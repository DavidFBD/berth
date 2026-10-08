import { BENCHMARKS, type Benchmark } from "@/lib/benchmarks";
import { isTradingDay } from "@/lib/market-calendar";
import { MARKS_MARKET_ID_BY_SYMBOL } from "@/lib/market-ids";
import { newYorkDay } from "@/lib/marks";
import { explainedFrom, ledgerExplains, valueHoldings } from "@/lib/portfolio-days";
import {
  historyRanges,
  type LivePoint,
  type Range,
} from "@/lib/portfolio-history";
import { withStory, type StoryHolding, type StoryResult } from "@/lib/portfolio-story";
import { readMarks } from "@/lib/server/marks";
import {
  hasRobinhoodOrders,
  liveListingPrices,
  loadListingOrders,
  loadPortfolioDays,
  readAccountBalances,
  type StoredPortfolioDay,
} from "@/lib/server/portfolio";
import { readRobinhoodHoldings } from "@/lib/server/robinhood-balances";
import type { Marks, OrderFacts } from "@/lib/benchmark";

/**
 * The account's money over time beside the same money in a benchmark, for
 * every range worth offering (lib/portfolio-history has the arithmetic and
 * says what each field means). Served by /api/portfolio/history and read
 * by the MCP server's get_performance (app/mcp).
 *
 *   GET /api/portfolio/history?benchmark=SPY
 *   POST /api/portfolio/history?benchmark=SPY   (the same; the client's
 *        rewards request core only speaks POST, see hooks/use-profile)
 *
 * Stored days come from `portfolio_days`, closes from `marks`, each
 * order's benchmark prices at its minute from `order_marks`. Today's point
 * is read live on a market day, the day named by New York's calendar (so a
 * read after midnight UTC but before midnight in New York replaces that
 * evening's stored close rather than adding a day): the account's balances
 * on chain at the solver oracle's prices (a listing the oracle does not
 * price takes its latest close), and the benchmark at the oracle's price
 * when it is a listing, DefiLlama's current price when it is not (Gold,
 * Bitcoin), its latest close when neither answers. The chain read has
 * LIVE_READ_MS; past it the line ends on the latest stored day.
 *
 * THE CONTRACT, per range in `ranges` (lib/portfolio-history HistoryResult):
 * - `days[].value` is always dollars; `days[].benchmark` is dollars or
 *   null (every point null unless `benchmarkStatus` is 'ok'; a single null
 *   with 'ok' is a day the benchmark has no close).
 * - `rebasedFrom` a day: money moved without an order before it, so the
 *   window starts on that day's snapshot and both lines are told from it.
 * - `benchmarkStatus` 'unexplained_balance' (money moved after the newest
 *   snapshot too) or 'unpriced_orders':
 *   `changePct` AND `benchmarkPct` are both null (money moved that no order
 *   prices, so neither percentage can be told), the dollar values stay.
 * - 'no_marks' (a buy with no benchmark price at its minute, or no closes):
 *   `benchmarkPct` null, `changePct` usually a number.
 * - 'too_short' (under two days): both null.
 * - 'ok': `benchmarkPct` a number when the closes allow; `changePct` a
 *   number unless a sell landed on a day its listing has no close.
 *
 * Each day's story rides on its point (lib/portfolio-story, additive):
 * `change` the dollars the holdings made or lost that day with buys and
 * sells set aside (null when a price or a cost is missing), `changePct`
 * the same over the money at work, `top` the holding that moved most in
 * dollars and `mover` in percent `{symbol, usd, pct}`, `held` the symbols
 * held, `fromBuy` on a first point told from what was paid. Each range
 * adds `contributions` (each holding's dollars over the window),
 * `changeUsd` and `orders` (`{day, at, symbol, direction, usd}`, the point
 * each landed on). A large move in the news is not read here: the board
 * already holds the moves (/api/moves) and picks one on a held day
 * (lib/portfolio-story pickMove), so this read never waits on news.
 *
 * `todaySource` says where today's point came from: `value` 'oracle' when
 * every holding was priced live, 'marks' when any took its latest close,
 * 'stored' when the live read took too long and the line ends on the
 * latest stored day (then `benchmark` is 'marks'). Null when there is no
 * live point for another reason (a closed market, a failed read, nothing
 * held). Never cached: the answer is one account's.
 */

