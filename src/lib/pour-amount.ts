import { formatUnits } from "viem";
import { ChainKeys, adjustAmountByFee, type SpokeChainKey } from "@sodax/sdk";
import { DEFAULT_SLIPPAGE_PCT, PARTNER_FEE } from "@/lib/sodax-config";
import { parseAmount, usdToTokenAmount } from "@/lib/format";
import { MIN_ORDER_USD } from "@/lib/order-minimum";
import { slowSource } from "@/lib/pour-lifecycle";

/**
 * The amount pipeline for a pour, either direction: what the typed text
 * means, what amount the quote must be asked for, what the minimum out is,
 * what Max may spend, and the single reason a pour can't go yet. This is the
 * app's real validation logic — it lives here, as data, so the drawers only
 * render it and a table of inputs can exercise every branch.
 */

/** lsoda* shares are 18-decimal ERC-4626 tokens on the Sonic hub. */
export const SHARE_DECIMALS = 18;

/** Bitcoin dust limit — the solver can't deliver less than this. */
export const BTC_DUST_SATS = 546n;

/**
 * The smallest pour, in USD: the one shared minimum (lib/order-minimum, where
 * the measurements behind it live). Under it the solver answers "Input amount
 * too low", which the app would otherwise have to word as "no route".
 */
export const MIN_POUR_USD = MIN_ORDER_USD;

/**
 * The floor in USD, rounded up to a half unit of the user's display currency
 * (`rate` = display units per USD) so the label can say "€1.50" and mean it.
 * A rate that hasn't settled (0, NaN) counts as USD.
 */
export function minPourUsd(rate = 1): number {
  const fx = rate > 0 && Number.isFinite(rate) ? rate : 1;
  // The epsilon keeps float noise (1.5 × 150 = 225.00000000000003) from adding a half unit.
  return Math.ceil(MIN_POUR_USD * fx * 2 - 1e-9) / 2 / fx;
}

/**
 * Whether a priced pour sits under the floor. An unpriced pour passes: with
 * no oracle price there is nothing to compare, and the solver keeps the last
 * word as before.
 */
export function belowMinimum(
  worthUsd: number | undefined,
  rate = 1,
): boolean {
  return worthUsd !== undefined && worthUsd < minPourUsd(rate);
}

export type PourAmounts = {
  /** Whether the field is being read as money (priced tokens only). */
  moneyMode: boolean;
  /**
   * Pre-fee amount, in the entry token's decimals: what the build receives,
   * what leaves the wallet, and what the quote is asked for.
   */
  buildAmount: bigint | undefined;
  /**
   * Approximate worth of `buildAmount` in the price's own currency — feed a
   * USD price, get USD; feed a display-currency price, get display currency.
   */
  worth: number | undefined;
};

/**
 * What the typed text means. Money is how people think about a pour, so the
 * user's display currency is the entry mode whenever the oracle prices the
 * token (callers pass the token price ALREADY in that currency: oracle USD ×
 * the FX rate); unpriced tokens fall back to token entry even if the field
 * is nominally in money.
 */
export function pourAmounts(
  text: string,
  denom: "money" | "token",
  decimals: number | undefined,
  price: number | undefined,
): PourAmounts {
  if (decimals === undefined) {
    return { moneyMode: false, buildAmount: undefined, worth: undefined };
  }
  const moneyMode = denom === "money" && price !== undefined;
  const buildAmount = moneyMode
    ? usdToTokenAmount(text, price, decimals)
    : parseAmount(text, decimals);
  const worth =
    buildAmount !== undefined && price !== undefined
      ? Number(formatUnits(buildAmount, decimals)) * price
      : undefined;
  return { moneyMode, buildAmount, worth };
}

/**
 * The amount that is actually swapped: the build amount less the partner fee,
 * which the SDK takes ONCE, on chain, when it builds the intent
 * (createVaultIntent: the spoke deposit carries the full build amount, the
 * intent's `inputAmount` is the build amount less the fee, and the fee goes
 * to PARTNER_FEE.address). Use it where the app itself prices the swapped
 * amount, as a limit order's minimum does (lib/limit-orders).
 *
 * Never hand it to a quote. `sodax.swaps.getQuote` (dapp-kit's useQuote)
 * already deducts the same fee from the amount it is given before asking the
 * solver, so the quote takes the PRE-fee build amount (usePourQuote) and its
 * `quoted_amount` is already the output of exactly this swapped amount. Until
 * 2026-10-01 the quote was asked for this amount, the fee came off twice in
 * the quote only, and every quote and minimum ran 0.4% low.
 */
