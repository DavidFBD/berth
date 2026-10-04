import {
  ChainKeys,
  getSupportedSolverTokens,
  isBitcoinChainKeyType,
  isEvmChainKeyType,
  spokeChainConfig,
  type SpokeChainKey,
  type XToken,
} from "@sodax/sdk";
import { getAddress, isAddress } from "viem";
import { sonic } from "viem/chains";
import { isTokenListingAddress } from "@/lib/listings";

/**
 * Chains a deposit can originate from, in picker display order. Hedera is
 * supported by the protocol but its production solver token list is empty
 * today, so it can't source a fillable deposit.
 */
export const DEPOSIT_SOURCE_CHAINS: readonly SpokeChainKey[] = [
  ChainKeys.ETHEREUM_MAINNET,
  ChainKeys.ARBITRUM_MAINNET,
  ChainKeys.BASE_MAINNET,
  ChainKeys.OPTIMISM_MAINNET,
  ChainKeys.POLYGON_MAINNET,
  ChainKeys.BSC_MAINNET,
  ChainKeys.AVALANCHE_MAINNET,
  ChainKeys.SONIC_MAINNET,
  ChainKeys.SOLANA_MAINNET,
  ChainKeys.SUI_MAINNET,
  ChainKeys.BITCOIN_MAINNET,
  ChainKeys.STELLAR_MAINNET,
  ChainKeys.INJECTIVE_MAINNET,
  ChainKeys.ICON_MAINNET,
  ChainKeys.NEAR_MAINNET,
  ChainKeys.STACKS_MAINNET,
  ChainKeys.HYPEREVM_MAINNET,
  ChainKeys.LIGHTLINK_MAINNET,
  ChainKeys.KAIA_MAINNET,
  ChainKeys.REDBELLY_MAINNET,
];

/**
 * Names people know where the SDK's own differs: it calls HyperEVM "Hyper",
 * which reads as a typo in "a little HYPE on Hyper". Display only; nothing
 * keys on a chain's display name.
 */
const CHAIN_NAME_OVERRIDES: Partial<Record<SpokeChainKey, string>> = {
  [ChainKeys.HYPEREVM_MAINNET]: "HyperEVM",
};

export function getChainName(chainKey: SpokeChainKey): string {
  return CHAIN_NAME_OVERRIDES[chainKey] ?? spokeChainConfig[chainKey]?.chain.name ?? chainKey;
}

export function getChainLogo(chainKey: SpokeChainKey): string | undefined {
  return spokeChainConfig[chainKey]?.chain.logo;
}

/**
 * Tokens offered in the deposit source picker for a chain: the production
 * solver set (anything else validates locally but can never be filled),
 * minus everything the house itself offers as a destination: the lsoda*
 * vault share tokens, and the stock and cash listings. The SDK lists the
 * shares as solver-tradeable on Sonic, and a future release will list the
 * stocks too; neither makes sense as something to pour IN, since selling a
 * listing is the sell path's job, not the deposit picker's.
 */
export function getDepositTokens(chainKey: SpokeChainKey): readonly XToken[] {
  const tokens = getSupportedSolverTokens(chainKey).filter(
    (token) =>
      !token.symbol.startsWith("lsoda") &&
      !isTokenListingAddress(token.address),
  );
  if (chainKey !== ChainKeys.SONIC_MAINNET) return tokens;
  return tokens.map(displayToken);
}

/**
 * An XToken under the name HUB_VAULT_DISPLAY gives it when it is one of the
 * hub's own vault wrappers, unchanged otherwise (and undefined stays
 * undefined). getDepositTokens applies this to every Sonic token the picker
 * shows; server code that resolves a token through a different SDK call
 * (`sodax.config.getXTokenFromHubAsset`) must apply the same override, since
 * 2.2 renamed the vaults to the coin they hold and nothing else re-derives
 * the stored pay_symbol afterward.
 */
export function displayToken<T extends XToken | undefined>(token: T): T {
  if (!token) return token;
  const shown = HUB_VAULT_DISPLAY[token.address.toLowerCase()];
  return (shown ? { ...token, ...shown } : token) as T;
}

/**
 * The hub's vault tokens on Sonic, under the names they had up to
 * @sodax/sdk 2.0.0. From 2.2 the SDK calls them by the coin they hold
 * (sodaBTC became "BTC", sodaSOL "SOL"), which would put the real coin's
 * name and logo on what is a hub wrapper of it, and price it as the coin
 * where Berth has only checked sodaBTC (lib/orders PAY_PRICE_IDS). Keyed by
 * lowercase address; only symbol and name change, so every payload keeps
 * the SDK's own token.
 */
