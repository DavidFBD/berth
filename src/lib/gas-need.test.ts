import { describe, expect, it } from "vitest";
import { ChainKeys } from "@sodax/sdk";
import {
  DEFAULT_WALLET_FEE_FLOOR,
  GATE_APPROVE_GAS,
  GATE_DEPOSIT_GAS,
  SOLANA_GATE_LAMPORTS,
  SUI_GATE_MIST,
  byGasStatus,
  floorNeed,
  floorWarns,
  gasModel,
  gasNeed,
  orderGasShort,
  payTokenGas,
  trustedNativeBalance,
} from "./gas-need";
import { evmFeeFloorBuffer } from "@/hooks/use-native-gas-buffer";

const GWEI = 1_000_000_000n;
const ETHER = 10n ** 18n;

/**
 * What real wallets reserved (gas limit x maxFeePerGas) on recent SODAX
 * deposits, read from Blockscout 2026-10-02, against the live maxFee viem
 * reported then. The gate must never ask for more than the viem-shaped
 * (Privy) signer reserves at the chain's own price plus headroom, or it
 * refuses orders that go through.
 */
const OBSERVED = [
  // chain, viem maxFee then, the largest reserve seen from a chain-priced signer
  { chain: ChainKeys.BASE_MAINNET, maxFee: 7_000_000n, reserved: 229_000n * 25_000_000n },
  { chain: ChainKeys.ARBITRUM_MAINNET, maxFee: 24_000_000n, reserved: 229_000n * 100_000_000n },
  { chain: ChainKeys.BSC_MAINNET, maxFee: 50_000_000n, reserved: 229_000n * 100_000_000n },
  { chain: ChainKeys.ETHEREUM_MAINNET, maxFee: 4_050_000_000n, reserved: 229_000n * 8_100_000_000n },
] as const;

describe("gasModel", () => {
  it("prices every EVM chain live, Sonic and HyperEVM included", () => {
    for (const chain of [
      ChainKeys.ETHEREUM_MAINNET,
      ChainKeys.BASE_MAINNET,
      ChainKeys.ARBITRUM_MAINNET,
      ChainKeys.OPTIMISM_MAINNET,
      ChainKeys.POLYGON_MAINNET,
      ChainKeys.BSC_MAINNET,
      ChainKeys.AVALANCHE_MAINNET,
      ChainKeys.HYPEREVM_MAINNET,
      ChainKeys.SONIC_MAINNET,
    ]) {
      expect(gasModel(chain).kind).toBe("evm");
    }
  });

  it("gates Solana and Sui off EVM, with fixed amounts", () => {
    expect(gasModel(ChainKeys.SOLANA_MAINNET)).toEqual({ kind: "fixed", units: SOLANA_GATE_LAMPORTS });
    expect(gasModel(ChainKeys.SUI_MAINNET)).toEqual({ kind: "fixed", units: SUI_GATE_MIST });
    expect(SUI_GATE_MIST).toBe(20_000_000n);
  });

  it("never gates Bitcoin, Stellar, NEAR, Injective, ICON or Stacks", () => {
    for (const chain of [
      ChainKeys.BITCOIN_MAINNET,
      ChainKeys.STELLAR_MAINNET,
      ChainKeys.NEAR_MAINNET,
      ChainKeys.INJECTIVE_MAINNET,
      ChainKeys.ICON_MAINNET,
      ChainKeys.STACKS_MAINNET,
    ]) {
      expect(gasModel(chain).kind).toBe("free");
      expect(payTokenGas({ chainKey: chain, isNative: false, nativeBalance: 0n, need: gasNeed({ chainKey: chain, feePerGas: undefined, approval: true }) })).toBe("ok");
      expect(orderGasShort({ chainKey: chain, isNative: true, nativeBalance: 1n, amount: 5n, need: 0n })).toBe(false);
    }
  });
});

