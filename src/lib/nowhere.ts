/**
 * The address Berth has no page for. Every unknown address is served as it
 * (next.config fallback rewrite), and so is every refused staff request
 * (next.config beforeFiles, src/proxy.ts, lib/server/not-found-response),
 * so the two cannot differ. Pure, so next.config can import it.
 */
export const NOWHERE_PATH = "/_berth/not-a-page";

/** The staff session cookie's name: `__Host-` in production (Secure, Path=/, no Domain). */
export function staffCookieNameFor(nodeEnv: string | undefined): string {
  return nodeEnv === "production" ? "__Host-berth-staff" : "berth-staff";
}

/** Every staff address, pages and API (the proxy's matcher and the refusal rewrite). */
export const STAFF_SOURCES = ["/staff", "/staff/:path*", "/api/staff", "/api/staff/:path*"] as const;

/** The proxy's mark on a refused staff request (src/proxy.ts refuse), read by next.config. */
export const REFUSED_HEADER = "x-berth-refused";
