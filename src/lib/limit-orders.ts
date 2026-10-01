import { isDollarStable } from "@/lib/orders";

/**
 * Limit orders, the pure half: a price becomes a minimum output, a date
 * becomes a deadline, the backend's view of an intent becomes a status.
 *
 * A limit order on SODAX is an ordinary intent that waits: the same
 * leverageYield deposit or withdraw build the market order uses, with
 * `deadline` 0n (no expiry) or the chosen day's end, and a
 * `minOutputAmount` set by the price instead of by a quote. It rests in the
 * hub Intents contract until a solver fills it at or better than that
 * minimum, or its owner cancels it. The builders hard code
 * `allowPartialFill: false`, so a Berth limit order fills whole or not at
 * all; `partial` is mapped for completeness, never expected.
 *
 * v1 keeps the arithmetic exact by pricing only in dollars: a buy is paid
 * with a dollar stablecoin, a sell is paid out in one. "Buy at $200" then
 * means the dollars actually swapped buy at least amount / 200 shares.
 */

/** Limit prices are carried as integers with this many decimals: $200.5 is 200_50000000n. */
export const PRICE_DECIMALS = 8;
const PRICE_SCALE = 10n ** BigInt(PRICE_DECIMALS);

/** How far ahead an expiry may be set. Past a year, "until cancelled" says it better. */
export const MAX_EXPIRY_DAYS = 365;

/** A hub-chain deadline of 0 means the intent never expires. */
export const UNTIL_CANCELLED = 0n;

export type LimitSide = "buy" | "sell";

export type LimitStatus = "resting" | "partial" | "filled" | "cancelled" | "expired";

/** Statuses still waiting in the contract, the ones the waiting strip shows. */
export function isWaiting(status: LimitStatus): boolean {
  return status === "resting" || status === "partial";
}

/**
 * Parse a typed dollar price ("200", "$1,250.5") into PRICE_DECIMALS.
 * Undefined for anything that is not a positive number, or has more
 * precision than PRICE_DECIMALS (never silently truncated).
 */
export function parseLimitPrice(text: string | null | undefined): bigint | undefined {
  const cleaned = (text ?? "").replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(cleaned)) return undefined;
  const [whole = "", fraction = ""] = cleaned.split(".");
  if (fraction.length > PRICE_DECIMALS) return undefined;
  const value = BigInt(whole || "0") * PRICE_SCALE + BigInt(fraction.padEnd(PRICE_DECIMALS, "0") || "0");
  return value > 0n ? value : undefined;
}

