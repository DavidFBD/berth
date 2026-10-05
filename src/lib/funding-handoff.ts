/**
 * From adding money to the buy (2026-10-05). Privy's funding window
 * (useAddFunds) answers once the person is done with the provider, which is
 * when the payment was made, not when the money is in the account: a card
 * payment lands as USDC on Base minutes later. So the handoff watches the
 * destination's USDC balance and moves on only once it has actually risen. This module is the rulebook, pure, so
 * every turn is a unit test; components/funding-handoff draws it.
 *
 *   waiting   the money is on its way: the thinking orb, a calm line
 *   slow      past SLOW_AFTER_MS: still watching, and says how long a
 *             card payment can take
 *   stopped   past STOP_AFTER_MS: no more reads; the money shows on the
 *             home when it lands, and the provider can say where it is
 *   unknown   the balance before could not be read: says so, reads nothing
 *   arrived   the balance rose by ARRIVAL_THRESHOLD_UNITS or more from
 *             the lowest it was since: the buy opens with that USDC
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
  /** The balance before the payment could not be read: no way to tell its money from what was there. */
  | { kind: "unknown" }
  | { kind: "arrived"; amount: bigint };

/**
 * The least rise that counts as the payment arriving: one dollar of USDC.
 * Dust, rounding and a stray airdrop stay below it; no card payment does.
 */
export const ARRIVAL_THRESHOLD_UNITS = 10n ** BigInt(FUND_USDC_DECIMALS);

/** How long one balance read may take before it counts as failed. */
export const READ_TIMEOUT_MS = 4_000;
/** How many times the balance before is tried, and the pause between tries. */
export const BASELINE_ATTEMPTS = 3;
export const BASELINE_RETRY_MS = 1_000;

/** Settles with the read, or rejects once `ms` passed, so a hung read never holds the wait. */
export function withTimeout<T>(read: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("read timed out")), ms);
    read.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * The balance before the payment, tried up to BASELINE_ATTEMPTS times,
 * each capped at READ_TIMEOUT_MS. Undefined when no try answered: the
 * wait then says honestly that it cannot tell, rather than guessing.
 */
export async function readBaseline(
  read: () => Promise<bigint>,
  {
    attempts = BASELINE_ATTEMPTS,
    timeoutMs = READ_TIMEOUT_MS,
    retryMs = BASELINE_RETRY_MS,
  }: { attempts?: number; timeoutMs?: number; retryMs?: number } = {},
): Promise<bigint | undefined> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await withTimeout(read(), timeoutMs);
    } catch {
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
  return undefined;
}

/**
 * The lowest balance seen since the baseline, the floor a rise is measured
 * from: USDC spent on Base while the payment is on its way lowers it, so
 * the payment still shows as a rise once it lands.
 */
export function nextLowest(lowest: bigint, read: bigint | undefined): bigint {
  return read !== undefined && read < lowest ? read : lowest;
}

/**
 * Where the wait stands. `baseline` is the USDC balance read before the
 * payment (undefined when no read answered), `lowest` the lowest read
 * since (nextLowest; the baseline until one is lower), `current` the
 * latest read (undefined until one answers). Money counts as arrived only
 * when the balance rose from that floor by ARRIVAL_THRESHOLD_UNITS or
 * more. With no baseline nothing can be told apart, so the view says so
 * (`unknown`) and nothing is read.
 */
export function arrivalView({
  baseline,
  lowest = baseline,
  current,
  startedAt,
  now,
}: {
  baseline: bigint | undefined;
  lowest?: bigint;
  current: bigint | undefined;
  startedAt: number;
  now: number;
}): ArrivalView {
  if (baseline === undefined || lowest === undefined) return { kind: "unknown" };
  if (current !== undefined) {
    const floor = lowest < baseline ? lowest : baseline;
    if (current - floor >= ARRIVAL_THRESHOLD_UNITS) return { kind: "arrived", amount: current - floor };
  }
  const waited = now - startedAt;
  if (waited >= STOP_AFTER_MS) return { kind: "stopped" };
  return { kind: "waiting", slow: waited >= SLOW_AFTER_MS };
}

/**
 * The way out of a wait. Privy answers "submitted" before the provider has
 * finished its checks, so a payment it then refuses would otherwise hold
 * the person on the wait for STOP_AFTER_MS: every view short of the
 * arrival offers paying another way, which stops the wait.
 */
export function offersPayAnotherWay(view: ArrivalView): boolean {
  return view.kind !== "arrived";
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

/**
 * The order that sent the person to add money (`topUpFor` on the home), and
 * whether it still stands after what just happened. It reopens only for a
 * card payment begun from the Add money drawer it opened; a payment begun
 * elsewhere (the path's step, the account drawer) or closing Add money with
 * nothing on its way lets it go, so an old order never reopens later.
 */
export type TopUpEvent =
  | { kind: "funded"; fromAddMoney: boolean }
  | { kind: "addMoneyClosed"; watching: boolean }
  | { kind: "payAnotherWay" };

export function keepsTopUp(event: TopUpEvent): boolean {
  switch (event.kind) {
    case "funded":
      return event.fromAddMoney;
    case "addMoneyClosed":
      return event.watching;
    case "payAnotherWay":
      // The drawer stays open on the ways to pay: a payment made there is still for that order.
      return true;
  }
}

/** Money that just arrived, offered as the next buy's pay token (components/flow/deposit-drawer). */
export type PreferPay = { chainKey: string; address: string; since: number };

/** How long arrived money is offered first; after that the sweep picks as always. */
export const PREFER_PAY_FOR_MS = 15 * 60_000;

/** How long until an offer made at `since` lapses (0 once it has): the home lets it go then. */
export function preferPayLeftMs(prefer: PreferPay, now: number): number {
  return Math.max(0, prefer.since + PREFER_PAY_FOR_MS - now);
}

/**
 * Whether the buy drawer starts from the money that just arrived:
 *   use   the sweep shows that token still held
 *   wait  the sweep is still reading: decide once it answers
 *   skip  nothing to prefer, or no longer held (spent meanwhile): never
 *         preselect a token the person does not hold
 * (A lapsed offer never gets here: the home drops it at preferPayLeftMs.)
 */
export function preferPayChoice({
  prefer,
  loading,
  holdings,
}: {
  prefer: Pick<PreferPay, "chainKey" | "address"> | null | undefined;
  loading: boolean;
  holdings: readonly { chainKey: string; address: string; balance: bigint }[];
}): "use" | "wait" | "skip" {
  if (!prefer) return "skip";
  if (loading) return "wait";
  const held = holdings.some(
    (holding) =>
      holding.chainKey === prefer.chainKey &&
      holding.address.toLowerCase() === prefer.address.toLowerCase() &&
      holding.balance > 0n,
  );
  return held ? "use" : "skip";
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
