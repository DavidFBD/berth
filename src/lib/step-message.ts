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

/**
 * The line under the order stepper. "Confirm in your wallet…" only where
 * there is a wallet to confirm in: `headless` is an email account's
 * embedded wallet sending with Privy paying the fee and no wallet screen
 * (lib/gas-sponsor sponsoredSendOptions).
 */
export function stepMessage(step: StepMessageKey, copy: Copy, headless: boolean): string {
  return (headless ? HEADLESS_STEP_MESSAGE : STEP_MESSAGE)[step](copy);
}
