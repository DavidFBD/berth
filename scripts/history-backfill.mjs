/**
 * Reach each account's stored history back to its first buy
 * (lib/server/history-backfill): the market days between the first buy's
 * close and the first snapshot, rebuilt from the orders at stored closes,
 * source 'ledger', only when the orders explain what that first snapshot
 * held. Never over a stored row; safe to run again. The evening cron does
 * the same for a few accounts a night.
 *
 * Dry run by default: says per account what it would add and why, writes
 * nothing. --write to save. --local aims at LOCAL_DATABASE_URL instead of
 * DATABASE_URL (which .env.local points at production).
 *
 *   pnpm history:backfill
 *   pnpm history:backfill --write
 *   pnpm history:backfill --local --write
 */
import "./lib/load-env.mjs";

const WRITE = process.argv.includes("--write");
const LOCAL = process.argv.includes("--local");

if (LOCAL) {
  if (!process.env.LOCAL_DATABASE_URL) {
    console.error("--local needs LOCAL_DATABASE_URL (postgres://…@localhost/…).");
    process.exit(1);
  }
} else {
  // lib/server/db prefers LOCAL_DATABASE_URL when it is set; without
  // --local the target is DATABASE_URL, said out loud.
  delete process.env.LOCAL_DATABASE_URL;
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set; it is read from .env.local.");
    process.exit(1);
  }
}

const { backfillHistories } = await import("../src/lib/server/history-backfill.ts");

const WHY = {
  no_orders: "no listing orders",
  no_snapshot: "no snapshot yet to check the orders against",
  reaches_first_buy: "history already starts at the first buy",
  explained: "the orders explain the first snapshot",
  unexplained: "the first snapshot holds what the orders do not add up to (money moved without an order); history keeps its start",
  merge_conflict: "writing would change a merged account's history after its first snapshot; nothing written",
};

console.log(`${LOCAL ? "local" : "DATABASE_URL"}, ${WRITE ? "writing" : "dry run"}`);
const summary = await backfillHistories({
  write: WRITE,
  onReport: (report) => {
    const span = report.rows.length ? ` (${report.rows[0].day} to ${report.rows.at(-1).day})` : "";
    const days = WRITE ? `${report.written} days written` : `${report.rows.length} days to add`;
    console.log(
      `${report.userId.slice(0, 8)} ${report.orders} orders, first buy ${report.firstBuyDay ?? "none"}, ` +
        `first snapshot ${report.firstSnapshotDay ?? "none"}: ${WHY[report.verdict]}; ${days}${span}`,
    );
  },
});
console.log(
  `${summary.accounts} account(s) whose history starts after their first order: ` +
    `${summary.explained} explained, ${summary.unexplained} not explained, ${summary.unchanged} unchanged; ` +
    (WRITE ? `${summary.written} days written` : `${summary.days} days to add; dry run, add --write to save`),
);
