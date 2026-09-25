import { COPY } from "@/lib/copy";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { MARKS_MARKET_ID_BY_SYMBOL } from "@/lib/market-ids";

/**
 * What a portfolio can be set beside: the same dollars, on the same days,
 * in something a person already knows the shape of.
 *
 * Three are listings (the S&P 500 fund, the Nasdaq 100 fund, Treasury
 * bills), so the solver oracle prices them live. Gold and Bitcoin are
 * benchmark-only: marked daily from DefiLlama (lib/market-ids) and never
 * on the board. Ids stay ids; the names come from copy.ts.
 */

export type BenchmarkSymbol = keyof typeof COPY.benchmarkNames;

export type Benchmark = {
  symbol: BenchmarkSymbol;
  name: string;
  /** The CoinGecko id the stored marks are fetched under. */
  marketId: string;
  /** The listing's address on Sonic when it is one, so the oracle can price it live. */
  listingAddress: string | null;
};

const ORDER: readonly BenchmarkSymbol[] = ["SPY", "QQQ", "PAXG", "BTC", "SGOV"];

export const BENCHMARKS: readonly Benchmark[] = ORDER.map((symbol) => ({
  symbol,
  name: COPY.benchmarkNames[symbol],
  marketId: MARKS_MARKET_ID_BY_SYMBOL[symbol],
  listingAddress:
    TOKEN_LISTINGS.find((listing) => listing.symbol === symbol)?.address.toLowerCase() ?? null,
}));

export const DEFAULT_BENCHMARK: BenchmarkSymbol = "SPY";

export function findBenchmark(symbol: string | null | undefined): Benchmark | undefined {
  if (!symbol) return undefined;
  const wanted = symbol.toUpperCase();
  return BENCHMARKS.find((benchmark) => benchmark.symbol === wanted);
}
