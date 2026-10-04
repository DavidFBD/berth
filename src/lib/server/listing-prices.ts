import { TOKEN_LISTINGS } from "@/lib/listings";

/**
 * USD prices for the listings, from the solver's own oracle. Served as is
 * by app/api/listing-prices, and read server-side by the portfolio (lib/
 * server/portfolio) for today's live value.
 *
 * Neither price source the app already has knows a stock token: the money
 * market oracle only prices its reserves and the DefiLlama feed is keyed by
 * CoinGecko id. The solver oracle (`/v1/intent/oracle`, public read, no key)
 * lists every listing on the hub under a `soda<TICKER>` symbol with the
 * price it fills against, which is also the right price to show: it is what
 * the quote will be built on. Server-side so one upstream request serves
 * every client, filtered to the listings so the payload is thirteen numbers
 * and not six hundred.
 *
 * Never throws: a missing price is a soft degrade (the board shows the row
 * unpriced, the drawer still quotes) and must never break the app.
 */

const ORACLE_URL = "https://api.sodax.com/v1/intent/oracle";
/** The hub, as the oracle keys it (intent-relay chain id, decimal). */
const HUB_CHAIN_ID = "146";
const REVALIDATE_SECONDS = 60;

/** The longest one oracle read may take. */
export const ORACLE_TIMEOUT_MS = 10_000;

export type ListingPricesResponse = {
  /** Lowercased listing address → USD price. */
  prices: Record<string, number>;
  /** Oldest `updatedAt` among the prices returned, epoch ms; null when empty. */
  updatedAt: number | null;
  /** Present only when prices are empty or partial, for the console. */
  reason?: string;
};

type OracleEntry = {
  address?: string;
  chainId?: string;
  symbol?: string;
  priceUsd?: number;
  updatedAt?: number;
};

export async function loadListingPrices(): Promise<ListingPricesResponse> {
  const wanted = new Set(
    TOKEN_LISTINGS.map((listing) => listing.address.toLowerCase()),
  );
  const payload: ListingPricesResponse = { prices: {}, updatedAt: null };

  try {
    const response = await fetch(ORACLE_URL, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(ORACLE_TIMEOUT_MS),
    });
    if (!response.ok) {
      payload.reason = `oracle answered ${response.status}`;
      return payload;
    }
    const entries = (await response.json()) as OracleEntry[];
    let oldest: number | null = null;
    for (const entry of entries) {
      if (entry.chainId !== HUB_CHAIN_ID || !entry.address) continue;
      const address = entry.address.toLowerCase();
      if (!wanted.has(address)) continue;
      const price = entry.priceUsd;
      if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
        continue;
      }
      payload.prices[address] = price;
      if (typeof entry.updatedAt === "number") {
        oldest = oldest === null ? entry.updatedAt : Math.min(oldest, entry.updatedAt);
      }
    }
    payload.updatedAt = oldest;
    const missing = wanted.size - Object.keys(payload.prices).length;
    if (missing > 0) payload.reason = `${missing} listing(s) unpriced by the oracle`;
  } catch (error) {
    payload.reason =
      error instanceof Error ? error.message : "oracle request failed";
  }

  return payload;
}
