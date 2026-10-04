import { getSql } from "@/lib/server/db";
import {
  ACCESS_TTL_SECONDS,
  CODE_TTL_SECONDS,
  LAST_USED_THROTTLE_SECONDS,
  REFRESH_TTL_SECONDS,
} from "@/lib/server/oauth/config";
import { randomToken, sha256Hex, verifyPkce } from "@/lib/server/oauth/crypto";
import type { ConsentRequest } from "@/lib/server/oauth/authorize";
import { resolveScope, scopeList } from "@/lib/server/oauth/validation";
import { assistantForGrantName, describeParty, type AssistantId } from "@/lib/assistant-party";
import { COPY } from "@/lib/copy";
import { sendNotice } from "@/lib/server/email/notify";

/**
 * Codes, grants and tokens: the stateful half of the authorization server.
 *
 * A grant is what a person allowed one client to do. It is made when a
 * code is first exchanged (an approval nobody redeems leaves nothing
 * behind) and reused when the same person approves the same client again,
 * so the account drawer lists one line per assistant. Every token hangs off
 * a grant; revoking the grant revokes them all.
 *
 * Two thefts are detected and answered by revoking the grant outright:
 * a code presented twice (RFC 6749 section 4.1.2), and a refresh token
 * presented after it was rotated (OAuth 2.1 section 4.3.1). Either means
 * two parties hold what only one should. The one exception is a rotated
 * refresh token retried within a minute while its successor lies unused
 * (REFRESH_RETRY_GRACE_SECONDS): a lost response, answered again.
 */

export type TokenError =
  | "invalid_request"
  | "invalid_grant"
  | "invalid_client"
  | "invalid_scope"
  | "invalid_target"
  | "unsupported_grant_type";

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

export type TokenResult = { ok: true; body: TokenResponse } | { ok: false; error: TokenError; description: string };

function iso(date: Date): string {
  return date.toISOString();
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

/** Issue a single use code for an approved consent request. Returns the plain code; only its hash is kept. */
export async function issueCode(userId: string, request: ConsentRequest, now = new Date()): Promise<string> {
  const code = randomToken(32);
  await getSql().query(
    `insert into oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at, redirect_uri_sent)
     values ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9)`,
    [
      sha256Hex(code),
      request.clientId,
      userId,
      request.redirectUri,
      request.codeChallenge,
      request.scope,
      request.resource,
      iso(addSeconds(now, CODE_TTL_SECONDS)),
      request.redirectUriSent !== false,
    ],
  );
  return code;
}

/** Revoke a grant and every token under it. */
export async function revokeGrant(grantId: string, now = new Date()): Promise<void> {
  const sql = getSql();
  await sql.query(`update oauth_grants set revoked_at = coalesce(revoked_at, $2::timestamptz) where id = $1`, [grantId, iso(now)]);
  await sql.query(`update oauth_tokens set revoked_at = coalesce(revoked_at, $2::timestamptz) where grant_id = $1`, [grantId, iso(now)]);
}

async function mintPair(grantId: string, scope: string, now: Date): Promise<TokenResponse> {
  const access = randomToken(32);
  const refresh = randomToken(32);
  await getSql().query(
    `insert into oauth_tokens (token_hash, grant_id, kind, expires_at, scope) values
       ($1, $3, 'access', $4::timestamptz, $6),
       ($2, $3, 'refresh', $5::timestamptz, $6)`,
    [sha256Hex(access), sha256Hex(refresh), grantId, iso(addSeconds(now, ACCESS_TTL_SECONDS)), iso(addSeconds(now, REFRESH_TTL_SECONDS)), scope],
  );
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_SECONDS, refresh_token: refresh, scope };
}

type CodeRow = {
  code_hash: string;
  client_id: string;
  user_id: string;
  grant_id: string | null;
  redirect_uri: string;
  redirect_uri_sent: boolean;
  code_challenge: string;
  scope: string;
  resource: string | null;
  expires_at: string | Date;
};

