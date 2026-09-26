import {
  MARKET_ID_BY_SYMBOL,
  SYMBOL_BY_MARKET_ID,
} from "@/lib/market-ids";
import {
  chunkByPointBudget,
  percentChange,
  tradingDayCloses,
  withoutSpikes,
} from "@/lib/performance";

/**
 * The listing-performance route's server half (the route in
 * app/api/listing-performance serves this as it is).
 *
 * How each listing has moved, and the shape of its last months.
 *
 * The solver oracle prices a listing but knows nothing of yesterday, so the
 * line and the change come from DefiLlama's keyless coins API, keyed by the
 * CoinGecko ids pinned in `lib/market-ids` (the same Robinhood token on
 * Robinhood's own chain: the same instrument, a different deployment). The
 * app already reaches DefiLlama for deposit token prices.
 *
 * One source, not two. An earlier draft took the change figures from
 * DefiLlama's own `/percentage` endpoint, which compares the price now
 * against the price a period ago whatever day that lands on. These tokens
 * trade around the clock on a thin venue, so a Saturday or a holiday can
 * carry a mark the share never had, and a Monday's "24 hour change" would
 * then be measured against it. Both numbers now come off the same filtered
 * series (`lib/market-calendar` says which days count), so the badge and the
 * line can never tell different stories, and the route makes three upstream
 * requests instead of six.
 *
 * Always 200. Every field is optional and a missing one is a soft degrade:
 * the row shows its price with no badge and no line rather than an error.
 */

const LLAMA_BASE = "https://coins.llama.fi";
/** The series gains one point a day; an hour between reads is generous. */
const SERIES_REVALIDATE_SECONDS = 3600;
/** Days of history asked for. Trading days keep about seven in ten. */
const SERIES_SPAN_DAYS = 90;
/**
 * DefiLlama answers 400 "Requested N data points exceeds the maximum of 500"
 * on the product of coins and span, so thirteen listings over ninety days
 * goes out as three requests. Verified 2026-09-17: 13 × 30 passes,
 * 13 × 60 does not.
 */
const SERIES_POINT_BUDGET = 500;

export type ListingPerformance = {
  /**
   * Percent change between the last two daily marks, e.g. 2.14 meaning
   * +2.14%. Day over day on trading days only, so a weekend print can never
   * invent a move. Not close to close: DefiLlama stamps these marks around
   * 08:50 in New York, before the opening bell, so each one carries the
   * previous session plus the night's thin trading.
   */
  changePct?: number;
  /**
   * The previous market day's mark was a bad print the despike dropped, so
   * there is no clean close to measure the last day against. `changePct` is
   * then absent rather than a two day change dressed as one.
   */
  noCleanClose?: boolean;
  /** Daily marks on days the market was open, oldest first. */
  series?: number[];
  /** ISO date of the first close in `series`. */
  seriesFrom?: string;
  /**
   * The ISO date of every mark in `series`, one for one. Needed because the
   * despike removes marks from inside the week, so a date cannot be counted
   * forward from `seriesFrom`. "Since your first buy" reads the benchmark's
   * mark on the day of the buy from here.
   */
  seriesDates?: string[];
};

export type ListingPerformanceResponse = {
  /** Ticker symbol → what is known about it. Absent means nothing is. */
  performance: Record<string, ListingPerformance>;
  /**
   * Days the longest series actually covers, oldest close to today. Not the
   * span asked for: history for these tokens begins on 2026-06-26, so a
   * caption reading "the last 90 days" over eighty days of line would be a
   * small lie told in the app's own voice. Zero when nothing came back.
   */
  seriesDays: number;
  /** Present only when something degraded, for the console. */
  reason?: string;
};

type ChartResponse = {
  coins?: Record<
    string,
    { prices?: { timestamp?: number; price?: number }[] } | undefined
  >;
};

/** One `/chart` read: daily marks for as many listings as the budget allows. */
async function readChunk(
  ids: readonly string[],
  start: number,
): Promise<Record<string, ListingPerformance>> {
  const url =
    `${LLAMA_BASE}/chart/${ids.map((id) => `coingecko:${id}`).join(",")}` +
    `?start=${start}&span=${SERIES_SPAN_DAYS}&period=1d`;
  const response = await fetch(url, {
    next: { revalidate: SERIES_REVALIDATE_SECONDS },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`DefiLlama answered ${response.status}`);
  const payload = (await response.json()) as ChartResponse;

  const found: Record<string, ListingPerformance> = {};
  for (const [key, value] of Object.entries(payload?.coins ?? {})) {
    const symbol = SYMBOL_BY_MARKET_ID[key.replace("coingecko:", "")];
    if (!symbol) continue;
    const points = (value?.prices ?? []).filter(
      (point): point is { timestamp: number; price: number } =>
        typeof point?.price === "number" && typeof point?.timestamp === "number",
    );
    // Two passes, in this order: the calendar removes the weekend and
    // holiday marks, which is most of the damage and needs no judgement,
    // and the despike then catches what the thinnest listings print inside
    // the week.
    const open = tradingDayCloses(points);
    const { dates, values } = withoutSpikes(open.dates, open.values);
    // One close draws no line and measures no change.
    if (values.length < 2) continue;
    const previousDropped = dates[dates.length - 2] !== open.dates[open.dates.length - 2];
    found[symbol] = {
      series: values,
      seriesFrom: dates[0],
      seriesDates: dates,
      ...(previousDropped
        ? { noCleanClose: true }
        : { changePct: percentChange(values[values.length - 2], values[values.length - 1]) }),
    };
  }
  return found;
}

/**
 * Every listing's series and change, as the route serves them. Exported for
 * lib/server/moves, which reads the same marks the board draws, from the
 * same fetch cache.
 */
export async function loadPerformance(): Promise<ListingPerformanceResponse> {
  const ids = Object.values(MARKET_ID_BY_SYMBOL);
  const start = Math.floor(Date.now() / 1000) - SERIES_SPAN_DAYS * 86_400;
  const payload: ListingPerformanceResponse = {
    performance: {},
    seriesDays: 0,
  };

  // Chunks are independent: one that fails costs its own listings a line and
  // nothing else, so they settle side by side rather than in sequence.
  const results = await Promise.allSettled(
    chunkByPointBudget(ids, SERIES_SPAN_DAYS, SERIES_POINT_BUDGET).map((chunk) =>
      readChunk(chunk, start),
    ),
  );

  const failures: string[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      Object.assign(payload.performance, result.value);
    } else {
      failures.push(
        result.reason instanceof Error
          ? result.reason.message
          : "upstream request failed",
      );
    }
  }

  // What the caption may claim: from the earliest close anyone returned to
  // today, capped at the window asked for.
  const earliest = Object.values(payload.performance)
    .map((entry) => entry.seriesFrom)
    .filter((from): from is string => typeof from === "string")
    .sort()[0];
  if (earliest) {
    const days = Math.round(
      (Date.now() - Date.parse(`${earliest}T00:00:00Z`)) / 86_400_000,
    );
    payload.seriesDays = Math.min(Math.max(days, 0), SERIES_SPAN_DAYS);
  }

  const missing = ids.length - Object.keys(payload.performance).length;
  if (failures.length > 0 || missing > 0) {
    payload.reason = [
      ...new Set(failures),
      ...(missing > 0 ? [`${missing} listing(s) without a series`] : []),
    ].join("; ");
  }
  return payload;
}
