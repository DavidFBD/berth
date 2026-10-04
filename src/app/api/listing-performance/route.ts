import { loadPerformance } from "@/lib/server/listing-performance";

export type {
  ListingPerformance,
  ListingPerformanceResponse,
} from "@/lib/server/listing-performance";

/**
 * Hobby's ceiling. A cold read walks the multiplier events back over the
 * 90 day window (lib/server/token-multipliers), about seven batched RPC
 * spans per group of tokens that have paid, each allowed eight seconds.
 */
export const maxDuration = 60;

/**
 * How each listing has moved; the reading is in lib/server/listing-performance.
 *
 * The same for everyone, so Vercel's edge keeps it for five minutes and
 * then serves it while a fresh one is read behind it: a cold multiplier
 * read (about 18 s on a new instance) is never waited on by a visitor.
 */
export async function GET(): Promise<Response> {
  const payload = await loadPerformance();
  // A degraded answer (a chunk or a multiplier unread) is kept only briefly.
  const cache = payload.reason
    ? "public, s-maxage=30, stale-while-revalidate=300"
    : "public, s-maxage=300, stale-while-revalidate=3600";
  return Response.json(payload, { headers: { "cache-control": cache } });
}
