import { firstStockShows, type FirstStockResponse } from "@/lib/first-stock";
import { CASH_SYMBOL } from "@/lib/nudge";
import { getSql } from "@/lib/server/db";

/**
 * The first stock card's dates for one account (lib/first-stock), and the
 * one write: "Got it". Closing keeps the first close, so a replay changes
 * nothing.
 */
export async function readFirstStock(userId: string, now = Date.now()): Promise<FirstStockResponse> {
  const rows = (await getSql().query(
    `select u.first_stock_closed_at as closed_at, u.created_at,
            (select min(coalesce(o.filled_at, o.placed_at, o.created_at)) from orders o
              where o.user_id = u.id and o.direction = 'buy' and o.listing_symbol <> $2
                and (o.fill_tx is not null or o.filled_at is not null)) as first_buy_at
       from users u where u.id = $1`,
    [userId, CASH_SYMBOL],
  )) as { closed_at: string | Date | null; created_at: string | Date; first_buy_at: string | Date | null }[];
  const row = rows[0];
  if (!row) return { closed: false, firstBuyAt: null, createdAt: now, show: false };
  const state = {
    closed: row.closed_at !== null,
    firstBuyAt: row.first_buy_at === null ? null : new Date(row.first_buy_at).getTime(),
    createdAt: new Date(row.created_at).getTime(),
  };
  return { ...state, show: firstStockShows(state, now) };
}

export async function closeFirstStock(userId: string): Promise<void> {
  await getSql().query(
    `update users set first_stock_closed_at = coalesce(first_stock_closed_at, now()) where id = $1`,
    [userId],
  );
}
