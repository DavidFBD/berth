import { describe, expect, it } from "vitest";
import { ChainKeys } from "@sodax/sdk";
import { evmFeeFloorBuffer } from "./use-native-gas-buffer";

/**
 * Issue #23's arithmetic, pinned. A Max deposit on Base withheld 0.0000067
 * ETH for gas, because the chain reported a 0.006 gwei base fee and suggests
 * a 0.001 gwei tip, and then the wallet signed at 2 gwei for a real fee of
 * 0.000239 ETH. Whatever the RPC says, the floor has to cover that.
 */
describe("evmFeeFloorBuffer", () => {
  const ISSUE_23_FEE_PAID = 239_273_352_270_590n;
  const ISSUE_23_BUFFER_HELD = 6_655_959_668_700n;

  it("covers the fee the wallet in issue #23 actually charged", () => {
    expect(evmFeeFloorBuffer(ChainKeys.BASE_MAINNET)).toBeGreaterThan(
      ISSUE_23_FEE_PAID,
    );
  });

  it("is far above what that Max withheld", () => {
    expect(evmFeeFloorBuffer(ChainKeys.BASE_MAINNET)).toBeGreaterThan(
      ISSUE_23_BUFFER_HELD * 10n,
    );
  });

  it("would have left that $2.03 balance able to pay", () => {
    const balance = 743_300_593_668_700n; // 0.000743 ETH, issue #23
    const spendable = balance - evmFeeFloorBuffer(ChainKeys.BASE_MAINNET);
    expect(spendable).toBeGreaterThan(0n);
    expect(balance - spendable).toBeGreaterThan(ISSUE_23_FEE_PAID);
  });

  it("applies to chains with no entry of their own, since new L2s repeat this", () => {
    expect(evmFeeFloorBuffer(ChainKeys.OPTIMISM_MAINNET)).toBeGreaterThan(0n);
    expect(evmFeeFloorBuffer(ChainKeys.ARBITRUM_MAINNET)).toBeGreaterThan(0n);
  });
});
