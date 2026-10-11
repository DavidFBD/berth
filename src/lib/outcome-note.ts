import type { Copy } from "@/lib/copy";
import type { OutcomeCheckPhase } from "@/lib/gas-sponsor";

export type OutcomeNoteState = {
  phase: OutcomeCheckPhase;
  /** Whole seconds left of the hold, while it is on. */
  secondsLeft: number;
  /** A sponsored send is still out past its deadline: the hold lasts until it answers. */
  waiting: boolean;
};

/**
 * What the note under an unclear sponsored answer says (components/flow
 * action-stepper OutcomeCheckNote), below its constant first line. It says
 * nothing was sent only after the wallet definitely refused; when the hold
 * ends with nothing seen it says Berth could not confirm either way. `orb`
 * is true only while something is actually working: a chain check running,
 * or a send still waiting on the wallet.
 */
export function outcomeNote(state: OutcomeNoteState, copy: Copy["outcomeCheck"]): { lines: string[]; orb: boolean } {
  const countdown = state.secondsLeft > 0 ? [copy.holdCountdown(state.secondsLeft)] : [];
  if (state.waiting) return { lines: [copy.waiting], orb: true };
  switch (state.phase) {
    case "checking":
      return { lines: [copy.checking, ...countdown], orb: true };
    case "nothing-sent":
      return { lines: [copy.nothingSent], orb: false };
    case "sent":
      return { lines: [copy.sent, ...countdown], orb: false };
    default:
      // A hold with no check behind it (no probe, or read back after a
      // reload) counts down plainly; once over, Berth could not confirm.
      return { lines: countdown.length > 0 ? countdown : [copy.unclear], orb: false };
  }
}

/** Whole seconds left of a hold ending at `until`; 0 once it is over. */
export function holdSecondsLeft(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / 1000));
}
