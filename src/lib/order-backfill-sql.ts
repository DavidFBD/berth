import type { HoldingChain, OrderRecord } from "./orders";

/**
 * The two one-off scripts' writes to `orders`, kept here so a db test runs
 * the very statements the scripts send (lib/server/order-backfill-sql.db.test).
 * No `@/` imports and type-only imports: the scripts load this file with
 * Node's type stripping, as they load lib/orders.
 *
 * Both name the holding chain from the intent (lib/orders holdingChainOf)
 * and never move one already named: a Robinhood Chain buy left null would
 * be judged on Sonic once the hold check reads both chains, read as zero
 * and forfeited.
 */

/** scripts/orders-backfill.mjs: one row per pour the XP ledger knows. */
export const BACKFILL_ORDER_UPSERT = `insert into orders (
       user_id, wallet_address, intent_tx, fill_tx, direction, listing_symbol,
       listing_address, quantity, min_quantity, pay_symbol, pay_chain,
       pay_amount, fee_amount, usd_value, placed_at, filled_at, usd_source,
       delivered_to, holding_chain
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     on conflict (intent_tx) do update set
       delivered_to = coalesce(orders.delivered_to, excluded.delivered_to),
       holding_chain = coalesce(orders.holding_chain, excluded.holding_chain),
       usd_value = coalesce(orders.usd_value, excluded.usd_value),
       usd_source = coalesce(orders.usd_source, excluded.usd_source),
       fill_tx = coalesce(orders.fill_tx, excluded.fill_tx),
       quantity = coalesce(orders.quantity, excluded.quantity),
       filled_at = coalesce(orders.filled_at, excluded.filled_at)`;

export function backfillOrderParams(userId: string | null, order: OrderRecord): unknown[] {
  return [
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
    order.usdSource,
    order.deliveredTo,
    order.holdingChain,
  ];
}

/** scripts/backfill-delivered-to.mjs: the delivery address of a row written before the column, and its chain. */
export const DELIVERED_TO_UPDATE = `update orders set delivered_to = $2, holding_chain = coalesce(holding_chain, $3)
      where intent_tx = $1 and delivered_to is null
      returning 1`;

export function deliveredToParams(intentTx: string, deliveredTo: string, holdingChain: HoldingChain): unknown[] {
  return [intentTx, deliveredTo, holdingChain];
}
