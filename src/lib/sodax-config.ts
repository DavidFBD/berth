import {
  ChainKeys,
  type EvmChainKey,
  type PartnerFee,
  type SodaxOptions,
} from "@sodax/sdk";
import type { SodaxWalletConfig } from "@sodax/wallet-sdk-react";

/**
 * Partner fee on every vault swap (deposit + withdraw intents). Percentage is
 * in basis points: 10 = 0.1%. The SDK deducts it from the input amount before
 * the swap, so quotes must run on the post-fee amount (adjustAmountByFee).
 */
export const PARTNER_FEE: PartnerFee = {
  address: "0xbe59D5bf40Ac4A349bD748E0d7c19eF27Ad3Ca23",
  percentage: 10,
};

/**
 * SDK config. SodaxOptions is a DeepPartial over the SDK's baked-in mainnet
 * defaults (chains, solver + relayer endpoints), so we only override what we
 * must. Both configs are module constants on purpose: SodaxProvider tracks
 * its config by reference and SodaxWalletProvider freezes it on first render.
 */
export const sodaxConfig: SodaxOptions = {
  fee: PARTNER_FEE,
  chains: {
    [ChainKeys.BITCOIN_MAINNET]: {
      radfi: {
        // USER mode: deposits build a PSBT straight from the personal
        // wallet's UTXOs — one signature, no Bound Exchange trading-wallet
        // funding step, and the hub wallet derives from the personal address
        // (which keeps our share-balance holders consistent). The SDK's
        // default TRADING mode would require funding a separate trading
        // wallet on-chain before every first deposit. Note: the SDK still
        // requests a one-time BIP322 auth signature per session for BTC
        // sources in either mode.
        walletMode: "USER",
      },
    },
  },
};

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const solanaRpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;

/**
 * Every chain family a deposit can originate from. An omitted slot removes
 * that family from the wallet picker; `{}` mounts it with SDK defaults.
 */
export const walletConfig: SodaxWalletConfig = {
  EVM: {
    ssr: true,
    reconnectOnMount: true,
    // WalletConnect is how mobile EVM wallets (MetaMask Mobile, Trust, Rainbow)
    // connect — EIP-6963 only discovers desktop browser extensions. Without a
    // project id the connector is skipped and extension wallets still work.
    ...(walletConnectProjectId
      ? { walletConnect: { projectId: walletConnectProjectId } }
      : {}),
    // Keyless publicnode endpoints instead of viem's baked-in defaults, which
    // are best-effort and do die — polygon-rpc.com returns 401 "tenant
    // disabled" as of 2026-07-31, silently blanking Polygon balances. Chains
    // not listed here (HyperEVM, LightLink, Kaia, Redbelly) stay on their
    // official default RPCs, which publicnode doesn't cover.
    chains: {
      [ChainKeys.ETHEREUM_MAINNET]: {
        rpcUrl: "https://ethereum-rpc.publicnode.com",
      },
      [ChainKeys.ARBITRUM_MAINNET]: {
        rpcUrl: "https://arbitrum-one-rpc.publicnode.com",
      },
      [ChainKeys.BASE_MAINNET]: { rpcUrl: "https://base-rpc.publicnode.com" },
      [ChainKeys.OPTIMISM_MAINNET]: {
        rpcUrl: "https://optimism-rpc.publicnode.com",
      },
      [ChainKeys.POLYGON_MAINNET]: {
        rpcUrl: "https://polygon-bor-rpc.publicnode.com",
      },
      [ChainKeys.BSC_MAINNET]: { rpcUrl: "https://bsc-rpc.publicnode.com" },
      [ChainKeys.AVALANCHE_MAINNET]: {
        rpcUrl: "https://avalanche-c-chain-rpc.publicnode.com",
      },
      [ChainKeys.SONIC_MAINNET]: { rpcUrl: "https://sonic-rpc.publicnode.com" },
    },
  },
  // The SDK default (api.mainnet-beta.solana.com) 403s browser dapp traffic
  // outright, which blanked the embedded wallet's SOL from the teapot.
  // Publicnode is keyless like the EVM endpoints above; env still wins.
  SOLANA: {
    chains: {
      [ChainKeys.SOLANA_MAINNET]: {
        rpcUrl: solanaRpcUrl ?? "https://solana-rpc.publicnode.com",
      },
    },
  },
  SUI: {},
  BITCOIN: {},
  STELLAR: {},
  ICON: {},
  INJECTIVE: {},
  NEAR: {},
  STACKS: {},
};

/**
 * The pinned RPC for an EVM chain, when we pin one. Consumers building their
 * own viem publicClient (the Privy bridge) must use this instead of viem's
 * baked-in default, which can be decommissioned (polygon-rpc.com) — undefined
 * falls back to the chain's default for the long-tail chains we don't pin.
 */
export function getPinnedRpcUrl(chainKey: EvmChainKey): string | undefined {
  const chains = walletConfig.EVM?.chains as
    | Partial<Record<EvmChainKey, { rpcUrl?: string }>>
    | undefined;
  return chains?.[chainKey]?.rpcUrl;
}

/** Slippage tolerance applied to solver quotes, in percent. */
export const DEFAULT_SLIPPAGE_PCT = 0.5;
