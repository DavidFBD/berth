import { describe, expect, it } from "vitest";
import { holdsIntentCreated, judgePour } from "./pour-verify";

// Whose pour it is: lib/server/pour-ownership.test.
const VAULT = "0xd09de2f5070699a909c0fd32fb5a909d3886701d";
const OTHER_TOKEN = "0x4effb5813271699683c25c734f4dabc45b363709";

const vaultAddresses = new Set([VAULT]);

function intent(overrides: { inputToken?: string; outputToken?: string }) {
  return {
    inputToken: (overrides.inputToken ?? OTHER_TOKEN) as `0x${string}`,
    outputToken: (overrides.outputToken ?? VAULT) as `0x${string}`,
  };
}

describe("judgePour", () => {
  it("accepts a buy whose output is a listing", () => {
    expect(judgePour({ direction: "in", intent: intent({}), vaultAddresses })).toEqual({ ok: true });
  });

  it("accepts either casing of the listing address", () => {
    expect(judgePour({ direction: "in", intent: intent({ outputToken: VAULT.toUpperCase().replace("0X", "0x") }), vaultAddresses })).toEqual({
      ok: true,
    });
  });

  it("rejects an intent that never touches a listing: any successful tx is no longer enough", () => {
    expect(judgePour({ direction: "in", intent: intent({ outputToken: OTHER_TOKEN }), vaultAddresses })).toEqual({
      ok: false,
      reason: "not a pour",
    });
  });

  it("rejects a buy hash claimed as a sell (and vice versa)", () => {
    expect(judgePour({ direction: "out", intent: intent({}), vaultAddresses })).toEqual({ ok: false, reason: "not a pour" });
    expect(judgePour({ direction: "out", intent: intent({ inputToken: VAULT, outputToken: OTHER_TOKEN }), vaultAddresses })).toEqual({
      ok: true,
    });
  });
});

describe("holdsIntentCreated", () => {
  const INTENTS = "0x6382D6ccD780758C5e8A6123c33ee8F4472F96ef";
  // IntentCreated's topic as Sonic logs it (a real Berth buy, 2026-10-01).
  const created = { address: INTENTS.toLowerCase(), topics: ["0x29fecd55" + "0".repeat(56)], data: "0x" };
  it("finds an IntentCreated from the Intents contract, and nothing else", () => {
    expect(holdsIntentCreated([created], INTENTS)).toBe(true);
    expect(holdsIntentCreated([{ ...created, address: "0x1111111111111111111111111111111111111111" }], INTENTS)).toBe(false);
    expect(holdsIntentCreated([{ ...created, topics: ["0xddf252ad" + "0".repeat(56)] }], INTENTS)).toBe(false);
    expect(holdsIntentCreated([], INTENTS)).toBe(false);
  });
});