const HUB_VAULT_DISPLAY: Readonly<Record<string, Pick<XToken, "symbol" | "name">>> = {
  "0x40cd41b35db9e5109ae7e54b44de8625db320e6b": { symbol: "sodaBNB", name: "Soda BNB" },
  "0x14238d267557e9d799016ad635b53cd15935d290": { symbol: "sodaAVAX", name: "Soda AVAX" },
  "0x7a1a5555842ad2d0ed274d09b5c4406a95799d5d": { symbol: "sodaBTC", name: "Soda BTC" },
  "0xdea692287e2ce8cb08fa52917be0f16b1dacdc87": { symbol: "sodaSOL", name: "Soda SOL" },
  "0x6bc8c37cba91f76e68c9e6d689a9c21e4d32079b": { symbol: "sodaXLM", name: "Soda XLM" },
  "0x1f22279c89b213944b7ea41dacb0a868ddcdfd13": { symbol: "sodaINJ", name: "Soda INJ" },
  "0xdc5b4b00f98347e95b9f94911213dab4c687e1e3": { symbol: "sodaSUI", name: "Soda SUI" },
  "0x208ed38f4783328aa9ebfec360d32e7520a9b779": { symbol: "sodaPOL", name: "Soda POL" },
  "0x6e81124fc5d2bf666b16a0a5d90066ebf35c7411": { symbol: "sodaHYPE", name: "Soda HYPE" },
  "0x4b207114f9118deac56436e1ae3c45648783c7ac": { symbol: "sodaRBNT", name: "Soda RBNT" },
  "0x14c5eb2d25dfb834852dfc85744875d1ecb09748": { symbol: "sodaLL", name: "Soda LL" },
  "0xcb6b152d3a943f25157381afca7fefcd2ef5a357": { symbol: "sodaWEETH", name: "SODA WEETH" },
  "0x58b0538d7eeaee69ef32f9f1de5cbf32a10a977b": { symbol: "sodaWSTETH", name: "SODA WSTETH" },
  "0xf4ba497c9b805e4bd88a8a9e6a7b8f74984c3e39": { symbol: "sodaNEAR", name: "SODA NEAR" },
  "0xd7d41b5f803b6a40f8a6eaa34e459a4564e39891": { symbol: "sodaKAIA", name: "Soda KAIA" },
  "0x1fbe5229e9d189f26bee77e5bfa24309fda90483": { symbol: "sodaSTX", name: "Soda STX" },
  "0x3bb956cc8922e1ba4148dc10ed1b4fa19aa599c4": { symbol: "sodaHBAR", name: "Soda HBAR" },
  "0xe1bad4400d947bc4fa66f9c0a143d800002083a0": { symbol: "sodaJITOSOL", name: "Soda JITOSOL" },
};

/**
 * The chain's native (gas) token as an XToken, when the solver list carries
 * it. A pour FROM a chain is an on-chain transaction there, so the sending
 * wallet needs a non-zero native balance to cover the network fee.
 *
 * Bitcoin has none in this sense: the fee comes out of the BTC being sent
 * (lib/gas-need calls it `free`), so there is no separate balance to gate
 * on. Up to @sodax/sdk 2.0.0 that held by accident, since Bitcoin's
 * nativeToken was 'BTC' and matched no solver token; from 2.2 it is '0:0',
 * BTC's own address, so it is said here on purpose.
 */
export function getNativeGasToken(chainKey: SpokeChainKey): XToken | undefined {
  if (isBitcoinChainKeyType(chainKey)) return undefined;
  const nativeAddress = spokeChainConfig[chainKey]?.nativeToken;
  if (!nativeAddress) return undefined;
  return getDepositTokens(chainKey).find(
    (token) => token.address === nativeAddress,
  );
}

/**
 * A person's address as the SDK must be handed it: on an EVM chain (Sonic
 * included), in its EIP-55 checksum. From @sodax/sdk 2.2 encodeAddress
 * rejects mixed case with a wrong checksum, where 2.0.0 passed it through.
 * Only for addresses a wallet or the chain gave us; a typed address is
 * checked strictly first (isTypedEvmAddress), so a typo is refused rather
 * than mended. Any other family, or anything not hex, is returned as is.
 */
export function sdkAddress(chainKey: SpokeChainKey, address: string): string {
  if (!isEvmChainKeyType(chainKey) || !isAddress(address, { strict: false })) return address;
  return getAddress(address);
}

/**
 * Whether a typed EVM address can be sent to: all lower case, or mixed case
 * with a correct checksum. A mixed case address with a wrong checksum is
 * most likely mistyped, so it is refused, as the 2.2 SDK would.
 */
export function isTypedEvmAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address) && isAddress(address, { strict: true });
}

/**
 * The SDK registry ships some EVM addresses with broken EIP-55 casing
 * (Polygon WBTC + LINK in @sodax/sdk 2.0.0; clean in 2.2.0-rc.8, kept as a guard). viem rejects a bad checksum
 * while ENCODING the multicall, which fails every token in the batch and
 * makes the whole chain read as zero balances. Re-checksum for balance
 * reads only — quote/deposit payloads keep the registry's original casing,
 * since the SDK and solver match tokens by exact string.
 *
 * EVM-only: every other chain family has its own address shape (a Sui coin
 * type like `0x2::sui::SUI` also starts with `0x`, a Stacks token pairs a
 * `SP…` principal with a contract and asset name, …) and none of it is a
 * viem address, so `isAddress`/`getAddress` must never see it. Route on the
 * token's own chain, not on how its address happens to look.
 */
export function toBalanceReadToken(token: XToken): XToken {
  if (!isEvmChainKeyType(token.chainKey)) return token;
  if (!token.address.startsWith("0x") || isAddress(token.address))
    return token;
  return { ...token, address: getAddress(token.address.toLowerCase()) };
}

/** A transaction on the Sonic hub, on the explorer viem knows for Sonic. */
export function hubTxUrl(txHash: string): string {
  return `${sonic.blockExplorers.default.url}/tx/${txHash}`;
}

/**
 * A transaction on a source chain, where the order machine has a reason to
 * point someone at it: today only Bitcoin, whose payment can take an hour to
 * reach Sonic and is followed on mempool.space meanwhile.
 */
export function spokeTxUrl(
  chainKey: SpokeChainKey,
  txHash: string,
): string | undefined {
  return isBitcoinChainKeyType(chainKey)
    ? `https://mempool.space/tx/${txHash}`
    : undefined;
}
