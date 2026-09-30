import { TOKEN_LISTINGS, type TokenListing } from "@/lib/listings";
import { MIN_POUR_USD } from "@/lib/pour-amount";
import { THROUGH_MARKET_PCT } from "@/lib/limit-orders";

/**
 * A drafted order: what an assistant can do about money, which is to write
 * a link. The link opens Berth's own order drawer on the listing with the
 * amount filled in (the `open`, `side`, `usd` and `qty` parameters that
 * components/home reads through readDraftParams below); the person checks it, picks what to pay with,
 * and signs, or closes it. Nothing is reserved, quoted or sent here.
 *
 * Pure, so every refusal is a unit test: an unknown listing, an amount
 * outside what the drawer itself accepts, a sell larger than the holding.
 */

/** The most a single draft may name. Larger is almost certainly a typo, and the drawer would say so anyway. */
export const MAX_DRAFT_USD = 1_000_000;

/** Prefixes shorter than this never match: "a" or "ap" names too many things to guess. */
const MIN_PREFIX = 3;

/**
 * Find a token listing by ticker or plain name, case-insensitively: an
 * exact ticker or name first, then a name prefix, but only one of at least
 * three characters that fits exactly one listing. Anything vaguer is no
 * match, so a draft never lands on a listing the person did not mean.
 */
export function findTokenListing(query: string | null | undefined): TokenListing | undefined {
  const wanted = query?.trim().toLowerCase();
  if (!wanted) return undefined;
  const exact =
    TOKEN_LISTINGS.find((listing) => listing.symbol.toLowerCase() === wanted) ??
    TOKEN_LISTINGS.find((listing) => listing.name.toLowerCase() === wanted);
  if (exact) return exact;
  if (wanted.length < MIN_PREFIX) return undefined;
  const prefixed = TOKEN_LISTINGS.filter((listing) => listing.name.toLowerCase().startsWith(wanted));
  return prefixed.length === 1 ? prefixed[0] : undefined;
}

export type DraftInput = {
  listing: string;
  side: "buy" | "sell";
  /** Dollars to spend (buy) or to take out (sell). */
  usd?: number;
  /** Listing units to sell. Sells only. */
  quantity?: number;
  /** "limit" waits for `limitPrice` (lib/limit-orders); market when absent. */
  orderType?: "market" | "limit";
  /** Dollars per share: a buy fills at this or lower, a sell at this or higher. */
  limitPrice?: number;
  /** The last day a limit order waits, "YYYY-MM-DD"; until cancelled when absent. */
  expires?: string;
};

/** The most a drafted limit price may be. Past it, it is a typo. */
export const MAX_LIMIT_PRICE = 1_000_000;

/** How far ahead a drafted expiry may be, as the drawer allows (lib/limit-orders MAX_EXPIRY_DAYS). */
const MAX_EXPIRY_DAYS = 365;

/**
 * A drafted expiry, checked against the calendar in UTC: a real day, not
 * before today, within a year. The drawer reads it as the end of that day
 * in the person's own time.
 */
function expiryProblem(expires: string, now: Date): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expires);
  if (!match) return 'Give expires as a day, "YYYY-MM-DD", or leave it out for until cancelled.';
  const day = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const check = new Date(day);
  if (check.getUTCDate() !== Number(match[3]) || check.getUTCMonth() !== Number(match[2]) - 1) return "That expiry is not a real day.";
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (day < today) return "That expiry is in the past.";
  if (day - today > MAX_EXPIRY_DAYS * 86_400_000) return "A limit order may wait at most a year. Leave expires out for until cancelled.";
  return null;
}

export type DraftContext = {
  origin: string;
  /** The listing's price in dollars, when the oracle has one. */
  price?: number;
  /** What the account holds of the listing, in units; required to judge a sell. */
  held?: number;
  /**
   * Whether the caller may see holdings (berth.read). A draft only token is
   * still refused an oversized sell, but never told how much is held.
   */
  mayReadHoldings?: boolean;
  /** Whether limit orders are switched on for this account (LIMIT_ORDERS_USERS). */
  limitAllowed?: boolean;
  /** Today, for checking a drafted expiry. */
  now?: Date;
};

