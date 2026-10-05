import { describe, expect, it } from "vitest";
import { COPY } from "./copy";
import { stepMessage } from "./step-message";

describe("stepMessage", () => {
  it("asks an external wallet to confirm", () => {
    expect(stepMessage("signing", COPY)).toBe("Confirm in your wallet…");
    expect(stepMessage("approving", COPY)).toBe(COPY.stepMsgApproving);
  });

  it("says what Berth is doing when it sends for an email account", () => {
    expect(stepMessage("signing", COPY, { headless: true })).toBe("Sending your order…");
    expect(stepMessage("approving", COPY, { headless: true })).toBe("Approving the spend…");
    expect(stepMessage("building", COPY, { headless: true })).toBe(COPY.stepMsgBuilding);
  });

  it("never asks a headless send to confirm anything, and uses no dashes", () => {
    for (const step of ["building", "approving", "signing"] as const) {
      const line = stepMessage(step, COPY, { headless: true });
      expect(line).not.toMatch(/wallet|confirm/i);
      expect(line).not.toMatch(/[–—]| - /);
    }
  });

  it("says a two-send approve plainly, with no wallet to confirm in when Berth sends it", () => {
    expect(stepMessage("approving", COPY, { approveTwice: true })).toBe(COPY.stepMsgApprovingTwice);
    const both = stepMessage("approving", COPY, { headless: true, approveTwice: true });
    expect(both).toBe(COPY.stepMsgApprovingTwiceHeadless);
    expect(both).not.toMatch(/wallet|confirm/i);
    expect(both).not.toMatch(/[–—]| - /);
    expect(stepMessage("signing", COPY, { headless: true, approveTwice: true })).toBe(COPY.stepMsgSending);
    expect(stepMessage("signing", COPY, { approveTwice: true })).toBe(COPY.stepMsgSigning);
  });
});
