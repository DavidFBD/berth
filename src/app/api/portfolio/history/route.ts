import { NextResponse, type NextRequest } from "next/server";
import { BENCHMARKS, DEFAULT_BENCHMARK, findBenchmark, type Benchmark } from "@/lib/benchmarks";
import { isTradingDay } from "@/lib/market-calendar";
import { MARKS_MARKET_ID_BY_SYMBOL } from "@/lib/market-ids";
import { ledgerExplains, valueHoldings } from "@/lib/portfolio-days";
import {
  historyRanges,
  type HistoryResult,
  type LivePoint,
  type Range,
} from "@/lib/portfolio-history";
import { readMarks } from "@/lib/server/marks";
import {
  hubWalletFor,
  liveListingPrices,
  loadListingOrders,
  loadPortfolioDays,
  readListingBalances,
} from "@/lib/server/portfolio";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";

export const dynamic = "force-dynamic";

/**
 * The account's money over time beside the same money in a benchmark, for
 * every range worth offering (lib/portfolio-history has the arithmetic and
 * says what each field means). Same proof of identity as /api/orders.
 *
 *   GET /api/portfolio/history?benchmark=SPY
 *   POST /api/portfolio/history?benchmark=SPY   (the same; the client's
 *        rewards request core only speaks POST, see hooks/use-profile)
 *
 * Stored days come from `portfolio_days`, closes from `marks`. Today's
 * point is read live on a market day: the account's balances on chain at
 * the solver oracle's prices (a listing the oracle does not price takes
 * its latest close), and the benchmark at the oracle's price when it is a
 * listing, DefiLlama's current price when it is not (Gold, Bitcoin), its
 * latest close when neither answers. `todaySource` says which, or null
 * when there is no live point (a closed market, a failed read).
 */

type Named = Pick<Benchmark, "symbol" | "name">;

export type PortfolioHistoryResponse = {
  benchmark: Named;
  benchmarks: Named[];
  /** Every offered range, plus since first buy always. */
  ranges: Partial<Record<Range, HistoryResult>>;
  /** What the range control offers, in order. Empty under two days. */
  available: Range[];
  /** When the newest point was read, ISO; null with no data at all. */
  updatedAt: string | null;
  todaySource: {
    /** 'oracle' when every holding was priced live, 'marks' when any took its latest close. */
    value: "oracle" | "marks";
    benchmark: "oracle" | "defillama" | "marks";
  } | null;
};

/** DefiLlama's current price for a benchmark-only id, or undefined. */
async function currentPrice(marketId: string): Promise<number | undefined> {
  try {
    const response = await fetch(`https://coins.llama.fi/prices/current/coingecko:${marketId}`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as { coins?: Record<string, { price?: number }> };
    const price = payload.coins?.[`coingecko:${marketId}`]?.price;
    return typeof price === "number" && price > 0 ? price : undefined;
  } catch {
    return undefined;
  }
}

export async function GET(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;

  const asked = request.nextUrl.searchParams.get("benchmark") ?? DEFAULT_BENCHMARK;
  const benchmark = findBenchmark(asked);
  if (!benchmark) {
    return NextResponse.json({ error: "unknown benchmark" }, { status: 400 });
  }

  const userId = resolved.user.id;
  const [days, orders] = await Promise.all([loadPortfolioDays(userId), loadListingOrders(userId)]);
  const listingSymbols = [
    ...new Set([
      ...orders.map((order) => order.symbol),
      ...days.flatMap((day) => day.holdings.map((holding) => holding.symbol)),
    ]),
  ];

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const spoke = read.caller.wallet ?? resolved.user.wallet_address;

  // The live read runs beside the marks read; either failing only costs
  // today's point.
  const liveRead = (async () => {
    if (!isTradingDay(today) || !spoke) return undefined;
    const [balances, prices] = await Promise.all([
      hubWalletFor(spoke).then(readListingBalances),
      liveListingPrices().catch(() => ({}) as Record<string, number>),
    ]);
    return { balances, prices };
  })().catch((error) => {
    console.warn("[portfolio/history] no live point", error instanceof Error ? error.message : error);
    return undefined;
  });

  const [liveInputs, marks] = await Promise.all([
    liveRead,
    readMarks([...new Set([benchmark.symbol, ...listingSymbols])]),
  ]);
  // Symbols held now but never ordered or stored still need a close to fall back on.
  const heldNow = Object.keys(liveInputs?.balances ?? {}).filter((symbol) => !(symbol in marks));
  if (heldNow.length > 0) Object.assign(marks, await readMarks(heldNow));

  let live: LivePoint | undefined;
  let todaySource: PortfolioHistoryResponse["todaySource"] = null;
  if (liveInputs) {
    let fromMarks = false;
    const valued = valueHoldings(liveInputs.balances, (symbol) => {
      const price = liveInputs.prices[symbol];
      if (price) return { price, source: "oracle" };
      const close = marks[symbol]?.values.at(-1);
      if (!close) return undefined;
      fromMarks = true;
      return { price: close, source: "mark" };
    });

    let benchmarkPrice: number | null = null;
    let benchmarkSource: "oracle" | "defillama" | "marks" = "marks";
    const oraclePrice = liveInputs.prices[benchmark.symbol];
    if (benchmark.listingAddress && oraclePrice) {
      benchmarkPrice = oraclePrice;
      benchmarkSource = "oracle";
    } else if (!benchmark.listingAddress) {
      const price = await currentPrice(MARKS_MARKET_ID_BY_SYMBOL[benchmark.symbol]);
      if (price) {
        benchmarkPrice = price;
        benchmarkSource = "defillama";
      }
    }

    // Nothing held and nothing stored: there is no line to end.
    if (valued.ok && (valued.day.value > 0 || days.length > 0)) {
      live = {
        day: today,
        asOf: now.toISOString(),
        value: valued.day.value,
        benchmarkPrice,
        prices: liveInputs.prices,
      };
      todaySource = { value: fromMarks ? "marks" : "oracle", benchmark: benchmarkSource };
    }
  }

  // Do the orders add up to what is held? Judged on today's balances when
  // they were read, else on the newest stored day's holdings and the orders
  // placed before it. With neither there is nothing to contradict them.
  const lastDay = days.at(-1);
  let balanceExplained = true;
  if (liveInputs) {
    balanceExplained = ledgerExplains(orders, liveInputs.balances);
  } else if (lastDay) {
    const asOf = Date.parse(lastDay.asOf);
    balanceExplained = ledgerExplains(
      orders.filter((order) => Date.parse(order.placedAt) <= asOf),
      Object.fromEntries(lastDay.holdings.map((holding) => [holding.symbol, holding.quantity])),
    );
  }

  const { ranges, available } = historyRanges({
    days,
    orders,
    benchmarkMarks: marks[benchmark.symbol],
    listingCloses: marks,
    live,
    balanceExplained,
  });

  const response: PortfolioHistoryResponse = {
    benchmark: { symbol: benchmark.symbol, name: benchmark.name },
    benchmarks: BENCHMARKS.map(({ symbol, name }) => ({ symbol, name })),
    ranges,
    available,
    updatedAt: live?.asOf ?? days.at(-1)?.asOf ?? null,
    todaySource,
  };
  return NextResponse.json(response, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}

/** The same read for the client's rewards request core, which always POSTs. */
export const POST = GET;