/** How long today's chain read (hub wallet and multicall) may take before it is given up. */
const LIVE_READ_MS = 6_000;

type Named = Pick<Benchmark, "symbol" | "name">;

export type PortfolioHistoryResponse = {
  benchmark: Named;
  benchmarks: Named[];
  /**
   * Every offered range, plus since first buy always. Each point carries its
   * day's story and each range its contributions and orders
   * (lib/portfolio-story); all additive to lib/portfolio-history's answer.
   */
  ranges: Partial<Record<Range, StoryResult>>;
  /** What the range control offers, in order. Empty under two days. */
  available: Range[];
  /** When the newest point was read, ISO; null with no data at all. */
  updatedAt: string | null;
  todaySource: {
    /**
     * 'oracle' when every holding was priced live, 'marks' when any took
     * its latest close, 'stored' when the live read timed out and the line
     * ends on the latest stored day.
     */
    value: "oracle" | "marks" | "stored";
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

/**
 * The history for one account against one benchmark. `spokes` are the
 * account's EVM addresses (home first, lib/server/identities
 * accountEvmAddresses): today's live point sums every one's hub wallet.
 * Empty when it has none, which only costs today's live point.
 */
export async function loadPortfolioHistory({
  userId,
  spokes,
  benchmark,
}: {
  userId: string;
  spokes: readonly string[];
  benchmark: Benchmark;
}): Promise<PortfolioHistoryResponse> {
  const [days, orders] = await Promise.all([loadPortfolioDays(userId), loadListingOrders(userId)]);
  const listingSymbols = [
    ...new Set([
      ...orders.map((order) => order.symbol),
      ...days.flatMap((day) => day.holdings.map((holding) => holding.symbol)),
    ]),
  ];

  const now = new Date();
  const today = newYorkDay(now);

  // The live read runs beside the marks read; either failing only costs
  // today's point.
  const TIMED_OUT = "timed out" as const;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const liveRead = Promise.race([
    (async () => {
      if (!isTradingDay(today) || spokes.length === 0) return undefined;
      // What sits in the account's own wallets on Robinhood Chain counts
      // too (plan P1b). When that chain does not answer, an account Berth
      // never delivered there keeps its live point on the hub alone; one it
      // did ends on its latest stored day rather than a low point.
      const onRobinhood = await hasRobinhoodOrders(userId).catch(() => true);
      const [balances, prices] = await Promise.all([
        readAccountBalances(spokes, undefined, undefined, readRobinhoodHoldings, onRobinhood ? "throw" : "hub only").then(
          (read) => read.total,
        ),
        liveListingPrices().catch(() => ({}) as Record<string, number>),
      ]);
      return { balances, prices };
    })(),
    new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), LIVE_READ_MS);
    }),
  ])
    .catch((error) => {
      console.warn("[portfolio/history] no live point", error instanceof Error ? error.message : error);
      return undefined;
    })
    .finally(() => clearTimeout(timer));



  const [liveOutcome, marks] = await Promise.all([
    liveRead,
    readMarks([...new Set([benchmark.symbol, ...listingSymbols])]),
  ]);
  const timedOut = liveOutcome === TIMED_OUT;
  if (timedOut) console.warn("[portfolio/history] live read timed out; ending on the stored day");
  const liveInputs = timedOut ? undefined : liveOutcome;
  // Symbols held now but never ordered or stored still need a close to fall back on.
  const heldNow = Object.keys(liveInputs?.balances ?? {}).filter((symbol) => !(symbol in marks));
  if (heldNow.length > 0) Object.assign(marks, await readMarks(heldNow));

  let live: LivePoint | undefined;
  let liveHoldings: StoryHolding[] | undefined;
  let todaySource: PortfolioHistoryResponse["todaySource"] =
    timedOut && days.length > 0 ? { value: "stored", benchmark: "marks" } : null;
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
      liveHoldings = valued.day.holdings;
      todaySource = { value: fromMarks ? "marks" : "oracle", benchmark: benchmarkSource };
    }
  }

  const { ranges, available } = storedComparison({
    days,
    orders,
    benchmark,
    marks,
    live,
    liveBalances: liveInputs?.balances,
    liveHoldings,
  });



  const response: PortfolioHistoryResponse = {
    benchmark: { symbol: benchmark.symbol, name: benchmark.name },
    benchmarks: BENCHMARKS.map(({ symbol, name }) => ({ symbol, name })),
    ranges,
    available,
    updatedAt: live?.asOf ?? days.at(-1)?.asOf ?? null,
    todaySource,
  };
  return response;
}

