import { loadMostBought, mostBoughtMaxAge } from "@/lib/server/social-proof";

export type { MostBoughtResponse, MostBoughtRow } from "@/lib/social-proof";

/**
 * Most bought on Berth (lib/server/social-proof): how many people bought
 * each listing in the last published Monday to Sunday week, rounded above
 * ten, and nothing else. Public and the same for everyone; stored once per
 * week, so the CDN may keep it until the next week is published (a day at
 * most). It names no one and
 * carries no amount. Below the thresholds the answer is an empty list,
 * which the board shows as nothing.
 */
export async function GET(): Promise<Response> {
  try {
    const answer = await loadMostBought();
    return Response.json(answer, {
      headers: { "Cache-Control": `public, s-maxage=${mostBoughtMaxAge()}, stale-while-revalidate=300` },
    });
  } catch (error) {
    console.warn("[most-bought]", error instanceof Error ? error.message : error);
    return Response.json({ rows: [], days: 7 }, { headers: { "Cache-Control": "no-store" } });
  }
}
