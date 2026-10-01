import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
