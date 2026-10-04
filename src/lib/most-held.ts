import { countablePerson, holdsSomething, personOf, type AccountFact, type MostBoughtWeek } from "@/lib/social-proof";

/**
 * Most held on Berth: what share of people who own a stock or fund on Berth
 * held each listing when a week closed, said only as a rounded "1 in N" (David, 2026-10-04). The
 * sibling of Most bought (lib/social-proof) and built on the same frame: the
 * same fixed Monday to Sunday UTC weeks, the same Tuesday 00:00 publish, the
 * same stored once answer, the same rule for who may be counted. Never a
 * count, an amount or a value; never live. The pure rules live here;
 * lib/server/most-held reads the daily holdings records and stores the week.
 */

/**
 * The first week that may be counted: the week of 19 October 2026, read at
 * its close and published Tuesday 27 October. Chosen so the privacy policy
 * paragraph and the in-app notice that announce Most held (carried by the
 * legal pass) land first; no holding from before they say so is counted.
 * If they slip, move this.
 */
export const MOST_HELD_FIRST_WEEK = "2026-10-19";
/** A listing is shown only when at least this many people held it. */
export const MOST_HELD_MIN_PER_LISTING = 20;
/** The card appears only when at least this many people held any stock or fund. */
export const MOST_HELD_MIN_ACCOUNTS = 50;
/**
 * A holding counts only when it was worth at least this many dollars at the
 * day's price, the same floor Most bought puts on a buy: a sliver kept to
 * sway the count costs something real, and an unpriced holding does not count.
 */
export const MOST_HELD_MIN_HOLDING_USD = 10;
/**
 * What an account held at the week's close is its last daily record inside
 * the week, Monday to Sunday. The records are written only on trading days
 * (the evening cron runs Monday to Friday, and a market holiday has none),
 * so the close is usually Friday's, Thursday's in a week whose Friday is a
 * holiday, and an evening that missed an account still counts its record
 * from earlier that week. Nothing from before the week stands in for it.
 */
export const MOST_HELD_SNAPSHOT_DAYS = 7;
/** Listings on the card at most. */
export const MOST_HELD_SHOWN = 5;
/**
 * The only shares ever said: 1 in 2, 3, 4, 5, 10 or 20. A share is always
 * said as the larger N, so it is never more than it was; a listing held by
 * fewer than 1 in 20 is not shown.
 */
export const MOST_HELD_LADDER: readonly number[] = [2, 3, 4, 5, 10, 20];

const DAY_MS = 86_400_000;

/** The days whose records may say what an account held at `week`'s close: [from, to), as YYYY-MM-DD; the whole week. */
export function snapshotDays(week: MostBoughtWeek): { from: string; to: string } {
  return {
    from: new Date(week.end.getTime() - MOST_HELD_SNAPSHOT_DAYS * DAY_MS).toISOString().slice(0, 10),
    to: week.end.toISOString().slice(0, 10),
  };
}

/**
 * "1 in N" for `held` of `total`: the smallest N on the ladder whose share
 * is no more than the true one (held × N ≥ total, in integers, so no
 * rounding error can overstate it). Null when even 1 in 20 would be more
 * than the truth, or when there is nothing to say.
 */
export function oneIn(held: number, total: number): number | null {
  if (!(held > 0) || !(total > 0) || held > total) return null;
  for (const n of MOST_HELD_LADDER) if (held * n >= total) return n;
  return null;
}

/** One account's last record at the week's close: which listings it held and at what price. */
export type HeldFact = {
  userId: string;
  holdings: readonly { symbol: string; quantity: number; price?: number | null }[];
};

/** One row: a listing and its share as said, "1 in `oneIn`". */
export type MostHeldRow = { symbol: string; oneIn: number };

/**
 * The board's answer: the first MOST_HELD_SHOWN listings that may be
 * shown, most held first, and nothing past them; empty when nothing may be
 * shown. `week` is the counted week's Monday. The card shows these rows and
 * a listing's own line reads its row, so a listing outside them says
 * nothing anywhere: a listing held by a few planted accounts must outrank
 * what real people hold before it says anything at all.
 */
export type MostHeldResponse = { rows: MostHeldRow[]; week?: string };

/** Whether a holding counts: held, not dust, priced, and worth at least MOST_HELD_MIN_HOLDING_USD. */
export function countsAsHeld(holding: { quantity: number; price?: number | null }): boolean {
  if (!holdsSomething(holding)) return false;
  const price = holding.price;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return false;
  return holding.quantity * price >= MOST_HELD_MIN_HOLDING_USD;
}

/**
 * Listings by the share of people holding them at the week's close.
 * Counted per person (merges folded; a person holds a listing when any of
 * their accounts did), only people countablePerson allows at `windowEnd`,
 * only `listed` symbols, only holdings countsAsHeld allows.
 *
 * The base is every counted person holding at least one listed stock or
 * fund. Nothing is shown while that base is below MOST_HELD_MIN_ACCOUNTS, a
 * listing held by fewer than MOST_HELD_MIN_PER_LISTING is left out, and so is
 * one below 1 in 20. Ranked on the share as said, ties in the order of
 * `listed`, so the order says no more than the words do. Only the first
 * MOST_HELD_SHOWN rows are returned.
 */
export function rankMostHeld(
  facts: readonly HeldFact[],
  accounts: ReadonlyMap<string, AccountFact>,
  listed: readonly string[],
  windowEnd: Date,
): MostHeldRow[] {
  const eligible = countablePerson(accounts, windowEnd);
  const allowed = new Set(listed);
  const everyone = new Set<string>();
  const bySymbol = new Map<string, Set<string>>();
  for (const fact of facts) {
    const person = personOf(fact.userId, accounts);
    if (!eligible(person)) continue;
    for (const holding of fact.holdings) {
      if (!allowed.has(holding.symbol) || !countsAsHeld(holding)) continue;
      everyone.add(person);
      const people = bySymbol.get(holding.symbol) ?? new Set<string>();
      people.add(person);
      bySymbol.set(holding.symbol, people);
    }
  }
  const total = everyone.size;
  if (total < MOST_HELD_MIN_ACCOUNTS) return [];
  return listed
    .map((symbol, index) => ({ symbol, index, held: bySymbol.get(symbol)?.size ?? 0 }))
    .filter((row) => row.held >= MOST_HELD_MIN_PER_LISTING)
    .flatMap((row) => {
      const n = oneIn(row.held, total);
      return n === null ? [] : [{ symbol: row.symbol, index: row.index, oneIn: n }];
    })
    .sort((a, b) => a.oneIn - b.oneIn || a.index - b.index)
    .slice(0, MOST_HELD_SHOWN)
    .map(({ symbol, oneIn: n }) => ({ symbol, oneIn: n }));
}
