import { describe, expect, it } from "vitest";
import { judgePour } from "./pour-verify";

const VAULT = "0xd09de2f5070699a909c0fd32fb5a909d3886701d";
const OTHER_TOKEN = "0x4effb5813271699683c25c734f4dabc45b363709";
const WALLET = "0xf4b759cf4fd5af5c0f2a40f74823f09743959399";
const STRANGER = "0x1111111111111111111111111111111111111111";
// A Solana pubkey arrives as 32 bytes of hex — not an EVM shape.
const SOLANA_SRC = `0x${"cd".repeat(32)}` as `0x${string}`;

const vaultAddresses = new Set([VAULT]);

function intent(overrides: {
  inputToken?: string;
  outputToken?: string;
  srcAddress?: string;
}) {
  return {
    inputToken: (overrides.inputToken ?? OTHER_TOKEN) as `0x${string}`,
    outputToken: (overrides.outputToken ?? VAULT) as `0x${string}`,
    srcAddress: (overrides.srcAddress ?? WALLET) as `0x${string}`,
  };
}

describe("judgePour", () => {
  it("accepts a deposit whose output is a tea vault and whose source is the account", () => {
    expect(
      judgePour({
        direction: "in",
        intent: intent({}),
        vaultAddresses,
        accountWallet: WALLET,
      }),
    ).toEqual({ ok: true });
  });

  it("accepts either casing of the same address", () => {
    expect(
      judgePour({
        direction: "in",
        intent: intent({ srcAddress: WALLET.toUpperCase().replace("0X", "0x") }),
        vaultAddresses,
        accountWallet: WALLET,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects an intent that never touches a vault — any successful tx is no longer enough", () => {
    expect(
      judgePour({
        direction: "in",
        intent: intent({ outputToken: OTHER_TOKEN }),
        vaultAddresses,
        accountWallet: WALLET,
      }),
    ).toEqual({ ok: false, reason: "not a pour" });
  });

  it("rejects a deposit hash claimed as a withdrawal (and vice versa)", () => {
    // Deposit intent (vault on the OUTPUT side) claimed as direction=out.
    expect(
      judgePour({
        direction: "out",
        intent: intent({}),
        vaultAddresses,
        accountWallet: WALLET,
      }),
    ).toEqual({ ok: false, reason: "not a pour" });
    // Withdrawal intent (vault on the INPUT side) passes as out.
    expect(
      judgePour({
        direction: "out",
        intent: intent({ inputToken: VAULT, outputToken: OTHER_TOKEN }),
        vaultAddresses,
        accountWallet: WALLET,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects someone else's EVM-sourced pour", () => {
    expect(
      judgePour({
        direction: "in",
        intent: intent({}),
        vaultAddresses,
        accountWallet: STRANGER,
      }),
    ).toEqual({ ok: false, reason: "not your pour" });
  });

  it("rejects an EVM-sourced pour when the account has no stored wallet", () => {
    expect(
      judgePour({
        direction: "in",
        intent: intent({}),
        vaultAddresses,
        accountWallet: null,
      }),
    ).toEqual({ ok: false, reason: "not your pour" });
  });

  it("lets a non-EVM source through the ownership gate (recorded residual)", () => {
    expect(
      judgePour({
        direction: "in",
        intent: intent({ srcAddress: SOLANA_SRC }),
        vaultAddresses,
        accountWallet: WALLET,
      }),
    ).toEqual({ ok: true });
  });
});
