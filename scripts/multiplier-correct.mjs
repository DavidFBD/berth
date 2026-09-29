/**
 * One-off correction for the dividend multiplier (lib/token-multiplier):
 * from 2026-09-02 13:05 UTC DefiLlama quotes a Robinhood token's share,
 * not the token, and every mark and benchmark price stored since then
 * stands below the token's worth by the token's multiplier (SGOV 0.51%,
 * SPY 0.17%, NVDA 0.08%, QQQ 0.07%, AAPL 0.06%, MU 0.01%).
 *
 * Re-reads what it corrects from the source, so it is safe to run again:
 * - table `marks`, every listing from 2026-09-02: DefiLlama's closes
 *   refetched and multiplied (lib/server/marks fetchMarkPoints), written
 *   where they differ from what is stored. Each write re-values the
 *   `portfolio_days` rows that priced a holding at that mark
 *   (lib/server/marks revalueDays). Nothing is deleted.
 * - table `order_marks`, the listing benchmarks (SPY, QQQ, SGOV) priced
 *   from 2026-09-02 13:05 UTC and written before the fix went out
 *   (`created_at` before --fixed-at, default now): the stored price times
 *   the multiplier at its `priced_at`, the moment DefiLlama's price is
 *   from. A row that already equals DefiLlama's price at the order's
 *   minute times the multiplier is left, so a second run changes nothing.
 *   Run it after the fix is deployed; if that was a while ago, pass the
 *   deploy time as --fixed-at so a row written by the fixed code is never
 *   multiplied twice.
 *
 * Dry run by default (reads only, prints what would change); --write to
 * save.
 *
 *   pnpm multiplier:correct
 *   pnpm multiplier:correct --write [--fixed-at 2026-09-30T08:00:00Z]
 */
import "./lib/load-env.mjs";

const { BENCHMARKS } = await import("../src/lib/benchmarks.ts");
const { TOKEN_LISTINGS } = await import("../src/lib/listings.ts");
const { addDays, onTheMark, settleMarks } = await import("../src/lib/marks.ts");
const { repriceHolding } = await import("../src/lib/portfolio-days.ts");
const { LLAMA_SHARE_QUOTES_FROM_MS, llamaTokenPrice } = await import("../src/lib/token-multiplier.ts");
const { fetchMarkPoints, writeMarks } = await import("../src/lib/server/marks.ts");
const { pricesAt } = await import("../src/lib/server/orders.ts");
const { readMultiplierHistories, toTokenPrices } = await import("../src/lib/server/token-multipliers.ts");
const { getSql } = await import("../src/lib/server/db.ts");

const WRITE = process.argv.includes("--write");
const fixedAtArg = process.argv[process.argv.indexOf("--fixed-at") + 1];
const FIXED_AT = process.argv.includes("--fixed-at") ? new Date(fixedAtArg) : new Date();
if (Number.isNaN(FIXED_AT.getTime())) {
  console.error(`--fixed-at ${fixedAtArg}: not a time`);
  process.exit(1);
}
const FROM_DAY = "2026-09-02";
/** Days fetched before FROM_DAY so the despike judges the first against a real neighbour. */
const CONTEXT_DAYS = 3;
const SAME = 1e-9;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set; it is read from .env.local.");
  process.exit(1);
}
const sql = getSql();

const today = new Date().toISOString().slice(0, 10);
const symbols = TOKEN_LISTINGS.map((listing) => listing.symbol);
const fetchFrom = addDays(FROM_DAY, -CONTEXT_DAYS);
const span = Math.round((Date.parse(today) - Date.parse(fetchFrom)) / 86_400_000) + 1;

// One chain read for the whole run.
const read = await readMultiplierHistories(symbols, LLAMA_SHARE_QUOTES_FROM_MS - 86_400_000);
for (const failure of read.failures) console.warn("multiplier:", failure);
const reader = async () => read;
for (const [symbol, history] of Object.entries(read.histories)) {
  if (history.current !== 1 || history.changes.length > 0) {
    const steps = history.changes
      .map((change) => `${change.from} -> ${change.to} at ${new Date(change.effectiveAt * 1000).toISOString()}`)
      .join("; ");
    console.log(`${symbol.padEnd(5)} multiplier now ${history.current}${steps ? ` (${steps})` : ""}`);
  }
}

// ---- marks ----------------------------------------------------------------
const { points, failures } = await fetchMarkPoints(symbols, fetchFrom, span, reader);
for (const failure of failures) console.warn("marks:", failure);

const stored = new Map(
  (
    await sql.query(
      `select symbol, to_char(day, 'YYYY-MM-DD') as day, close::float8 as close
         from marks where symbol = any($1::text[]) and day >= $2::date`,
      [symbols, FROM_DAY],
    )
  ).map((row) => [`${row.symbol}|${row.day}`, Number(row.close)]),
);

const portfolioRows = await sql.query(
  `select user_id, to_char(day, 'YYYY-MM-DD') as day, value_usd::float8 as value, holdings
     from portfolio_days where day >= $1::date`,
  [FROM_DAY],
);

