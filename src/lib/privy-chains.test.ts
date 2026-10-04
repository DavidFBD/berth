import { describe, expect, it } from "vitest";
import { ChainKeys, getEvmViemChain, isEvmChainKeyType } from "@sodax/sdk";
import { PRIVY_DEFAULT_CHAIN, PRIVY_SUPPORTED_CHAINS } from "./privy-chains";

describe("PRIVY_SUPPORTED_CHAINS", () => {
  it("covers every EVM spoke chain exactly once", () => {
    const evmKeys = Object.values(ChainKeys).filter(isEvmChainKeyType);
    const ids = PRIVY_SUPPORTED_CHAINS.map((chain) => chain.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const key of evmKeys) {
      expect(ids).toContain(getEvmViemChain(key).id);
    }
  });

  // The regression behind issue #13: Privy's bundled registry maps id 999 to
  // the dead Zora Goerli Testnet. Our list must pin it to HyperEVM mainnet.
  it("resolves chain 999 to HyperEVM mainnet, never a testnet", () => {
    const hyper = PRIVY_SUPPORTED_CHAINS.find((chain) => chain.id === 999);
    expect(hyper?.name).toBe("HyperEVM");
    expect(hyper?.testnet).not.toBe(true);
    expect(JSON.stringify(hyper?.rpcUrls)).toContain("hyperliquid");
    expect(JSON.stringify(hyper?.rpcUrls)).not.toContain("zora");
  });

  it("hands Privy the pinned RPC where we pin one", () => {
    const polygon = PRIVY_SUPPORTED_CHAINS.find((chain) => chain.id === 137);
    expect(polygon?.rpcUrls.privyWalletOverride?.http[0]).toBe(
      "https://polygon.drpc.org",
    );
  });

  it("leaves unpinned chains on their official default RPC", () => {
    const hyper = PRIVY_SUPPORTED_CHAINS.find((chain) => chain.id === 999);
    expect(hyper?.rpcUrls.privyWalletOverride).toBeUndefined();
    expect(hyper?.rpcUrls.default.http[0]).toBe(
      "https://rpc.hyperliquid.xyz/evm",
    );
  });
});

describe("PRIVY_DEFAULT_CHAIN", () => {
  it("is the hub and a member of the supported list", () => {
    expect(PRIVY_DEFAULT_CHAIN.id).toBe(
      getEvmViemChain(ChainKeys.SONIC_MAINNET).id,
    );
    expect(PRIVY_SUPPORTED_CHAINS).toContain(PRIVY_DEFAULT_CHAIN);
  });

  // Robinhood Chain (4663) joined the SDK's EVM spoke list in 2.2.0-rc.8, so
  // it rides along here automatically (reads go live for everyone; only
  // delivery is switched). The default stays Sonic regardless.
  it("carries Robinhood Chain without disturbing the default", () => {
    expect(PRIVY_SUPPORTED_CHAINS.map((chain) => chain.id)).toContain(4663);
    expect(PRIVY_DEFAULT_CHAIN.id).not.toBe(4663);
  });
});
