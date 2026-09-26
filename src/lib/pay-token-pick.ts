/**
 * What the buy drawer's "paying with" slot should do while the wallet
 * sweep (hooks/use-embedded-holdings) comes in. Pure, so the race it
 * guards against is a unit test rather than something seen on a phone.
 *
 * The sweep reads every chain one by one, and one slow or rate limited
 * chain used to hold the default pick back for as long as it took, so a
 * drawer opened on a fresh page load (a draft link, most of all) sat in
 * its empty state. Now the best holding is picked once the sweep settles,
 * or once PICK_WAIT_MS has passed with something already found, and the
 * slot says it is looking in the meantime, never for longer than
 * FIND_TIMEOUT_MS.
 */

/** How long a drawer waits for the whole sweep before picking the best holding found so far. */
export const PICK_WAIT_MS = 4_000;

/** How long the slot says it is looking before it falls back to asking. */
export const FIND_TIMEOUT_MS = 15_000;

export type PayTokenState =
  /** A token is in the slot, picked by the person or earlier by default. */
  | "chosen"
  /** Put the first holding in the slot now. */
  | "pick"
  /** Still looking: show that, not the empty slot. */
  | "finding"
  /** Nothing to pick: ask what they are paying with. */
  | "none";

export function payTokenState(input: {
  hasToken: boolean;
  /** Any chain resolved an address to sweep. */
  connected: boolean;
  /** The sign in is still settling, so no address can be known yet. */
  sessionPending: boolean;
  /** Any chain's sweep, or the prices it is sorted by, still in flight. */
  sweepLoading: boolean;
  holdingsCount: number;
  /** PICK_WAIT_MS has passed since the drawer opened. */
  pickWaitOver: boolean;
  /** FIND_TIMEOUT_MS has passed since the drawer opened. */
  findTimedOut: boolean;
}): PayTokenState {
  if (input.hasToken) return "chosen";
  if (input.connected && input.holdingsCount > 0 && (!input.sweepLoading || input.pickWaitOver)) {
    return "pick";
  }
  if (input.findTimedOut) return "none";
  const looking = input.connected ? input.sweepLoading : input.sessionPending;
  return looking ? "finding" : "none";
}

/**
 * Whether a drafted dollar amount goes into the field now. Once per
 * opening, only as money (the pay token must be priced, or "50" would read
 * as fifty tokens), and never over anything the person typed: an edit to
 * the field consumes the draft just as filling it in does.
 */
export function shouldPrefillUsd(input: {
  consumed: boolean;
  draftUsd: number | undefined;
  hasToken: boolean;
  priced: boolean;
  amount: string;
}): boolean {
  return (
    !input.consumed &&
    input.draftUsd !== undefined &&
    input.draftUsd > 0 &&
    input.hasToken &&
    input.priced &&
    input.amount === ""
  );
}
