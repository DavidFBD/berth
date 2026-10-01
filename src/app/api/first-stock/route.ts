import { NextResponse, type NextRequest } from "next/server";
import { closeFirstStock, readFirstStock } from "@/lib/server/first-stock";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";

export type { FirstStockResponse } from "@/lib/first-stock";

/**
 * The first stock card's state for the caller's account (lib/first-stock).
 * `{ close: true }` is "Got it": idempotent, and it answers the new state.
 */
export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;
  if (read.caller.body.close === true) await closeFirstStock(resolved.user.id);
  return NextResponse.json(await readFirstStock(resolved.user.id));
}
