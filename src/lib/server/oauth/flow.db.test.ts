import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "../db";
import { makeTestDb } from "../pglite-test-db";
import { getOrCreateUser } from "../accounts";
import { judgeAuthorizeRequest, readConsent, signConsent, type ConsentRequest } from "./authorize";
import { allowRegistration, getClient, registerClient } from "./clients";
import { RateLimitedError } from "./rate-limit";
import { pruneOAuth } from "./prune";
import { randomToken, s256Challenge } from "./crypto";
import type { SafeFetcher } from "./ssrf";
import {
  exchangeCode,
  issueCode,
  listGrants,
  refreshTokens,
  revokeToken,
  revokeUserGrant,
  verifyAccessToken,
} from "./tokens";

/**
 * The authorization server end to end against a real Postgres (PGlite with
 * db/schema.sql): registration, the authorization request's two kinds of
 * failure, codes that work once, refresh tokens that rotate, and the two
 * reuses that revoke a grant.
 */

const ORIGIN = "https://www.berthmarkets.com";
const RESOURCE = `${ORIGIN}/mcp`;
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

const CLIENT_FOR = (clientId: string) => ({ kind: "dcr" as const, clientId, name: "Claude" });

let sql: SqlClient;
let close: () => Promise<void>;
let userId: string;

beforeAll(async () => {
  process.env.SESSION_SECRET ??= "test-secret-for-oauth-consent";
  const db = await makeTestDb();
  sql = db.sql;
  close = db.close;
  setSqlClient(sql);
});

afterAll(async () => {
  setSqlClient(null);
  await close();
});

beforeEach(async () => {
  for (const table of ["oauth_tokens", "oauth_codes", "oauth_grants", "oauth_clients", "oauth_rate_limits", "users"]) {
    await sql.query(`delete from ${table}`);
  }
  userId = (await getOrCreateUser({ did: null, wallet: `0x${"a".repeat(40)}` }))!.user.id;
});

async function newClient(redirects = [REDIRECT], name = "Claude") {
  const result = await registerClient({ redirect_uris: redirects, client_name: name }, "1.2.3.4");
  if (!result.ok) throw new Error(result.description);
  return result.client;
}

function consentFor(clientId: string, verifier: string, overrides: Partial<ConsentRequest> = {}): ConsentRequest {
  return {
    clientId,
    party: { kind: "known", assistant: "claude", name: "Claude" },
    redirectUri: REDIRECT,
    redirectUriSent: true,
    redirectHost: "claude.ai",
    scope: "berth.read berth.draft",
    state: "xyz",
    codeChallenge: s256Challenge(verifier),
    resource: RESOURCE,
    ...overrides,
  };
}

async function tokensFor(clientId: string) {
  const verifier = randomToken(48);
  const code = await issueCode(userId, consentFor(clientId, verifier));
  const result = await exchangeCode({
    code,
    clientId,
    redirectUri: REDIRECT,
    codeVerifier: verifier,
    resource: RESOURCE,
    expectedResource: RESOURCE,
    client: CLIENT_FOR(clientId),
  });
  if (!result.ok) throw new Error(result.description);
  return result.body;
}

