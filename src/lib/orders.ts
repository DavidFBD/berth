import { decodeAbiParameters, formatUnits } from "viem";

/**
 * An order as Berth remembers it, and the pure reading of an intent into one.
 *
 * No fetching and no `@/` imports, so the backfill script can load this file
 * with Node's type stripping as it is (scripts/orders-backfill.mjs).
 *
 * What an intent says, measured against a real one (2026-09-21, a Cash buy):
 * `inputAmount` is what reaches the solver, 1.992 USDC; the partner fee
 * rides separately in `data`, 0.008, so the person paid 2.000; the listing
 * arrives as `outputToken`, at least `minOutputAmount` of it; and the exact
 * quantity is only in the fill, as an ERC-20 Transfer of the listing token
 * to the hub wallet (0.018910 against a minimum of 0.018740).
 */

export type OrderRecord = {
  intentTx: string;
  fillTx: string | null;
  direction: "buy" | "sell";
  walletAddress: string | null;
  /** intent.srcAddress, any family: lowercased when hex, as given otherwise (base58 is case sensitive). */
  srcAddress?: string | null;
  /**
   * intent.dstAddress, lowercased when hex: the wallet the output was delivered to.
   * On a buy this is exactly where the fill's Transfer landed, and the one
   * place the thirty day hold check reads the balance (lib/server/holds).
   */
  deliveredTo: string | null;
  listingSymbol: string;
  listingAddress: string;
  /** Decimal units of the listing: received on a buy, sold on a sell. */
  quantity: string | null;
  minQuantity: string | null;
  /** What the person paid with (buy) or asked to be paid in (sell). */
  paySymbol: string | null;
  payChain: string | null;
  /** Decimal units of the paying token, fee included on a buy. */
  payAmount: string | null;
  feeAmount: string | null;
  /**
   * Dollars paid, fee included. Exact for a stablecoin; otherwise the pay
   * token's DefiLlama price at the minute of the order times the amount.
   * Null when neither is known, never a guess.
   */
  usdValue: string | null;
  /** How `usdValue` was reached: "stable", "price", or null when it is null. */
  usdSource: "stable" | "price" | null;
  placedAt: Date | null;
  filledAt: Date | null;
  /**
   * Where the stock token sits for this order (orders.holding_chain): a
   * buy, where it arrived; a sell, where it left from. Never the payout
   * chain of a sell, which is `payChain`. Read from the intent only
   * (holdingChainOf), so every writer stores the same truth.
   */
  holdingChain: HoldingChain;
};

/**
 * The chains a listing's stock token can sit on for Berth: the Sonic hub
 * (the listing's own vault token, every order before Robinhood Chain) and
 * Robinhood Chain (chain 4663, the native Robinhood stock token in the
 * person's own wallet). The values are the SDK chain keys, exactly what
 * orders.holding_chain's check allows; never a chain id.
 */
export type HoldingChain = "sonic" | "robinhood";

/**
 * SODAX relay chain ids, as an intent's srcChain and dstChain carry them.
 * Pinned here rather than read from the SDK so this file keeps no imports
 * the backfill scripts cannot load; lib/orders.test holds them to the
 * SDK's own map (getSpokeChainKeyFromIntentRelayChainId).
 */
export const SONIC_RELAY_CHAIN_ID = 146n;
export const ROBINHOOD_RELAY_CHAIN_ID = 21071n;

