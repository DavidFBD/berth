import { describe, expect, it } from "vitest";
import { shouldShowEmailNudge, VISITS_BEFORE_EARNED, type EmailNudgeFacts } from "@/lib/email-nudge";

const NOW = 1_700_000_000_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const facts = (partial: Partial<EmailNudgeFacts>): EmailNudgeFacts => ({
  hasEmail: false,
  boughtBefore: false,
  visits: 0,
  dismissedAt: null,
  otherStripShowing: false,
  ...partial,
});

describe("shouldShowEmailNudge", () => {
  it("never shows once the account has a verified email", () => {
    expect(shouldShowEmailNudge(facts({ hasEmail: true, boughtBefore: true }), NOW)).toBe(false);
    expect(shouldShowEmailNudge(facts({ hasEmail: true, visits: 5 }), NOW)).toBe(false);
  });

  it("stays quiet while a higher-priority strip is showing, even once earned", () => {
    expect(
      shouldShowEmailNudge(facts({ boughtBefore: true, otherStripShowing: true }), NOW),
    ).toBe(false);
  });

  it("is not earned before a first buy or two visits", () => {
    expect(shouldShowEmailNudge(facts({ visits: 0 }), NOW)).toBe(false);
    expect(shouldShowEmailNudge(facts({ visits: VISITS_BEFORE_EARNED - 1 }), NOW)).toBe(false);
  });

  it("shows after a first buy, even on the very first visit", () => {
    expect(shouldShowEmailNudge(facts({ boughtBefore: true, visits: 0 }), NOW)).toBe(true);
  });

  it("shows after enough visits with nothing bought yet", () => {
    expect(shouldShowEmailNudge(facts({ visits: VISITS_BEFORE_EARNED }), NOW)).toBe(true);
    expect(shouldShowEmailNudge(facts({ visits: VISITS_BEFORE_EARNED + 3 }), NOW)).toBe(true);
  });

  it("stays away for a week after being dismissed", () => {
    const justNow = facts({ boughtBefore: true, dismissedAt: NOW - 1 });
    expect(shouldShowEmailNudge(justNow, NOW)).toBe(false);

    const almostAWeek = facts({ boughtBefore: true, dismissedAt: NOW - (WEEK_MS - 1) });
    expect(shouldShowEmailNudge(almostAWeek, NOW)).toBe(false);
  });

  it("comes back once a full week has passed", () => {
    const exactlyAWeek = facts({ boughtBefore: true, dismissedAt: NOW - WEEK_MS });
    expect(shouldShowEmailNudge(exactlyAWeek, NOW)).toBe(true);

    const overAWeek = facts({ boughtBefore: true, dismissedAt: NOW - WEEK_MS - 1 });
    expect(shouldShowEmailNudge(overAWeek, NOW)).toBe(true);
  });
});
