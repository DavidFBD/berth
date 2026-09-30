import { loadListingX } from "@/lib/server/listing-x";

export type { ListingXResponse } from "@/lib/server/listing-x";

/**
 * What is being said on X about the listings; the ranking is in
 * lib/server/listing-x. Always 200: a quiet hour, an expired token and a
 * rate limit all reach the reader as the same calm line.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  // `fresh=1` is the column's refresh button: at most one extra fetch per
  // slot for everyone, inside the day's cap (lib/x-schedule).
  return Response.json(
    await loadListingX(params.get("symbol"), undefined, {
      fresh: params.get("fresh") === "1",
      // The column is the one reader allowed to go to X; everyone else peeks.
      mayFetch: true,
    }),
  );
}
