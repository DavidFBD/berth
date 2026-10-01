import { NextResponse, type NextRequest } from "next/server";
import { hubWalletFor } from "@/lib/server/portfolio";
import { accountEvmAddresses } from "@/lib/server/identities";
import { accountOwnedWallets } from "@/lib/server/pour-ownership";
import {
  hasWaitingOrders,
  limitOrdersOn,
  limitOwnership,
  listLimitOrders,
  markCancelAsked,
  placeLimitOrder,
  sweepMissing,
  type LimitOrderView,
} from "@/lib/server/limit-orders";
import { readRewardsCaller, refuseWhereUnavailable, resolveRewardsUser } from "@/lib/server/rewards-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Limit orders for the signed-in account (lib/server/limit-orders), behind
 * the LIMIT_ORDERS_USERS switch. One POST, three actions:
 *
 *   { action: "list" }      the switch as a boolean, and the waiting orders,
 *                           synced against SODAX's backend on the way
 *   { action: "record", intentTxHash, direction, limitPrice?, intentHash?, srcChain? }
 *                           a limit order just placed, verified on chain
 *   { action: "cancelAsked", intentTxHash, cancelTxHash }
 *                           the person signed a cancel
 *
 * Everyone not switched on gets `{ enabled: false, orders: [] }` and
 * nothing else, whatever they ask. Same proof of identity as the rewards
 * routes: a Privy token or a wallet session.
 */
export type LimitOrdersResponse = { enabled: boolean; orders: LimitOrderView[] };

const TX = /^0x[0-9a-f]{64}$/;

export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;
  const { user } = resolved;
  const { body } = read.caller;

  const enabled = limitOrdersOn([user.id, user.wallet_address, read.caller.wallet]);
  const action = body.action;
  // Switched off with orders still waiting: they can still be seen and
  // cancelled, never added to.
  const stranded = !enabled && action !== "record" && (await hasWaitingOrders(user.id).catch(() => false));
  if (!enabled && !stranded) return NextResponse.json({ enabled: false, orders: [] } satisfies LimitOrdersResponse);

  // The addresses this account signs as: its home address and whatever
  // its row holds, and the hub wallet each derives on the home chain,
  // where a sell is created and every buy lands.
  const ownersOf = async () => {
    const spokes = [...new Set([read.caller.wallet, user.wallet_address].filter((a): a is string => !!a).map((a) => a.toLowerCase()))];
    const hubs = await Promise.all(spokes.map((spoke) => hubWalletFor(spoke).catch(() => null)));
    return new Set([...spokes, ...hubs.filter((hub): hub is string => !!hub)]);
  };
  // The home address's hub wallet: the only one a v1 limit sell may come from.
  const homeHubOf = async () => {
    const home =
      (await accountEvmAddresses(user.id, user.wallet_address).catch(() => ({ home: null }))).home ?? read.caller.wallet ?? null;
    return home ? hubWalletFor(home.toLowerCase()).catch(() => null) : null;
  };

  if (action === "list" || action === undefined) {
    try {
      // The safety net: an intent on the hub with no row is found and
      // recorded (lib/server/limit-orders sweepMissing). Throttled, unless
      // the page holds an order it could not save.
      if (enabled) {
        await sweepMissing(user.id, await ownersOf(), {
          owns: limitOwnership(await accountOwnedWallets(user.id, user.wallet_address)),
          force: body.sweep === true,
          homeHub: await homeHubOf(),
          // A limit buy found while Berth is not available here pays nothing (lib/server/no-xp).
          noXpBuys: read.caller.availability?.available === false,
        }).catch((error) =>
          console.warn("[limit-orders] sweep failed", error instanceof Error ? error.message : error),
        );
      }
      const orders = await listLimitOrders(user.id);
      return NextResponse.json({ enabled, orders } satisfies LimitOrdersResponse);
    } catch (error) {
      console.warn("[limit-orders] list failed", error instanceof Error ? error.message : error);
      return NextResponse.json({ enabled, orders: [] } satisfies LimitOrdersResponse);
    }
  }

  const intentTx = typeof body.intentTxHash === "string" ? body.intentTxHash.toLowerCase() : "";
  if (!TX.test(intentTx)) return NextResponse.json({ error: "bad tx hash" }, { status: 400 });

  if (action === "cancelAsked") {
    const cancelTx = typeof body.cancelTxHash === "string" ? body.cancelTxHash : "";
    const marked = await markCancelAsked(user.id, intentTx, cancelTx);
    return NextResponse.json({ ok: marked }, { status: marked ? 200 : 404 });
  }

  if (action === "record" && enabled) {
    const direction = body.direction === "sell" ? "sell" : body.direction === "buy" ? "buy" : null;
    if (!direction) return NextResponse.json({ error: "bad direction" }, { status: 400 });
    // A limit buy is not taken where Berth is not available; a limit sell is (lib/availability).
    if (direction === "buy") {
      const refused = refuseWhereUnavailable(read.caller);
      if (refused) return refused;
    }
    const owners = await ownersOf();
    const typed = Number(body.limitPrice);
    const placed = await placeLimitOrder({
      userId: user.id,
      owners,
      owns: limitOwnership(await accountOwnedWallets(user.id, user.wallet_address)),
      intentTx,
      direction,
      typedPrice: Number.isFinite(typed) ? typed : undefined,
      intentHash: typeof body.intentHash === "string" ? body.intentHash : undefined,
      srcChain: typeof body.srcChain === "string" ? body.srcChain : undefined,
      homeHub: direction === "sell" ? await homeHubOf() : undefined,
    });
    if (!placed.ok) {
      // A read that did not answer: ask again, the order is not refused.
      if (placed.reason === "not yet known") return NextResponse.json({ error: placed.reason, retry: true }, { status: 503, headers: { "retry-after": "10" } });
      return NextResponse.json({ error: placed.reason }, { status: 422 });
    }
    return NextResponse.json({ ok: true, order: placed.order });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
