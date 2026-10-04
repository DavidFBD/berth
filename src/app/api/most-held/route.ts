import { loadMostHeldWeek, mostHeldMaxAge } from "@/lib/server/most-held";

export type { MostHeldResponse, MostHeldRow } from "@/lib/most-held";

/**
 * Most held on Berth (lib/server/most-held): the share of people who own a stock or fund on Berth
 * that held each listing when the last published Monday to Sunday week
 * closed, as a rounded "1 in N", and nothing else. Public and the same for
 * everyone; stored once per week, so the CDN may keep it until the next
 * week is published (a day at most), or five minutes while a week with no
 * daily record at all waits to be counted. Below the thresholds the answer is an
 * empty list, which the board shows as nothing.
 */
export async function GET(): Promise<Response> {
  try {
    const { answer, final } = await loadMostHeldWeek();
    return Response.json(answer, {
      headers: { "Cache-Control": `public, s-maxage=${mostHeldMaxAge(new Date(), final)}, stale-while-revalidate=300` },
    });
  } catch (error) {
    console.warn("[most-held]", error instanceof Error ? error.message : error);
    return Response.json({ rows: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
