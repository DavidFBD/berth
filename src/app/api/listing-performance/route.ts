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

/** How each listing has moved; the reading is in lib/server/listing-performance. */
export async function GET(): Promise<Response> {
  return Response.json(await loadPerformance());
}