/** A price in PRICE_DECIMALS back to a plain decimal string, trailing zeros trimmed. */
export function priceText(price: bigint): string {
  const whole = price / PRICE_SCALE;
  const fraction = (price % PRICE_SCALE).toString().padStart(PRICE_DECIMALS, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** A price in PRICE_DECIMALS as a number, for display only. */
export function priceNumber(price: bigint): number {
  return Number(priceText(price));
}

/** A dollar number (from a draft or the oracle) as PRICE_DECIMALS, rounded to the cent. */
export function priceFromNumber(value: number): bigint | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return parseLimitPrice(value.toFixed(2));
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

/**
 * The minimum the intent may pay out for a limit price, in the OUTPUT
 * token's smallest units, from the amount that is actually swapped (the
 * input after the partner fee, lib/pour-amount swapInputFor).
 *
 *   buy:  input dollars / price   = shares   (input: the stablecoin, output: the listing)
 *   sell: input shares  x price   = dollars  (input: the listing, output: the stablecoin)
 *
 * Rounded UP, always: the minimum is the least the person accepts, so
 * rounding up can only make the fill at least as good as the price they
 * named, never a hair worse. Undefined when anything is missing or zero.
 */
export function limitMinOutput({
  side,
  swapInput,
  inputDecimals,
  outputDecimals,
  price,
}: {
  side: LimitSide;
  swapInput: bigint | undefined;
  inputDecimals: number;
  outputDecimals: number;
  price: bigint | undefined;
}): bigint | undefined {
  if (!swapInput || swapInput <= 0n || !price || price <= 0n) return undefined;
  const inScale = 10n ** BigInt(inputDecimals);
  const outScale = 10n ** BigInt(outputDecimals);
  const out =
    side === "buy"
      ? ceilDiv(swapInput * outScale * PRICE_SCALE, price * inScale)
      : ceilDiv(swapInput * price * outScale, inScale * PRICE_SCALE);
  return out > 0n ? out : undefined;
}

/** What the fill works out to per share, from the swap input and a minimum output. For the summary. */
export function effectivePrice({
  side,
  swapInput,
  minOutput,
  inputDecimals,
  outputDecimals,
}: {
  side: LimitSide;
  swapInput: bigint;
  minOutput: bigint;
  inputDecimals: number;
  outputDecimals: number;
}): number {
  const input = Number(swapInput) / 10 ** inputDecimals;
  const output = Number(minOutput) / 10 ** outputDecimals;
  return side === "buy" ? input / output : output / input;
}

/**
 * Whether a pay (buy) or payout (sell) token can price a limit order in
 * v1: a dollar stablecoin on an EVM network. Anything else would need a
 * second price to turn the limit into a minimum, and a second price that
 * moves while the order waits.
 */
export function limitTokenOk(token: { symbol: string } | null | undefined, isEvm: boolean): boolean {
  return !!token && isEvm && isDollarStable(token.symbol);
}

/** The expiry a person can pick: never, or the end of a chosen day. */
export type LimitExpiry = { kind: "never" } | { kind: "date"; day: string };

/** The end of a local calendar day ("2026-10-03"), or undefined for a malformed one. */
export function endOfDay(day: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return undefined;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const end = new Date(year, month - 1, date, 23, 59, 59);
  if (end.getFullYear() !== year || end.getMonth() !== month - 1 || end.getDate() !== date) return undefined;
  return end;
}

/** A Date as the local "YYYY-MM-DD" a date input speaks. */
export function dayOf(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The intent's `deadline`, in unix seconds: 0n until cancelled, else the
 * end of the chosen day. The contract compares it with the hub block time,
 * which runs on the same unix clock.
 */
export function limitDeadline(expiry: LimitExpiry): bigint | undefined {
  if (expiry.kind === "never") return UNTIL_CANCELLED;
  const end = endOfDay(expiry.day);
  return end ? BigInt(Math.floor(end.getTime() / 1000)) : undefined;
}

export type LimitProblem = "enterPrice" | "noPrice" | "throughMarket" | "pickDate" | "pastDate" | "tooFar";

/**
 * How far past today's price a limit may be set: a buy this much above
 * it, a sell this much below. A limit through the market fills at once at
 * the named price, not the market's, and a solver may keep the difference,
 * so "Buy at $2000" typed for a $200 stock would pay ten times over. Past
 * this, the drawer sends the person to "Now" instead.
 */
export const THROUGH_MARKET_PCT = 1;

/** Whether the price sits further through the market than THROUGH_MARKET_PCT allows. */
export function throughMarket(side: LimitSide, price: bigint | undefined, marketPrice: number | undefined): boolean {
  if (!price || marketPrice === undefined || !Number.isFinite(marketPrice) || marketPrice <= 0) return false;
  const limit = priceNumber(price);
  const slack = THROUGH_MARKET_PCT / 100;
  return side === "buy" ? limit > marketPrice * (1 + slack) : limit < marketPrice * (1 - slack);
}

/** The one reason a limit order cannot go yet, before the amount pipeline's own reasons. */
export function limitProblem({
  price,
  expiry,
  now = new Date(),
  side,
  marketPrice,
}: {
  price: bigint | undefined;
  expiry: LimitExpiry;
  now?: Date;
  side?: LimitSide;
  marketPrice?: number;
}): LimitProblem | null {
  if (!price) return "enterPrice";
  // Without today's price nothing can say whether the limit is through
  // the market, so the order waits for one rather than failing open.
  if (side && (marketPrice === undefined || !Number.isFinite(marketPrice) || marketPrice <= 0)) return "noPrice";
  if (side && throughMarket(side, price, marketPrice)) return "throughMarket";
  if (expiry.kind === "date") {
    const end = endOfDay(expiry.day);
    if (!end) return "pickDate";
    // The server takes a dated order with at least two minutes left (lib/server/limit-orders MIN_WAIT_SECONDS).
    if (end.getTime() - now.getTime() < 3 * 60_000) return "pastDate";
    if (end.getTime() - now.getTime() > MAX_EXPIRY_DAYS * 86_400_000) return "tooFar";
  }
  return null;
}

/**
 * Whether the price is already met at the market, so the order would
 * likely fill as soon as it lands: a buy at or above the price now, a
 * sell at or below it. Said in the drawer, never blocked.
 */
export function fillsNow(side: LimitSide, price: bigint | undefined, marketPrice: number | undefined): boolean {
  if (!price || marketPrice === undefined || !Number.isFinite(marketPrice)) return false;
  const limit = priceNumber(price);
  return side === "buy" ? limit >= marketPrice : limit <= marketPrice;
}

/** One event on the backend's intent record (GET /v1/be/intent/tx/:hash). */
export type IntentEvent = {
  eventType: string;
  txHash?: string;
  blockNumber?: number;
  intentState?: { exists?: boolean; remainingInput?: string; receivedOutput?: string };
};

/** The part of the backend's intent record the status reads. */
export type IntentRecord = {
  open: boolean;
  intent: { deadline: string; inputAmount: string };
  events: readonly IntentEvent[];
};

export type LimitState = {
  status: LimitStatus;
  /** Input still waiting, smallest units. */
  remainingInput: bigint;
  /** Output paid so far, smallest units. */
  receivedOutput: bigint;
  /** The last fill's transaction, when there was one. */
  fillTx?: string;
  /** The transaction that closed it without a full fill (a cancel), when there was one. */
  closeTx?: string;
};

function big(value: string | undefined): bigint {
  try {
    return value ? BigInt(value) : 0n;
  } catch {
    return 0n;
  }
}

/**
 * The backend's intent record as a status. Filled once an `intent-filled`
 * event leaves nothing remaining; partial while something has filled and
 * it is still open; closed by an `intent-cancelled` event, which reads as
 * expired when the deadline had passed and the person did not ask to
 * cancel (a SODAX keeper cancels expired intents and refunds them, seen
 * on chain 2026-09-17: tx 0x6eb448a9…e39a from 0x7ec046ce…64cf returned a
 * hub wallet sell's input to that hub wallet), and cancelled otherwise.
 * No record yet (the backend indexes a few seconds behind the hub) is
 * resting: the intent is on chain, just not seen.
 */
export function limitStateFrom(
  record: IntentRecord | null | undefined,
  { now = new Date(), cancelAsked = false }: { now?: Date; cancelAsked?: boolean } = {},
): LimitState | null {
  if (!record) return null;
  const inputAmount = big(record.intent.inputAmount);
  let remainingInput = inputAmount;
  let receivedOutput = 0n;
  let fillTx: string | undefined;
  let closeTx: string | undefined;
  let cancelled = false;
  for (const event of record.events) {
    if (event.eventType === "intent-filled") {
      if (event.intentState?.remainingInput !== undefined) remainingInput = big(event.intentState.remainingInput);
      if (event.intentState?.receivedOutput !== undefined) receivedOutput = big(event.intentState.receivedOutput);
      fillTx = event.txHash ?? fillTx;
    } else if (event.eventType === "intent-cancelled") {
      cancelled = true;
      closeTx = event.txHash ?? closeTx;
    }
  }
  // A fill the backend closed with no cancel is a whole fill, even when
  // its event carries no state: these intents never fill in part.
  const filledWhole = fillTx !== undefined && (remainingInput === 0n || (!record.open && !cancelled));
  if (filledWhole) return { status: "filled", remainingInput: 0n, receivedOutput, fillTx };
  const closed = cancelled || !record.open;
  if (!closed) {
    return { status: receivedOutput > 0n ? "partial" : "resting", remainingInput, receivedOutput, fillTx };
  }
  const deadline = big(record.intent.deadline);
  const expired = !cancelAsked && deadline > 0n && Number(deadline) * 1000 <= now.getTime();
  return { status: expired ? "expired" : "cancelled", remainingInput, receivedOutput, fillTx, closeTx };
}

/** A waiting order past its own deadline that the backend still calls open: expired, awaiting the keeper's refund. */
export function pastDeadline(expiresAt: Date | string | null | undefined, now = new Date()): boolean {
  if (!expiresAt) return false;
  const at = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return !Number.isNaN(at.getTime()) && at.getTime() <= now.getTime();
}

/** How much of the order has filled, 0 to 1, from the input still waiting. */
export function fillProgress(inputAmount: bigint, remainingInput: bigint): number {
  if (inputAmount <= 0n) return 0;
  const done = inputAmount - (remainingInput > inputAmount ? inputAmount : remainingInput);
  return Number((done * 10_000n) / inputAmount) / 10_000;
}

/**
 * The switch: `LIMIT_ORDERS_USERS`, a comma separated list of Berth user
 * ids or wallet addresses. An account is switched on when any of its
 * identifiers is on the list, compared case-insensitively. An empty or
 * missing list switches nobody on.
 */
export function switchedOn(list: string | null | undefined, identifiers: readonly (string | null | undefined)[]): boolean {
  const allowed = new Set(
    (list ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
  if (allowed.size === 0) return false;
  return identifiers.some((id) => !!id && allowed.has(id.trim().toLowerCase()));
}

/**
 * What the order button says once the amount pipeline's own gate is
 * satisfied (lib/pour-amount, called with the limit's minimum in place of
 * a quote): review when everything a limit needs is there, otherwise the
 * one thing missing. Earlier reasons (sign in, amount, balance, network)
 * keep their own words and are never replaced by these.
 */
export type LimitCta = "review" | "needsDollars" | LimitProblem;

export function limitCta({
  tokenOk,
  problem,
  minOut,
}: {
  tokenOk: boolean;
  problem: LimitProblem | null;
  minOut: bigint | undefined;
}): LimitCta {
  if (!tokenOk) return "needsDollars";
  if (problem) return problem;
  if (!minOut) return "enterPrice";
  return "review";
}

/** A local day ("2026-10-03") as the person reads it, e.g. "Oct 3, 2026". */
export function dayLabel(day: string, locale?: string): string | undefined {
  const end = endOfDay(day);
  return end?.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
}

/** What a waiting order still holds, in the few fields the sum needs. */
export type WaitingFacts = {
  direction: LimitSide;
  symbol: string;
  inputRaw: string;
  inputDecimals: number;
  progress: number;
  /** What pays a buy; only a dollar coin's amount is dollars. */
  paySymbol?: string | null;
};

/**
 * The dollars still waiting in orders: a buy's unfilled dollars (v1 buys
 * are paid in dollar coins, so the input is dollars), a sell's unfilled
 * shares at today's price. `priced` is false when a sell had no price, so
 * the figure is shown as partial rather than guessed. This money is the
 * person's, locked in SODAX's contract, and belongs in the account total
 * under its own name, never under holdings.
 */
export function waitingUsd(
  orders: readonly WaitingFacts[],
  priceOf: (symbol: string) => number | undefined,
): { usd: number; priced: boolean } {
  let usd = 0;
  let priced = true;
  for (const order of orders) {
    const units = Number(order.inputRaw) / 10 ** order.inputDecimals;
    const left = units * Math.max(0, 1 - order.progress);
    if (order.direction === "buy") {
      // v1 only places buys paid in dollar coins; anything else is left out
      // of the dollars rather than counted at a dollar a unit.
      if (isDollarStable(order.paySymbol)) usd += left;
      else priced = false;
    } else {
      const price = priceOf(order.symbol);
      if (price === undefined || !Number.isFinite(price)) priced = false;
      else usd += left * price;
    }
  }
  return { usd, priced };
}

/** The account total with waiting money in it: what the person owns plus what waits. Undefined while a part loads. */
export function accountTotalWith(parts: readonly (number | undefined)[]): number | undefined {
  return parts.some((part) => part === undefined) ? undefined : parts.reduce<number>((sum, part) => sum + (part ?? 0), 0);
}
