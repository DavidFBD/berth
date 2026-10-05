/**
 * One-off: fill orders.delivered_to for rows written before the column
 * existed, from the intent itself (intent.dstAddress, the wallet the fill's
 * Transfer went to; lib/server/orders stores the same thing at fill time).
 *
 * Touches only rows where delivered_to is null and writes that column and,
 * where it is still null, holding_chain, read from the same intent by
 * src/lib/orders holdingChainOf: an address on Robinhood Chain written
 * beside a null chain would be read as a hub wallet and judged on Sonic.
 * Safe to run again: a second run sees only what the first could not
 * resolve. Prints counts, never addresses.
 *
 *   node --no-warnings --experimental-strip-types scripts/backfill-delivered-to.mjs
 *
 * Reads DATABASE_URL from the environment, else from .env.local (as db-push).
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { Sodax } from "@sodax/sdk";

const { holdingChainOf } = await import("../src/lib/orders.ts");
const { DELIVERED_TO_UPDATE, deliveredToParams } = await import("../src/lib/order-backfill-sql.ts");

if (!process.env.DATABASE_URL) {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // fall through to the check below
  }
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set. Run `vercel env pull` first.");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
// The same client the orders backfill uses: getIntent only needs the hub.
// The SDK's default hub RPC (rpc.soniclabs.com) answered 503 to everything on
// 2026-10-04; the app's own failover list, as in src/lib/sodax-config HUB_RPC_URLS.
const sodax = new Sodax({
  hub: { rpcUrls: ["https://sonic-rpc.publicnode.com", "https://sonic.drpc.org", "https://rpc.soniclabs.com"] },
});

async function intentOf(tx) {
  try {
    const result = await Promise.race([
      sodax.swaps.getIntent(tx),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 20_000)),
    ]);
    return result.ok ? result.value : undefined;
  } catch {
    return undefined;
  }
}

const rows = await sql.query(
  "select intent_tx, direction from orders where delivered_to is null order by created_at",
);
let filled = 0;
let unresolved = 0;
let failed = 0;
for (const row of rows) {
  // Each row on its own: one whose write throws is counted and the rest still run.
  try {
    const intent = await intentOf(row.intent_tx);
    const delivered =
      intent && typeof intent.dstAddress === "string" && intent.dstAddress.length > 2
        ? intent.dstAddress.toLowerCase()
        : null;
    if (!delivered) {
      unresolved += 1;
      continue;
    }
    const updated = await sql.query(DELIVERED_TO_UPDATE, deliveredToParams(row.intent_tx, delivered, holdingChainOf(row.direction, intent)));
    if (updated.length > 0) filled += 1;
  } catch (error) {
    failed += 1;
    console.warn("row failed:", error instanceof Error ? error.message : error);
  }
}
console.log(`rows seen: ${rows.length}, filled: ${filled}, unresolved: ${unresolved}, failed: ${failed}`);
