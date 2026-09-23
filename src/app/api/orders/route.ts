import { NextResponse, type NextRequest } from "next/server";
import { getSql } from "@/lib/server/db";
import type { OrderFacts } from "@/lib/benchmark";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";

/**
 * The account's own orders, for "since your first buy" (lib/benchmark).
 * Same proof of identity as the rewards routes: a Privy token or a wallet
 * session, never an address taken on trust.
 */
export type OrdersResponse = { orders: OrderFacts[] };

export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;

  const rows = (await getSql().query(
    `select listing_symbol, direction, quantity::float8 as quantity,
            usd_value::float8 as usd, coalesce(filled_at, placed_at, created_at) as placed_at
       from orders
      where user_id = $1
      order by placed_at`,
    [resolved.user.id],
  )) as {
    listing_symbol: string;
    direction: "buy" | "sell";
    quantity: number | null;
    usd: number | null;
    placed_at: string | Date;
  }[];

  const response: OrdersResponse = {
    orders: rows.map((row) => ({
      symbol: row.listing_symbol,
      direction: row.direction,
      quantity: row.quantity,
      usd: row.usd,
      placedAt: new Date(row.placed_at).toISOString(),
    })),
  };
  return NextResponse.json(response);
}
