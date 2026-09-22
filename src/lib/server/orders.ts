import type { Intent, Sodax } from "@sodax/sdk";
import { getSql } from "@/lib/server/db";
import { listListings } from "@/lib/listings";
import {
  TRANSFER_TOPIC,
  addressTopic,
  pickFill,
  readOrder,
  type OrderRecord,
} from "@/lib/orders";

/**
 * Writing the order record at fill time: which listing, how much, what it
 * cost, when. Called from the pour route once the intent has been verified
 * (lib/server/pour-verify), so nothing here re-proves ownership; it only
 * reads what the chain says happened.
 *
 * Best effort by design. A failed read or write logs and returns; the XP
 * award that called it has already been decided and must not fail over
 * bookkeeping. A missing fill is written as a row without a quantity, and a
 * later call for the same intent fills the gaps in (the upsert keeps what is
 * known and adds what is new).
 */

const SONIC_RPC = "https://sonic-rpc.publicnode.com";
/** Sonic makes a block about every 0.3s; this is well over an hour of them. */
const FILL_SEARCH_BLOCKS = 20_000;

async function rpc<T>(method: string, params: unknown[]): Promise<T | undefined> {
  try {
    const response = await fetch(SONIC_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as { result?: T };
    return payload.result ?? undefined;
  } catch {
    return undefined;
  }
}

async function blockTime(blockHex: string): Promise<Date | null> {
  const block = await rpc<{ timestamp: string }>("eth_getBlockByNumber", [blockHex, false]);
  return block ? new Date(Number.parseInt(block.timestamp, 16) * 1000) : null;
}

export async function buildOrder({
  sodax,
  intentTx,
  direction,
  intent,
  claimedFillTx,
}: {
  sodax: Sodax;
  intentTx: string;
  direction: "buy" | "sell";
  intent: Intent;
  claimedFillTx?: string | null;
}): Promise<OrderRecord | undefined> {
  const listings = listListings(sodax.leverageYield.listVaults());
  const ours = direction === "buy" ? intent.outputToken : intent.inputToken;
  const other = direction === "buy" ? intent.inputToken : intent.outputToken;
  const listing = listings.find((entry) => entry.address.toLowerCase() === ours.toLowerCase());
  if (!listing) return undefined;
  const payToken = sodax.config.getXTokenFromHubAsset(other);

  const receipt = await rpc<{ blockNumber: string }>("eth_getTransactionReceipt", [intentTx]);
  const placedAt = receipt ? await blockTime(receipt.blockNumber) : null;

  let fill: ReturnType<typeof pickFill>;
  // A buy is delivered to the hub wallet on Sonic, where the Transfer can be
  // read. A sell pays out on the destination chain, which is not read here.
  if (direction === "buy" && receipt) {
    const from = Number.parseInt(receipt.blockNumber, 16);
    const logs = await rpc<{ transactionHash: string; data: string; blockNumber: string }[]>(
      "eth_getLogs",
      [
        {
          fromBlock: receipt.blockNumber,
          toBlock: `0x${(from + FILL_SEARCH_BLOCKS).toString(16)}`,
          address: listing.address,
          topics: [TRANSFER_TOPIC, null, addressTopic(intent.dstAddress)],
        },
      ],
    );
    fill = logs ? pickFill(logs, claimedFillTx) : undefined;
  }
  const filledAt = fill ? await blockTime(`0x${fill.blockNumber.toString(16)}`) : null;

  return readOrder({
    intentTx,
    direction,
    intent,
    listing: { symbol: listing.symbol, address: listing.address, decimals: listing.decimals },
    pay: payToken
      ? { symbol: payToken.symbol, decimals: payToken.decimals, chainKey: payToken.chainKey }
      : undefined,
    received: fill?.received,
    fillTx: fill?.fillTx ?? null,
    placedAt,
    filledAt,
  });
}

/** Insert or complete. Known values are never overwritten with unknowns. */
export async function saveOrder(userId: string | null, order: OrderRecord): Promise<void> {
  await getSql().query(
    `insert into orders (
       user_id, wallet_address, intent_tx, fill_tx, direction, listing_symbol,
       listing_address, quantity, min_quantity, pay_symbol, pay_chain,
       pay_amount, fee_amount, usd_value, placed_at, filled_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     on conflict (intent_tx) do update set
       user_id = coalesce(orders.user_id, excluded.user_id),
       wallet_address = coalesce(orders.wallet_address, excluded.wallet_address),
       fill_tx = coalesce(orders.fill_tx, excluded.fill_tx),
       quantity = coalesce(orders.quantity, excluded.quantity),
       pay_amount = coalesce(orders.pay_amount, excluded.pay_amount),
       usd_value = coalesce(orders.usd_value, excluded.usd_value),
       placed_at = coalesce(orders.placed_at, excluded.placed_at),
       filled_at = coalesce(orders.filled_at, excluded.filled_at)`,
    [
      userId,
      order.walletAddress,
      order.intentTx,
      order.fillTx,
      order.direction,
      order.listingSymbol,
      order.listingAddress,
      order.quantity,
      order.minQuantity,
      order.paySymbol,
      order.payChain,
      order.payAmount,
      order.feeAmount,
      order.usdValue,
      order.placedAt,
      order.filledAt,
    ],
  );
}

/** The pour route's call: build and save, never throw. */
export async function recordOrder(args: {
  sodax: Sodax;
  userId: string | null;
  intentTx: string;
  direction: "buy" | "sell";
  intent: Intent;
  claimedFillTx?: string | null;
}): Promise<void> {
  try {
    const order = await buildOrder(args);
    if (order) await saveOrder(args.userId, order);
  } catch (error) {
    console.warn("[orders] not recorded", args.intentTx, error instanceof Error ? error.message : error);
  }
}