export function swapInputFor(buildAmount: bigint | undefined): bigint | undefined {
  return buildAmount === undefined || buildAmount <= 0n
    ? undefined
    : adjustAmountByFee(buildAmount, PARTNER_FEE, "exact_input");
}

/**
 * The amount a quote is asked for: the PRE-fee build amount, untouched,
 * because the SDK's quote takes the fee off itself (see swapInputFor). Its
 * own function so usePourQuote cannot drift from it and a test can pin the
 * pair against the SDK.
 */
export function quoteAmountFor(buildAmount: bigint | undefined): bigint | undefined {
  return buildAmount === undefined || buildAmount <= 0n ? undefined : buildAmount;
}

/** Apply slippage tolerance (in percent, e.g. 0.5) to a quoted output. */
export function applySlippage(quoted: bigint, slippagePct: number): bigint {
  const bps = BigInt(Math.round(slippagePct * 100));
  return (quoted * (10_000n - bps)) / 10_000n;
}

/**
 * The slippage tolerance for an order signed on `srcChainKey`, in percent:
 * a slow source (lib/pour-lifecycle slowSource, Bitcoin) gets its own wider
 * one because its intent reaches the solver long after the quote; every
 * other source gets the app's default.
 */
export function slippagePctFor(srcChainKey?: SpokeChainKey | null): number {
  return (srcChainKey && slowSource(srcChainKey)?.slippagePct) || DEFAULT_SLIPPAGE_PCT;
}

/**
 * Minimum acceptable output for a quote, at the tolerance for the signing
 * chain (slippagePctFor). This is the intent's `minOutputAmount`, and the
 * same value the drawer shows as the least the person gets.
 */
export function minReceivedFor(
  quoted: bigint | undefined,
  srcChainKey?: SpokeChainKey | null,
): bigint | undefined {
  return quoted === undefined
    ? undefined
    : applySlippage(quoted, slippagePctFor(srcChainKey));
}

export type DepositMax =
  | { kind: "ready"; amount: bigint }
  /** The gas buffer is still being priced — Max would guess wrong. */
  | { kind: "bufferLoading" }
  /** The whole balance would go to network fees. */
  | { kind: "nothingSpendable" };

/**
 * What Max may spend: the balance minus what the network actually charges
 * (see useNativeGasBuffer; non-native pours pay their fee from the native
 * balance, so their buffer is 0).
 */
export function depositMax(
  balance: bigint,
  gasBuffer: bigint | undefined,
): DepositMax {
  if (gasBuffer === undefined) return { kind: "bufferLoading" };
  const max = balance > gasBuffer ? balance - gasBuffer : 0n;
  if (max <= 0n) return { kind: "nothingSpendable" };
  return { kind: "ready", amount: max };
}

/**
 * Render an amount as field text in the given denomination. Money rounds
 * DOWN at the currency's own precision (cents for EUR, whole yen for JPY) so
 * the converted token amount never exceeds the amount it was derived from
 * (Max must stay spendable; a flip must keep meaning the same pour).
 */
export function amountText(
  amount: bigint,
  decimals: number,
  moneyMode: boolean,
  price: number | undefined,
  moneyFractionDigits = 2,
): string {
  if (moneyMode && price !== undefined) {
    const worth = Number(formatUnits(amount, decimals)) * price;
    const scale = 10 ** moneyFractionDigits;
    return (Math.floor(worth * scale) / scale).toFixed(moneyFractionDigits);
  }
  return formatUnits(amount, decimals);
}

/**
 * Whether a withdraw's minimum output lands under Bitcoin's dust limit. Only
 * native BTC — guard on the token, not just the chain, in case Bitcoin's
 * solver list ever gains a non-BTC (non-8dp) token.
 */
export function belowBtcDust(
  dstChainKey: SpokeChainKey | null,
  tokenSymbol: string | undefined,
  minOut: bigint | undefined,
): boolean {
  return (
    dstChainKey === ChainKeys.BITCOIN_MAINNET &&
    tokenSymbol === "BTC" &&
    minOut !== undefined &&
    minOut < BTC_DUST_SATS
  );
}

/**
 * The single reason a pour can't go yet, in the order the user can act on
 * them. The drawers map each kind to its tea-voice label; the order and the
 * conditions live here.
 */