export type CodeExchange = {
  code?: string | null;
  clientId?: string | null;
  redirectUri?: string | null;
  codeVerifier?: string | null;
  resource?: string | null;
  /** The resource this server serves, `${origin}/mcp`. */
  expectedResource: string;
  /** The client, for the name the account drawer shows (derived from where the code went, lib/assistant-party). */
  client: { kind: "dcr" | "cimd"; clientId: string; name: string | null };
};

/** The line the account drawer shows for a grant: the assistant's own name, the redirect host, or an app on this computer. */
export function grantLabel(client: CodeExchange["client"], redirectUri: string): string {
  const party = describeParty(client, redirectUri);
  if (party.kind === "known") return party.name;
  if (party.kind === "loopback") return COPY.assistantLocalApp;
  return party.host;
}

/** grant_type=authorization_code. */
export async function exchangeCode(input: CodeExchange, now = new Date()): Promise<TokenResult> {
  const { code, clientId, redirectUri, codeVerifier } = input;
  if (!code || !clientId || !codeVerifier) {
    return { ok: false, error: "invalid_request", description: "code, client_id and code_verifier are required" };
  }
  const sql = getSql();
  const codeHash = sha256Hex(code);
  // Claim first, atomically: of two racing exchanges exactly one gets the row.
  const claimed = (await sql.query(
    `update oauth_codes set used_at = $2::timestamptz where code_hash = $1 and used_at is null
     returning code_hash, client_id, user_id, grant_id, redirect_uri, redirect_uri_sent, code_challenge, scope, resource, expires_at`,
    [codeHash, iso(now)],
  )) as CodeRow[];
  const row = claimed[0];
  if (!row) {
    // Mark the replay first: an exchange still linking its grant reads the
    // mark in its own linking statement (below) and revokes what it made.
    const seen = (await sql.query(
      `update oauth_codes set replayed_at = coalesce(replayed_at, $2::timestamptz) where code_hash = $1
       returning grant_id, user_id, client_id`,
      [codeHash, iso(now)],
    )) as { grant_id: string | null; user_id: string; client_id: string }[];
    if (seen[0]) {
      // Presented twice: whoever redeemed it first may be the thief. The
      // person's live grant to this client goes too, whichever it is.
      if (seen[0].grant_id) await revokeGrant(seen[0].grant_id, now);
      const live = (await sql.query(
        `select id from oauth_grants where user_id = $1 and client_id = $2 and revoked_at is null`,
        [seen[0].user_id, seen[0].client_id],
      )) as { id: string }[];
      for (const grant of live) await revokeGrant(grant.id, now);
      console.warn("[oauth] authorization code reused; grant revoked", seen[0].grant_id);
      return { ok: false, error: "invalid_grant", description: "code already used" };
    }
    return { ok: false, error: "invalid_grant", description: "unknown code" };
  }
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    return { ok: false, error: "invalid_grant", description: "code expired" };
  }
  if (row.client_id !== clientId) return { ok: false, error: "invalid_grant", description: "code was issued to another client" };
  // Required only when the authorization request named it; if given anyway, it must match.
  if ((row.redirect_uri_sent && !redirectUri) || (redirectUri && redirectUri !== row.redirect_uri)) {
    return { ok: false, error: "invalid_grant", description: "redirect_uri does not match the authorization request" };
  }
  if (!verifyPkce(codeVerifier, row.code_challenge)) {
    return { ok: false, error: "invalid_grant", description: "code_verifier does not match" };
  }
  const bound = row.resource ?? input.expectedResource;
  if (input.resource && input.resource.replace(/\/+$/, "") !== bound) {
    return { ok: false, error: "invalid_target", description: "resource does not match the authorization request" };
  }

  const clientName = grantLabel(input.client, row.redirect_uri);
  // One live grant per person and client: approving again refreshes it.
  const existing = (await sql.query(
    `update oauth_grants set scope = $3, client_name = coalesce($4, client_name), resource = $5
      where id = (select id from oauth_grants
                   where user_id = $1 and client_id = $2 and revoked_at is null
                   order by created_at desc limit 1)
      returning id`,
    [row.user_id, row.client_id, row.scope, clientName, bound],
  )) as { id: string }[];
  if (existing[0]) {
    // Approving again starts a new chain: refresh tokens from before stop
    // working, so a copy left behind somewhere cannot outlive the new consent.
    await sql.query(
      `update oauth_tokens set revoked_at = $2::timestamptz where grant_id = $1 and kind = 'refresh' and revoked_at is null`,
      [existing[0].id, iso(now)],
    );
  }
  const grantId =
    existing[0]?.id ??
    (
      (await sql.query(
        `insert into oauth_grants (user_id, client_id, client_name, scope, resource) values ($1, $2, $3, $4, $5) returning id`,
        [row.user_id, row.client_id, clientName, row.scope, bound],
      )) as { id: string }[]
    )[0].id;
  const linked = (await sql.query(`update oauth_codes set grant_id = $2 where code_hash = $1 returning replayed_at`, [
    codeHash,
    grantId,
  ])) as { replayed_at: string | Date | null }[];
  if (linked[0]?.replayed_at) {
    await revokeGrant(grantId, now);
    console.warn("[oauth] authorization code replayed during its exchange; grant revoked", grantId);
    return { ok: false, error: "invalid_grant", description: "code already used" };
  }
  const pair = await mintPair(grantId, row.scope, now);
  // A new connection is a security notice (approving the same app again refreshes its grant and says nothing).
  if (!existing[0]) {
    sendNotice({
      userId: row.user_id,
      ref: grantId,
      notice: { type: "assistant_connected", app: clientName ?? COPY.email.assistantConnected.unnamed, scopes: scopeList(row.scope) },
    });
  }
  // A replay that marked the code after the link above found grant_id set
  // and revoked the grant, tokens minted just now included (mintPair rows
  // are revoked by grant; a grant revoked first leaves them unusable too).
  return { ok: true, body: pair };
}

