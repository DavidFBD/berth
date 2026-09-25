import { loadListingPrices } from "@/lib/server/listing-prices";

export type { ListingPricesResponse } from "@/lib/server/listing-prices";

/**
 * USD prices for the listings, from the solver's own oracle
 * (lib/server/listing-prices). Always 200: a missing price is a soft
 * degrade and must never break the app.
 */
export async function GET(): Promise<Response> {
  return Response.json(await loadListingPrices());
}
