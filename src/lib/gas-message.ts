import type { SpokeChainKey } from "@sodax/sdk";
import { getChainName } from "@/lib/chains";
import type { Copy } from "@/lib/copy";
import { formatTokenAmount } from "@/lib/format";
import { formatUnits } from "viem";
import { track } from "@/lib/analytics";

/**
 * The top-up guidance for an order its wallet cannot pay the fee for: the
 * token, the network and roughly how much to add when that can be told.
 */
export function gasShortMessage(
  copy: Pick<Copy, "gasToAdd" | "gasNeededToPay" | "gasToAddCancel" | "gasNeededToCancel" | "gasLowerAmount">,
  native: { symbol: string; decimals: number },
  chainKey: SpokeChainKey,
  toAdd: bigint | undefined,
  purpose: GasPurpose = "order",
  /** Paying in the gas token, and the amount typed is what leaves no fee (lib/gas-need amountLeavesNoFee). */
  lowerAmount = false,
): string {
  const chainName = getChainName(chainKey);
  if (lowerAmount) return copy.gasLowerAmount(native.symbol, chainName);
  if (toAdd === undefined) {
    return purpose === "cancel"
      ? copy.gasNeededToCancel(native.symbol, chainName)
      : copy.gasNeededToPay(native.symbol, chainName);
  }
  // The house formatter, with just enough decimals for the two significant
  // digits gasToAdd rounds to: "0.000034", "1,200".
  const digits = Math.min(20, Math.max(0, native.decimals - (toAdd.toString().length - 2)));
  const amount = formatTokenAmount(toAdd, native.decimals, digits);
  return purpose === "cancel"
    ? copy.gasToAddCancel(amount, native.symbol, chainName)
    : copy.gasToAdd(amount, native.symbol, chainName);
}

/** What the signature is for: an order, or cancelling a waiting one. The words differ. */
export type GasPurpose = "order" | "cancel";

/**
 * The shortfall as the gas_blocked event carries it (lib/analytics): a plain
 * decimal in native units, two significant digits, or "unknown".
 */
export function shortfallProp(toAdd: bigint | undefined, decimals: number): string {
  return toAdd === undefined ? "unknown" : formatUnits(toAdd, decimals);
}

/** How long one block counts as one, across the drawer and the last check. */
const GAS_BLOCKED_DEDUPE_MS = 60_000;
const lastGasBlocked = new Map<string, number>();

/**
 * Send gas_blocked once per block: the drawer showing it after the person
 * typed an amount, the last check on a tap and the cancel check all report
 * the same side and chain, and within a minute only the first is sent.
 * Returns whether it was sent (tests).
 */
export function trackGasBlocked(
  props: { side: "buy" | "sell" | "cancel"; chain: string; shortfall: string },
  now = Date.now(),
): boolean {
  const key = `${props.side}:${props.chain}`;
  const last = lastGasBlocked.get(key);
  if (last !== undefined && now - last < GAS_BLOCKED_DEDUPE_MS) return false;
  lastGasBlocked.set(key, now);
  track("gas_blocked", props);
  return true;
}
