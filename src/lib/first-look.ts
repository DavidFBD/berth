import { adviceShaped } from "@/lib/advice-shaped";
import { STOCK_LISTINGS } from "@/lib/listings";
import type { NewsItem } from "@/lib/news";

export { adviceShaped };

/**
 * A first look at a stock, for someone about to make their first buy, and
 * on the first stock's card (2026-10-01).
 *
 * No one else's words sit beside Buy. Not a headline, not a post, not a
 * quote: a blocklist cannot tell advice from news reliably enough for that
 * spot (the delta red team, 2026-10-01, got 44 of 60 new advice headlines
 * past one). So the look says only Berth's own fixed lines:
 *
 *   "NVIDIA is in today's news."   Jev read today's headlines about it and
 *                                  at least one is about the company, reports
 *                                  something, and is not shaped like advice.
 *                                  A quiet link opens the news drawer, which
 *                                  keeps its own rules.
 *   "Nothing in today's news about NVIDIA."
 *                                  Jev read today's headlines and none passed.
 *   a move, in code's numbers      when the last trading day's move was large
 *                                  for the listing. No post, no cause.
 *
 * And nothing at all when Jev did not read a listing's headlines: "nothing in
 * the news" is said only of news that was actually looked at.
 */

/** How surely Jev must read a headline as mainly about the company (the column keeps a named one from 0.35). */
export const FIRST_LOOK_ABOUT_FLOOR = 0.8;

/** The examples the first buy offers (components/home-next-step); fixed, never chosen by the news. */
export const FIRST_LOOK_SYMBOLS = ["SPY", "NVDA", "AAPL", "TSLA"] as const;

/** Whether two moments fall on the same calendar day in New York. */
export function sameNewYorkDay(a: number, b: number): boolean {
  const day = (at: number) => new Date(at).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return day(a) === day(b);
}

/** What one listing's look found. */
export type FirstLook = {
  /** Jev read every one of today's headlines about it, so "in" or "nothing" may be said. */
  looked: boolean;
  /** At least one of today's headlines passed (only meaningful when `looked`). */
  inNews: boolean;
  /** The last trading day's change, percent, when it was large for this listing; from the marks, never Jev. */
  movePct?: number;
};

export type FirstLookResponse = {
  /** False when Jev is not configured: nothing was looked at. */
  judged: boolean;
  /** When the look was made, epoch ms, so the page never says "today" of yesterday's answer. */
  asOf: number;
  /** Only the listings whose feeds were read. */
  looks: Record<string, FirstLook>;
};

/**
 * Whether today's headlines about `symbol` let the look speak, and what it
 * may say. `items` are what the news column's reader returned for it, after
 * Jev (a kept headline carries `verdict` and `about`; one Jev did not read
 * carries neither). `read` is how many headlines Jev answered for in that
 * read.
 */
export function judgeToday({
  symbol,
  items,
  read,
  now = Date.now(),
}: {
  symbol: string;
  items: readonly NewsItem[];
  read: number;
  now?: number;
}): { looked: boolean; inNews: boolean } {
  const today = items.filter((item) => item.symbol === symbol && item.publishedAt <= now && sameNewYorkDay(item.publishedAt, now));
  // Any of today's headlines unread, or nothing read at all: Jev did not look.
  if (read === 0 || today.some((item) => item.verdict === undefined)) return { looked: false, inNews: false };
  const inNews = today.some(
    (item) =>
      (item.verdict === "material" || item.verdict === "fact") &&
      item.about !== undefined &&
      item.about >= FIRST_LOOK_ABOUT_FLOOR &&
      !adviceShaped(item.title),
  );
  return { looked: true, inNews };
}

/**
 * What the page may show for one listing, right now:
 *   loading  the answer is on its way: hold the box's place
 *   hidden   nothing to say: no key, a failure, a listing not looked at and
 *            no large move, or an answer from an earlier New York day
 *   shown    the look, with whichever lines are true
 */
export type FirstLookState =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "shown"; look: FirstLook };

export function lookStateFor({
  symbol,
  data,
  loading,
  now = Date.now(),
}: {
  symbol: string;
  data: FirstLookResponse | undefined;
  loading: boolean;
  now?: number;
}): FirstLookState {
  if (!data) return loading ? { kind: "loading" } : { kind: "hidden" };
  if (!data.judged || !sameNewYorkDay(data.asOf, now)) return { kind: "hidden" };
  const look = data.looks?.[symbol];
  if (!look || (!look.looked && look.movePct === undefined)) return { kind: "hidden" };
  return { kind: "shown", look };
}

/**
 * The listings one look reads: the first buy's examples, plus at most one
 * more stock (the first stock card's, when it is none of them). Anything that
 * is not a stock on Berth is ignored.
 */
export function firstLookSymbols(also?: string | null): string[] {
  const symbols: string[] = [...FIRST_LOOK_SYMBOLS];
  const extra = also?.trim().toUpperCase();
  if (extra && !symbols.includes(extra) && STOCK_LISTINGS.some((listing) => listing.symbol === extra)) symbols.push(extra);
  return symbols;
}
