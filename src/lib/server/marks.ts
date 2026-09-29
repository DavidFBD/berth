import type { Marks } from "@/lib/benchmark";
import { MARKS_MARKET_ID_BY_SYMBOL, SYMBOL_BY_MARKS_MARKET_ID } from "@/lib/market-ids";
import {
  addDays,
  markStartSeconds,
  onTheMark,
  settleMarks,
  type IsoDay,
  type StoredMark,
} from "@/lib/marks";
import { chunkByPointBudget } from "@/lib/performance";
import { repriceHolding, type Holding } from "@/lib/portfolio-days";
import { getSql } from "@/lib/server/db";
import { cachedMultiplierHistories, toTokenPrices, type MultiplierReader } from "@/lib/server/token-multipliers";

/**
 * The stored marks' IO: DefiLlama's `/chart` in, table `marks` out, and
 * the read the portfolio draws from. The rules (what time a mark is, what
 * is kept) are in lib/marks. A listing's mark is what one token is worth,
 * so DefiLlama's share quote is multiplied by the token's dividend
 * multiplier on the way in (lib/token-multiplier).
 */

const LLAMA_BASE = "https://coins.llama.fi";
/** DefiLlama's cap on coins times days per request (lib/server/listing-performance). */
export const MARKS_POINT_BUDGET = 500;

type Point = { timestamp: number; price: number };

type ChartResponse = {
  coins?: Record<string, { prices?: { timestamp?: number; price?: number }[] } | undefined>;
};

/** One `/chart` request: daily points from `fromDay`'s mark time, by symbol. */
async function readChart(
  symbols: readonly string[],
  fromDay: IsoDay,
  spanDays: number,
): Promise<Record<string, Point[]>> {
  const ids = symbols.map((symbol) => `coingecko:${MARKS_MARKET_ID_BY_SYMBOL[symbol]}`);
  const url =
    `${LLAMA_BASE}/chart/${ids.join(",")}` +
    `?start=${markStartSeconds(fromDay)}&span=${spanDays}&period=1d`;
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`DefiLlama answered ${response.status}`);
  const payload = (await response.json()) as ChartResponse;
  const out: Record<string, Point[]> = {};
  for (const [key, value] of Object.entries(payload.coins ?? {})) {
    const symbol = SYMBOL_BY_MARKS_MARKET_ID[key.replace("coingecko:", "")];
    if (!symbol) continue;
    out[symbol] = (value?.prices ?? []).filter(
      (point): point is Point =>
        typeof point?.price === "number" && typeof point?.timestamp === "number",
    );
  }
  return out;
}

/**
 * Points for every symbol, `spanDays` from `fromDay`, cut to the point
 * budget, as token prices (lib/server/token-multipliers toTokenPrices). A
 * chunk that fails costs its own symbols and is reported, and so does a
 * listing whose multiplier could not be read: its points are the share's,
 * and a mark stored from them would stand below the token's worth.
 */
export async function fetchMarkPoints(
  symbols: readonly string[],
  fromDay: IsoDay,
  spanDays: number,
  readMultipliers: MultiplierReader = cachedMultiplierHistories,
): Promise<{ points: Record<string, Point[]>; failures: string[] }> {
  const chunks = chunkByPointBudget(symbols, spanDays, MARKS_POINT_BUDGET);
  const results = await Promise.allSettled(
    chunks.map((chunk) => readChart(chunk, fromDay, spanDays)),
  );
  const points: Record<string, Point[]> = {};
  const failures: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") Object.assign(points, result.value);
    else {
      const reason = result.reason instanceof Error ? result.reason.message : "request failed";
      failures.push(`${chunks[index].join(",")}: ${reason}`);
    }
  });
  const { prices, unread } = await toTokenPrices(points, readMultipliers);
  for (const symbol of unread) failures.push(`${symbol}: dividend multiplier unread`);
  return { points: prices, failures };
}

/**
 * Upsert the kept marks and take out the ones the despike rejected, then
 * put right every stored portfolio day those days valued at the old mark
 * (revalueDays). Returns how many portfolio days were re-valued.
 */
export async function writeMarks(
  symbol: string,
  keep: readonly StoredMark[],
  drop: readonly IsoDay[],
): Promise<number> {
  const sql = getSql();
  if (keep.length > 0) {
    await sql.query(
      `insert into marks (symbol, day, close, source)
       select $1, d, c, 'defillama'
         from unnest($2::date[], $3::numeric[]) as t(d, c)
       on conflict (symbol, day) do update set close = excluded.close, source = excluded.source`,
      [symbol, keep.map((mark) => mark.day), keep.map((mark) => mark.close)],
    );
  }
  if (drop.length > 0) {
    await sql.query(
      `delete from marks where symbol = $1 and day = any($2::date[]) and source = 'defillama'`,
      [symbol, drop],
    );
  }
  return revalueDays(symbol, [...keep.map((mark) => mark.day), ...drop]);
}