/** The refusal a caller without berth.read gets for a sell the holding cannot cover: no numbers, not even none. */
const SELL_TOO_LARGE_BLIND = (name: string) =>
  `This sell is more ${name} than the account holds. The person can see their holding in Berth.`;

export type Draft =
  | {
      ok: true;
      listing: TokenListing;
      side: "buy" | "sell";
      usd?: number;
      quantity?: number;
      /** What the order is worth in dollars, when it can be told. */
      approxUsd?: number;
      /** Set on a limit order: dollars per share. */
      limitPrice?: number;
      /** Set on a limit order with a last day. */
      expires?: string;
      url: string;
    }
  | { ok: false; reason: string };

function trimNumber(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

export function draftOrder(input: DraftInput, context: DraftContext): Draft {
  const listing = findTokenListing(input.listing);
  if (!listing) return { ok: false, reason: `Berth does not offer "${input.listing}". Call list_listings for what is on the board.` };

  const hasUsd = input.usd !== undefined && input.usd !== null;
  const hasQty = input.quantity !== undefined && input.quantity !== null;
  if (hasUsd === hasQty) return { ok: false, reason: "Give exactly one of usd_amount or quantity." };
  if (hasQty && input.side === "buy") return { ok: false, reason: "A buy is drafted in dollars: give usd_amount." };

  const url = new URL("/", context.origin);
  url.searchParams.set("open", listing.symbol);
  url.searchParams.set("side", input.side);

  // A limit order: only where the switch is on, only on a stock, with a
  // sane price and, when given, a real day ahead.
  let limit: { limitPrice: number; expires?: string } | undefined;
  if (input.orderType === "limit") {
    if (!context.limitAllowed) return { ok: false, reason: "Limit orders are not open on this account. Draft a market order instead." };
    if (listing.kind !== "stock") return { ok: false, reason: `A limit order is for stocks and funds, not ${listing.name}.` };
    const price = Number(input.limitPrice);
    if (input.limitPrice === undefined || input.limitPrice === null || !Number.isFinite(price) || price <= 0) {
      return { ok: false, reason: "A limit order needs limit_price, in dollars per share." };
    }
    if (price > MAX_LIMIT_PRICE) return { ok: false, reason: "That limit price is larger than a draft may be." };
    // No live price, nothing to check the limit against (lib/limit-orders
    // throughMarket): refused rather than drafted blind.
    if (context.price === undefined || !Number.isFinite(context.price) || context.price <= 0) {
      return { ok: false, reason: `There is no live price for ${listing.name} right now, so a limit order cannot be checked. Try again in a moment.` };
    }
    const slack = THROUGH_MARKET_PCT / 100;
    if (input.side === "buy" ? price > context.price * (1 + slack) : price < context.price * (1 - slack)) {
      return {
        ok: false,
        reason: `A limit ${input.side} at $${price.toFixed(2)} is ${input.side === "buy" ? "above" : "below"} today's price of $${context.price.toFixed(2)} and would fill at once at the worse price. Draft a market order instead.`,
      };
    }
    const rounded = Number(price.toFixed(2));
    if (rounded <= 0) return { ok: false, reason: "The limit price must be at least a cent." };
    if (input.expires) {
      const problem = expiryProblem(input.expires, context.now ?? new Date());
      if (problem) return { ok: false, reason: problem };
    }
    limit = { limitPrice: rounded, ...(input.expires && { expires: input.expires }) };
    url.searchParams.set("price", trimNumber(rounded, 2));
    if (input.expires) url.searchParams.set("until", input.expires);
  } else if (input.limitPrice !== undefined || input.expires !== undefined) {
    return { ok: false, reason: 'Give order_type "limit" with limit_price, or leave both out for a market order.' };
  }

  if (hasUsd) {
    const usd = Number(input.usd);
    if (!Number.isFinite(usd) || usd < MIN_POUR_USD) {
      return { ok: false, reason: `The smallest order Berth takes is $${MIN_POUR_USD}.` };
    }
    if (usd > MAX_DRAFT_USD) return { ok: false, reason: "That amount is larger than a single draft may be." };
    if (input.side === "sell") {
      if (context.held === undefined) return { ok: false, reason: "Could not read the account's holdings to check this sell." };
      const blind = context.mayReadHoldings === false;
      if (context.held <= 0) return { ok: false, reason: blind ? SELL_TOO_LARGE_BLIND(listing.name) : `The account holds no ${listing.name}.` };
      if (context.price === undefined) {
        return { ok: false, reason: `There is no live price for ${listing.name} right now, so sell by quantity instead.` };
      }
      const worth = context.held * context.price;
      if (usd > worth * 1.0001) {
        return {
          ok: false,
          reason: blind
            ? SELL_TOO_LARGE_BLIND(listing.name)
            : `The account's ${listing.name} is worth about $${worth.toFixed(2)}, less than $${usd.toFixed(2)}.`,
        };
      }
    }
    url.searchParams.set("usd", trimNumber(usd, 2));
    return { ok: true, listing, side: input.side, usd: Number(trimNumber(usd, 2)), approxUsd: usd, ...limit, url: url.toString() };
  }

  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, reason: "The quantity must be more than zero." };
  if (context.held === undefined) return { ok: false, reason: "Could not read the account's holdings to check this sell." };
  const blind = context.mayReadHoldings === false;
  if (context.held <= 0) return { ok: false, reason: blind ? SELL_TOO_LARGE_BLIND(listing.name) : `The account holds no ${listing.name}.` };
  if (quantity > context.held * 1.000001) {
    return {
      ok: false,
      reason: blind
        ? SELL_TOO_LARGE_BLIND(listing.name)
        : `The account holds ${trimNumber(context.held, 6)} ${listing.name}, less than ${trimNumber(quantity, 6)}.`,
    };
  }
  const approxUsd = context.price !== undefined ? quantity * context.price : undefined;
  if (approxUsd !== undefined && approxUsd < MIN_POUR_USD) {
    return { ok: false, reason: `That is worth under $${MIN_POUR_USD}, the smallest order Berth takes.` };
  }
  url.searchParams.set("qty", trimNumber(Math.min(quantity, context.held), 8));
  return { ok: true, listing, side: "sell", quantity: Number(trimNumber(quantity, 8)), approxUsd, ...limit, url: url.toString() };
}

