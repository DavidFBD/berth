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
import { getSql } from "@/lib/server/db";

/**
 * The stored marks' IO: DefiLlama's `/chart` in, table `marks` out, and
 * the read the portfolio draws from. The rules (what time a mark is, what
 * is kept) are in lib/marks.
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
 * budget. A chunk that fails costs its own symbols and is reported.
 */
export async function fetchMarkPoints(
  symbols: readonly string[],
  fromDay: IsoDay,
  spanDays: number,
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
  return { points, failures };
}

/** Upsert the kept marks and take out the ones the despike rejected. */
export async function writeMarks(
  symbol: string,
  keep: readonly StoredMark[],
  drop: readonly IsoDay[],
): Promise<void> {
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
}

export type MarksRunSummary = {
  symbols: number;
  written: number;
  dropped: number;
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
}: {
  today?: IsoDay;
  writeDays?: number;
  contextDays?: number;
  symbols?: readonly string[];
} = {}): Promise<MarksRunSummary> {
  const span = writeDays + contextDays + 1;
  const fromDay = addDays(today, -(writeDays + contextDays));
  const writeFrom = addDays(today, -writeDays);
  const { points, failures } = await fetchMarkPoints(symbols, fromDay, span);
  const summary: MarksRunSummary = { symbols: symbols.length, written: 0, dropped: 0, empty: [], failures };
  for (const symbol of symbols) {
    const raw = points[symbol];
    if (!raw || raw.length === 0) {
      summary.empty.push(symbol);
      continue;
    }
    const { keep, drop } = settleMarks(onTheMark(raw), writeFrom);
    try {
      await writeMarks(symbol, keep, drop);
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
