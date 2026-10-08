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
  gasModel,
  gasToAdd,
  gasNeed,
  orderGasShort,
  payTokenGas,
  trustedNativeBalance,
  walletFeeFloor,
  walletReserve,
  warnReserve,
  floorWarns,
  paidSendNeed,
  amountLeavesNoFee,
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

  it("is the chain's own price alone; the wallet's reserve joins it in blockingNeed", () => {
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
      const maxBuffer = [feePerGas * 350_000n * 3n, evmFeeFloorBuffer(ChainKeys.BASE_MAINNET, feePerGas)].reduce((a, b) => (a > b ? a : b));
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

  it("counts the amount against the balance when the native token pays, with no slack below the need", () => {
    expect(orderGasShort({ chainKey: ChainKeys.BASE_MAINNET, isNative: true, nativeBalance: 5_000n, amount: 4_000n, need })).toBe(false);
    expect(orderGasShort({ chainKey: ChainKeys.BASE_MAINNET, isNative: true, nativeBalance: 5_000n, amount: 4_001n, need })).toBe(true);
  });

  it("refuses a typed native buy on Base that leaves less than the wallet reserves", () => {
    // The review's case: 0.000446 ETH left after the amount, the wallet needs 0.000458 at 229k gas.
    const need = blockingNeed({ chainKey: ChainKeys.BASE_MAINNET, feePerGas: 6_000_000n, approval: false })!;
    const amount = 10n ** 15n;
    const balance = amount + 446_000_000_000_000n;
    expect(orderGasShort({ chainKey: ChainKeys.BASE_MAINNET, isNative: true, nativeBalance: balance, amount, need })).toBe(true);
    expect(orderGasShort({ chainKey: ChainKeys.BASE_MAINNET, isNative: true, nativeBalance: amount + need, amount, need })).toBe(false);
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

describe("blockingNeed: what a wallet that pays its own fee reserves", () => {
  const BASE = ChainKeys.BASE_MAINNET;

  it("is gas x (2 x fee + the chain's tip) on a cheap L2, for a buy, a buy with approval and a sell", () => {
    const fee = 7_000_000n;
    expect(blockingNeed({ chainKey: BASE, feePerGas: fee, approval: false })).toBe(GATE_DEPOSIT_GAS * (2n * fee + 2n * GWEI));
    expect(blockingNeed({ chainKey: BASE, feePerGas: fee, approval: true })).toBe(
      (GATE_DEPOSIT_GAS + GATE_APPROVE_GAS) * (2n * fee + 2n * GWEI),
    );
    expect(blockingNeed({ chainKey: BASE, feePerGas: fee, approval: false, order: "sell" })).toBe(GATE_SELL_GAS * (2n * fee + 2n * GWEI));
  });

  it("covers what issue #23's wallet reserved: 229k gas at a 0.006 gwei base fee and a 2 gwei tip", () => {
    const reserved = 229_000n * (2n * 6_000_000n + 2n * GWEI); // 0.000460748 ETH
    // Even reading only the bare base fee, the gate asks more.
    expect(blockingNeed({ chainKey: BASE, feePerGas: 6_000_000n, approval: false })!).toBeGreaterThan(reserved);
    // And a native Max holds back more still, so the wallet accepts it too.
    expect(evmFeeFloorBuffer(BASE, 6_000_000n)).toBeGreaterThan(reserved);
  });

  it("covers a Base sell when the base fee climbs to 0.3 gwei", () => {
    const base = 300_000_000n;
    const reserved = 61_401n * (2n * base + 2n * GWEI);
    expect(blockingNeed({ chainKey: BASE, feePerGas: base, approval: false, order: "sell" })!).toBeGreaterThan(reserved);
  });

  it("refuses issue #27's sell, which the chain's own price alone let through", () => {
    const asked = 61_401n * (2n * GWEI + 2n * 6_000_000n); // ~0.000123 ETH
    const held = asked - 1n;
    const chainOnly = gasNeed({ chainKey: BASE, feePerGas: 7_000_000n, approval: false });
    const need = blockingNeed({ chainKey: BASE, feePerGas: 7_000_000n, approval: false, order: "sell" });
    expect(orderGasShort({ chainKey: BASE, isNative: false, nativeBalance: held, amount: 0n, need: chainOnly })).toBe(false);
    expect(orderGasShort({ chainKey: BASE, isNative: false, nativeBalance: held, amount: 0n, need })).toBe(true);
  });

  it("assumes a busy-day fee while the read is loading or failed", () => {
    expect(blockingNeed({ chainKey: BASE, feePerGas: undefined, approval: false })).toBe(
      GATE_DEPOSIT_GAS * (2n * (GWEI / 50n) + 2n * GWEI),
    );
  });

  it("keeps the chain's price where it is the larger, and is the chain's need off EVM or when Privy pays", () => {
    // A sell reserves 70k at the wallet but the chain-priced need keeps 250k x 1.5.
    const fee = 100n * GWEI;
    const chain = gasNeed({ chainKey: ChainKeys.SONIC_MAINNET, feePerGas: fee, approval: false })!;
    expect(blockingNeed({ chainKey: ChainKeys.SONIC_MAINNET, feePerGas: fee, approval: false, order: "sell" })).toBe(chain);
    expect(blockingNeed({ chainKey: ChainKeys.SOLANA_MAINNET, feePerGas: undefined, approval: false })).toBe(SOLANA_GATE_LAMPORTS);
    expect(blockingNeed({ chainKey: BASE, feePerGas: undefined, approval: false, sponsored: true })).toBe(0n);
  });

  it("refuses a buy paid in a token whose chain holds less, and lets through one that holds it", () => {
    const need = blockingNeed({ chainKey: BASE, feePerGas: 7_000_000n, approval: false })!;
    const facts = { chainKey: BASE, isNative: false, amount: 10n ** 6n } as const;
    expect(orderGasShort({ ...facts, nativeBalance: need - 1n, need })).toBe(true);
    expect(orderGasShort({ ...facts, nativeBalance: need, need })).toBe(false);
  });

  it("never refuses a sponsored order, even with an empty wallet", () => {
    const need = blockingNeed({ chainKey: BASE, feePerGas: undefined, approval: false, sponsored: true });
    expect(orderGasShort({ chainKey: BASE, isNative: false, nativeBalance: 0n, amount: 0n, need, sponsored: true })).toBe(false);
  });

  it("never refuses a native Max, even after the fee triples", () => {
    const fee = 7_000_000n;
    const balance = 10n ** 16n;
    const max = balance - evmFeeFloorBuffer(BASE, fee);
    const later = blockingNeed({ chainKey: BASE, feePerGas: 3n * fee, approval: false })!;
    expect(orderGasShort({ chainKey: BASE, isNative: true, nativeBalance: balance, amount: max, need: later })).toBe(false);
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
    // A sell on Arbitrum at a 0.02 gwei fee is refused only under 0.0000098 ETH.
    expect(walletReserve({ chainKey: ChainKeys.ARBITRUM_MAINNET, feePerGas: 20_000_000n, approval: false, order: "sell" })).toBe(
      9_800_000_000_000n,
    );
  });

  it("meets Polygon's enforced 30 gwei tip, and keeps 2 gwei for an EVM chain not yet measured", () => {
    expect(walletFeeFloor(ChainKeys.POLYGON_MAINNET)).toBe(30n * GWEI);
    expect(walletFeeFloor(ChainKeys.LIGHTLINK_MAINNET)).toBe(DEFAULT_WALLET_FEE_FLOOR);
  });

  it("never refuses a native Max on any listed chain, read or not", () => {
    for (const chain of [ChainKeys.ARBITRUM_MAINNET, ChainKeys.POLYGON_MAINNET, ChainKeys.AVALANCHE_MAINNET, ChainKeys.BASE_MAINNET]) {
      for (const fee of [undefined, GWEI / 100n, 50n * GWEI]) {
        const need = blockingNeed({ chainKey: chain, feePerGas: fee, approval: false })!;
        const balance = 10n ** 18n;
        const max = balance - evmFeeFloorBuffer(chain, fee);
        expect(orderGasShort({ chainKey: chain, isNative: true, nativeBalance: balance, amount: max, need })).toBe(false);
      }
    }
  });
});

describe("floorWarns: the band between the gate and a wallet attaching 2 gwei", () => {
  const ARB = ChainKeys.ARBITRUM_MAINNET;
  const fee = 20_000_000n;
  const need = blockingNeed({ chainKey: ARB, feePerGas: fee, approval: false, order: "sell" })!;
  const warnNeed = warnReserve({ chainKey: ARB, feePerGas: fee, approval: false, order: "sell" })!;
  const facts = { chainKey: ARB, isNative: false, amount: 0n, need, warnNeed } as const;

  it("warns an Arbitrum wallet that clears the gate but not 2 gwei, the review's 0.0001 ETH case", () => {
    expect(warnNeed).toBe(GATE_SELL_GAS * (2n * fee + 2n * GWEI));
    const balance = 10n ** 14n; // 0.0001 ETH
    expect(orderGasShort({ ...facts, nativeBalance: balance })).toBe(false);
    expect(floorWarns({ ...facts, nativeBalance: balance })).toBe(true);
  });

  it("says nothing once 2 gwei is covered, or when the order is refused anyway", () => {
    expect(floorWarns({ ...facts, nativeBalance: warnNeed })).toBe(false);
    expect(floorWarns({ ...facts, nativeBalance: need - 1n })).toBe(false);
    expect(floorWarns({ ...facts, nativeBalance: undefined })).toBe(false);
  });

  it("has no band where the floor is already 2 gwei or more, off EVM, or when Privy pays", () => {
    expect(warnReserve({ chainKey: ChainKeys.BASE_MAINNET, feePerGas: fee, approval: false })).toBeUndefined();
    expect(warnReserve({ chainKey: ChainKeys.POLYGON_MAINNET, feePerGas: fee, approval: false })).toBeUndefined();
    expect(warnReserve({ chainKey: ChainKeys.SOLANA_MAINNET, feePerGas: undefined, approval: false })).toBeUndefined();
    expect(warnReserve({ chainKey: ARB, feePerGas: fee, approval: false, sponsored: true })).toBeUndefined();
  });

  it("keeps Max clear of the warning, and at no less than the old 0.0003 ETH hold-back", () => {
    const buyWarn = warnReserve({ chainKey: ARB, feePerGas: fee, approval: false })!;
    const buyNeed = blockingNeed({ chainKey: ARB, feePerGas: fee, approval: false })!;
    const balance = 10n ** 16n;
    const max = balance - evmFeeFloorBuffer(ARB, fee);
    expect(floorWarns({ chainKey: ARB, isNative: true, nativeBalance: balance, amount: max, need: buyNeed, warnNeed: buyWarn })).toBe(false);
    expect(evmFeeFloorBuffer(ARB, fee)).toBeGreaterThanOrEqual(300_000_000_000_000n);
  });
});

describe("paidSendNeed: the embedded wallet's paid fallback", () => {
  it("uses the transaction's own gas, fee and value when it carries them", () => {
    expect(paidSendNeed({ chainKey: ChainKeys.BASE_MAINNET, gas: 100_000n, maxFeePerGas: 10_000_000n, feePerGas: undefined, value: 5n })).toBe(
      1_000_000_000_005n,
    );
  });

  it("falls back to the chain's own price, with no wallet tip, and is unknown without one", () => {
    const fee = 7_000_000n;
    expect(paidSendNeed({ chainKey: ChainKeys.BASE_MAINNET, gas: undefined, maxFeePerGas: undefined, feePerGas: fee })).toBe(
      gasNeed({ chainKey: ChainKeys.BASE_MAINNET, feePerGas: fee, approval: false }),
    );
    expect(paidSendNeed({ chainKey: ChainKeys.BASE_MAINNET, gas: undefined, maxFeePerGas: undefined, feePerGas: undefined })).toBeUndefined();
  });
});

describe("amountLeavesNoFee", () => {
  it("blames the typed amount only when the gas token pays and the balance alone covers the fee", () => {
    expect(amountLeavesNoFee({ isNative: true, nativeBalance: 1_000n, need: 400n })).toBe(true);
    expect(amountLeavesNoFee({ isNative: true, nativeBalance: 300n, need: 400n })).toBe(false);
    expect(amountLeavesNoFee({ isNative: false, nativeBalance: 1_000n, need: 400n })).toBe(false);
    expect(amountLeavesNoFee({ isNative: true, nativeBalance: undefined, need: 400n })).toBe(false);
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
    expect(walletReserve({ chainKey: base, feePerGas: undefined, approval: true, sponsored: true })).toBeUndefined();
    expect(walletReserve({ chainKey: base, feePerGas: undefined, approval: false, sponsored: true, order: "sell" })).toBeUndefined();
  });
  it("leaves the unsponsored gate exactly as it was", () => {
    expect(payTokenGas({ chainKey: base, isNative: false, nativeBalance: 0n, need: undefined })).toBe("short");
    expect(orderGasShort({ chainKey: base, isNative: false, nativeBalance: 0n, amount: 0n, need: 1n })).toBe(true);
  });
});