/**
 * A draft as the in-app chat renders it (components/chat): the values
 * draft_order computed on the server, never the model's prose.
 */
export type DraftSummary = {
  symbol: string;
  name: string;
  side: "buy" | "sell";
  usd?: number;
  quantity?: number;
  /** What the order is worth in dollars, when it can be told. */
  approxUsd?: number;
  /** A limit order's price, dollars per share. */
  limitPrice?: number;
  /** A limit order's last day, "YYYY-MM-DD". */
  expires?: string;
};

/** The deep link's parameters, read back by the app (components/home). Pure, shared, so both ends agree. */
export type DraftParams = {
  symbol: string;
  side: "buy" | "sell";
  usd?: number;
  quantity?: number;
  /** A limit order's price (`price`), dollars per share. */
  limitPrice?: number;
  /** A limit order's last day (`until`), "YYYY-MM-DD". */
  expires?: string;
  /** The recurring plan's run this draft answers (`run`, lib/recurring runDraftUrl). */
  runId?: string;
};

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readDraftParams(params: URLSearchParams): DraftParams | null {
  const symbol = params.get("open")?.toUpperCase();
  if (!symbol) return null;
  const side = params.get("side") === "sell" ? "sell" : "buy";
  const usd = Number(params.get("usd"));
  const quantity = Number(params.get("qty"));
  const price = Number(params.get("price"));
  const limitPrice = params.has("price") && Number.isFinite(price) && price > 0 ? price : undefined;
  const until = params.get("until");
  const run = params.get("run");
  return {
    symbol,
    side,
    usd: params.has("usd") && Number.isFinite(usd) && usd > 0 ? usd : undefined,
    quantity: side === "sell" && params.has("qty") && Number.isFinite(quantity) && quantity > 0 ? quantity : undefined,
    ...(limitPrice !== undefined && {
      limitPrice,
      ...(until && /^\d{4}-\d{2}-\d{2}$/.test(until) && { expires: until }),
    }),
    ...(side === "buy" && run && RUN_ID.test(run) && { runId: run.toLowerCase() }),
  };
}
