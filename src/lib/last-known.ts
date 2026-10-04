import { HOME_STAGES, type HomeStage, type StageDecision } from "@/lib/home-stage";
import { CASH_SYMBOL } from "@/lib/nudge";
import { TOKEN_LISTINGS } from "@/lib/listings";

/**
 * What the home last showed for an account, kept on the server so the next
 * visit, on any device, opens on figures instead of skeletons while the
 * live reads (the hub, a dozen networks, the oracle) arrive. Shown marked
 * as updating, never as live, and replaced part by part as each live part
 * is known (components/board/account-total, holdings-list, cash-shelf,
 * funds-module). Never used to decide money: a buy, a sell, the gas gate
 * and every amount in a drawer read live, as before.
 *
 * Two sources, newest first: the home's own last proven reading (saved by
 * the browser once every part of it was read live, app/api/account/
 * last-known), else the account's latest daily snapshot (portfolio_days,
 * written by the evening job), which knows stocks and cash but not funds.
 */

export type LastKnownHolding = {
  symbol: string;
  /** Tokens held, as a plain number: display only. */
  quantity: number;
  /** Dollars at the price of the reading; null when it had none. */
  worth: number | null;
};

export type LastKnownSnapshot = {
  v: 1;
  stage: HomeStage;
  /** Each part of the account's figure; null when the reading did not know it. */
  stocks: number | null;
  cash: number | null;
  funds: number | null;
  waiting: number | null;
  /** The stocks and funds held (cash has its own shelf), in the registry's order, as the live list draws them. */
  holdings: LastKnownHolding[];
};

export type LastKnown = {
  snapshot: LastKnownSnapshot;
  /** When it was read, epoch ms. */
  asOf: number;
  /** "live": the home's own reading. "day": the evening job's daily snapshot. */
  source: "live" | "day";
};

const MAX_HOLDINGS = 60;
/** Far above any account; a figure past it is not a reading. */
const MAX_USD = 1e10;
const ORDER = TOKEN_LISTINGS.map((listing) => listing.symbol);
const KNOWN_SYMBOLS = new Set(ORDER);

function figure(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_USD) return undefined;
  return value;
}

/** A snapshot from the wire, or null for anything that is not one. The server stores only what passes. */
export function parseSnapshot(value: unknown): LastKnownSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (input.v !== 1) return null;
  const stage = HOME_STAGES.find((candidate) => candidate === input.stage);
  if (!stage) return null;
  const stocks = figure(input.stocks);
  const cash = figure(input.cash);
  const funds = figure(input.funds);
  const waiting = figure(input.waiting);
  if (stocks === undefined || cash === undefined || funds === undefined || waiting === undefined) return null;
  if (!Array.isArray(input.holdings) || input.holdings.length > MAX_HOLDINGS) return null;
  const holdings: LastKnownHolding[] = [];
  for (const entry of input.holdings) {
    if (!entry || typeof entry !== "object") return null;
    const row = entry as Record<string, unknown>;
    if (typeof row.symbol !== "string" || !KNOWN_SYMBOLS.has(row.symbol)) return null;
    const quantity = figure(row.quantity);
    const worth = figure(row.worth);
    if (quantity === undefined || quantity === null || worth === undefined) return null;
    holdings.push({ symbol: row.symbol, quantity, worth });
  }
  return { v: 1, stage, stocks, cash, funds, waiting, holdings };
}

/**
 * The evening job's daily snapshot as a last-known reading: what the
 * account held at that close, at that close's prices. It never knew funds
 * or money waiting in orders, so those stay unknown.
 */