describe("gasNeed", () => {
  it("is the chain's own maxFee x realistic gas x 1.5", () => {
    expect(gasNeed({ chainKey: ChainKeys.ETHEREUM_MAINNET, feePerGas: 10n * GWEI, approval: false })).toBe(
      (10n * GWEI * GATE_DEPOSIT_GAS * 3n) / 2n,
    );
  });

  it("adds an approval only when asked to", () => {
    const without = gasNeed({ chainKey: ChainKeys.HYPEREVM_MAINNET, feePerGas: GWEI, approval: false })!;
    const withApproval = gasNeed({ chainKey: ChainKeys.HYPEREVM_MAINNET, feePerGas: GWEI, approval: true })!;
    expect(withApproval - without).toBe((GWEI * GATE_APPROVE_GAS * 3n) / 2n);
  });

  it("never uses the 2 gwei wallet floor (issue #23 made it a warning, not a refusal)", () => {
    const need = gasNeed({ chainKey: ChainKeys.BASE_MAINNET, feePerGas: 7_000_000n, approval: false })!;
    expect(need).toBeLessThan(DEFAULT_WALLET_FEE_FLOOR * GATE_DEPOSIT_GAS);
  });

  it("is unknown while the fee per gas is", () => {
    expect(gasNeed({ chainKey: ChainKeys.HYPEREVM_MAINNET, feePerGas: undefined, approval: false })).toBeUndefined();
  });

  it.each(OBSERVED)("on $chain never asks more than three times what a chain-priced wallet reserved", ({ chain, maxFee, reserved }) => {
    const need = gasNeed({ chainKey: chain, feePerGas: maxFee, approval: true })!;
    expect(need).toBeLessThanOrEqual(reserved * 3n);
  });

  it("leaves Max a few percent of room: Max's buffer is always above the gate", () => {
    for (const feePerGas of [1_000_000n, GWEI, 30n * GWEI]) {
      const need = gasNeed({ chainKey: ChainKeys.BASE_MAINNET, feePerGas, approval: false })!;
      const maxBuffer = [feePerGas * 350_000n * 3n, evmFeeFloorBuffer(ChainKeys.BASE_MAINNET)].reduce((a, b) => (a > b ? a : b));
      expect(need * 103n / 100n).toBeLessThanOrEqual(maxBuffer);
    }
  });
});

describe("trustedNativeBalance", () => {
  it("reads a 0 off EVM as unknown, since the SDK answers 0 for a failed read", () => {
    expect(trustedNativeBalance(ChainKeys.SOLANA_MAINNET, 0n)).toBeUndefined();
    expect(trustedNativeBalance(ChainKeys.SUI_MAINNET, 0n)).toBeUndefined();
    expect(trustedNativeBalance(ChainKeys.SOLANA_MAINNET, 5n)).toBe(5n);
    expect(trustedNativeBalance(ChainKeys.BASE_MAINNET, 0n)).toBe(0n);
  });
});

describe("payTokenGas", () => {
  const need = 300_000n * GWEI;

  it("greys USDC on HyperEVM with no HYPE, the case a real new user hit three times", () => {
    expect(payTokenGas({ chainKey: ChainKeys.HYPEREVM_MAINNET, isNative: false, nativeBalance: 0n, need })).toBe("short");
    // Even before the fee is priced: any fee is more than nothing.
    expect(payTokenGas({ chainKey: ChainKeys.HYPEREVM_MAINNET, isNative: false, nativeBalance: 0n, need: undefined })).toBe("short");
  });

  it("greys a token whose chain holds some native but less than the fee", () => {
    expect(payTokenGas({ chainKey: ChainKeys.BASE_MAINNET, isNative: false, nativeBalance: need - 1n, need })).toBe("short");
    expect(payTokenGas({ chainKey: ChainKeys.BASE_MAINNET, isNative: false, nativeBalance: need, need })).toBe("ok");
  });

  it("keeps the native token itself when it covers more than its own fee", () => {
    expect(payTokenGas({ chainKey: ChainKeys.BASE_MAINNET, isNative: true, nativeBalance: ETHER / 100n, need })).toBe("ok");
    expect(payTokenGas({ chainKey: ChainKeys.BASE_MAINNET, isNative: true, nativeBalance: need, need })).toBe("short");
  });

  it("never greys while the balance is unknown, or 0 off EVM", () => {
    expect(payTokenGas({ chainKey: ChainKeys.HYPEREVM_MAINNET, isNative: false, nativeBalance: undefined, need })).toBe("unknown");
    expect(payTokenGas({ chainKey: ChainKeys.SOLANA_MAINNET, isNative: false, nativeBalance: 0n, need: SOLANA_GATE_LAMPORTS })).toBe("unknown");
  });

  it("greys Solana below rent exemption plus fee, and Sui below its budget", () => {
    expect(payTokenGas({ chainKey: ChainKeys.SOLANA_MAINNET, isNative: false, nativeBalance: 500_000n, need: SOLANA_GATE_LAMPORTS })).toBe("short");
    expect(payTokenGas({ chainKey: ChainKeys.SUI_MAINNET, isNative: false, nativeBalance: 10_000_000n, need: SUI_GATE_MIST })).toBe("short");
  });
});

