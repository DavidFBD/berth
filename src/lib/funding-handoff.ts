import { MIN_ORDER_USD } from "@/lib/order-minimum";

/**
 * From adding money to the buy (2026-10-05). Privy's funding window
 * (useAddFunds) answers once the person is done with the provider, which is
 * when the payment was made, not when the money is in the account: a card
 * payment lands as USDC on Base minutes later, a bank transfer can take a
 * day. So the handoff watches the destination's USDC balance and moves on
 * only once it has actually risen. This module is the rulebook, pure, so
 * every turn is a unit test; components/funding-handoff draws it.
 *
 *   waiting   the money is on its way: the thinking orb, a calm line
 *   slow      past SLOW_AFTER_MS: still watching, and says how long a
 *             card or a bank transfer can take
 *   stopped   past STOP_AFTER_MS: no more reads; the money shows on the
 *             home when it lands, and the provider can say where it is
 *   arrived   the balance rose: the buy opens with that USDC to pay with
 */

/** USDC on Base: what every onramp delivers and what Berth asks for (components/account-button). */
export const FUND_CHAIN_CAIP = "eip155:8453" as const;
export const FUND_USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const FUND_USDC_DECIMALS = 6;

/** How often the destination's balance is read while waiting. */
export const ARRIVAL_POLL_MS = 5_000;
/** When the wait is longer than a card payment usually takes. */
export const SLOW_AFTER_MS = 3 * 60_000;
/** When the handoff stops reading and leaves the money to show on the home. */
export const STOP_AFTER_MS = 30 * 60_000;

/** What came back from Privy's funding window, as far as the handoff cares. */
export type FundingOutcome =
  /** A payment or transfer went through on the provider's side: watch for the money. */
  | "sent"
  /** Closed without paying: nothing to wait for. */
  | "closed";

/**
 * Reads what `addFunds` resolved with. Privy answers `{ status }` (with
 * `method` naming card or crypto); a status that says nothing went
 * through, or no answer at all, is a closed window. Any other answer is
 * treated as sent, since waiting for money that never comes costs a calm
 * line, while missing money that came costs the handoff.
 */
export function fundingOutcome(result: unknown): FundingOutcome {
  if (!result || typeof result !== "object") return "closed";
  const status = (result as { status?: unknown }).status;
  if (typeof status !== "string") return "sent";
  const closed = ["cancelled", "canceled", "closed", "exited", "abandoned", "failed", "error"];
  return closed.includes(status.toLowerCase()) ? "closed" : "sent";
}

export type ArrivalView =
  | { kind: "waiting"; slow: boolean }
  | { kind: "stopped" }
  | { kind: "arrived"; amount: bigint };

/** The least that counts as money arriving when the balance before is unknown: one order's minimum. */
export const MIN_ARRIVAL_UNITS = BigInt(Math.round(MIN_ORDER_USD * 10 ** FUND_USDC_DECIMALS));

/**
 * Where the wait stands. `baseline` is the USDC balance read as the window
 * opened (undefined when that read failed), `current` the latest read
 * (undefined until one answers). Money counts as arrived only when the
 * balance rose; with no baseline, only once it holds enough for an order,
 * so dust already there is never mistaken for the payment.
 */
export function arrivalView({
  baseline,
  current,
  startedAt,
  now,
}: {
  baseline: bigint | undefined;
  current: bigint | undefined;
  startedAt: number;
  now: number;
}): ArrivalView {
  if (current !== undefined) {
    if (baseline !== undefined && current > baseline) return { kind: "arrived", amount: current - baseline };
    if (baseline === undefined && current >= MIN_ARRIVAL_UNITS) return { kind: "arrived", amount: current };
  }
  const waited = now - startedAt;
  if (waited >= STOP_AFTER_MS) return { kind: "stopped" };
  return { kind: "waiting", slow: waited >= SLOW_AFTER_MS };
}

/** Whether the balance is still worth reading. */
export function stillWatching(view: ArrivalView): boolean {
  return view.kind === "waiting";
}

/**
 * Where the money goes next once it has arrived:
 *   buy     the order that asked for money (a top up from the buy drawer) reopens, paying with it
 *   choose  nothing was chosen yet: one tap to choose what to buy (the path's first buy, or the board)
 *   none    Berth takes no order here (lib/availability): the money is simply there
 */
export function handoffTarget({ hasListing, canBuy }: { hasListing: boolean; canBuy: boolean }): "buy" | "choose" | "none" {
  if (!canBuy) return "none";
  return hasListing ? "buy" : "choose";
}

/** Raw USDC units as dollars, for the arrival line. */
export function usdcToUsd(units: bigint): number {
  return Number(units) / 10 ** FUND_USDC_DECIMALS;
}

/**
 * What the money step offers (components/home-next-step AddMoneyStep):
 *   wallet  a wallet account pays from its wallet; a quiet way to its own address on Base
 *   card    an email account with its wallet: the card payment first, crypto as the quiet way
 *   drawer  otherwise (the wallet still being made, or money set aside to name first): Add money's drawer
 */
export function moneyStepOffer({
  walletAccount,
  canPayByCard,
  aside,
}: {
  walletAccount: boolean;
  canPayByCard: boolean;
  aside: boolean;
}): "wallet" | "card" | "drawer" {
  if (walletAccount) return "wallet";
  return canPayByCard && !aside ? "card" : "drawer";
}
