/**
 * Guards for the moment between the tap on Buy or Sell and the wallet prompt.
 *
 * The submit handlers await the terms and a fresh quote before they sign. A
 * drawer closed in that gap (back, swipe, overlay, or the host unmounting it)
 * has reset its order state and lost its tracking, so a signature started after
 * it would leave a wallet prompt with nothing watching it and a signed order
 * that never reaches the ledger. So the drawer refuses to close while it is
 * preparing, and a handler that finds its drawer gone anyway does not sign.
 */

/** Whether a close of the drawer must be refused right now. */
export function refusesClose(state: { locked: boolean; preparing: boolean }): boolean {
  return state.locked || state.preparing;
}

export type SignAttempt = {
  /** Starts an attempt; any earlier one stops being current. */
  begin(): number;
  /** The drawer closed or unmounted: no attempt in flight may sign. */
  cancel(): void;
  /** True while `attempt` is the latest and the drawer has not closed since. */
  current(attempt: number): boolean;
};

export function createSignAttempt(): SignAttempt {
  let latest = 0;
  return {
    begin() {
      latest += 1;
      return latest;
    },
    cancel() {
      latest += 1;
    },
    current(attempt) {
      return attempt === latest;
    },
  };
}
