import { formatUnits } from "viem";

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
};

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

export type IntentFacts = {
  inputToken: string;
  outputToken: string;
  inputAmount: bigint;
  minOutputAmount: bigint;
  srcAddress: string;
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