type RefreshRow = {
  grant_id: string;
  token_scope: string | null;
  expires_at: string | Date;
  revoked_at: string | Date | null;
  replaced_by: string | null;
  client_id: string;
  scope: string;
  grant_revoked_at: string | Date | null;
};

/**
 * A rotated refresh token presented again this soon, while its successor has
 * never been used, is taken for a client retrying a refresh whose answer it
 * lost (a dropped connection, a timeout), not for a thief: it is answered
 * with a fresh pair that replaces the unused successor. Later than this, or
 * once the successor has been used, it is reuse and the grant is revoked.
 */
export const REFRESH_RETRY_GRACE_SECONDS = 60;

type RefreshInput = {
  refreshToken?: string | null;
  clientId?: string | null;
  scope?: string | null;
  resource?: string | null;
  expectedResource: string;
};

/** Revoke tokens this call minted but will not hand out. */
async function discardPair(pair: TokenResponse, now: Date): Promise<void> {
  await getSql().query(`update oauth_tokens set revoked_at = $3::timestamptz where token_hash in ($1, $2)`, [
    sha256Hex(pair.access_token),
    sha256Hex(pair.refresh_token),
    iso(now),
  ]);
}

/** grant_type=refresh_token, with rotation, reuse detection and a short retry grace. */
export async function refreshTokens(input: RefreshInput, now = new Date(), attempt = 0): Promise<TokenResult> {
  const { refreshToken, clientId } = input;
  if (!refreshToken || !clientId) return { ok: false, error: "invalid_request", description: "refresh_token and client_id are required" };
  const sql = getSql();
  const tokenHash = sha256Hex(refreshToken);
  const rows = (await sql.query(
    `select t.grant_id, t.scope as token_scope, t.expires_at, t.revoked_at, t.replaced_by, g.client_id, g.scope, g.revoked_at as grant_revoked_at
       from oauth_tokens t join oauth_grants g on g.id = t.grant_id
      where t.token_hash = $1 and t.kind = 'refresh'`,
    [tokenHash],
  )) as RefreshRow[];
  const row = rows[0];
  if (!row) return { ok: false, error: "invalid_grant", description: "unknown refresh token" };
  if (row.client_id !== clientId) return { ok: false, error: "invalid_grant", description: "refresh token was issued to another client" };
  if (row.grant_revoked_at) return { ok: false, error: "invalid_grant", description: "grant revoked" };
  if (input.resource && input.resource.replace(/\/+$/, "") !== input.expectedResource) {
    return { ok: false, error: "invalid_target", description: "resource does not match" };
  }
  // A refresh may narrow what the last token could do, never widen it, and
  // never past what the grant allows today.
  const granted = new Set(row.scope.split(" "));
  const allowed = (row.token_scope ?? row.scope).split(" ").filter((part) => granted.has(part)).join(" ");
  const scope = resolveScope(input.scope, allowed);

  if (row.replaced_by) {
    const rotatedAt = row.revoked_at ? new Date(row.revoked_at).getTime() : null;
    if (rotatedAt !== null && now.getTime() - rotatedAt <= REFRESH_RETRY_GRACE_SECONDS * 1000 && scope.ok && scope.scope) {
      const next = await mintPair(row.grant_id, scope.scope, now);
      // Retire the successor, but only if nobody has used it yet.
      const retired = (await sql.query(
        `update oauth_tokens set replaced_by = $2, revoked_at = $3::timestamptz
          where token_hash = $1 and kind = 'refresh' and replaced_by is null and revoked_at is null
          returning token_hash`,
        [row.replaced_by, sha256Hex(next.refresh_token), iso(now)],
      )) as unknown[];
      if (retired.length > 0) {
        await sql.query(`update oauth_tokens set replaced_by = $2 where token_hash = $1`, [tokenHash, sha256Hex(next.refresh_token)]);
        console.warn("[oauth] rotated refresh token retried within the grace; successor replaced", row.grant_id);
        return { ok: true, body: next };
      }
      await discardPair(next, now);
    }
    await revokeGrant(row.grant_id, now);
    console.warn("[oauth] rotated refresh token reused; grant revoked", row.grant_id);
    return { ok: false, error: "invalid_grant", description: "refresh token already used" };
  }
  if (row.revoked_at) return { ok: false, error: "invalid_grant", description: "refresh token revoked" };
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    return { ok: false, error: "invalid_grant", description: "refresh token expired" };
  }
  if (!scope.ok || !scope.scope) return { ok: false, error: "invalid_scope", description: "scope exceeds the grant" };

  const next = await mintPair(row.grant_id, scope.scope, now);
  // Rotate atomically: a second presenter racing this one finds replaced_by set.
  const rotated = (await sql.query(
    `update oauth_tokens set replaced_by = $2, revoked_at = $3::timestamptz
      where token_hash = $1 and replaced_by is null and revoked_at is null
      returning token_hash`,
    [tokenHash, sha256Hex(next.refresh_token), iso(now)],
  )) as unknown[];
  if (rotated.length === 0) {
    // Lost a race with a concurrent refresh of the same token: answer it as
    // a retry, which the grace above either serves or treats as reuse.
    await discardPair(next, now);
    if (attempt === 0) return refreshTokens(input, now, 1);
    await revokeGrant(row.grant_id, now);
    console.warn("[oauth] refresh token raced; grant revoked", row.grant_id);
    return { ok: false, error: "invalid_grant", description: "refresh token already used" };
  }
  return { ok: true, body: next };
}

