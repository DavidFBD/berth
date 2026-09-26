import { DEFAULT_SCOPE, SCOPES_SUPPORTED } from "@/lib/server/oauth/config";

/**
 * Pure checks the authorization server makes on what a client sends: its
 * redirect URIs, the scope it asks for, the name it gives itself, and the
 * shape of a Client ID Metadata Document URL. No I/O here, so every rule is
 * a unit test away.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * A redirect URI a public client may register: https anywhere, or plain
 * http on a loopback host (a desktop app listening locally, RFC 8252).
 * Never a fragment, never userinfo, never a custom scheme we cannot vouch
 * for, never longer than a sane URL.
 */
export function isAllowedRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || value.includes("#")) return false;
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return url.hostname.length > 0;
  if (url.protocol === "http:") return LOOPBACK_HOSTS.has(url.hostname);
  return false;
}

/**
 * Whether a redirect URI in an authorization request matches a registered
 * one. Exact string match, except that a loopback redirect may use any port
 * (RFC 8252 section 7.3), since a desktop client picks a free one each run.
 */
export function redirectUriMatches(requested: string, registered: readonly string[]): boolean {
  if (registered.includes(requested)) return true;
  let asked: URL;
  try {
    asked = new URL(requested);
  } catch {
    return false;
  }
  if (asked.protocol !== "http:" || !LOOPBACK_HOSTS.has(asked.hostname)) return false;
  return registered.some((candidate) => {
    try {
      const known = new URL(candidate);
      return (
        known.protocol === "http:" &&
        known.hostname === asked.hostname &&
        known.pathname === asked.pathname &&
        known.search === asked.search
      );
    } catch {
      return false;
    }
  });
}

export type ScopeResult = { ok: true; scope: string } | { ok: false };

/**
 * The scope to grant: what was asked for, when every part of it is one we
 * support, deduplicated in our own order; the default when nothing was
 * asked. Anything unknown fails the whole request (invalid_scope) rather
 * than being silently dropped, so a client never believes it holds a scope
 * it does not.
 */
export function resolveScope(requested: string | null | undefined, allowed: string = DEFAULT_SCOPE): ScopeResult {
  const allowedSet = new Set(allowed.split(" ").filter(Boolean));
  const asked = (requested ?? "").split(/\s+/).filter(Boolean);
  if (asked.length === 0) return { ok: true, scope: [...allowedSet].join(" ") };
  if (!asked.every((part) => allowedSet.has(part))) return { ok: false };
  const order = SCOPES_SUPPORTED as readonly string[];
  const scope = [...new Set(asked)].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(" ");
  return { ok: true, scope };
}

/** The scope as a list, for authInfo. */
export function scopeList(scope: string): string[] {
  return scope.split(" ").filter(Boolean);
}

/**
 * A client's self-given name, trimmed to something a consent screen can show.
 * Folded to NFKC first, then stripped of control characters, zero width
 * characters (U+200B to U+200F, U+FEFF) and the bidi embeddings, overrides
 * and isolates (U+202A to U+202E, U+2066 to U+2069) that can disguise a name.
 */
export function cleanClientName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, 80);
}

/**
 * Whether a client_id is a Client ID Metadata Document URL we may fetch:
 * https, a path beyond "/", no fragment, no userinfo, no dot segments.
 */
export function isCimdClientId(value: string): boolean {
  if (!value.startsWith("https://") || value.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.hash || value.includes("#")) return false;
  if (url.username || url.password) return false;
  if (url.pathname === "/" || url.pathname === "") return false;
  // new URL() has already folded dot segments away, so read the raw path.
  const rawPath = value.replace(/^https:\/\/[^/?#]*/i, "").split("?")[0];
  if (/(^|\/)\.\.?(\/|$)/.test(rawPath)) return false;
  return true;
}

/** The host a redirect goes to, as the consent screen shows it. */
export function redirectHost(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}
