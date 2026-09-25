/**
 * Rebuild past `portfolio_days` from the orders ledger, source 'ledger'
 * (lib/portfolio-days ledgerDays): quantity per listing per market day from
 * buys less sells placed before that day's close, valued at stored closes.
 * Run `pnpm marks:backfill --write` first.
 *
 * Only for an account whose balance on chain right now the orders fully
 * explain (ledgerExplains, the tolerance lib/benchmark uses); for anyone
 * else nothing is written for past days, and the daily snapshot starts
 * their history. A day a held listing has no close for is left out. Never
 * replaces a snapshot row. Safe to run again. Dry run by default; --write
 * to save.
 *
 *   pnpm portfolio:backfill
 *   pnpm portfolio:backfill --write
 */
import "./lib/load-env.mjs";

const { ledgerDays, ledgerExplains } = await import("../src/lib/portfolio-days.ts");
const { readMarks } = await import("../src/lib/server/marks.ts");
const {
  hubWalletFor,
  loadListingOrders,
  readListingBalances,
  savePortfolioDay,
  snapshotAccounts,
} = await import("../src/lib/server/portfolio.ts");
const { getSql } = await import("../src/lib/server/db.ts");

const WRITE = process.argv.includes("--write");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set; it is read from .env.local.");
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const accounts = await snapshotAccounts();
let written = 0;
let explained = 0;
for (const account of accounts) {
  const orders = await loadListingOrders(account.id);
  if (orders.length === 0) continue;
  let balances;
  try {
    balances = await readListingBalances(await hubWalletFor(account.wallet));
  } catch (error) {
    console.log(`${account.id} balance read failed, skipped: ${error instanceof Error ? error.message : error}`);
    continue;
  }
  const held = Object.entries(balances).map(([symbol, quantity]) => `${quantity} ${symbol}`).join(", ") || "nothing";
  if (!ledgerExplains(orders, balances)) {
    console.log(`${account.id} ${orders.length} orders, holds ${held}: the orders do not explain it, nothing written`);
    continue;
  }
  explained += 1;
  const symbols = [...new Set(orders.map((order) => order.symbol))];
  const closes = await readMarks(symbols);
  const rows = ledgerDays({ orders, closes, through: today });
  console.log(
    `${account.id} ${orders.length} orders, holds ${held}: ${rows.length} ledger days` +
      (rows.length ? ` (${rows[0].day} $${rows[0].value.toFixed(2)} to ${rows.at(-1).day} $${rows.at(-1).value.toFixed(2)})` : ""),
  );
  if (!WRITE) continue;
  for (const row of rows) {
    if (await savePortfolioDay(account.id, row.day, row, "ledger", row.asOf)) written += 1;
  }
}

if (WRITE) {
  const [{ rows }] = await getSql().query("select count(*)::int as rows from portfolio_days");
  console.log(`${explained} account(s) explained; wrote ${written} ledger days; portfolio_days now holds ${rows} rows`);
} else {
  console.log(`${explained} account(s) explained; dry run, add --write to save`);
}
