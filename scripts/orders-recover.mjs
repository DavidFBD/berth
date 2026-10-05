/**
 * Recover orders that filled but were never written to `orders`
 * (lib/server/orders-recover): every live account's filled Berth intents
 * in SODAX's backend, for each EVM address on the account and its hub
 * wallet, proven on chain as the pour route proves them, built as the pour
 * route builds them. Mostly the sells a hub wallet made before judgePour
 * accepted hub wallets, which the pour route refused and never recorded.
 *
 * Insert only, `on conflict (intent_tx) do nothing`: a recorded order is
 * never touched. No XP is paid; the summary counts the recovered orders
 * with no pour award. Safe to run again. Dry run by default: prints per
 * account what it would add. --write to insert. --local aims at
 * LOCAL_DATABASE_URL instead of DATABASE_URL (which .env.local points at
 * production). --json <file> also writes the recovered rows as JSON.
 *
 *   pnpm orders:recover
 *   pnpm orders:recover --write
 *   pnpm orders:recover --local --write
 */
import "./lib/load-env.mjs";
import { writeFileSync } from "node:fs";

const WRITE = process.argv.includes("--write");
const LOCAL = process.argv.includes("--local");
const jsonAt = process.argv.indexOf("--json");
const JSON_FILE = jsonAt > 0 ? process.argv[jsonAt + 1] : undefined;

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

const { recoverOrders } = await import("../src/lib/server/orders-recover.ts");

const day = (date) => (date ? new Date(date).toISOString().slice(0, 16).replace("T", " ") : "?");
const rows = [];
console.log(`${LOCAL ? "local" : "DATABASE_URL"}, ${WRITE ? "writing" : "dry run"}`);
const summary = await recoverOrders({
  write: WRITE,
  onReport: (report) => {
    console.log(
      `${report.userId.slice(0, 8)} ${report.addresses} addresses, ${report.intents} intents, ` +
        `${report.berthFilled} Berth fills, ${report.alreadyRecorded} recorded, ` +
        `${report.recovered.length} ${WRITE ? `recovered (${report.written} written)` : "to add"}` +
        (report.rejected.length ? `, ${report.rejected.length} refused` : ""),
    );
    for (const order of report.recovered) {
      console.log(
        `  ${day(order.placedAt)} ${order.direction} ${order.quantity ?? "?"} ${order.listingSymbol}` +
          ` ${order.direction === "buy" ? "for" : "for at least"} ${order.payAmount ?? "?"} ${order.paySymbol ?? "?"}` +
          ` intent ${order.intentTx.slice(0, 10)}…${order.xpPaid ? "" : " (no XP)"}`,
      );
      rows.push(order);
    }
    for (const refused of report.rejected) console.log(`  refused ${refused.intentTx.slice(0, 10)}…: ${refused.reason}`);
  },
});
if (JSON_FILE) writeFileSync(JSON_FILE, JSON.stringify(rows, null, 2));
console.log(
  `${summary.accounts} account(s): ${summary.recovered} order(s) ${WRITE ? `recovered, ${summary.written} written` : "to add"}, ` +
    `${summary.xpUnpaid} without pour XP (not paid here), ${summary.rejected} refused` +
    (summary.failedAccounts ? `, ${summary.failedAccounts} account(s) failed (see warnings; rerun, it is idempotent)` : "") +
    (WRITE ? "" : "; dry run, add --write to save"),
);
