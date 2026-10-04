import { loadListingPrices } from "@/lib/server/listing-prices";

export type { ListingPricesResponse } from "@/lib/server/listing-prices";

/**
 * USD prices for the listings, from the solver's own oracle
 * (lib/server/listing-prices). Always 200: a missing price is a soft
 * degrade and must never break the app.
 *
 * The same for everyone, so Vercel's edge keeps it: fresh for 30 seconds,
 * then served while a new read is fetched behind it, so no visitor waits on
 * the oracle (measured 0.4 to 1.8 s a read, 2026-10-04). Stale for a minute
 * at most, not five: the price prefills the buy drawer's limit price and its
 * "fills now" label. A read that came back empty is not kept.
 */
export async function GET(): Promise<Response> {
  const payload = await loadListingPrices();
  const priced = Object.keys(payload.prices).length > 0;
  return Response.json(payload, {
    headers: { "cache-control": priced ? "public, s-maxage=30, stale-while-revalidate=60" : "no-store" },
  });
}
