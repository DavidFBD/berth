import type { Copy } from "@/lib/copy";

export type StepMessageKey = "building" | "approving" | "signing";

const STEP_MESSAGE: Record<StepMessageKey, (copy: Copy) => string> = {
  building: (copy) => copy.stepMsgBuilding,
  approving: (copy) => copy.stepMsgApproving,
  signing: (copy) => copy.stepMsgSigning,
};

/** When Berth sends for the person, nothing waits on them: no wallet to confirm in. */
const HEADLESS_STEP_MESSAGE: Record<StepMessageKey, (copy: Copy) => string> = {
  building: (copy) => copy.stepMsgBuilding,
  approving: (copy) => copy.stepMsgApprovingHeadless,
  signing: (copy) => copy.stepMsgSending,
};

export type StepMessageOptions = {
  /** An email account's embedded wallet sending with Privy paying the fee and no wallet screen (lib/gas-sponsor sponsoredSendOptions). */
  headless?: boolean;
  /** The approve is two sends: a token like USDT clearing an old allowance first (pour-lifecycle approvalTakesTwo). */
  approveTwice?: boolean;
};

/**
 * The line under the order stepper. "Confirm in your wallet…" only where
 * there is a wallet to confirm in. A two-send approve stays one step; only
 * its message changes. When both apply, the headless words win: nobody is
 * asked to confirm anything, the line only says there are two sends.
 */
export function stepMessage(
  step: StepMessageKey,
  copy: Copy,
  { headless = false, approveTwice = false }: StepMessageOptions = {},
): string {
  if (step === "approving" && approveTwice) {
    return headless ? copy.stepMsgApprovingTwiceHeadless : copy.stepMsgApprovingTwice;
  }
  return (headless ? HEADLESS_STEP_MESSAGE : STEP_MESSAGE)[step](copy);
}
