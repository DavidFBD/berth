import { describe, expect, it } from "vitest";
import { payTokenState, shouldPrefillUsd } from "./pay-token-pick";

const base = {
  hasToken: false,
  connected: true,
  sessionPending: false,
  sweepLoading: false,
  holdingsCount: 0,
  pickWaitOver: false,
  findTimedOut: false,
};

describe("payTokenState", () => {
  it("never replaces a token already in the slot", () => {
    expect(payTokenState({ ...base, hasToken: true, holdingsCount: 3 })).toBe("chosen");
  });

  it("picks once the sweep settles with something in it", () => {
    expect(payTokenState({ ...base, holdingsCount: 2 })).toBe("pick");
  });

  it("keeps looking while the sweep is partial and the wait is not over", () => {
    expect(payTokenState({ ...base, sweepLoading: true, holdingsCount: 1 })).toBe("finding");
  });

  it("does not let one slow chain hold the pick back past the wait", () => {
    expect(payTokenState({ ...base, sweepLoading: true, holdingsCount: 1, pickWaitOver: true })).toBe("pick");
  });

  it("picks balances that arrive late, even after the loading line gave up", () => {
    expect(
      payTokenState({ ...base, holdingsCount: 1, pickWaitOver: true, findTimedOut: true }),
    ).toBe("pick");
  });

  it("says it is looking while the sign in settles, before any address exists", () => {
    expect(payTokenState({ ...base, connected: false, sessionPending: true })).toBe("finding");
  });

  it("falls back to asking when the sweep settles empty", () => {
    expect(payTokenState(base)).toBe("none");
  });

  it("falls back to asking when nothing is signed in", () => {
    expect(payTokenState({ ...base, connected: false })).toBe("none");
  });

  it("never spins forever", () => {
    expect(payTokenState({ ...base, sweepLoading: true, pickWaitOver: true, findTimedOut: true })).toBe("none");
    expect(payTokenState({ ...base, connected: false, sessionPending: true, findTimedOut: true })).toBe("none");
  });
});

describe("shouldPrefillUsd", () => {
  const ready = { consumed: false, draftUsd: 5, hasToken: true, priced: true, amount: "" };

  it("fills a drafted amount once the pay token is picked and priced", () => {
    expect(shouldPrefillUsd(ready)).toBe(true);
  });

  it("waits for a pay token and its price", () => {
    expect(shouldPrefillUsd({ ...ready, hasToken: false })).toBe(false);
    expect(shouldPrefillUsd({ ...ready, priced: false })).toBe(false);
  });

  it("applies only once per opening", () => {
    expect(shouldPrefillUsd({ ...ready, consumed: true })).toBe(false);
  });

  it("never writes over what the person typed", () => {
    expect(shouldPrefillUsd({ ...ready, amount: "12" })).toBe(false);
  });

  it("does nothing without a draft", () => {
    expect(shouldPrefillUsd({ ...ready, draftUsd: undefined })).toBe(false);
    expect(shouldPrefillUsd({ ...ready, draftUsd: 0 })).toBe(false);
  });
});
