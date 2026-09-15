import {
  ChainKeys,
  type EvmChainKey,
  type PartnerFee,
  type SodaxOptions,
} from "@sodax/sdk";
import type { SodaxWalletConfig } from "@sodax/wallet-sdk-react";

/**
 * Partner fee on every vault swap (deposit + withdraw intents). Percentage is
 * in basis points: 40 = 0.4%. The SDK deducts it from the input amount before
 * the swap, so quotes must run on the post-fee amount (adjustAmountByFee).
 * The info drawer's disclosure line derives from this value — change it here
 * and the copy follows.
 */
export const PARTNER_FEE: PartnerFee = {
  address: "0xbe59D5bf40Ac4A349bD748E0d7c19eF27Ad3Ca23",
  percentage: 40,
};

/**
 * Keyless endpoints instead of the defaults baked into viem and the SDK,
 * which are best-effort and do die — polygon-rpc.com returns 401 "API key
 * disabled, tenant disabled" as of 2026-07-31. Pinned in BOTH configs below:
 * the wallet SDK reads balances through its own clients, and the core SDK
 * builds separate clients for allowance checks and receipt polling from ITS
 * chain config (issue #12 was Polygon deposits dying on the SDK half after
 * only the wallet half was pinned). Privy inherits this table too, through
 * getPinnedRpcUrl in lib/privy-chains.
 *
 * RECEIPT lookups are the binding constraint here, not balance reads.
 * publicnode refuses eth_getTransactionReceipt on Arbitrum, Base, Optimism
 * and BSC — HTTP 403, or -32602 "Archive requests require a personal token"
 * — at ANY block age, so even a fresh confirmation poll fails. Since -32602
 * is the invalid-params code, Privy renders it as "Invalid parameters were
 * provided to the RPC method" on top of a withdraw that had ALREADY
 * SUCCEEDED, which reads to a user as money lost (field-found 2026-09-01, in
 * Privy's own modal, so the auto-reporter never saw it and there is no issue
 * number for it). Avalanche's publicnode fails worse in kind: it answers an
 * old block with a NULL receipt, a silent "not mined". Those five move to
 * official endpoints. Ethereum, Polygon and Sonic serve receipts correctly
 * at depth and stay.
 *
 * Every endpoint below is verified for eth_getTransactionReceipt at both
 * recent and 100k-block depth, and for CORS from localhost and the
 * production origin. Chains not listed (HyperEVM, LightLink, Kaia, Redbelly)
 * stay on their official default RPCs, which publicnode doesn't cover.
 */
const PINNED_EVM_RPCS: Partial<Record<EvmChainKey, { rpcUrl: string }>> = {
  [ChainKeys.ETHEREUM_MAINNET]: {
    rpcUrl: "https://ethereum-rpc.publicnode.com",
  },
  [ChainKeys.ARBITRUM_MAINNET]: { rpcUrl: "https://arb1.arbitrum.io/rpc" },
  [ChainKeys.BASE_MAINNET]: { rpcUrl: "https://mainnet.base.org" },
  [ChainKeys.OPTIMISM_MAINNET]: { rpcUrl: "https://mainnet.optimism.io" },
  [ChainKeys.POLYGON_MAINNET]: {
    rpcUrl: "https://polygon-bor-rpc.publicnode.com",
  },
  [ChainKeys.BSC_MAINNET]: { rpcUrl: "https://bsc-dataseed.bnbchain.org" },
  [ChainKeys.AVALANCHE_MAINNET]: {
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
  },
  [ChainKeys.SONIC_MAINNET]: { rpcUrl: "https://sonic-rpc.publicnode.com" },
};

/**
 * Our own mount for the keyed SODAX proxy (`app/api/sodax/[...path]`). The SDK
 * hangs `/quote`, `/status` and `/execute` off the endpoint below, so the
 * route handler receives `intent/<call>` and forwards it with the key.
 */
export const SODAX_PROXY_PATH = "/api/sodax";

/** The endpoint the proxy stands in front of, and the server's own address. */
const SOLVER_UPSTREAM = "https://api.sodax.com/v1/intent";

/** `HttpUrl` from @sodax/types, which @sodax/sdk doesn't re-export. */
type HttpUrl = `http://${string}` | `https://${string}`;

/**
 * Where solver calls go. In the browser: our own origin, so the request picks
 * up the SODAX API key server-side — a key in a client bundle is a published
 * key, and the pour's `POST /intent/execute` is a write path SODAX is turning
 * key checks on for. On the server (SSR of the provider tree, and the Sodax
 * instance in lib/server/pour-verify, which never calls the solver anyway):
 * upstream directly, since there's no origin to resolve a relative URL against.
 *
 * The cast is the template-literal type meeting a runtime string; an origin is
 * always http:// or https://.
 */
const solverApiEndpoint = (
  typeof window === "undefined"
    ? SOLVER_UPSTREAM
    : `${window.location.origin}${SODAX_PROXY_PATH}/intent`
) as HttpUrl;

/**
 * SDK config. SodaxOptions is a DeepPartial over the SDK's baked-in mainnet
 * defaults (chains, solver + relayer endpoints), so we only override what we
 * must. Both configs are module constants on purpose: SodaxProvider tracks
 * its config by reference and SodaxWalletProvider freezes it on first render.
 */
export const sodaxConfig: SodaxOptions = {
  fee: PARTNER_FEE,
  solver: { solverApiEndpoint },
  chains: {
    ...PINNED_EVM_RPCS,
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
    chains: PINNED_EVM_RPCS,
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
  return PINNED_EVM_RPCS[chainKey]?.rpcUrl;
}

/** Slippage tolerance applied to solver quotes, in percent. */
export const DEFAULT_SLIPPAGE_PCT = 0.5;

/** Basis points to a human percent: 40 → "0.4%". PartnerFee is a union; ours
 * is the percentage branch, but narrow instead of assuming. */
export const FEE_PCT_LABEL =
  "percentage" in PARTNER_FEE ? `${PARTNER_FEE.percentage / 100}%` : "small";
