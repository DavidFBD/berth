import { getSql } from "@/lib/server/db";
import {
  CIMD_CACHE_SECONDS,
  CIMD_FETCH_LIMIT_PER_HOUR,
  REGISTER_GLOBAL_LIMIT_PER_HOUR,
  REGISTER_LIMIT_PER_HOUR,
} from "@/lib/server/oauth/config";
import { RateLimitedError, takeRatePlace } from "@/lib/server/oauth/rate-limit";
import { randomToken } from "@/lib/server/oauth/crypto";
import { safeFetch, type SafeFetcher } from "@/lib/server/oauth/ssrf";
import { cleanClientName, isAllowedRedirectUri, isCimdClientId } from "@/lib/server/oauth/validation";
import { isLoopbackUri, isReservedName, knownAssistantFor } from "@/lib/assistant-party";

/**
 * Who may ask for a grant. Two ways to be a client:
 *
 * - Dynamic Client Registration (RFC 7591): POST /oauth/register with
 *   redirect URIs, get back a random client_id. Public clients only, no
 *   secret, rate limited per caller.
 * - Client ID Metadata Document: the client_id is an https URL serving the
 *   client's own metadata. We fetch it (lib/server/oauth/ssrf), insist its
 *   client_id field names that same URL, and keep it for a few minutes.
 *
 * Either way the answer is the same shape: an id, a name to show, and the
 * exact redirect URIs a code may be sent to.
 */

export type OAuthClient = {
  clientId: string;
  kind: "dcr" | "cimd";
  name: string | null;
  redirectUris: string[];
};

export const MAX_REDIRECT_URIS = 10;

export type RegisterResult =
  | { ok: true; client: OAuthClient }
  | { ok: false; error: "invalid_redirect_uri" | "invalid_client_metadata" | "rate_limited"; description: string };

/**
 * Validate a registration body (pure). `clientId` is the metadata document
 * URL when the body is one, since that host vouches for the client too.
 *
 * A name that borrows a known assistant's (Claude, ChatGPT, OpenAI,
 * Anthropic, Grok, xAI) is refused unless every redirect is on that
 * assistant's own hosts, or the document is served from one. A desktop app
 * answering only on loopback keeps its registration but loses the name: the
 * consent screen calls it an app on this computer either way.
 */
export function parseRegistration(body: Record<string, unknown>, clientId?: string):
  | { ok: true; name: string | null; redirectUris: string[] }
  | { ok: false; error: "invalid_redirect_uri" | "invalid_client_metadata"; description: string } {
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0) {
    return { ok: false, error: "invalid_redirect_uri", description: "redirect_uris is required" };
  }
  if (uris.length > MAX_REDIRECT_URIS) {
    return { ok: false, error: "invalid_redirect_uri", description: `at most ${MAX_REDIRECT_URIS} redirect_uris` };
  }
  if (!uris.every(isAllowedRedirectUri)) {
    return {
      ok: false,
      error: "invalid_redirect_uri",
      description: "redirect_uris must be https, or http on a loopback address",
    };
  }
  // Public clients only. A client that prefers another method but lists
  // "none" among those it supports (ChatGPT's published document prefers
  // private_key_jwt) is taken as public: Berth advertises only "none", so
  // that is what it will use, and PKCE is the proof either way.
  const method = body.token_endpoint_auth_method;
  const supported = body.token_endpoint_auth_methods_supported;
  const canBePublic = Array.isArray(supported) && supported.includes("none");
  if (method !== undefined && method !== "none" && !canBePublic) {
    return { ok: false, error: "invalid_client_metadata", description: "only public clients (token_endpoint_auth_method none)" };
  }
  // A client may list grants Berth does not offer (Claude's published
  // document adds jwt-bearer); only code and refresh are ever issued, so the
  // extras are ignored rather than refused. Code must be among them.
  const grantTypes = body.grant_types;
  if (
    grantTypes !== undefined &&
    (!Array.isArray(grantTypes) ||
      !grantTypes.every((grant) => typeof grant === "string") ||
      !grantTypes.includes("authorization_code"))
  ) {
    return { ok: false, error: "invalid_client_metadata", description: "grant_types must include authorization_code" };
  }
  const responseTypes = body.response_types;
  if (
    responseTypes !== undefined &&
    (!Array.isArray(responseTypes) ||
      !responseTypes.every((type) => typeof type === "string") ||
      !responseTypes.includes("code"))
  ) {
    return { ok: false, error: "invalid_client_metadata", description: "response_types must include code" };
  }
  const redirectUris = [...new Set(uris as string[])];
  let name = cleanClientName(body.client_name);
  if (isReservedName(name)) {
    const vouched =
      (clientId !== undefined && knownAssistantFor(clientId) !== null) ||
      redirectUris.every((uri) => knownAssistantFor(uri) !== null);
    if (!vouched) {
      if (!redirectUris.every(isLoopbackUri)) {
        return {
          ok: false,
          error: "invalid_client_metadata",
          description: "client_name names an assistant whose hosts these redirect_uris are not on",
        };
      }
      name = null;
    }
  }
  return { ok: true, name, redirectUris };
}

/**
 * Take a registration place for this caller and in all, this hour. The
 * global cap bounds what a spread of addresses can register together.
 */