describe("registration", () => {
  it("registers a public client and finds it again", async () => {
    const client = await newClient();
    expect(client.clientId).toMatch(/^berth_/);
    expect(await getClient(client.clientId)).toEqual(client);
    expect(await getClient("berth_nobody")).toBeNull();
  });

  it("rate limits one caller", async () => {
    for (let i = 0; i < 20; i += 1) await newClient();
    const refused = await registerClient({ redirect_uris: [REDIRECT] }, "1.2.3.4");
    expect(refused).toMatchObject({ ok: false, error: "rate_limited" });
    expect((await registerClient({ redirect_uris: [REDIRECT] }, "5.6.7.8")).ok).toBe(true);
  });

  it("never lets racing registrations past the limit", async () => {
    const results = await Promise.all(
      Array.from({ length: 30 }, () => registerClient({ redirect_uris: [REDIRECT] }, "9.9.9.9")),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(20);
  });

  it("caps registrations from everyone together", async () => {
    const now = new Date();
    for (let i = 0; i < 500; i += 1) expect(await allowRegistration(`10.0.${Math.floor(i / 20)}.${i % 20}`, now)).toBe(true);
    expect(await allowRegistration("10.9.9.9", now)).toBe(false);
    // A new hour, a new window.
    expect(await allowRegistration("10.9.9.9", new Date(now.getTime() + 3600_000))).toBe(true);
  });
});

describe("the authorization request", () => {
  const challenge = s256Challenge(randomToken(48));

  it("asks for consent when everything is in order", async () => {
    const client = await newClient();
    const outcome = await judgeAuthorizeRequest(
      {
        response_type: "code",
        client_id: client.clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "abc",
        resource: RESOURCE,
      },
      ORIGIN,
    );
    expect(outcome.kind).toBe("consent");
    if (outcome.kind !== "consent") return;
    expect(outcome.request).toMatchObject({ party: { kind: "known", name: "Claude" }, redirectHost: "claude.ai", scope: "berth.read berth.draft", resource: RESOURCE });

    const token = await signConsent(outcome.request, ORIGIN);
    expect(await readConsent(token, ORIGIN)).toEqual(outcome.request);
    expect(await readConsent(token, "https://elsewhere.example")).toBeNull();
    expect(await readConsent(`${token}x`, ORIGIN)).toBeNull();
  });

  it("never redirects for an unknown client or an unregistered redirect", async () => {
    const client = await newClient();
    expect(
      await judgeAuthorizeRequest({ response_type: "code", client_id: "berth_ghost", redirect_uri: REDIRECT }, ORIGIN),
    ).toEqual({ kind: "error", reason: "unknown_client" });
    expect(
      await judgeAuthorizeRequest(
        { response_type: "code", client_id: client.clientId, redirect_uri: "https://evil.example/cb", code_challenge: challenge, code_challenge_method: "S256" },
        ORIGIN,
      ),
    ).toEqual({ kind: "error", reason: "bad_redirect_uri" });
  });

  it("sends other problems back to the client with state and iss", async () => {
    const client = await newClient();
    const base = { response_type: "code", client_id: client.clientId, redirect_uri: REDIRECT, state: "s1", code_challenge: challenge, code_challenge_method: "S256" };
    const errorOf = async (params: Record<string, string | null>) => {
      const outcome = await judgeAuthorizeRequest({ ...base, ...params }, ORIGIN);
      if (outcome.kind !== "redirect") throw new Error(`expected a redirect, got ${outcome.kind}`);
      const url = new URL(outcome.url);
      expect(url.origin + url.pathname).toBe(REDIRECT);
      expect(url.searchParams.get("state")).toBe("s1");
      expect(url.searchParams.get("iss")).toBe(ORIGIN);
      return url.searchParams.get("error");
    };
    expect(await errorOf({ code_challenge: null })).toBe("invalid_request");
    expect(await errorOf({ code_challenge_method: "plain" })).toBe("invalid_request");
    expect(await errorOf({ response_type: "token" })).toBe("unsupported_response_type");
    expect(await errorOf({ resource: "https://evil.example/mcp" })).toBe("invalid_target");
    expect(await errorOf({ scope: "berth.read berth.withdraw" })).toBe("invalid_scope");
  });
});

describe("codes", () => {
  it("exchanges once, with PKCE, for a working token pair", async () => {
    const client = await newClient();
    const tokens = await tokensFor(client.clientId);
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "berth.read berth.draft" });

    const access = await verifyAccessToken(tokens.access_token, RESOURCE);
    expect(access).toMatchObject({ userId, clientId: client.clientId, scopes: ["berth.read", "berth.draft"] });
    expect(await verifyAccessToken(tokens.access_token, "https://other.example/mcp")).toBeNull();
    expect(await verifyAccessToken("not-a-token", RESOURCE)).toBeNull();

    const grants = await listGrants(userId);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ clientName: "Claude", assistant: "claude" });
    expect(grants[0].lastUsedAt).not.toBeNull();
  });

  it("revokes the grant when a code is presented twice", async () => {
    const client = await newClient();
    const verifier = randomToken(48);
    const code = await issueCode(userId, consentFor(client.clientId, verifier));
    const exchange = { code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: verifier, expectedResource: RESOURCE, client: CLIENT_FOR(client.clientId) };
    const first = await exchangeCode(exchange);
    expect(first.ok).toBe(true);
    const second = await exchangeCode(exchange);
    expect(second).toMatchObject({ ok: false, error: "invalid_grant" });
    if (first.ok) expect(await verifyAccessToken(first.body.access_token, RESOURCE)).toBeNull();
    expect(await listGrants(userId)).toHaveLength(0);
  });

  it("revokes what the first exchange made when the replay races it", async () => {
    const client = await newClient();
    const verifier = randomToken(48);
    const code = await issueCode(userId, consentFor(client.clientId, verifier));
    const exchange = { code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: verifier, expectedResource: RESOURCE, client: CLIENT_FOR(client.clientId) };
    const results = await Promise.all([exchangeCode(exchange), exchangeCode(exchange)]);
    expect(results.filter((result) => !result.ok)).not.toHaveLength(0);
    for (const result of results) if (result.ok) expect(await verifyAccessToken(result.body.access_token, RESOURCE)).toBeNull();
    expect(await listGrants(userId)).toHaveLength(0);
  });

  it("refuses a mismatched redirect, verifier, client or resource, and an expired code", async () => {
    const client = await newClient();
    const other = await newClient();
    const attempt = async (overrides: Record<string, unknown>, issuedAt = new Date()) => {
      const verifier = randomToken(48);
      const code = await issueCode(userId, consentFor(client.clientId, verifier), issuedAt);
      return exchangeCode({
        code,
        clientId: client.clientId,
        redirectUri: REDIRECT,
        codeVerifier: verifier,
        expectedResource: RESOURCE,
        client: CLIENT_FOR(client.clientId),
        ...overrides,
      });
    };
    expect(await attempt({ redirectUri: "https://claude.ai/other" })).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(await attempt({ codeVerifier: randomToken(48) })).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(await attempt({ clientId: other.clientId })).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(await attempt({ resource: "https://evil.example/mcp" })).toMatchObject({ ok: false, error: "invalid_target" });
    expect(await attempt({}, new Date(Date.now() - 5 * 60_000))).toMatchObject({ ok: false, error: "invalid_grant", description: "code expired" });
    expect(await exchangeCode({ code: "made-up", clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: randomToken(48), expectedResource: RESOURCE, client: CLIENT_FOR(client.clientId) })).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("asks for redirect_uri at the token endpoint only when authorize named it", async () => {
    const client = await newClient();
    const exchange = async (sent: boolean, redirectUri: string | null) => {
      const verifier = randomToken(48);
      const code = await issueCode(userId, consentFor(client.clientId, verifier, { redirectUriSent: sent }));
      return exchangeCode({ code, clientId: client.clientId, redirectUri, codeVerifier: verifier, expectedResource: RESOURCE, client: CLIENT_FOR(client.clientId) });
    };
    expect(await exchange(true, null)).toMatchObject({ ok: false, error: "invalid_grant" });
    expect((await exchange(false, null)).ok).toBe(true);
    expect((await exchange(false, REDIRECT)).ok).toBe(true);
    expect(await exchange(false, "https://claude.ai/other")).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("keeps one grant per person and client across approvals", async () => {
    const client = await newClient();
    const before = await tokensFor(client.clientId);
    const after = await tokensFor(client.clientId);
    expect(await listGrants(userId)).toHaveLength(1);
    // The new approval starts a new chain; the old refresh token is done, the grant is not.
    const refresh = (token: string) => refreshTokens({ refreshToken: token, clientId: client.clientId, expectedResource: RESOURCE });
    expect(await refresh(before.refresh_token)).toMatchObject({ ok: false, description: "refresh token revoked" });
    expect((await refresh(after.refresh_token)).ok).toBe(true);
    expect(await listGrants(userId)).toHaveLength(1);
  });
});

describe("refresh tokens", () => {
  it("rotate, and the old one stops working", async () => {
    const client = await newClient();
    const first = await tokensFor(client.clientId);
    const refreshed = await refreshTokens({ refreshToken: first.refresh_token, clientId: client.clientId, expectedResource: RESOURCE });
    expect(refreshed.ok).toBe(true);
    if (!refreshed.ok) return;
    expect(refreshed.body.refresh_token).not.toBe(first.refresh_token);
    expect(await verifyAccessToken(refreshed.body.access_token, RESOURCE)).not.toBeNull();
  });

  it("revoke the whole grant when a rotated one comes back", async () => {
    const client = await newClient();
    const first = await tokensFor(client.clientId);
    const second = await refreshTokens({ refreshToken: first.refresh_token, clientId: client.clientId, expectedResource: RESOURCE });
    if (!second.ok) throw new Error("refresh failed");
    const later = new Date(Date.now() + 61_000);
    const replay = await refreshTokens({ refreshToken: first.refresh_token, clientId: client.clientId, expectedResource: RESOURCE }, later);
    expect(replay).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(await verifyAccessToken(second.body.access_token, RESOURCE, later)).toBeNull();
    const afterTheft = await refreshTokens({ refreshToken: second.body.refresh_token, clientId: client.clientId, expectedResource: RESOURCE }, later);
    expect(afterTheft).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("answer a retry within a minute while the successor is unused, replacing the successor", async () => {
    const client = await newClient();
    const first = await tokensFor(client.clientId);
    const refresh = (token: string, at = new Date()) =>
      refreshTokens({ refreshToken: token, clientId: client.clientId, expectedResource: RESOURCE }, at);
    const lost = await refresh(first.refresh_token);
    if (!lost.ok) throw new Error("refresh failed");
    // The client never saw `lost` and tries again with the old token.
    const retry = await refresh(first.refresh_token, new Date(Date.now() + 30_000));
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.body.refresh_token).not.toBe(lost.body.refresh_token);
    // The unused successor is retired: presenting it later is reuse like any other.
    expect(await refresh(lost.body.refresh_token, new Date(Date.now() + 150_000))).toMatchObject({ ok: false });
    expect(await listGrants(userId)).toHaveLength(0);
  });

  it("keep the grant through repeated retries and serve the new chain", async () => {
    const client = await newClient();
    const first = await tokensFor(client.clientId);
    const refresh = (token: string, at = new Date()) =>
      refreshTokens({ refreshToken: token, clientId: client.clientId, expectedResource: RESOURCE }, at);
    await refresh(first.refresh_token);
    await refresh(first.refresh_token, new Date(Date.now() + 10_000));
    const third = await refresh(first.refresh_token, new Date(Date.now() + 20_000));
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(await verifyAccessToken(third.body.access_token, RESOURCE)).not.toBeNull();
    const onward = await refresh(third.body.refresh_token, new Date(Date.now() + 120_000));
    expect(onward.ok).toBe(true);
    expect(await listGrants(userId)).toHaveLength(1);
  });

  it("still revoke on a retry once the successor has been used", async () => {
    const client = await newClient();
    const first = await tokensFor(client.clientId);
    const refresh = (token: string, at = new Date()) =>
      refreshTokens({ refreshToken: token, clientId: client.clientId, expectedResource: RESOURCE }, at);
    const second = await refresh(first.refresh_token);
    if (!second.ok) throw new Error("refresh failed");
    expect((await refresh(second.body.refresh_token, new Date(Date.now() + 5_000))).ok).toBe(true);
    expect(await refresh(first.refresh_token, new Date(Date.now() + 10_000))).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(await listGrants(userId)).toHaveLength(0);
  });

  it("serve both of two concurrent refreshes of the same token", async () => {
    const client = await newClient();
    const first = await tokensFor(client.clientId);
    const input = { refreshToken: first.refresh_token, clientId: client.clientId, expectedResource: RESOURCE };
    const [a, b] = await Promise.all([refreshTokens(input), refreshTokens(input)]);
    expect(a.ok && b.ok).toBe(true);
    expect(await listGrants(userId)).toHaveLength(1);
  });

  it("narrow scope on request but never widen it", async () => {
    const client = await newClient();
    const first = await tokensFor(client.clientId);
    const narrowed = await refreshTokens({ refreshToken: first.refresh_token, clientId: client.clientId, scope: "berth.read", expectedResource: RESOURCE });
    expect(narrowed).toMatchObject({ ok: true, body: { scope: "berth.read" } });
    if (!narrowed.ok) return;
    // The narrowed token really is narrower, and so is the next refresh by default.
    expect((await verifyAccessToken(narrowed.body.access_token, RESOURCE))?.scopes).toEqual(["berth.read"]);
    const widened = await refreshTokens({ refreshToken: narrowed.body.refresh_token, clientId: client.clientId, scope: "berth.read berth.draft", expectedResource: RESOURCE });
    expect(widened).toMatchObject({ ok: false, error: "invalid_scope" });
  });

  it("keep a narrowed scope when refreshed without asking", async () => {
    const client = await newClient();
    const first = await tokensFor(client.clientId);
    const narrowed = await refreshTokens({ refreshToken: first.refresh_token, clientId: client.clientId, scope: "berth.read", expectedResource: RESOURCE });
    if (!narrowed.ok) throw new Error("narrowing failed");
    const again = await refreshTokens({ refreshToken: narrowed.body.refresh_token, clientId: client.clientId, expectedResource: RESOURCE });
    expect(again).toMatchObject({ ok: true, body: { scope: "berth.read" } });
  });

  it("belong to their client", async () => {
    const client = await newClient();
    const other = await newClient();
    const first = await tokensFor(client.clientId);
    expect(await refreshTokens({ refreshToken: first.refresh_token, clientId: other.clientId, expectedResource: RESOURCE })).toMatchObject({ ok: false, error: "invalid_grant" });
  });
});

describe("revocation", () => {
  it("of a refresh token ends the grant, of an access token only itself", async () => {
    const client = await newClient();
    const a = await tokensFor(client.clientId);
    await revokeToken(a.access_token, client.clientId);
    expect(await verifyAccessToken(a.access_token, RESOURCE)).toBeNull();
    expect((await refreshTokens({ refreshToken: a.refresh_token, clientId: client.clientId, expectedResource: RESOURCE })).ok).toBe(true);

    const b = await tokensFor(client.clientId);
    await revokeToken(b.refresh_token, client.clientId);
    expect(await verifyAccessToken(b.access_token, RESOURCE)).toBeNull();
    expect(await listGrants(userId)).toHaveLength(0);
  });

  it("from the account drawer only reaches the account's own grants", async () => {
    const client = await newClient();
    const tokens = await tokensFor(client.clientId);
    const [grant] = await listGrants(userId);
    const stranger = (await getOrCreateUser({ did: null, wallet: `0x${"b".repeat(40)}` }))!.user.id;
    expect(await revokeUserGrant(stranger, grant.id)).toBe(false);
    expect(await verifyAccessToken(tokens.access_token, RESOURCE)).not.toBeNull();
    expect(await revokeUserGrant(userId, grant.id)).toBe(true);
    expect(await verifyAccessToken(tokens.access_token, RESOURCE)).toBeNull();
    expect(await revokeUserGrant(userId, grant.id)).toBe(false);
  });
});

describe("client metadata documents", () => {
  const id = "https://client.example/oauth/meta.json";
  const doc = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({ client_id: id, client_name: "Example Assistant", redirect_uris: ["https://client.example/cb"], ...overrides });
  const serving = (body: string, calls: string[] = []): SafeFetcher => async (url) => {
    calls.push(url);
    return { ok: true, status: 200, body, contentType: "application/json" };
  };

  it("fetches, checks and caches a document", async () => {
    const calls: string[] = [];
    const client = await getClient(id, { fetcher: serving(doc(), calls) });
    expect(client).toEqual({ clientId: id, kind: "cimd", name: "Example Assistant", redirectUris: ["https://client.example/cb"] });
    await getClient(id, { fetcher: serving(doc(), calls) });
    expect(calls).toHaveLength(1);
    // Stale after the cache window: fetched again.
    await getClient(id, { fetcher: serving(doc(), calls), now: new Date(Date.now() + 11 * 60_000) });
    expect(calls).toHaveLength(2);
  });

  it("limits the document fetches one caller can cause at authorize", async () => {
    const calls: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      await getClient(`https://client.example/meta-${i}.json`, { fetcher: serving(doc(), calls), fetchKey: "7.7.7.7" });
    }
    expect(calls).toHaveLength(30);
    await expect(getClient(id, { fetcher: serving(doc(), calls), fetchKey: "7.7.7.7" })).rejects.toBeInstanceOf(RateLimitedError);
    expect(calls).toHaveLength(30);
    // Someone else, and a cached document, are unaffected.
    expect(await getClient(id, { fetcher: serving(doc(), calls), fetchKey: "8.8.8.8" })).not.toBeNull();
    expect(await getClient(id, { fetcher: serving(doc(), calls), fetchKey: "7.7.7.7" })).not.toBeNull();
  });

  it("serves the stale copy of a known client only where asked to", async () => {
    await getClient(id, { fetcher: serving(doc()) });
    const later = new Date(Date.now() + 11 * 60_000);
    const down: SafeFetcher = async () => ({ ok: false, reason: "timeout" });
    expect(await getClient(id, { fetcher: down, now: later })).toBeNull();
    expect(await getClient(id, { fetcher: down, now: later, allowStale: true })).toMatchObject({ clientId: id, kind: "cimd" });
    // Never for a client it has not seen.
    expect(await getClient("https://unseen.example/meta.json", { fetcher: down, allowStale: true })).toBeNull();
  });

  it("refuses a document naming another client, a failed fetch, and a non-document id", async () => {
    expect(await getClient(id, { fetcher: serving(doc({ client_id: "https://evil.example/meta.json" })) })).toBeNull();
    expect(await getClient(id, { fetcher: async () => ({ ok: false, reason: "not a public address" }) })).toBeNull();
    expect(await getClient(id, { fetcher: async () => ({ ok: true, status: 404, body: "", contentType: null }) })).toBeNull();
    const calls: string[] = [];
    expect(await getClient("https://client.example/", { fetcher: serving(doc(), calls) })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("drives a full authorization with a metadata document client", async () => {
    const outcome = await judgeAuthorizeRequest(
      {
        response_type: "code",
        client_id: id,
        redirect_uri: "https://client.example/cb",
        code_challenge: s256Challenge(randomToken(48)),
        code_challenge_method: "S256",
      },
      ORIGIN,
      { fetcher: serving(doc()) },
    );
    expect(outcome).toMatchObject({ kind: "consent", request: { party: { kind: "unknown", host: "client.example", selfName: "Example Assistant" }, redirectHost: "client.example" } });
  });
});

describe("pruning", () => {
  it("removes expired codes, long dead tokens and clients nobody granted, and nothing live", async () => {
    const granted = await newClient();
    const idle = await newClient(["https://idle.example/cb"], "Idle");
    const old = await tokensFor(granted.clientId);
    await revokeToken(old.access_token, granted.clientId);
    // Approving again retires the old refresh token too.
    const live = await tokensFor(granted.clientId);
    await sql.query(`update oauth_clients set created_at = now() - interval '8 days'`);
    await sql.query(`update oauth_tokens set revoked_at = now() - interval '8 days' where revoked_at is not null`);
    await sql.query(`update oauth_codes set expires_at = now() - interval '2 hours'`);
    const summary = await pruneOAuth();
    expect(summary.codes).toBeGreaterThanOrEqual(2);
    expect(summary.tokens).toBe(2);
    expect(summary.clients).toBe(1);
    expect(await getClient(idle.clientId)).toBeNull();
    expect(await getClient(granted.clientId)).not.toBeNull();
    expect(await verifyAccessToken(live.access_token, RESOURCE)).not.toBeNull();
  });
});
