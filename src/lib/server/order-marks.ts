import type { OrderFacts } from "@/lib/benchmark";
import { BENCHMARKS } from "@/lib/benchmarks";
import { getSql } from "@/lib/server/db";
import { recordOrderMarks } from "@/lib/server/orders";

/**
 * Table `order_marks` read and mended: each benchmark's price at an
 * order's minute, written at fill time by lib/server/orders
 * recordOrderMarks. What a fill-time fetch missed, the evening cron
 * and `pnpm order-marks:backfill` fill in here.
 */

/**
 * Orders mended per evening run: five prices each in one request, all at
 * once, so the stage costs one request's timeout (lib/server/evening).
 */
export const ORDER_MARKS_PER_RUN = 10;

/**
 * Orders missing a price for a benchmark that could have one, newest
 * first, at most `limit`. A benchmark could have one when its earliest
 * stored mark (table `marks`) is on or before the order's day: an order
 * placed before a benchmark existed can never be priced for it, and must
 * not hold a place in the queue night after night.
 */
export async function ordersMissingMarks(limit: number): Promise<{ id: string; placedAt: Date }[]> {
  const rows = (await getSql().query(
    `with firsts as (
       select symbol, min(day) as first_day from marks
        where symbol = any($1::text[]) group by symbol
     )
     select o.id, coalesce(o.placed_at, o.filled_at, o.created_at) as placed_at
       from orders o
      where exists (
        select 1 from firsts f
         where f.first_day <= coalesce(o.placed_at, o.filled_at, o.created_at)::date
           and not exists (select 1 from order_marks m where m.order_id = o.id and m.symbol = f.symbol))
      order by coalesce(o.placed_at, o.filled_at, o.created_at) desc
      limit $2`,
    [BENCHMARKS.map((benchmark) => benchmark.symbol), limit],
  )) as { id: string; placed_at: string | Date }[];
  return rows.map((row) => ({ id: row.id, placedAt: new Date(row.placed_at) }));
}

export type OrderMarksSummary = { orders: number; written: number; failed: number };

/** Fill in the missing prices for up to `limit` orders, at once. Never throws past a failed read of the queue. */
export async function fillOrderMarks({
  limit = ORDER_MARKS_PER_RUN,
  record = recordOrderMarks,
}: {
  limit?: number;
  record?: (orderId: string, placedAt: Date) => Promise<number>;
} = {}): Promise<OrderMarksSummary> {
  const missing = await ordersMissingMarks(limit);
  const summary: OrderMarksSummary = { orders: missing.length, written: 0, failed: 0 };
  const results = await Promise.all(missing.map((order) => record(order.id, order.placedAt)));
  for (const written of results) {
    summary.written += written;
    if (written === 0) summary.failed += 1;
  }
  return summary;
}

/**
 * An account's orders, oldest first, in the shape lib/benchmark reads,
 * each with the benchmark prices recorded at its minute.
 */
export async function loadOrderFacts(userId: string): Promise<OrderFacts[]> {
  const rows = (await getSql().query(
    `select o.listing_symbol, o.direction, o.quantity::float8 as quantity,
            o.usd_value::float8 as usd,
            coalesce(o.filled_at, o.placed_at, o.created_at) as placed_at,
            (select jsonb_object_agg(m.symbol, m.price::float8)
               from order_marks m where m.order_id = o.id) as benchmark_marks
       from orders o
      where o.user_id = $1
      order by placed_at`,
    [userId],
  )) as {
    listing_symbol: string;
    direction: "buy" | "sell";
    quantity: number | string | null;
    usd: number | string | null;
    placed_at: string | Date;
    benchmark_marks: Record<string, number | string> | string | null;
  }[];
  return rows.map((row) => {
    const raw =
      typeof row.benchmark_marks === "string"
        ? (JSON.parse(row.benchmark_marks) as Record<string, number | string>)
        : row.benchmark_marks;
    const facts: OrderFacts = {
      symbol: row.listing_symbol,
      direction: row.direction,
      quantity: row.quantity === null ? null : Number(row.quantity),
      usd: row.usd === null ? null : Number(row.usd),
      placedAt: new Date(row.placed_at).toISOString(),
    };
    if (raw && Object.keys(raw).length > 0) {
      facts.benchmarkMarks = Object.fromEntries(
        Object.entries(raw).map(([symbol, price]) => [symbol, Number(price)]),
      );
    }
    return facts;
  });
}

export type OrderLogEntry = {
  symbol: string;
  direction: "buy" | "sell";
  quantity: number | null;
  usd: number | null;
  /** When it filled, or when it was placed if it has not. */
  at: string;
  /** Whether the fill is recorded (fill_tx or filled_at), so it really was bought or sold. */
  filled: boolean;
};

/**
 * An account's orders newest first, each saying whether it filled, for the
 * assistant's get_orders (lib/server/mcp/tools). A placed order that never
 * filled must not read as bought or sold. The app's own callers keep
 * loadOrderFacts, whose shape and rows are unchanged.
 */
export async function loadOrderLog(userId: string, limit: number): Promise<{ total: number; entries: OrderLogEntry[] }> {
  const sql = getSql();
  const [rows, counts] = await Promise.all([
    sql.query(
      `select listing_symbol, direction, quantity::float8 as quantity, usd_value::float8 as usd,
              coalesce(filled_at, placed_at, created_at) as at,
              (fill_tx is not null or filled_at is not null) as filled
         from orders where user_id = $1
        order by coalesce(filled_at, placed_at, created_at) desc
        limit $2`,
      [userId, limit],
    ) as Promise<
      { listing_symbol: string; direction: "buy" | "sell"; quantity: number | string | null; usd: number | string | null; at: string | Date; filled: boolean }[]
    >,
    sql.query(`select count(*)::int as n from orders where user_id = $1`, [userId]) as Promise<{ n: number }[]>,
  ]);
  return {
    total: counts[0]?.n ?? 0,
    entries: rows.map((row) => ({
      symbol: row.listing_symbol,
      direction: row.direction,
      quantity: row.quantity === null ? null : Number(row.quantity),
      usd: row.usd === null ? null : Number(row.usd),
      at: new Date(row.at).toISOString(),
      filled: row.filled === true,
    })),
  };
}