export function snapshotFromDay(holdings: readonly { symbol: string; quantity: number; price: number }[]): LastKnownSnapshot {
  let stocks = 0;
  let cash = 0;
  const rows: LastKnownHolding[] = [];
  for (const holding of holdings) {
    if (!(holding.quantity > 0) || !Number.isFinite(holding.price)) continue;
    const worth = holding.quantity * holding.price;
    if (holding.symbol === CASH_SYMBOL) {
      cash += worth;
      continue;
    }
    stocks += worth;
    rows.push({ symbol: holding.symbol, quantity: holding.quantity, worth });
  }
  // The live list's order (the registry's), so nothing moves when it lands.
  rows.sort((a, b) => ORDER.indexOf(a.symbol) - ORDER.indexOf(b.symbol));
  return {
    v: 1,
    // A daily snapshot is only kept for an account that held something.
    stage: rows.length > 0 ? "owns" : cash > 0 ? "funded" : "empty",
    stocks,
    cash,
    funds: null,
    waiting: null,
    holdings: rows,
  };
}

const cents = (value: number | null) => (value === null ? null : Math.round(value * 100));

/** Whether two readings would draw the same page, to the cent. */
export function sameSnapshot(a: LastKnownSnapshot, b: LastKnownSnapshot): boolean {
  if (a.stage !== b.stage) return false;
  if (cents(a.stocks) !== cents(b.stocks) || cents(a.cash) !== cents(b.cash)) return false;
  if (cents(a.funds) !== cents(b.funds) || cents(a.waiting) !== cents(b.waiting)) return false;
  if (a.holdings.length !== b.holdings.length) return false;
  return a.holdings.every((row, index) => {
    const other = b.holdings[index];
    return row.symbol === other.symbol && row.quantity === other.quantity && cents(row.worth) === cents(other.worth);
  });
}

/** A reading unchanged this long is saved again anyway, so "as of" stays near the truth. */
export const RESAVE_AFTER_MS = 30 * 60_000;

/** Whether a fresh live reading should replace the one the server keeps. */
export function shouldSave(saved: LastKnown | null | undefined, next: LastKnownSnapshot, now: number): boolean {
  if (!saved || saved.source !== "live") return true;
  const aged = now - saved.asOf >= RESAVE_AFTER_MS;
  // A reading that could not finish its funds (a network unread) does not
  // wipe a recent one that did; once that one has aged, it may.
  if (next.funds === null && saved.snapshot.funds !== null && !aged) return false;
  if (!sameSnapshot(saved.snapshot, next)) return true;
  return aged;
}

/** A part of the account's figure as drawn: live when known, else last known and marked so. */
export type ShownPart = { value: number | undefined; lastKnown: boolean };

export function shownPart(live: number | undefined, lastKnown: number | null | undefined): ShownPart {
  if (live !== undefined) return { value: live, lastKnown: false };
  if (lastKnown !== null && lastKnown !== undefined) return { value: lastKnown, lastKnown: true };
  return { value: undefined, lastKnown: false };
}

/**
 * Where the home stands, and where that came from. A proven live stage
 * always wins. Short of one, this browser's own memory and the account's
 * last reading keep the page in the order it had, the further along of the
 * two when they differ (another device may have bought since this one
 * remembered), so a holder whose reads are slow is never shown Add money.
 * Only then a provisional live stage (one that failed or slow networks
 * stand between it and certainty). Anything not proven live is drawn
 * marked as updating.
 */
export function decideHomeStage({
  live,
  remembered,
  lastKnown,
}: {
  live: StageDecision;
  remembered: HomeStage | undefined;
  lastKnown: LastKnown | null | undefined;
}): { stage: HomeStage | undefined; source: "live" | "remembered" | "lastKnown" | "provisional" | "none" } {
  if (live.proven && live.stage) return { stage: live.stage, source: "live" };
  const known = lastKnown?.snapshot.stage;
  if (remembered && (!known || HOME_STAGES.indexOf(remembered) >= HOME_STAGES.indexOf(known))) {
    return { stage: remembered, source: "remembered" };
  }
  if (known) return { stage: known, source: "lastKnown" };
  if (live.stage) return { stage: live.stage, source: "provisional" };
  return { stage: undefined, source: "none" };
}
