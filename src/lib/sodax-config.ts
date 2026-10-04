import {
  ChainKeys,
  leverageYieldVaults,
  sonicSupportedTokens,
  type EvmChainKey,
  type LeverageYieldVault,
  type PartnerFee,
  type SodaxOptions,
  type XToken,
} from "@sodax/sdk";
import type { SodaxWalletConfig } from "@sodax/wallet-sdk-react";
import { TOKEN_LISTINGS, toXToken } from "@/lib/listings";

/**
 * Partner fee on every vault swap (deposit + withdraw intents). Percentage is
 * in basis points: 40 = 0.4%. The SDK takes it once, from the input, when it
 * builds the intent, and `sodax.swaps.getQuote` deducts the same fee before it
 * asks the solver: quotes take the PRE-fee amount (lib/pour-amount
 * swapInputFor is the post-fee one, for the app's own pricing). Both read the
 * SDK's swap fee, which falls back to the global `fee` below.
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
 * Polygon's publicnode went the same way on 2026-10-04: state reads
 * answered 529 or hung past viem's ten second timeout (block numbers stayed
 * quick), so the funds sweep held the whole Funds row for 20 to 50 seconds.
 * dRPC's keyless Polygon endpoint answers the same reads in under 0.6 s and
 * serves receipts at depth.
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
  [ChainKeys.POLYGON_MAINNET]: { rpcUrl: "https://polygon.drpc.org" },
  [ChainKeys.BSC_MAINNET]: { rpcUrl: "https://bsc-dataseed.bnbchain.org" },
  [ChainKeys.AVALANCHE_MAINNET]: {
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
  },
  [ChainKeys.SONIC_MAINNET]: { rpcUrl: "https://sonic-rpc.publicnode.com" },
};

/**
 * The fourth cup, carried by hand until an SDK release brings it.
 *
 * `listVaults()` reads the SDK's STATIC registry, never the backend, and
 * @sodax/sdk 2.0.0 (and stable 2.1.0) only know three vaults. lsodaSUSDS is
 * deployed on the hub and the API already serves it from
 * `GET /v1/leverage-yield/vaults` alongside the other three, verified
 * 2026-09-15: the proxy answers `symbol() = lsodaSUSDS`, its `asset()` matches
 * the entry below, and the solver quotes both directions. The values here are
 * that response verbatim.
 *
 * Self-retiring: the append no-ops the moment the SDK's own registry carries
 * the name, so an upgrade needs no edit here, only a deletion when convenient.
 */
const LSODA_SUSDS: LeverageYieldVault = {
  name: "lsodaSUSDS",
  vault: "0x758532F160D9D338bf662A4a59BA31a5B918A7cb",
  asset: "0x243b0c26c8b38793908d7C64e8510f21B19B4613",
  borrowToken: "0xb780e09576C2667ba9F5B80FbAb2e6b8A0a21e37",
  lsdSource: {
    poolId: "d8c4eff5-c8a9-46fc-a888-057c4c668e72",
    fallbackAprPct: 3.5,
    label: "Sky (sUSDS)",
  },
};

const VAULTS: readonly LeverageYieldVault[] = leverageYieldVaults.some(
  (vault) => vault.name === LSODA_SUSDS.name,
)
  ? leverageYieldVaults
  : [...leverageYieldVaults, LSODA_SUSDS];

/**
 * The same cup, as the SDK's ConfigService needs to see it. `listVaults()` is
 * only the shelf: every quote and every deposit build first asks
 * `isValidOriginalAssetAddress(sonic, vault)`, which reads
 * `chains[sonic].supportedTokens`, and 2.0.0's Sonic table stops at three
 * lsoda tokens. Without this entry the fourth cup renders, prices and counts
 * its shares, and then the solver is never asked: `getQuote` throws
 * "unsupported token_dst" before the request leaves, so the drawer reads the
 * leaves forever (field-found 2026-09-16, a one-euro pour that never quoted;
 * verified the entry makes both directions quote). Same self-retiring guard
 * as the vault append above: the release that knows the symbol turns this
 * into an empty override.
 */
const LSODA_SUSDS_TOKEN: XToken = {
  symbol: "lsodaSUSDS",
  name: "Leveraged Soda sUSDS",
  decimals: 18,
  address: LSODA_SUSDS.vault,
  chainKey: ChainKeys.SONIC_MAINNET,
  hubAsset: LSODA_SUSDS.vault,
  vault: LSODA_SUSDS.vault,
};

/**
 * Every Sonic token the app trades that 2.0.0's table doesn't carry: the
 * fourth cup and the thirteen Robinhood listings (lib/listings), which the
 * backend serves and the chain confirms but no installed SDK release knows.
 * Keyed by symbol like the SDK's own table, and filtered by the same
 * self-retiring rule: a symbol the SDK has learned drops out here, so an
 * upgrade needs no edit. `sodax-config.test.ts` pins that every listing
 * still resolves to ITS address afterwards, which is the one way this guard
 * could go wrong: an SDK release carrying the same ticker under a different
 * wrapper's contract.
 */
const HAND_CARRIED_SONIC_TOKENS: readonly XToken[] = [
  LSODA_SUSDS_TOKEN,
  ...TOKEN_LISTINGS.map(toXToken),
];

const SONIC_TOKEN_OVERRIDES: Record<string, XToken> = Object.fromEntries(
  HAND_CARRIED_SONIC_TOKENS.filter(
    (token) => !(token.symbol in sonicSupportedTokens),
  ).map((token) => [token.symbol, token]),
);

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
 * The hub (Sonic), where every holding lives. The SDK builds its hub client
 * from its OWN hub config, not from the Sonic spoke pin above, so until
 * 2026-10-04 every hub read (hub wallet derivation, holdings, reserves,
 * pour verification on the server) went to rpc.soniclabs.com alone. That
 * endpoint answered 503 "No backend available" to every call that day, and
 * the home held its total, its parts and What you own as skeletons until a
 * retry got lucky. The SDK takes a list (RpcFailoverConfig): viem's
 * fallback transport tries them in order and moves on at the first error.
 * All three serve receipts at depth and answer CORS from the app.
 */
export const HUB_RPC_URLS = [
  "https://sonic-rpc.publicnode.com",
  "https://sonic.drpc.org",
  "https://rpc.soniclabs.com",
] as const;

/**
 * SDK config. SodaxOptions is a DeepPartial over the SDK's baked-in mainnet
 * defaults (chains, solver + relayer endpoints), so we only override what we
 * must. Both configs are module constants on purpose: SodaxProvider tracks
 * its config by reference and SodaxWalletProvider freezes it on first render.
 */
export const sodaxConfig: SodaxOptions = {
  fee: PARTNER_FEE,
  solver: { solverApiEndpoint },
  leverageYield: { vaults: VAULTS },
  // One failover round, not viem's three: React Query owns the retries above it.
  hub: { rpcUrls: HUB_RPC_URLS, rpcOptions: { retryCount: 1 } },
  chains: {
    ...PINNED_EVM_RPCS,
    [ChainKeys.SONIC_MAINNET]: {
      ...PINNED_EVM_RPCS[ChainKeys.SONIC_MAINNET],
      supportedTokens: SONIC_TOKEN_OVERRIDES,
    },
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