describe("orderGasShort", () => {
  const need = 1_000n;

  it("counts the amount against the balance when the native token pays, with a little slack", () => {
    expect(orderGasShort({ chainKey: ChainKeys.BASE_MAINNET, isNative: true, nativeBalance: 5_000n, amount: 4_000n, need })).toBe(false);
    // 3% slack: a fee risen a little since Max is not a refusal.
    expect(orderGasShort({ chainKey: ChainKeys.BASE_MAINNET, isNative: true, nativeBalance: 5_000n, amount: 4_030n, need })).toBe(false);
    expect(orderGasShort({ chainKey: ChainKeys.BASE_MAINNET, isNative: true, nativeBalance: 5_000n, amount: 4_031n, need })).toBe(true);
  });

  it("needs only the fee beside another token", () => {
    expect(orderGasShort({ chainKey: ChainKeys.BASE_MAINNET, isNative: false, nativeBalance: 1_000n, amount: 10n ** 9n, need })).toBe(false);
    expect(orderGasShort({ chainKey: ChainKeys.BASE_MAINNET, isNative: false, nativeBalance: 999n, amount: 1n, need })).toBe(true);
  });

  it("lets an unknown balance through to the wallet, and a 0 off EVM", () => {
    expect(orderGasShort({ chainKey: ChainKeys.BASE_MAINNET, isNative: false, nativeBalance: undefined, amount: 1n, need })).toBe(false);
    expect(orderGasShort({ chainKey: ChainKeys.SOLANA_MAINNET, isNative: false, nativeBalance: 0n, amount: 1n, need })).toBe(false);
  });
});

describe("floorWarns", () => {
  const base = { chainKey: ChainKeys.BASE_MAINNET, isNative: false, amount: 0n, approval: false } as const;
  const need = gasNeed({ chainKey: ChainKeys.BASE_MAINNET, feePerGas: 7_000_000n, approval: false })!;
  const floor = floorNeed(ChainKeys.BASE_MAINNET, false)!;

  it("warns, without refusing, a wallet that covers the chain's price but not the floor", () => {
    const balance = (need + floor) / 2n;
    expect(orderGasShort({ ...base, nativeBalance: balance, need })).toBe(false);
    expect(floorWarns({ ...base, nativeBalance: balance, need })).toBe(true);
  });

  it("says nothing once the floor is covered, or when the order is refused anyway", () => {
    expect(floorWarns({ ...base, nativeBalance: floor, need })).toBe(false);
    expect(floorWarns({ ...base, nativeBalance: need - 1n, need })).toBe(false);
  });

  it("says nothing where the chain's own price is above the floor, or off EVM", () => {
    const dear = gasNeed({ chainKey: ChainKeys.ETHEREUM_MAINNET, feePerGas: 10n * GWEI, approval: false })!;
    expect(floorWarns({ ...base, chainKey: ChainKeys.ETHEREUM_MAINNET, nativeBalance: dear, need: dear })).toBe(false);
    expect(floorWarns({ ...base, chainKey: ChainKeys.SOLANA_MAINNET, nativeBalance: 2_000_000n, need: SOLANA_GATE_LAMPORTS })).toBe(false);
  });
});

describe("byGasStatus", () => {
  it("puts what can pay first and what cannot last, keeping each group's order", () => {
    const rows = [
      { id: "hyper-usdc", status: "short" as const },
      { id: "base-usdc", status: "ok" as const },
      { id: "sui", status: "unknown" as const },
      { id: "hyper-hype", status: "short" as const },
      { id: "base-eth", status: "ok" as const },
    ];
    expect(byGasStatus(rows, (row) => row.status).map((row) => row.id)).toEqual([
      "base-usdc",
      "sui",
      "base-eth",
      "hyper-usdc",
      "hyper-hype",
    ]);
  });
});

describe("a sponsored order (Privy pays the fee)", () => {
  const base = ChainKeys.BASE_MAINNET;
  it("needs no gas and is never gated, even with an empty wallet", () => {
    expect(gasModel(base, true)).toEqual({ kind: "free" });
    expect(gasNeed({ chainKey: base, feePerGas: 5n * GWEI, approval: true, sponsored: true })).toBe(0n);
    expect(payTokenGas({ chainKey: base, isNative: false, nativeBalance: 0n, need: undefined, sponsored: true })).toBe("ok");
    expect(orderGasShort({ chainKey: base, isNative: false, nativeBalance: 0n, amount: 0n, need: undefined, sponsored: true })).toBe(false);
    expect(floorNeed(base, true, true)).toBeUndefined();
    expect(
      floorWarns({ chainKey: base, isNative: false, nativeBalance: 0n, amount: 0n, need: 0n, approval: false, sponsored: true }),
    ).toBe(false);
  });
  it("leaves the unsponsored gate exactly as it was", () => {
    expect(payTokenGas({ chainKey: base, isNative: false, nativeBalance: 0n, need: undefined })).toBe("short");
    expect(orderGasShort({ chainKey: base, isNative: false, nativeBalance: 0n, amount: 0n, need: 1n })).toBe(true);
  });
});