export type PourGate =
  | { kind: "ready" }
  | { kind: "pickToken" }
  | { kind: "connectSource" }
  | { kind: "pickDestination" }
  | { kind: "invalidRecipient" }
  | { kind: "connectDestination" }
  | { kind: "enterAmount" }
  | { kind: "balanceLoading" }
  | { kind: "insufficient" }
  | { kind: "belowMinimum" }
  | { kind: "wrongChain" }
  | { kind: "noRoute" }
  | { kind: "belowDust" }
  | { kind: "quotePending" }
  /** A buy needs a shelf to land on, and this browser has no email session. */
  | { kind: "noAccount" }
  /** The shelf is still being derived; a moment, not a refusal. */
  | { kind: "accountPending" }
  /**
   * The wallet that would pay (or sign a sell) is connected but not on the
   * account (lib/account-wallets): an order from it would not count as the
   * account's, so it is added first.
   */
  | { kind: "walletNotLinked" }
  /** A sell from a hub wallet another of the account's addresses owns: only that address can sign it. */
  | { kind: "signWithOther" };

/**
 * Whether the destination's account is ready. Cups deliver to the signing
 * wallet's own hub wallet and never wait on this; a listing buy delivers to
 * THE account (lib/account: the Base-derived hub wallet), so it needs one.
 */
export type AccountReadiness = "ready" | "deriving" | "none";

export function depositGate(state: {
  hasToken: boolean;
  address: string | undefined;
  buildAmount: bigint | undefined;
  balance: bigint | undefined;
  belowMinimum: boolean;
  isWrongChain: boolean;
  noRoute: boolean;
  quoted: bigint | undefined;
  minOut: bigint | undefined;
  hasWalletProvider: boolean;
  /** Defaults to ready: cups never wait on the account. */
  account?: AccountReadiness;
  /** False when the paying wallet is connected but not on the account. Defaults to true. */
  payerLinked?: boolean;
}): PourGate {
  // Before anything else: a buy with nowhere to land is not a pour yet, and
  // the fix (sign in) is a different door from every other reason below.
  if (state.account === "none") return { kind: "noAccount" };
  if (state.payerLinked === false) return { kind: "walletNotLinked" };
  // Token-first: a user whose only wallet is on another family (e.g.
  // Phantom) must be routed to the picker, not told to "connect" while
  // already connected — the source chain defaults to Ethereum until they pick.
  if (!state.hasToken) return { kind: "pickToken" };
  if (!state.address) return { kind: "connectSource" };
  if (!state.buildAmount) return { kind: "enterAmount" };
  if (state.balance === undefined) return { kind: "balanceLoading" };
  if (state.buildAmount > state.balance) return { kind: "insufficient" };
  // After the balance (you can't be asked for a dollar you don't hold) and
  // before the network: a too-small pour is fixed in the field, not the wallet.
  if (state.belowMinimum) return { kind: "belowMinimum" };
  if (state.isWrongChain) return { kind: "wrongChain" };
  if (state.noRoute) return { kind: "noRoute" };
  if (
    state.quoted === undefined ||
    state.minOut === undefined ||
    !state.hasWalletProvider
  ) {
    return { kind: "quotePending" };
  }
  // Last, beside the quote: the shelf is deterministic and cached, so this
  // is a first-paint wait at most, never a reason to send the user away.
  if (state.account === "deriving") return { kind: "accountPending" };
  return { kind: "ready" };
}

export function withdrawGate(state: {
  address: string | undefined;
  hasDestination: boolean;
  recipient: string | undefined;
  usingCustomRecipient: boolean;
  buildAmount: bigint | undefined;
  availableShares: bigint;
  belowMinimum: boolean;
  isWrongChain: boolean;
  noRoute: boolean;
  belowDust: boolean;
  quoted: bigint | undefined;
  minOut: bigint | undefined;
  hasWalletProvider: boolean;
  /**
   * Whether this session can sign for the hub wallet the sell comes from:
   * false when the account holds the listing behind another of its
   * addresses. Defaults to true.
   */
  canSignSource?: boolean;
  /** False when the signing wallet is connected but not on the account. Defaults to true. */
  signerLinked?: boolean;
}): PourGate {
  if (!state.address) return { kind: "connectSource" };
  if (state.signerLinked === false) return { kind: "walletNotLinked" };
  if (state.canSignSource === false) return { kind: "signWithOther" };
  if (!state.hasDestination) return { kind: "pickDestination" };
  if (!state.recipient) {
    return state.usingCustomRecipient
      ? { kind: "invalidRecipient" }
      : { kind: "connectDestination" };
  }
  if (!state.buildAmount) return { kind: "enterAmount" };
  if (state.buildAmount > state.availableShares) return { kind: "insufficient" };
  if (state.belowMinimum) return { kind: "belowMinimum" };
  if (state.isWrongChain) return { kind: "wrongChain" };
  if (state.noRoute) return { kind: "noRoute" };
  if (state.belowDust) return { kind: "belowDust" };
  if (
    state.quoted === undefined ||
    state.minOut === undefined ||
    !state.hasWalletProvider
  ) {
    return { kind: "quotePending" };
  }
  return { kind: "ready" };
}