/**
 * Re-value the `portfolio_days` rows of `days` whose holdings valued
 * `symbol` at a stored mark, now that the mark changed or was taken out:
 * a snapshot's newest close has had no day after it to be despiked
 * against, so a bad print can reach a row before tomorrow's run removes
 * it. The quantities are the row's own (`holdings`); `as_of` and `source`
 * are kept, only the price and the value change. A day whose mark is gone
 * takes the close before it ('prior_mark'); with none the row is left.
 */
export async function revalueDays(symbol: string, days: readonly IsoDay[]): Promise<number> {
  if (days.length === 0) return 0;
  const sql = getSql();
  const rows = (await sql.query(
    `select user_id, to_char(day, 'YYYY-MM-DD') as day, holdings
       from portfolio_days
      where day = any($1::date[]) and holdings @> $2::jsonb`,
    [days, JSON.stringify([{ symbol }])],
  )) as { user_id: string; day: string; holdings: Holding[] | string }[];
  if (rows.length === 0) return 0;

  const closes = new Map<IsoDay, { price: number; source: "mark" | "prior_mark" } | null>();
  const closeFor = async (day: IsoDay) => {
    if (closes.has(day)) return closes.get(day)!;
    const [found] = (await sql.query(
      `select to_char(day, 'YYYY-MM-DD') as day, close::float8 as close
         from marks where symbol = $1 and day <= $2::date
        order by day desc limit 1`,
      [symbol, day],
    )) as { day: string; close: number }[];
    const result = found
      ? { price: Number(found.close), source: found.day === day ? ("mark" as const) : ("prior_mark" as const) }
      : null;
    closes.set(day, result);
    return result;
  };

  let revalued = 0;
  for (const row of rows) {
    const close = await closeFor(row.day);
    if (!close) continue;
    const holdings = typeof row.holdings === "string" ? (JSON.parse(row.holdings) as Holding[]) : row.holdings;
    const next = repriceHolding(holdings, symbol, close.price, close.source);
    if (!next) continue;
    await sql.query(
      `update portfolio_days set value_usd = $3, holdings = $4::jsonb
        where user_id = $1 and day = $2::date`,
      [row.user_id, row.day, next.value, JSON.stringify(next.holdings)],
    );
    revalued += 1;
  }
  return revalued;
}

export type MarksRunSummary = {
  symbols: number;
  written: number;
  dropped: number;
  /** Portfolio days put right because a mark they were valued at changed or went. */
  revalued: number;
  /** Symbols with no points at all this run. */
  empty: string[];
  failures: string[];
};

/**
 * Fetch, settle and store. `writeDays` of marks are written; the fetch
 * reaches `contextDays` further back so the despike can judge the oldest
 * written day against a real neighbour.
 */
export async function refreshMarks({
  today = new Date().toISOString().slice(0, 10),
  writeDays = 7,
  contextDays = 3,
  symbols = Object.keys(MARKS_MARKET_ID_BY_SYMBOL),
  readMultipliers = cachedMultiplierHistories,
}: {
  today?: IsoDay;
  writeDays?: number;
  contextDays?: number;
  symbols?: readonly string[];
  readMultipliers?: MultiplierReader;
} = {}): Promise<MarksRunSummary> {
  const span = writeDays + contextDays + 1;
  const fromDay = addDays(today, -(writeDays + contextDays));
  const writeFrom = addDays(today, -writeDays);
  const { points, failures } = await fetchMarkPoints(symbols, fromDay, span, readMultipliers);
  const summary: MarksRunSummary = {
    symbols: symbols.length,
    written: 0,
    dropped: 0,
    revalued: 0,
    empty: [],
    failures,
  };
  for (const symbol of symbols) {
    const raw = points[symbol];
    if (!raw || raw.length === 0) {
      summary.empty.push(symbol);
      continue;
    }
    const { keep, drop } = settleMarks(onTheMark(raw), writeFrom);
    try {
      summary.revalued += await writeMarks(symbol, keep, drop);
      summary.written += keep.length;
      summary.dropped += drop.length;
    } catch (error) {
      summary.failures.push(`${symbol}: ${error instanceof Error ? error.message : "write failed"}`);
    }
  }
  return summary;
}

/** Stored closes by symbol, oldest first. */
export async function readMarks(
  symbols: readonly string[],
  fromDay: IsoDay = "1970-01-01",
): Promise<Record<string, Marks>> {
  const out: Record<string, { dates: string[]; values: number[] }> = {};
  for (const symbol of symbols) out[symbol] = { dates: [], values: [] };
  if (symbols.length === 0) return out;
  const rows = (await getSql().query(
    `select symbol, to_char(day, 'YYYY-MM-DD') as day, close::float8 as close
       from marks
      where symbol = any($1::text[]) and day >= $2::date
      order by symbol, day`,
    [symbols, fromDay],
  )) as { symbol: string; day: string; close: number }[];
  for (const row of rows) {
    out[row.symbol].dates.push(row.day);
    out[row.symbol].values.push(Number(row.close));
  }
  return out;
}
