import { describe, expect, it } from "vitest";
import { COPY } from "./copy";
import { stepMessage } from "./step-message";

describe("stepMessage", () => {
  it("asks an external wallet to confirm", () => {
    expect(stepMessage("signing", COPY, false)).toBe("Confirm in your wallet…");
    expect(stepMessage("approving", COPY, false)).toBe(COPY.stepMsgApproving);
  });

  it("says what Berth is doing when it sends for an email account", () => {
    expect(stepMessage("signing", COPY, true)).toBe("Sending your order…");
    expect(stepMessage("approving", COPY, true)).toBe("Approving the spend…");
    expect(stepMessage("building", COPY, true)).toBe(COPY.stepMsgBuilding);
  });

  it("never asks a headless send to confirm anything, and uses no dashes", () => {
    for (const step of ["building", "approving", "signing"] as const) {
      const line = stepMessage(step, COPY, true);
      expect(line).not.toMatch(/wallet|confirm/i);
      expect(line).not.toMatch(/[–—]| - /);
    }
  });
});
