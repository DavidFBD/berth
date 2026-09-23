import { loadPerformance } from "@/lib/server/listing-performance";

export type {
  ListingPerformance,
  ListingPerformanceResponse,
} from "@/lib/server/listing-performance";

/** How each listing has moved; the reading is in lib/server/listing-performance. */
export async function GET(): Promise<Response> {
  return Response.json(await loadPerformance());
}
