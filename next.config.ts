import type { NextConfig } from "next";
import { NOWHERE_PATH, REFUSED_HEADER, STAFF_SOURCES, staffCookieNameFor } from "./src/lib/nowhere";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      // Every staff address, pages and API, asked with neither a staff
      // session cookie nor a bearer token (docs/adr/0008-staff-area.md):
      // served as the address Berth has no page for before anything of the
      // area is touched, so the answer is an unknown path's byte for byte,
      // headers and RSC requests included.
      beforeFiles: [
        // Refused by the proxy (src/proxy.ts): it marks the request and
        // takes its credentials off; here it becomes the unknown address.
        ...STAFF_SOURCES.map((source) => ({
          source,
          has: [{ type: "header" as const, key: REFUSED_HEADER }],
          destination: NOWHERE_PATH,
        })),
        ...STAFF_SOURCES.map((source) => ({
          source,
          missing: [
            { type: "cookie" as const, key: staffCookieNameFor(process.env.NODE_ENV) },
            { type: "header" as const, key: "authorization" },
          ],
          destination: NOWHERE_PATH,
        })),
      ],
      afterFiles: [],
      // Every address Berth has no page for is served as that same address,
      // so a refused staff page and any unknown path answer alike even on a
      // client router request, which names the rewritten path in a header.
      // Build assets (_next/) and Vercel's own paths (_vercel/, analytics) keep their own answers.
      fallback: [{ source: "/:path((?!_next/|_vercel/).*)", destination: NOWHERE_PATH }],
    };
  },
  async headers() {
    // Link preview cards (lib/og/card) are drawn once per build. A day in
    // the browser, a year at the edge (a deploy purges it), and a week of
    // serving the old card while the new one is fetched.
    const card = [
      { key: "Cache-Control", value: "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800" },
    ];
    return [
      ...["/opengraph-image", "/twitter-image", "/:segment/opengraph-image", "/:segment/twitter-image"].map((source) => ({
        source,
        headers: card,
      })),
      // The staff area's strict headers are set by src/proxy.ts, on an
      // authorised request only, so a refused one is a plain 404.
      {
        // The consent screen an assistant sends people to: never framed,
        // so it cannot be dressed up inside someone else's page and
        // clicked through (lib/server/oauth).
        source: "/oauth/authorize",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
