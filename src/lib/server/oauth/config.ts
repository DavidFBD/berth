/**
 * The constants of Berth's own OAuth authorization server, the one an
 * assistant (Claude, ChatGPT, Grok) signs in through to reach the MCP
 * server at /mcp. The whole thing is small on purpose: public clients only,
 * PKCE S256 only, authorization code and refresh token only, opaque random
 * tokens stored as SHA-256 hashes, one resource.
 *
 * The rule the whole feature rests on (CONTEXT.md): an assistant reads and
 * drafts, the person signs. No scope here can move money, because nothing
 * behind /mcp can.
 */

/** Read the account: holdings, performance, orders, rank. */
export const SCOPE_READ = "berth.read";
/** Draft a buy or sell as a link the person approves and signs in Berth. */
export const SCOPE_DRAFT = "berth.draft";

export const SCOPES_SUPPORTED = [SCOPE_READ, SCOPE_DRAFT] as const;
export type Scope = (typeof SCOPES_SUPPORTED)[number];

/** What a client gets when it asks for no scope at all. */
export const DEFAULT_SCOPE = `${SCOPE_READ} ${SCOPE_DRAFT}`;

/** An authorization code lives this long. */
export const CODE_TTL_SECONDS = 90;
/** An access token lives this long. */
export const ACCESS_TTL_SECONDS = 60 * 60;
/** A refresh token lives this long from its last use (sliding). */
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
/** The signed consent request an authorize page carries is good this long. */
export const CONSENT_TTL_SECONDS = 10 * 60;
/** A cached Client ID Metadata Document is trusted this long before a refetch. */
export const CIMD_CACHE_SECONDS = 10 * 60;
/** last_used_at is written at most this often per grant. */
export const LAST_USED_THROTTLE_SECONDS = 5 * 60;

/** Registrations accepted from one caller per hour. */
export const REGISTER_LIMIT_PER_HOUR = 20;
/** Registrations accepted from everyone together per hour. */
export const REGISTER_GLOBAL_LIMIT_PER_HOUR = 500;
/** Client ID Metadata Document fetches one caller may cause per hour at authorize. */
export const CIMD_FETCH_LIMIT_PER_HOUR = 30;

/** Where the MCP server lives under the origin; also the resource identifier's path. */
export const MCP_PATH = "/mcp";

/** The production origin, pinned as the issuer there whatever Host a request carries. */
export const PRODUCTION_ORIGIN = "https://www.berthmarkets.com";

/**
 * The public origin this request reached, which is also the issuer. An
 * explicit OAUTH_ISSUER wins (set it if a proxy ever hides the host); in
 * production (VERCEL_ENV) it is pinned to www.berthmarkets.com, so a
 * request through another alias of the deployment cannot mint consent or
 * tokens under a different issuer; otherwise the forwarding headers Vercel
 * sets, then the Host header. Never ends in a slash.
 */
export function publicOrigin(headers: Headers, fallbackUrl?: string): string {
  const explicit = process.env.OAUTH_ISSUER?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.VERCEL_ENV === "production") return PRODUCTION_ORIGIN;
  const forwardedHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || headers.get("host")?.trim();
  if (host) {
    const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
    const proto = forwardedProto || (local ? "http" : "https");
    return `${proto}://${host}`;
  }
  if (fallbackUrl) return new URL(fallbackUrl).origin;
  return PRODUCTION_ORIGIN;
}

/** The one resource this server issues tokens for (RFC 8707). */
export function resourceFor(origin: string): string {
  return `${origin}${MCP_PATH}`;
}
