import type { Nudge } from "@/lib/nudge";
import { MIN_ORDER_USD } from "@/lib/order-minimum";

/**
 * Where an account stands, which decides the home's one next step
 * (components/home.tsx, HomeTracks):
 *
 *   empty   nothing spendable, at least the order minimum: add money
 *   funded  enough to place an order, no stock or fund yet: buy the first
 *   owns    holds a stock or fund: the total and what it owns lead, then buy
 *
 * Decided only from balances that are known. A sweep still loading, or a
 * wallet the session should read that has no address yet, is unknown, never
 * $0: the home keeps the stage it remembered, or holds the step's place, for
 * a bounded wait. A network that could not be read lets the step show for
 * what was read, but that stage is never remembered.
 */
export type HomeStage = "empty" | "funded" | "owns";

export const HOME_STAGES: readonly HomeStage[] = ["empty", "funded", "owns"];

/** What the funds sweep (hooks/use-embedded-holdings) knows, in the parts the stage needs. */
export type FundsRead = {
  /** Whether any chain resolved an address to sweep. */
  connected: boolean;
  /**
   * Chains this session should read that have no address yet (an email
   * session's Solana wallet arrives a moment after its EVM one): unknown,
   * not zero.
   */
  unaddressedChains: number;
  isLoading: boolean;
  /** Networks that could not be read: unknown, not zero. */
  erroredChains: number;
  /** Each asset found, with its oracle value when the oracle prices it. */
  holdings: readonly { usdValue: number | undefined }[];
  /** The sum of the priced assets; undefined when none is priced. */
  totalUsd: number | undefined;
};

/**
 * The stage, and whether it is proven. A proven stage is remembered for
 * the next visit; a provisional one is shown (so a new account always gets
 * its Add money step) but never remembered. No stage at all means wait.
 */
export type StageDecision = { stage: HomeStage | undefined; proven: boolean };

const WAIT: StageDecision = { stage: undefined, proven: false };

export function homeStage({
  holdingsSettled,
  ownsStock,
  funds,
  waitedOut = false,
}: {
  /** Whether what the account holds (stocks, funds, cash) has been read, on every wallet the account links. */
  holdingsSettled: boolean;
  ownsStock: boolean;
  funds: FundsRead;
  /**
   * Whether the bounded wait for missing addresses is over. After it, a
   * wallet that never connected no longer holds the page: the stage is
   * decided from what was read, provisionally.
   */
  waitedOut?: boolean;
}): StageDecision {
  if (!holdingsSettled) return WAIT;
  if (ownsStock) return { stage: "owns", proven: true };
  if (funds.isLoading) return WAIT;
  // Money proven by what was read is proven, whatever else is missing.
  if ((funds.totalUsd ?? 0) >= MIN_ORDER_USD) return { stage: "funded", proven: true };
  // Something the oracle cannot price may well be enough to buy with; the
  // buy drawer reads it per token. Never call that empty.
  if (funds.holdings.some((holding) => holding.usdValue === undefined)) return { stage: "funded", proven: true };
  const missing = !funds.connected || funds.unaddressedChains > 0;
  if (missing && !waitedOut) return WAIT;
  // Only failed or missing networks stand between this and empty: show the
  // real step for what was read (the Funds row says what it could not
  // read), and do not remember it.
  if (missing || funds.erroredChains > 0) return { stage: "empty", proven: false };
  return { stage: "empty", proven: true };
}

/**
 * Money the account has that is not spendable right now: cash parked in
 * the Treasury bill fund, or dollars waiting in a limit order. Someone
 * with it is shown their total even before a first stock.
 */
export function hasMoneyAside({ holdsCash, waitingOrders }: { holdsCash: boolean; waitingOrders: boolean }): boolean {
  return holdsCash || waitingOrders;
}

/** How long a missing wallet address may hold the step before it is decided from what was read. */
export const ADDRESS_WAIT_MS = 8_000;

/** A remembered stage, read back from storage; anything else is no answer. */
export function parseHomeStage(value: string | null | undefined): HomeStage | undefined {
  return HOME_STAGES.find((stage) => stage === value);
}

/**
 * Nudge lines the next step already says, so the line under it does not
 * say them twice: "add money" while the step is adding money, "choose a
 * first buy" while the step is the first buy.
 */
export const NUDGES_SAID_BY_STEP: Readonly<Record<HomeStage, readonly Nudge["kind"][]>> = {
  empty: ["addFunds"],
  funded: ["firstBuy"],
  owns: [],
};
