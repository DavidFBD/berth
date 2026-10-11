import { describe, expect, it } from "vitest";
import { COPY } from "./copy";
import { holdSecondsLeft, outcomeNote } from "./outcome-note";

const copy = COPY.outcomeCheck;
const note = (phase: Parameters<typeof outcomeNote>[0]["phase"], secondsLeft = 0, waiting = false) =>
  outcomeNote({ phase, secondsLeft, waiting }, copy);

describe("the note under an unclear order answer", () => {
  it("says nothing has reached the network yet while it checks, with the hold's countdown", () => {
    expect(note("checking", 42).lines).toEqual([
      "Berth is checking the network for this order.",
      copy.holdCountdown(42),
    ]);
  });

  it("says nothing was sent only after the wallet definitely refused", () => {
    expect(note("nothing-sent").lines).toEqual([copy.nothingSent]);
    for (const phase of ["idle", "checking", "sent", "unclear"] as const) {
      for (const seconds of [0, 30]) {
        expect(note(phase, seconds).lines.join(" ")).not.toMatch(/nothing was sent/i);
      }
    }
  });

  it("when the hold ends with nothing seen, says Berth could not confirm and points to What you own", () => {
    expect(note("unclear", 0).lines).toEqual([copy.unclear]);
    expect(copy.unclear).toBe("Berth couldn't confirm either way whether this order went out. Check What you own before trying again.");
  });

  it("points to What you own when something reached the network", () => {
    expect(note("sent", 20).lines).toEqual([copy.sent, copy.holdCountdown(20)]);
  });

  it("waits plainly for a send past its deadline", () => {
    expect(note("checking", 60, true).lines).toEqual([copy.waiting]);
  });
});

describe("the orb and the countdown (review 2026-10-11)", () => {
  it("shows the orb only while a check runs or a send is still waiting on the wallet", () => {
    expect(note("checking", 30).orb).toBe(true);
    expect(note("checking", 30, true).orb).toBe(true);
    for (const phase of ["idle", "unclear", "sent", "nothing-sent"] as const) {
      expect(note(phase, 30).orb).toBe(false);
      expect(note(phase, 0).orb).toBe(false);
    }
  });

  it("counts down a plain hold with no check behind it, as after a reload", () => {
    expect(note("idle", 12).lines).toEqual([copy.holdCountdown(12)]);
    expect(note("unclear", 12).lines).toEqual([copy.holdCountdown(12)]);
  });

  it("rounds the seconds left up, and stops at zero", () => {
    expect(holdSecondsLeft(10_000, 0)).toBe(10);
    expect(holdSecondsLeft(10_000, 9_001)).toBe(1);
    expect(holdSecondsLeft(10_000, 10_000)).toBe(0);
    expect(holdSecondsLeft(0, 5_000)).toBe(0);
  });
});
