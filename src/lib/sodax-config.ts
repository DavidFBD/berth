import { ChainKeys, type SodaxOptions } from "@sodax/sdk";
import type { SodaxWalletConfig } from "@sodax/wallet-sdk-react";

/**
 * SDK config. SodaxOptions is a DeepPartial over the SDK's baked-in mainnet
 * defaults (chains, solver + relayer endpoints), so we only override what we
 * must. Both configs are module constants on purpose: SodaxProvider tracks
 * its config by reference and SodaxWalletProvider freezes it on first render.
 */
export const sodaxConfig: SodaxOptions = {};

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
  },
  SOLANA: solanaRpcUrl
    ? { chains: { [ChainKeys.SOLANA_MAINNET]: { rpcUrl: solanaRpcUrl } } }
    : {},
  SUI: {},
  BITCOIN: {},
  STELLAR: {},
  ICON: {},
  INJECTIVE: {},
  NEAR: {},
  STACKS: {},
};

/** Slippage tolerance applied to solver quotes, in percent. */
export const DEFAULT_SLIPPAGE_PCT = 0.5;
