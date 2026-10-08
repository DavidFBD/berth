import { describe, expect, it } from "vitest";
import { ChainKeys } from "@sodax/sdk";
import {
  DEFAULT_WALLET_FEE_FLOOR,
  GATE_APPROVE_GAS,
  GATE_DEPOSIT_GAS,
  SOLANA_GATE_LAMPORTS,
  SUI_GATE_MIST,
  GATE_SELL_GAS,
  blockingNeed,
  byGasStatus,
  floorNeed,
  gasModel,
  gasToAdd,
  gasNeed,
  orderGasShort,
  payTokenGas,
  trustedNativeBalance,
  walletFeeFloor,
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

  it("is the chain's own price alone; the 2 gwei wallet floor joins it in blockingNeed", () => {
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

describe("blockingNeed: the wallet floor refuses a wallet that pays its own fee", () => {
  const BASE = ChainKeys.BASE_MAINNET;
  // Base's own price when issue #27 happened: a few thousandths of a gwei.
  const chainNeed = (approval: boolean) => gasNeed({ chainKey: BASE, feePerGas: 7_000_000n, approval })!;

  it("is the floor on a cheap L2, for a buy and for a sell", () => {
    const buy = blockingNeed({ chainKey: BASE, need: chainNeed(false), approval: false });
    const sell = blockingNeed({ chainKey: BASE, need: chainNeed(false), approval: false, order: "sell" });
    expect(buy).toBe(DEFAULT_WALLET_FEE_FLOOR * GATE_DEPOSIT_GAS);
    expect(sell).toBe(DEFAULT_WALLET_FEE_FLOOR * GATE_SELL_GAS);
    expect(blockingNeed({ chainKey: BASE, need: chainNeed(true), approval: true })).toBe(
      DEFAULT_WALLET_FEE_FLOOR * (GATE_DEPOSIT_GAS + GATE_APPROVE_GAS),
    );
  });

  it("stands in with the floor while the fee per gas is still loading", () => {
    expect(blockingNeed({ chainKey: BASE, need: undefined, approval: false })).toBe(floorNeed(BASE, false));
  });

  it("keeps the chain's price where it is above the floor", () => {
    const dear = gasNeed({ chainKey: ChainKeys.ETHEREUM_MAINNET, feePerGas: 10n * GWEI, approval: false })!;
    expect(blockingNeed({ chainKey: ChainKeys.ETHEREUM_MAINNET, need: dear, approval: false })).toBe(dear);
  });

  it("leaves off EVM and sponsored orders exactly as the chain's need", () => {
    expect(blockingNeed({ chainKey: ChainKeys.SOLANA_MAINNET, need: SOLANA_GATE_LAMPORTS, approval: false })).toBe(
      SOLANA_GATE_LAMPORTS,
    );
    expect(blockingNeed({ chainKey: BASE, need: 0n, approval: false, sponsored: true })).toBe(0n);
  });

  it("refuses issue #27's sell: an external wallet on Base short of the 61,401 gas at 2 gwei it was asked for", () => {
    // The wallet reserved 61,401 gas at about 2 gwei, ~0.000123 ETH, and held less.
    const asked = 61_401n * (DEFAULT_WALLET_FEE_FLOOR + 2n * 6_000_000n);
    const held = asked - 1n;
    const need = blockingNeed({ chainKey: BASE, need: chainNeed(false), approval: false, order: "sell" });
    // The chain's own price alone let it through, which is how it reached the wallet.
    expect(orderGasShort({ chainKey: BASE, isNative: false, nativeBalance: held, amount: 0n, need: chainNeed(false) })).toBe(false);
    expect(orderGasShort({ chainKey: BASE, isNative: false, nativeBalance: held, amount: 0n, need })).toBe(true);
    expect(need!).toBeGreaterThan(asked);
  });

  it("refuses a buy paid in a token whose chain holds less than the floor, and lets through one that holds it", () => {
    const need = blockingNeed({ chainKey: BASE, need: chainNeed(false), approval: false })!;
    const facts = { chainKey: BASE, isNative: false, amount: 10n ** 6n } as const;
    expect(orderGasShort({ ...facts, nativeBalance: need - 1n, need })).toBe(true);
    expect(orderGasShort({ ...facts, nativeBalance: need, need })).toBe(false);
  });

  it("never refuses a sponsored order, even with an empty wallet", () => {
    const need = blockingNeed({ chainKey: BASE, need: 0n, approval: false, sponsored: true });
    expect(orderGasShort({ chainKey: BASE, isNative: false, nativeBalance: 0n, amount: 0n, need, sponsored: true })).toBe(false);
  });

  it("never refuses a native Max: the Max buffer holds back the floor", () => {
    const need = blockingNeed({ chainKey: BASE, need: chainNeed(false), approval: false })!;
    const balance = 743_300_593_668_700n; // issue #23's balance
    const max = balance - evmFeeFloorBuffer(BASE);
    expect(orderGasShort({ chainKey: BASE, isNative: true, nativeBalance: balance, amount: max, need })).toBe(false);
    expect(orderGasShort({ chainKey: BASE, isNative: true, nativeBalance: balance, amount: max + need / 10n, need })).toBe(true);
  });
});

describe("walletFeeFloor: per chain, from what wallets attach there", () => {
  it("keeps Base at the 2 gwei seen on issues #23 and #27", () => {
    expect(walletFeeFloor(ChainKeys.BASE_MAINNET)).toBe(2n * GWEI);
  });

  it("does not hold cheap L2s to Base's 2 gwei", () => {
    for (const chain of [ChainKeys.ARBITRUM_MAINNET, ChainKeys.OPTIMISM_MAINNET, ChainKeys.BSC_MAINNET, ChainKeys.HYPEREVM_MAINNET, ChainKeys.ROBINHOOD_MAINNET]) {
      expect(walletFeeFloor(chain)).toBe(GWEI / 10n);
    }
    // A sell on Arbitrum is refused only under 0.000007 ETH, not 0.0002.
    expect(floorNeed(ChainKeys.ARBITRUM_MAINNET, false, false, "sell")).toBe(7_000_000_000_000n);
  });

  it("meets Polygon's enforced 30 gwei tip, and keeps 2 gwei for an EVM chain not yet measured", () => {
    expect(walletFeeFloor(ChainKeys.POLYGON_MAINNET)).toBe(30n * GWEI);
    expect(walletFeeFloor(ChainKeys.LIGHTLINK_MAINNET)).toBe(DEFAULT_WALLET_FEE_FLOOR);
  });

  it("never refuses a native Max on any listed chain", () => {
    for (const chain of [ChainKeys.ARBITRUM_MAINNET, ChainKeys.POLYGON_MAINNET, ChainKeys.AVALANCHE_MAINNET, ChainKeys.BASE_MAINNET]) {
      const need = blockingNeed({ chainKey: chain, need: undefined, approval: false })!;
      const balance = 10n ** 17n;
      const max = balance - evmFeeFloorBuffer(chain);
      expect(orderGasShort({ chainKey: chain, isNative: true, nativeBalance: balance, amount: max, need })).toBe(false);
    }
  });
});

describe("gasToAdd", () => {
  const BASE = ChainKeys.BASE_MAINNET;
  const need = DEFAULT_WALLET_FEE_FLOOR * GATE_SELL_GAS; // 0.0002 ETH

  it("names what is missing, rounded up to two significant digits", () => {
    const toAdd = gasToAdd({ chainKey: BASE, isNative: false, nativeBalance: need - 37_123_000_000_000n, amount: 0n, need });
    expect(toAdd).toBe(38_000_000_000_000n); // 0.000038 ETH
  });

  it("counts the amount when the order pays in the native token itself", () => {
    expect(gasToAdd({ chainKey: BASE, isNative: true, nativeBalance: need, amount: 5n * 10n ** 14n, need })).toBe(5n * 10n ** 14n);
  });

  it("is nothing when nothing is missing, unknown, or Privy pays", () => {
    expect(gasToAdd({ chainKey: BASE, isNative: false, nativeBalance: need, amount: 0n, need })).toBeUndefined();
    expect(gasToAdd({ chainKey: BASE, isNative: false, nativeBalance: undefined, amount: 0n, need })).toBeUndefined();
    expect(gasToAdd({ chainKey: BASE, isNative: false, nativeBalance: 0n, amount: 0n, need: undefined })).toBeUndefined();
    expect(gasToAdd({ chainKey: BASE, isNative: false, nativeBalance: 0n, amount: 0n, need, sponsored: true })).toBeUndefined();
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
    expect(floorNeed(base, false, true, "sell")).toBeUndefined();
  });
  it("leaves the unsponsored gate exactly as it was", () => {
    expect(payTokenGas({ chainKey: base, isNative: false, nativeBalance: 0n, need: undefined })).toBe("short");
    expect(orderGasShort({ chainKey: base, isNative: false, nativeBalance: 0n, amount: 0n, need: 1n })).toBe(true);
  });
});
