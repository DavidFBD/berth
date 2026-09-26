import { loadListingX } from "@/lib/server/listing-x";

export type { ListingXResponse } from "@/lib/server/listing-x";

/**
 * What is being said on X about the listings; the ranking is in
 * lib/server/listing-x. Always 200: a quiet hour, an expired token and a
 * rate limit all reach the reader as the same calm line.
 */
export async function GET(request: Request): Promise<Response> {
  return Response.json(await loadListingX(new URL(request.url).searchParams.get("symbol")));
}
