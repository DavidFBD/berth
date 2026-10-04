/**
 * One-off: write an order row for every pour the XP ledger already knows.
 *
 * The ledger kept only the intent hash (xp_events.ref); everything else is
 * read back from the chain the same way lib/server/orders does at fill time.
 * Safe to run again: rows are keyed on the intent and a rerun only fills in
 * what an earlier one could not find. Dry run by default; --write to save.
 *
 *   node --no-warnings --experimental-strip-types scripts/orders-backfill.mjs
 *   node --no-warnings --experimental-strip-types scripts/orders-backfill.mjs --write
 *
 * Reads DATABASE_URL from the environment (source .env.local first).
 */
import { neon } from "@neondatabase/serverless";
import { Sodax } from "@sodax/sdk";

const { readOrder, pickFill, priceIdFor, isDollarStable, TRANSFER_TOPIC, addressTopic } = await import(
  "../src/lib/orders.ts"
);
const { COINGECKO_ID_BY_LOWER_SYMBOL } = await import("../src/lib/coingecko-ids.ts");
const { listListings } = await import("../src/lib/listings.ts");
const { displayToken } = await import("../src/lib/chains.ts");

const WRITE = process.argv.includes("--write");
const RPC = "https://sonic-rpc.publicnode.com";
const FILL_SEARCH_BLOCKS = 20_000;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set. Run `set -a; source .env.local; set +a` first.");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);
// The SDK's default hub RPC (rpc.soniclabs.com) answered 503 to everything on
// 2026-10-04; the app's own failover list, as in src/lib/sodax-config HUB_RPC_URLS.
const sodax = new Sodax({
  hub: { rpcUrls: ["https://sonic-rpc.publicnode.com", "https://sonic.drpc.org", "https://rpc.soniclabs.com"] },
});
const listings = listListings(sodax.leverageYield.listVaults());

async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await response.json()).result;
}
async function priceAt(id, at) {
  const seconds = Math.floor(at.getTime() / 1000);
  const response = await fetch(`https://coins.llama.fi/prices/historical/${seconds}/coingecko:${id}`);
  if (!response.ok) return undefined;
  const price = (await response.json()).coins?.[`coingecko:${id}`]?.price;
  return typeof price === "number" && price > 0 ? price : undefined;
}
async function blockTime(hex) {
  const block = await rpc("eth_getBlockByNumber", [hex, false]);
  return block ? new Date(Number.parseInt(block.timestamp, 16) * 1000) : null;
}

const pours = await sql`
  select user_id, kind, ref from xp_events
  where kind in ('pour_in', 'pour_out') and ref is not null
  order by created_at`;
console.log(`${pours.length} pours in the ledger${WRITE ? "" : " (dry run)"}`);

for (const pour of pours) {
  const direction = pour.kind === "pour_out" ? "sell" : "buy";
  const found = await sodax.swaps.getIntent(pour.ref);
  if (!found.ok) {
    console.log("skip, no intent", pour.ref);
    continue;
  }
  const intent = found.value;
  const ours = direction === "buy" ? intent.outputToken : intent.inputToken;
  const other = direction === "buy" ? intent.inputToken : intent.outputToken;
  const listing = listings.find((entry) => entry.address.toLowerCase() === ours.toLowerCase());
  if (!listing) {
    console.log("skip, not a listing", pour.ref);
    continue;
  }
  const pay = displayToken(sodax.config.getXTokenFromHubAsset(other));
  const receipt = await rpc("eth_getTransactionReceipt", [pour.ref]);
  const placedAt = receipt ? await blockTime(receipt.blockNumber) : null;
  let fill;
  if (direction === "buy" && receipt) {
    const from = Number.parseInt(receipt.blockNumber, 16);
    const logs = await rpc("eth_getLogs", [
      {
        fromBlock: receipt.blockNumber,
        toBlock: `0x${(from + FILL_SEARCH_BLOCKS).toString(16)}`,
        address: listing.address,
        topics: [TRANSFER_TOPIC, null, addressTopic(intent.dstAddress)],
      },
    ]);
    fill = Array.isArray(logs) ? pickFill(logs) : undefined;
  }
  const filledAt = fill ? await blockTime(`0x${fill.blockNumber.toString(16)}`) : null;
  const priceId =
    direction === "buy" && pay && !isDollarStable(pay.symbol)
      ? priceIdFor(pay.symbol, COINGECKO_ID_BY_LOWER_SYMBOL)
      : undefined;
  const payUsdPrice = priceId && placedAt ? await priceAt(priceId, placedAt) : undefined;
  const order = readOrder({
    payUsdPrice,
    intentTx: pour.ref,
    direction,
    intent,
    listing: { symbol: listing.symbol, address: listing.address, decimals: listing.decimals },
    pay: pay ? { symbol: pay.symbol, decimals: pay.decimals, chainKey: pay.chainKey } : undefined,
    received: fill?.received,
    fillTx: fill?.fillTx ?? null,
    placedAt,
    filledAt,
  });
  console.log(
    `${order.direction} ${order.quantity ?? "?"} ${order.listingSymbol} for ${order.payAmount ?? "?"} ${order.paySymbol ?? "?"}` +
      ` usd=${order.usdValue ?? "-"} (${order.usdSource ?? "unknown"}) placed=${order.placedAt?.toISOString() ?? "?"} fill=${order.fillTx ? "yes" : "no"}`,
  );
  if (!WRITE) continue;
  await sql.query(
    `insert into orders (
       user_id, wallet_address, intent_tx, fill_tx, direction, listing_symbol,
       listing_address, quantity, min_quantity, pay_symbol, pay_chain,
       pay_amount, fee_amount, usd_value, placed_at, filled_at, usd_source,
       delivered_to
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     on conflict (intent_tx) do update set
       delivered_to = coalesce(orders.delivered_to, excluded.delivered_to),
       usd_value = coalesce(orders.usd_value, excluded.usd_value),
       usd_source = coalesce(orders.usd_source, excluded.usd_source),
       fill_tx = coalesce(orders.fill_tx, excluded.fill_tx),
       quantity = coalesce(orders.quantity, excluded.quantity),
       filled_at = coalesce(orders.filled_at, excluded.filled_at)`,
    [
      pour.user_id, order.walletAddress, order.intentTx, order.fillTx, order.direction,
      order.listingSymbol, order.listingAddress, order.quantity, order.minQuantity,
      order.paySymbol, order.payChain, order.payAmount, order.feeAmount, order.usdValue,
      order.placedAt, order.filledAt, order.usdSource, order.deliveredTo,
    ],
  );
}
console.log(WRITE ? "written" : "dry run; add --write to save");