export type VerifiedAccess = {
  userId: string;
  clientId: string;
  /** The grant's saved name, "Claude", "ChatGPT" or "Grok" only for those products' own hosts. */
  clientName: string | null;
  grantId: string;
  scopes: string[];
  /** Seconds since the epoch. */
  expiresAt: number;
  resource: string | null;
};

/**
 * The grant behind an access token, or null for anything unknown, expired,
 * revoked, or bound to another resource. Stamps the grant's last use, at
 * most once per LAST_USED_THROTTLE_SECONDS.
 */
export async function verifyAccessToken(
  token: string | null | undefined,
  expectedResource: string,
  now = new Date(),
): Promise<VerifiedAccess | null> {
  if (!token || token.length > 200) return null;
  const sql = getSql();
  const rows = (await sql.query(
    `select t.grant_id, t.expires_at, g.user_id, g.client_id, g.client_name, coalesce(t.scope, g.scope) as scope, g.resource, g.last_used_at
       from oauth_tokens t join oauth_grants g on g.id = t.grant_id
      where t.token_hash = $1 and t.kind = 'access' and t.revoked_at is null and g.revoked_at is null`,
    [sha256Hex(token)],
  )) as {
    grant_id: string;
    expires_at: string | Date;
    user_id: string;
    client_id: string;
    client_name: string | null;
    scope: string;
    resource: string | null;
    last_used_at: string | Date | null;
  }[];
  const row = rows[0];
  if (!row) return null;
  const expiresAt = new Date(row.expires_at).getTime();
  if (expiresAt <= now.getTime()) return null;
  if (row.resource && row.resource !== expectedResource) return null;
  if (!row.last_used_at || now.getTime() - new Date(row.last_used_at).getTime() > LAST_USED_THROTTLE_SECONDS * 1000) {
    await sql.query(`update oauth_grants set last_used_at = $2::timestamptz where id = $1`, [row.grant_id, iso(now)]);
  }
  return {
    userId: row.user_id,
    clientId: row.client_id,
    clientName: row.client_name,
    grantId: row.grant_id,
    scopes: scopeList(row.scope),
    expiresAt: Math.floor(expiresAt / 1000),
    resource: row.resource,
  };
}