let marksChanged = 0;
let portfolioDays = 0;
const markChanges = {};
for (const symbol of symbols) {
  const raw = points[symbol];
  if (!raw || raw.length === 0) continue;
  const { keep } = settleMarks(onTheMark(raw), FROM_DAY);
  const changed = keep.filter((mark) => {
    const was = stored.get(`${symbol}|${mark.day}`);
    return was === undefined || Math.abs(mark.close / was - 1) > SAME;
  });
  if (changed.length === 0) continue;
  markChanges[symbol] = changed;
  const ratios = changed
    .map((mark) => stored.get(`${symbol}|${mark.day}`))
    .map((was, index) => (was ? changed[index].close / was - 1 : undefined))
    .filter((ratio) => ratio !== undefined);
  const added = changed.length - ratios.length;
  const pct = (ratio) => `${(ratio * 100).toFixed(3)}%`;
  console.log(
    `marks ${symbol.padEnd(5)} ${changed.length} day(s) ${changed[0].day} to ${changed.at(-1).day}` +
      (ratios.length ? `, up ${pct(Math.min(...ratios))} to ${pct(Math.max(...ratios))}` : "") +
      (added ? `, ${added} new` : ""),
  );
  marksChanged += changed.length;
}

// What the portfolio days priced at those marks would become (the same rule revalueDays applies).
let portfolioDelta = 0;
for (const row of portfolioRows) {
  let holdings = typeof row.holdings === "string" ? JSON.parse(row.holdings) : row.holdings;
  let value = row.value;
  for (const [symbol, changed] of Object.entries(markChanges)) {
    const mark = changed.find((candidate) => candidate.day === row.day);
    if (!mark) continue;
    const next = repriceHolding(holdings, symbol, mark.close, "mark");
    if (!next) continue;
    holdings = next.holdings;
    value = next.value;
  }
  if (Math.abs(value - row.value) > 1e-12) {
    portfolioDays += 1;
    portfolioDelta += value - row.value;
    console.log(`  portfolio ${row.user_id} ${row.day} ${row.value.toFixed(6)} -> ${value.toFixed(6)}`);
  }
}

// ---- order_marks ----------------------------------------------------------
const listingBenchmarks = BENCHMARKS.filter((benchmark) => benchmark.listingAddress);
const orderMarks = await sql.query(
  `select m.order_id, m.symbol, m.price::float8 as price, m.priced_at,
          coalesce(o.placed_at, o.filled_at, o.created_at) as placed_at
     from order_marks m join orders o on o.id = m.order_id
    where m.symbol = any($1::text[]) and m.priced_at >= $2::timestamptz and m.created_at < $3::timestamptz
    order by placed_at`,
  [
    listingBenchmarks.map((benchmark) => benchmark.symbol),
    new Date(LLAMA_SHARE_QUOTES_FROM_MS).toISOString(),
    FIXED_AT.toISOString(),
  ],
);
const byOrder = new Map();
for (const row of orderMarks) {
  if (!byOrder.has(row.order_id)) byOrder.set(row.order_id, { placedAt: new Date(row.placed_at), rows: [] });
  byOrder.get(row.order_id).rows.push(row);
}
const orderUpdates = [];
for (const [orderId, { placedAt, rows }] of byOrder) {
  const found = await pricesAt(
    listingBenchmarks.map((benchmark) => benchmark.marketId),
    placedAt,
    "4h",
  );
  const priced = {};
  for (const benchmark of listingBenchmarks) {
    const price = found[benchmark.marketId];
    if (price) priced[benchmark.symbol] = [{ timestamp: price.pricedAt.getTime() / 1000, price: price.price, pricedAt: price.pricedAt }];
  }
  const { prices: refetched } = await toTokenPrices(priced, reader);
  for (const row of rows) {
    const history = read.histories[row.symbol];
    if (!history) {
      console.warn(`order_marks ${orderId} ${row.symbol}: multiplier unread, left`);
      continue;
    }
    const again = refetched[row.symbol]?.[0];
    if (again && Math.abs(row.price / again.price - 1) <= SAME) continue; // already the token's
    const pricedAt = new Date(row.priced_at);
    const price = llamaTokenPrice(row.price, pricedAt.getTime(), history);
    if (Math.abs(price / row.price - 1) <= SAME) continue;
    orderUpdates.push({ orderId, symbol: row.symbol, price });
    console.log(
      `order_marks ${orderId} ${row.symbol.padEnd(4)} ${row.price} -> ${price.toFixed(6)} (+${((price / row.price - 1) * 100).toFixed(3)}%)`,
    );
  }
}

// ---- write ----------------------------------------------------------------
if (WRITE) {
  let revalued = 0;
  for (const [symbol, changed] of Object.entries(markChanges)) revalued += await writeMarks(symbol, changed, []);
  for (const update of orderUpdates) {
    await sql.query(
      `update order_marks set price = $3 where order_id = $1::uuid and symbol = $2`,
      [update.orderId, update.symbol, update.price],
    );
  }
  console.log(`wrote ${marksChanged} marks (re-valuing ${revalued} portfolio days) and ${orderUpdates.length} order benchmark prices`);
} else {
  console.log(
    `dry run: would write ${marksChanged} marks, re-value ${portfolioDays} portfolio days` +
      ` (${portfolioDelta >= 0 ? "+" : ""}$${portfolioDelta.toFixed(6)} in all) and update ${orderUpdates.length} order benchmark prices;` +
      " add --write to save",
  );
}
