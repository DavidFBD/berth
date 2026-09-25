import { NextResponse, type NextRequest } from "next/server";
import type { OrderFacts } from "@/lib/benchmark";
import { loadOrderFacts } from "@/lib/server/order-marks";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";

/**
 * The account's own orders, for "since your first buy" (lib/benchmark).
 * Same proof of identity as the rewards routes: a Privy token or a wallet
 * session, never an address taken on trust. Each order carries
 * `benchmarkMarks`, the benchmarks' prices at its minute by symbol, when
 * they were recorded (table `order_marks`); compareHolding buys at those.
 */
export type OrdersResponse = { orders: OrderFacts[] };

export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;

  const response: OrdersResponse = { orders: await loadOrderFacts(resolved.user.id) };
  return NextResponse.json(response);
}
