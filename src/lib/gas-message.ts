import type { SpokeChainKey } from "@sodax/sdk";
import { getChainName } from "@/lib/chains";
import type { Copy } from "@/lib/copy";
import { formatTokenAmount } from "@/lib/format";
import { formatUnits } from "viem";

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
