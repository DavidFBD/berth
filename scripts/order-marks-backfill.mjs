/**
 * Fill table `order_marks` for every order still missing a benchmark's
 * price at its minute: one DefiLlama historical request per order for all
 * five benchmarks (lib/server/orders recordOrderMarks). The evening cron
 * does the same ten at a time; this catches up the whole book.
 * Safe to run again: a stored price is kept. Dry run by default (it reads
 * the prices and writes nothing); --write to save.
 *
 *   pnpm order-marks:backfill
 *   pnpm order-marks:backfill --write
 */
import "./lib/load-env.mjs";

const { BENCHMARKS } = await import("../src/lib/benchmarks.ts");
const { pricesAt, recordOrderMarks } = await import("../src/lib/server/orders.ts");
const { ordersMissingMarks } = await import("../src/lib/server/order-marks.ts");
const { getSql } = await import("../src/lib/server/db.ts");

const WRITE = process.argv.includes("--write");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set; it is read from .env.local.");
  process.exit(1);
}

const missing = await ordersMissingMarks(100_000);
console.log(`${missing.length} orders missing at least one benchmark price`);

let prices = 0;
let unpriced = 0;
for (const order of missing) {
  if (WRITE) {
    const written = await recordOrderMarks(order.id, order.placedAt);
    prices += written;
    if (written === 0) unpriced += 1;
    console.log(`${order.id} ${order.placedAt.toISOString()} wrote ${written}`);
  } else {
    const found = await pricesAt(
      BENCHMARKS.map((benchmark) => benchmark.marketId),
      order.placedAt,
      "4h",
    );
    const symbols = BENCHMARKS.filter((benchmark) => found[benchmark.marketId]).map((b) => b.symbol);
    prices += symbols.length;
    if (symbols.length === 0) unpriced += 1;
    console.log(`${order.id} ${order.placedAt.toISOString()} ${symbols.join(",") || "no prices"}`);
  }
}

if (WRITE) {
  const [{ rows }] = await getSql().query("select count(*)::int as rows from order_marks");
  const left = (await ordersMissingMarks(100_000)).length;
  console.log(`wrote ${prices} prices; ${unpriced} orders got none; order_marks now holds ${rows} rows; ${left} orders still short`);
} else {
  console.log(`dry run: would write up to ${prices} prices; ${unpriced} orders have none; add --write to save`);
}