/**
 * RFC 7009 revocation. A refresh token takes its whole grant with it; an
 * access token only itself. Unknown tokens, and tokens of another client,
 * are answered the same way (the caller always says 200).
 */
export async function revokeToken(token: string | null | undefined, clientId: string | null | undefined, now = new Date()): Promise<void> {
  if (!token || token.length > 200) return;
  const sql = getSql();
  const rows = (await sql.query(
    `select t.kind, t.grant_id, g.client_id from oauth_tokens t join oauth_grants g on g.id = t.grant_id where t.token_hash = $1`,
    [sha256Hex(token)],
  )) as { kind: "access" | "refresh"; grant_id: string; client_id: string }[];
  const row = rows[0];
  if (!row || (clientId && row.client_id !== clientId)) return;
  if (row.kind === "refresh") await revokeGrant(row.grant_id, now);
  else await sql.query(`update oauth_tokens set revoked_at = coalesce(revoked_at, $2::timestamptz) where token_hash = $1`, [sha256Hex(token), iso(now)]);
}

export type GrantSummary = {
  id: string;
  clientName: string;
  /** The known assistant this grant belongs to, for the drawer's Connected marks. */
  assistant: AssistantId | null;
  scope: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

/** The live grants on an account, newest first. */
export async function listGrants(userId: string): Promise<GrantSummary[]> {
  const rows = (await getSql().query(
    `select id, client_id, client_name, scope, created_at, last_used_at
       from oauth_grants where user_id = $1 and revoked_at is null
      order by coalesce(last_used_at, created_at) desc`,
    [userId],
  )) as { id: string; client_id: string; client_name: string | null; scope: string; created_at: string | Date; last_used_at: string | Date | null }[];
  return rows.map((row) => ({
    id: row.id,
    clientName: row.client_name ?? row.client_id,
    assistant: assistantForGrantName(row.client_name),
    scope: scopeList(row.scope),
    createdAt: new Date(row.created_at).toISOString(),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
  }));
}

/** Revoke one of an account's own grants. False when it is not theirs or already gone. */
export async function revokeUserGrant(userId: string, grantId: string, now = new Date()): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(grantId)) return false;
  const rows = (await getSql().query(`select id from oauth_grants where id = $1 and user_id = $2 and revoked_at is null`, [
    grantId,
    userId,
  ])) as { id: string }[];
  if (!rows[0]) return false;
  await revokeGrant(grantId, now);
  return true;
}