/**
 * The comparison from what is already read: stored days, the orders, the
 * closes and, when there is one, today's live point with the balances it
 * was read from. Whether the orders explain what is held is judged here,
 * on the live balances when given, else on the newest stored day and the
 * orders placed before it. loadPortfolioHistory's arithmetic, and the
 * weekly summary's (lib/server/weekly), which passes stored days only.
 */
export function storedComparison({
  days,
  orders,
  benchmark,
  marks,
  live,
  liveBalances,
  liveHoldings,
}: {
  days: readonly StoredPortfolioDay[];
  orders: readonly OrderFacts[];
  benchmark: Pick<Benchmark, "symbol">;
  marks: Readonly<Record<string, Marks>>;
  live?: LivePoint;
  liveBalances?: Readonly<Record<string, number>>;
  /** What today's live value was made of, for today's story. */
  liveHoldings?: readonly StoryHolding[];
}): { ranges: Partial<Record<Range, StoryResult>>; available: Range[] } {
  // Do the orders add up to what is held? Judged on today's balances when
  // they were read, else on the newest stored day's holdings and the orders
  // placed before it. With neither there is nothing to contradict them.
  const lastDay = days.at(-1);
  let balanceExplained = true;
  if (liveBalances) {
    balanceExplained = ledgerExplains(orders, liveBalances);
  } else if (lastDay) {
    const asOf = Date.parse(lastDay.asOf);
    balanceExplained = ledgerExplains(
      orders.filter((order) => Date.parse(order.placedAt) <= asOf),
      Object.fromEntries(lastDay.holdings.map((holding) => [holding.symbol, holding.quantity])),
    );
  }
  // When they do not, money moved without an order: the comparison starts
  // from the first snapshot the orders explain everything after.
  const base = balanceExplained ? undefined : explainedFrom(days, orders, liveBalances);
  // A day rebuilt from the orders after that snapshot would leave out the
  // move, so only snapshots are drawn from it on.
  const drawn = base ? days.filter((day) => day.source === "snapshot" || day.day <= base.day) : days;

  const { ranges, available } = historyRanges({
    days: drawn,
    orders,
    benchmarkSymbol: benchmark.symbol,
    benchmarkMarks: marks[benchmark.symbol],
    listingCloses: marks,
    live,
    balanceExplained,
    base,
  });
  // Each day's story beside the numbers (lib/portfolio-story): additive,
  // and never in the way. If telling it fails, the plain numbers go out
  // as they are, so the chart, the weekly email and the assistant's
  // performance read never fail because of it.
  try {
    return {
      ranges: withStory(
        ranges,
        { days: drawn, orders, listingCloses: marks, live, liveHoldings },
        { rebased: Boolean(base && drawn.some((day) => day.day === base.day)) },
      ),
      available,
    };
  } catch (error) {
    console.warn("[portfolio/history] no day stories", error instanceof Error ? error.message : error);
    return { ranges, available };
  }
}
