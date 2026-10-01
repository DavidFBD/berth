import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      // The staff campaigns page, asked without its pass (lib/server/staff-page):
      // served as the address Berth has no page for, before anything of the
      // page is touched, so the answer is an unknown path's byte for byte,
      // headers included. A pass that is there but not valid is the proxy's
      // to refuse (src/proxy.ts).
      beforeFiles: ["/staff/campaigns", "/staff/campaigns/:path*"].map((source) => ({
        source,
        missing: [{ type: "cookie" as const, key: "berth_staff" }],
        destination: "/_berth/not-a-page",
      })),
      afterFiles: [],
      // Every address Berth has no page for is served as that same address,
      // so a refused staff page and any unknown path answer alike even on a
      // client router request, which names the rewritten path in a header.
      // Build assets keep their own plain 404.
      fallback: [{ source: "/:path((?!_next/).*)", destination: "/_berth/not-a-page" }],
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
