import { describe, expect, it } from "vitest";
import { asks, consentState, nextChoice, parseChoice, readSignal, sends, type ConsentState } from "./analytics-consent";

const none = { doNotTrack: false, globalPrivacyControl: false };

describe("the consent state machine", () => {
  it("asks first, and sends nothing while it asks", () => {
    const state = consentState(null, none);
    expect(state).toBe("ask");
    expect(asks(state)).toBe(true);
    expect(sends(state)).toBe(false);
  });

  it("sends only after Allow, and stops after No thanks or the switch", () => {
    expect(nextChoice("ask", "allow")).toBe("granted");
    expect(nextChoice("ask", "decline")).toBe("denied");
    expect(nextChoice("granted", "switchOff")).toBe("denied");
    expect(nextChoice("denied", "switchOn")).toBe("granted");
    expect(sends(consentState("granted", none))).toBe(true);
    expect(sends(consentState("denied", none))).toBe(false);
    expect(asks(consentState("denied", none))).toBe(false);
    expect(asks(consentState("granted", none))).toBe(false);
  });

  it("reads Do Not Track and Global Privacy Control as no, never asks, and cannot be switched on from the page", () => {
    for (const signal of [
      { doNotTrack: true, globalPrivacyControl: false },
      { doNotTrack: false, globalPrivacyControl: true },
    ]) {
      for (const stored of [null, "granted", "denied"] as const) {
        const state = consentState(stored, signal);
        expect(state).toBe("signal");
        expect(sends(state)).toBe(false);
        expect(asks(state)).toBe(false);
      }
      expect(nextChoice("signal", "allow")).toBeNull();
      expect(nextChoice("signal", "switchOn")).toBeNull();
    }
  });

  it("only sends in one state of four", () => {
    const states: ConsentState[] = ["ask", "granted", "denied", "signal"];
    expect(states.filter(sends)).toEqual(["granted"]);
  });

  it("stores only a choice, and ignores anything else in storage", () => {
    expect(parseChoice("granted")).toBe("granted");
    expect(parseChoice("denied")).toBe("denied");
    expect(parseChoice("yes")).toBeNull();
    expect(parseChoice(null)).toBeNull();
  });

  it("reads the browser's signals", () => {
    expect(readSignal({ doNotTrack: "1" })).toEqual({ doNotTrack: true, globalPrivacyControl: false });
    expect(readSignal({ globalPrivacyControl: true })).toEqual({ doNotTrack: false, globalPrivacyControl: true });
    expect(readSignal({ doNotTrack: "0" })).toEqual(none);
    expect(readSignal({}, { doNotTrack: "1" })).toEqual({ doNotTrack: true, globalPrivacyControl: false });
    expect(readSignal(undefined)).toEqual(none);
  });
});
