/**
 * Where the app's SODAX API key lives, and what it is allowed to sign for.
 *
 * SODAX now mints partner API keys (docs.sodax.com/developers/how-to/api-keys).
 * They travel as an `x-api-key` header, and the write half of the solver API is
 * already wired for the check: enforcement is off on the public deployment
 * today and comes back on route by route. Reads stay public, writes will not.
 * One of those writes is `POST /intent/execute`, the notify that tells the
 * solver a pour has landed on the hub and to go fill it, and this app sends it
 * from the browser on every deposit and every pour-back.
 *
 * A key in front-end JavaScript is a published key, so ours never ships to the
 * browser. The client SDK is pointed at `/api/sodax` on our own origin (see
 * `lib/sodax-config`), the route handler above this module attaches the key,
 * and only the three routes below are forwarded: a pass-through proxy would
 * lend our credential to every path on the SODAX API, including ones this app
 * has no business calling.
 */

/** Upstream root. The version prefix is part of it; routes hang off `/v1`. */
export const SODAX_API_BASE = "https://api.sodax.com/v1";

/**
 * Exactly what `SolverApiService` calls off `solver.solverApiEndpoint` (the SDK
 * builds each URL as `${endpoint}/quote|status|execute`). Quote and status are
 * reads and would survive unkeyed, but they share the one endpoint knob with
 * execute, and keeping them keyed costs nothing while enforcement arrives
 * piecemeal.
 */
const FORWARDED_ROUTES = new Set([
  "intent/quote",
  "intent/status",
  "intent/execute",
]);

/**
 * The upstream URL for a proxied request, or null when the path isn't one we
 * forward. Exact matching against the set, so no `..` segment or casing trick
 * can walk out of it.
 */
export function resolveProxyTarget(
  segments: readonly string[] | undefined,
): string | null {
  const path = (segments ?? []).join("/");
  return FORWARDED_ROUTES.has(path) ? `${SODAX_API_BASE}/${path}` : null;
}

/**
 * The headers the proxy sends upstream. Built from nothing rather than
 * forwarded from the caller: the browser's own headers carry cookies and a
 * session upstream has no business seeing, and a caller must never be able to
 * smuggle an `x-api-key` of its own through. A missing key sends none, which
 * upstream still serves until it turns enforcement on.
 */
export function buildUpstreamHeaders(
  apiKey: string | undefined,
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(apiKey ? { "x-api-key": apiKey } : {}),
  };
}