function relayId(value: bigint | number | string | undefined): bigint | null {
  if (value === undefined) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/**
 * Where an order's stock token sits, from the intent alone: a buy
 * delivered on Robinhood Chain (dstChain 21071) holds there, and so does a
 * sell paid from Robinhood Chain (srcChain 21071). Everything else is the
 * hub. The one place orders.holding_chain is derived (plan, carried into
 * P2a): readOrder sets it on every record, and the backfill scripts call it
 * for theirs.
 */
export function holdingChainOf(
  direction: "buy" | "sell",
  intent: { srcChain?: bigint | number | string; dstChain?: bigint | number | string },
): HoldingChain {
  const leg = direction === "buy" ? relayId(intent.dstChain) : relayId(intent.srcChain);
  return leg === ROBINHOOD_RELAY_CHAIN_ID ? "robinhood" : "sonic";
}

/** What a listing needs to be found from an intent: its Sonic vault address and, where it has one, its Robinhood Chain hub asset. */
export type IntentListing = { address: string; rhHubAsset?: string };

/**
 * The listing an intent buys (its output) or sells (its input), or
 * undefined. On the hub that token is the listing's own Sonic address. On
 * Robinhood Chain an intent names the listing's hub asset there
 * (`rhHubAsset`, the SDK's robinhood supportedTokens), and only together
 * with that chain: a buy whose output is the hub asset must be delivered on
 * Robinhood Chain, a sell spending it must come from there. A hub asset
 * delivered to the hub is not a holding Berth knows, so it is no listing.
 * The listing found is always the one with the Sonic address, which is
 * what orders.listing_address stores for both chains.
 */
export function listingOfIntent<L extends IntentListing>(
  listings: readonly L[],
  intent: { inputToken: string; outputToken: string; srcChain?: bigint | number | string; dstChain?: bigint | number | string },
  direction: "buy" | "sell",
): L | undefined {
  const ours = (direction === "buy" ? intent.outputToken : intent.inputToken).toLowerCase();
  const chain = holdingChainOf(direction, intent);
  return listings.find((listing) =>
    chain === "robinhood"
      ? !!listing.rhHubAsset && listing.rhHubAsset.toLowerCase() === ours
      : listing.address.toLowerCase() === ours,
  );
}

/** Symbols worth exactly a dollar for a cost basis. Kept short on purpose. */
const DOLLAR_STABLES = new Set(["USDC", "USDT", "USDS", "DAI", "BNUSD", "USDC.E", "USDBC"]);

export function isDollarStable(symbol: string | null | undefined): boolean {
  return symbol ? DOLLAR_STABLES.has(symbol.toUpperCase()) : false;
}

/**
 * CoinGecko ids for what people pay with that the app's own id list
 * (lib/coingecko-ids, which covers the listed ERC-20s) leaves out: each
 * chain's native coin and the staked forms seen in real orders. Checked
 * against DefiLlama's historical endpoint on 2026-09-23.
 */
const PAY_PRICE_IDS: Readonly<Record<string, string>> = {
  eth: "ethereum",
  weth: "ethereum",
  bnb: "binancecoin",
  wbnb: "binancecoin",
  avax: "avalanche-2",
  pol: "polygon-ecosystem-token",
  matic: "polygon-ecosystem-token",
  kaia: "kaia",
  sol: "solana",
  jitosol: "jito-staked-sol",
  btc: "bitcoin",
  sui: "sui",
  xlm: "stellar",
  near: "near",
  inj: "injective-protocol",
  icx: "icon",
  s: "sonic-3",
  stx: "blockstack",
  hype: "hyperliquid",
  // The hub's own form of a coin, paid from the account on Sonic. Only
  // wrappers taken as one to one with their coin: sodaBTC is the SDK's
  // soda vault for Bitcoin (SodaTokens.sodaBTC). From @sodax/sdk 2.2 the
  // SDK calls it "BTC"; lib/chains getDepositTokens gives it back its
  // sodaBTC name, which is what keeps this id live. Others stay unpriced
  // until checked.
  sodabtc: "bitcoin",
};

/** The id to price a pay token by, from this list, then the app's own. */
export function priceIdFor(
  symbol: string | null | undefined,
  known: Readonly<Record<string, string>> = {},
): string | undefined {
  if (!symbol) return undefined;
  const lower = symbol.toLowerCase();
  return PAY_PRICE_IDS[lower] ?? known[lower];
}

/**
 * The partner fee carried in an intent's `data`: a type byte of 1 (FEE),
 * then the fee as a 32-byte integer and the receiver as a 32-byte word.
 * Anything else (no data, a hook, an array) is no fee we can read: zero.
 */
export function decodeFee(data: string): bigint {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  if (hex.length < 2 + 64 || hex.slice(0, 2) !== "01") return 0n;
  return BigInt(`0x${hex.slice(2, 66)}`);
}

/**
 * Who the partner fee in an intent's `data` is paid to, lowercased, or null
 * when the data carries no fee (the same layout decodeFee reads: the
 * receiver is the low 20 bytes of the second word).
 */
export function decodeFeeReceiver(data: string): string | null {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  if (hex.length < 2 + 128 || hex.slice(0, 2) !== "01") return null;
  return `0x${hex.slice(66 + 24, 130)}`.toLowerCase();
}

export type IntentFacts = {
  inputToken: string;
  outputToken: string;
  inputAmount: bigint;
  minOutputAmount: bigint;
  srcAddress: string;
  /** Where the output is delivered: on a buy, the hub wallet the fill's Transfer goes to, or the person's own wallet on Robinhood Chain. */
  dstAddress?: string;
  /** Relay chain ids (SONIC_RELAY_CHAIN_ID, ROBINHOOD_RELAY_CHAIN_ID): where the input came from and the output goes. */
  srcChain: bigint | number | string;
  dstChain: bigint | number | string;
  data: string;
};

export type TokenFacts = { symbol: string; decimals: number; chainKey: string };

/**
 * One intent, read as an order. `listing` is the side that is ours (the
 * output of a buy, the input of a sell); `pay` is the other side, resolved
 * by the caller from the hub asset. `received` is the listing quantity from
 * the fill, when the fill has been found.
 */
export function readOrder({
  intentTx,
  direction,
  intent,
  listing,
  pay,
  received,
  fillTx,
  placedAt,
  filledAt,
  payUsdPrice,
}: {
  intentTx: string;
  direction: "buy" | "sell";
  intent: IntentFacts;
  listing: { symbol: string; address: string; decimals: number };
  pay: TokenFacts | undefined;
  received?: bigint;
  fillTx?: string | null;
  placedAt?: Date | null;
  filledAt?: Date | null;
  /** The pay token's dollar price at the order, for a buy not paid in dollars. */
  payUsdPrice?: number;
}): OrderRecord {
  const fee = decodeFee(intent.data);
  const units = (value: bigint, decimals: number) => formatUnits(value, decimals);
  const evm = /^0x[0-9a-f]{40}$/i.test(intent.srcAddress);

  let quantity: string | null;
  let minQuantity: string | null;
  let payAmount: string | null;
  if (direction === "buy") {
    quantity = received !== undefined ? units(received, listing.decimals) : null;
    minQuantity = units(intent.minOutputAmount, listing.decimals);
    payAmount = pay ? units(intent.inputAmount + fee, pay.decimals) : null;
  } else {
    // Selling spends exactly `inputAmount` of the listing. What arrives is
    // paid out on the destination chain, which this does not read, so the
    // floor is kept and the proceeds are left unknown rather than guessed.
    quantity = units(intent.inputAmount + fee, listing.decimals);
    minQuantity = null;
    payAmount = pay ? units(intent.minOutputAmount, pay.decimals) : null;
  }

  return {
    intentTx: intentTx.toLowerCase(),
    fillTx: fillTx ? fillTx.toLowerCase() : null,
    direction,
    walletAddress: evm ? intent.srcAddress.toLowerCase() : null,
    srcAddress: intent.srcAddress ? (/^0x[0-9a-fA-F]*$/.test(intent.srcAddress) ? intent.srcAddress.toLowerCase() : intent.srcAddress) : null,
    // Hex (the intent's encoding, and every EVM address) lowercases without
    // loss; anything else, a base58 payout address say, keeps its case.
    deliveredTo: intent.dstAddress
      ? /^0x[0-9a-fA-F]*$/.test(intent.dstAddress)
        ? intent.dstAddress.toLowerCase()
        : intent.dstAddress
      : null,
    listingSymbol: listing.symbol,
    listingAddress: listing.address.toLowerCase(),
    quantity,
    minQuantity,
    paySymbol: pay?.symbol ?? null,
    payChain: pay?.chainKey ?? null,
    payAmount,
    feeAmount: pay && direction === "buy" ? units(fee, pay.decimals) : null,
    ...dollars(direction, pay?.symbol, payAmount, payUsdPrice),
    placedAt: placedAt ?? null,
    filledAt: filledAt ?? null,
    holdingChain: holdingChainOf(direction, intent),
  };
}

function dollars(
  direction: "buy" | "sell",
  symbol: string | undefined,
  payAmount: string | null,
  price: number | undefined,
): { usdValue: string | null; usdSource: "stable" | "price" | null } {
  if (direction !== "buy" || payAmount === null) return { usdValue: null, usdSource: null };
  if (isDollarStable(symbol)) return { usdValue: payAmount, usdSource: "stable" };
  if (price !== undefined && Number.isFinite(price) && price > 0) {
    return { usdValue: (Number(payAmount) * price).toFixed(6), usdSource: "price" };
  }
  return { usdValue: null, usdSource: null };
}

/** The topic of the Intents contract's IntentFilled(bytes32 intentHash, (bool,uint256,uint256,bool) intentState). */
export const INTENT_FILLED_TOPIC = "0x179edcc2ff551e1336d178824736b025cc5df1a59d05fbcb69ae2de8c06433da";

/**
 * Which IntentFilled is this intent's fill, from the Intents contract's
 * logs: the intent hash is not indexed, so the caller reads every
 * IntentFilled in a block range and this keeps the ones for `intentHash`.
 * The fill that leaves nothing remaining is the one, its receivedOutput the
 * whole output (the Intents contract counts it cumulatively); with none
 * whole, the last one so far. This is how a Robinhood Chain buy is read:
 * its output leaves the hub through the asset manager, so no Transfer of
 * the listing to the buyer ever happens on Sonic (pickFill's reading).
 */
export function pickIntentFill(
  logs: readonly { transactionHash: string; data: string; blockNumber: string; topics?: readonly string[] }[],
  intentHash: string,
): { fillTx: string; received: bigint; blockNumber: number } | undefined {
  const fills: { fillTx: string; received: bigint; remaining: bigint; blockNumber: number }[] = [];
  for (const log of logs) {
    try {
      const [hash, state] = decodeAbiParameters(
        [
          { type: "bytes32" },
          {
            type: "tuple",
            components: [
              { name: "exists", type: "bool" },
              { name: "remainingInput", type: "uint256" },
              { name: "receivedOutput", type: "uint256" },
              { name: "pendingPayment", type: "bool" },
            ],
          },
        ],
        log.data as `0x${string}`,
      );
      if (hash.toLowerCase() !== intentHash.toLowerCase()) continue;
      fills.push({
        fillTx: log.transactionHash.toLowerCase(),
        received: state.receivedOutput,
        remaining: state.remainingInput,
        blockNumber: Number.parseInt(log.blockNumber, 16),
      });
    } catch {
      // not an IntentFilled we can read: skip it
    }
  }
  fills.sort((a, b) => a.blockNumber - b.blockNumber);
  const chosen = fills.find((fill) => fill.remaining === 0n) ?? fills.at(-1);
  return chosen ? { fillTx: chosen.fillTx, received: chosen.received, blockNumber: chosen.blockNumber } : undefined;
}

/** The ERC-20 Transfer event's topic. */
export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** An address as a 32-byte log topic. */
export function addressTopic(address: string): string {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

/**
 * Which Transfer is the fill. The first one after the intent to the hub
 * wallet, unless the client named its fill and that fill is among them: two
 * quick buys of the same listing would otherwise be told apart by order
 * alone. A named fill that is not among them is ignored, never trusted.
 */
export function pickFill(
  logs: readonly { transactionHash: string; data: string; blockNumber: string }[],
  claimedFillTx?: string | null,
): { fillTx: string; received: bigint; blockNumber: number } | undefined {
  const sorted = [...logs].sort(
    (a, b) => Number.parseInt(a.blockNumber, 16) - Number.parseInt(b.blockNumber, 16),
  );
  const claimed = claimedFillTx
    ? sorted.find((log) => log.transactionHash.toLowerCase() === claimedFillTx.toLowerCase())
    : undefined;
  const chosen = claimed ?? sorted[0];
  if (!chosen) return undefined;
  return {
    fillTx: chosen.transactionHash.toLowerCase(),
    received: BigInt(chosen.data),
    blockNumber: Number.parseInt(chosen.blockNumber, 16),
  };
}