export async function allowRegistration(callerKey: string, now = new Date()): Promise<boolean> {
  if (!(await takeRatePlace("register", callerKey, REGISTER_LIMIT_PER_HOUR, now))) return false;
  return takeRatePlace("register:all", "all", REGISTER_GLOBAL_LIMIT_PER_HOUR, now);
}

export async function registerClient(body: Record<string, unknown>, callerKey: string): Promise<RegisterResult> {
  const parsed = parseRegistration(body);
  if (!parsed.ok) return parsed;
  if (!(await allowRegistration(callerKey))) {
    return { ok: false, error: "rate_limited", description: "too many registrations, try again later" };
  }
  const clientId = `berth_${randomToken(18)}`;
  await getSql().query(
    `insert into oauth_clients (client_id, kind, name, redirect_uris) values ($1, 'dcr', $2, $3::text[])`,
    [clientId, parsed.name, parsed.redirectUris],
  );
  return { ok: true, client: { clientId, kind: "dcr", name: parsed.name, redirectUris: parsed.redirectUris } };
}

export type CimdResult = { ok: true; name: string | null; redirectUris: string[] } | { ok: false; reason: string };

/**
 * Judge a fetched Client ID Metadata Document (pure): JSON, its client_id
 * exactly the URL it was fetched from, redirect URIs we would accept at
 * registration, a public client.
 */
export function parseCimdDocument(clientId: string, body: string): CimdResult {
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch {
    return { ok: false, reason: "not json" };
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { ok: false, reason: "not an object" };
  const record = doc as Record<string, unknown>;
  if (record.client_id !== clientId) return { ok: false, reason: "client_id does not match the document URL" };
  const parsed = parseRegistration(record, clientId);
  if (!parsed.ok) return { ok: false, reason: parsed.description };
  if ("client_secret" in record || "client_secret_expires_at" in record) {
    return { ok: false, reason: "a metadata document must not carry a secret" };
  }
  return { ok: true, name: parsed.name, redirectUris: parsed.redirectUris };
}

type ClientRow = { client_id: string; kind: "dcr" | "cimd"; name: string | null; redirect_uris: string[]; fetched_at: string | Date | null };

function toClient(row: ClientRow): OAuthClient {
  return { clientId: row.client_id, kind: row.kind, name: row.name, redirectUris: row.redirect_uris };
}

/**
 * The client behind an id, or null when there is none we can trust. A
 * metadata document URL is served from the cache while it is fresh and
 * refetched after. At authorize a failed refetch is a refusal, never the
 * stale copy, since the owner may have changed the document to cut a
 * redirect off. The token endpoint passes `allowStale`: there the
 * redirect was already checked when the code was issued, and a client that
 * is known must not lose its refresh to its own host having a bad minute.
 */
export async function getClient(
  clientId: string | null | undefined,
  {
    fetcher = safeFetch,
    now = new Date(),
    allowStale = false,
    fetchKey,
  }: {
    fetcher?: SafeFetcher;
    now?: Date;
    allowStale?: boolean;
    /**
     * The caller behind an unauthenticated fetch (authorize): a document
     * fetch counts against its hourly limit, and past it RateLimitedError
     * is thrown rather than fetching.
     */
    fetchKey?: string;
  } = {},
): Promise<OAuthClient | null> {
  if (!clientId || clientId.length > 2000) return null;
  const sql = getSql();
  const rows = (await sql.query(
    `select client_id, kind, name, redirect_uris, fetched_at from oauth_clients where client_id = $1`,
    [clientId],
  )) as ClientRow[];
  const row = rows[0];
  if (row?.kind === "dcr") return toClient(row);
  if (!isCimdClientId(clientId)) return null;

  if (row?.fetched_at && now.getTime() - new Date(row.fetched_at).getTime() < CIMD_CACHE_SECONDS * 1000) {
    return toClient(row);
  }
  if (fetchKey !== undefined && !(await takeRatePlace("cimd", fetchKey, CIMD_FETCH_LIMIT_PER_HOUR, now))) {
    throw new RateLimitedError("metadata document fetches");
  }
  const fetched = await fetcher(clientId).catch((error: unknown) => ({ ok: false as const, reason: String(error) }));
  if (!fetched.ok || fetched.status !== 200) {
    console.warn("[oauth] metadata document fetch failed", clientId, fetched.ok ? fetched.status : fetched.reason);
    return allowStale && row?.kind === "cimd" ? toClient(row) : null;
  }
  const parsed = parseCimdDocument(clientId, fetched.body);
  if (!parsed.ok) {
    console.warn("[oauth] metadata document refused", clientId, parsed.reason);
    return null;
  }
  await sql.query(
    `insert into oauth_clients (client_id, kind, name, redirect_uris, fetched_at)
     values ($1, 'cimd', $2, $3::text[], $4::timestamptz)
     on conflict (client_id) do update set
       name = excluded.name, redirect_uris = excluded.redirect_uris, fetched_at = excluded.fetched_at
     where oauth_clients.kind = 'cimd'`,
    [clientId, parsed.name, parsed.redirectUris, now.toISOString()],
  );
  return { clientId, kind: "cimd", name: parsed.name, redirectUris: parsed.redirectUris };
}
