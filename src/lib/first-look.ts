import { adviceShaped } from "@/lib/advice-shaped";
import { STOCK_LISTINGS } from "@/lib/listings";
import { newYorkDate, newYorkInstant, shiftDate } from "@/lib/market-calendar";
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
 *   "NVIDIA is in today's news."   a headline from today (in New York) about
 *                                  it passed: Jev read it as about the
 *                                  company, reporting something, and it is
 *                                  not shaped like advice. A quiet link opens
 *                                  the news drawer, which keeps its own rules.
 *   "NVIDIA was in the news this past week."
 *                                  none today, but one from the six New York
 *                                  days before today passed. The window rolls: it does not
 *                                  empty at midnight or over a weekend, and
 *                                  the line names the week, never "today".
 *   a move, in code's numbers      when the last trading day's move was large
 *                                  for the listing. No post, no cause.
 *
 * When nothing passed, no news line at all: never "nothing in the news". A
 * week of opinion pieces is not nothing, and an empty week is more likely a
 * stalled feed than a quiet company (the review, 2026-10-04).
 *
 * Until 2026-10-04 the window was the New York calendar day, so from
 * midnight, and all weekend, every example said "Nothing in today's news"
 * while Friday's stories sat in the store.
 */

/** How surely Jev must read a headline as mainly about the company (the column keeps a named one from 0.35). */
export const FIRST_LOOK_ABOUT_FLOOR = 0.8;

/** The examples the first buy offers (components/home-next-step); fixed, never chosen by the news. */
export const FIRST_LOOK_SYMBOLS = ["SPY", "NVDA", "AAPL", "TSLA"] as const;

/** How many New York calendar days the look reads: today and the six before it. */
export const FIRST_LOOK_DAYS = 7;

/**
 * Where the look's window starts: midnight in New York six calendar days
 * before today, so "this past week" is today and the six days before it,
 * whatever daylight saving does to the length of a day. It rolls with the
 * date, so a weekend or a quiet morning is never "nothing".
 */
export function windowStart(now: number): number {
  return newYorkInstant(shiftDate(newYorkDate(new Date(now)), -(FIRST_LOOK_DAYS - 1)), 0, 0).getTime();
}

/** Whether two moments fall on the same calendar day in New York. */
export function sameNewYorkDay(a: number, b: number): boolean {
  const day = (at: number) => new Date(at).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return day(a) === day(b);
}

/**
 * What one listing's look found. `looked` and `inNews` keep the meaning an
 * answer had before the rolling week, because a page loaded before this
 * deploy still reads them: it says "in today's news" for both, and "Nothing
 * in today's news" for `looked` alone. So both are true together, of today
 * only, or both false. The week lives in its own field, which only a page
 * that knows the week line reads.
 */
export type FirstLook = {
  /** One of today's headlines passed (always equal to `inNews`, for an older page). */
  looked: boolean;
  /** One of today's headlines (New York) passed. */
  inNews: boolean;
  /** One of the week's headlines passed, today's included. Absent on an older answer. */
  inNewsWeek?: boolean;
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

/** Whether one headline lets the look say "in the news": read by Jev, about the company, reporting something, not advice. */
export function passes(item: NewsItem): boolean {
  return (
    (item.verdict === "material" || item.verdict === "fact") &&
    item.about !== undefined &&
    item.about >= FIRST_LOOK_ABOUT_FLOOR &&
    !adviceShaped(item.title)
  );
}

/**
 * Whether the past week's headlines about `symbol` let the look speak, and
 * what it may say. `items` are the headlines the news store keeps for it in
 * the window, after Jev (a judged one carries `verdict` and `about`; one Jev
 * did not read carries neither, and so never passes). Only a passing
 * headline makes a line, so a headline not yet read cannot make one false.
 */
export function judgeRecent({
  symbol,
  items,
  now = Date.now(),
}: {
  symbol: string;
  items: readonly NewsItem[];
  now?: number;
}): Pick<FirstLook, "looked" | "inNews" | "inNewsWeek"> {
  const since = windowStart(now);
  const passed = items.filter(
    (item) => item.symbol === symbol && item.publishedAt <= now && item.publishedAt >= since && passes(item),
  );
  if (passed.length === 0) return { looked: false, inNews: false, inNewsWeek: false };
  const today = passed.some((item) => sameNewYorkDay(item.publishedAt, now));
  // Week only: `looked` and `inNews` stay false, so a page from before the week line says nothing at all.
  return { looked: today, inNews: today, inNewsWeek: true };
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
  // An answer cached from before the week line can carry looked without inNews: it says nothing now.
  if (!look || (!(look.looked && look.inNews) && !look.inNewsWeek && look.movePct === undefined)) return { kind: "hidden" };
  return { kind: "shown", look };
}

/**
 * The listings one look reads: the first buy's examples, plus at most one
 * more stock (the first stock card's, when it is none of them). Anything that
 * is not a stock on Berth is ignored.
 */
export function firstLookSymbols(also?: string | null): string[] {
  const extra = firstLookExtra(also);
  return extra ? [...FIRST_LOOK_SYMBOLS, extra] : [...FIRST_LOOK_SYMBOLS];
}

/** The one stock a look may add beyond the examples, in its registry spelling, or undefined. */
export function firstLookExtra(also?: string | null): string | undefined {
  const extra = also?.trim().toUpperCase();
  if (!extra || (FIRST_LOOK_SYMBOLS as readonly string[]).includes(extra)) return undefined;
  return STOCK_LISTINGS.some((listing) => listing.symbol === extra) ? extra : undefined;
}

/**
 * The one query string an answer is served under: none, or `?also=` a stock
 * outside the examples. Anything else (an unknown parameter, a symbol that is
 * not a stock, another spelling) is sent there first, so a random query
 * string cannot make the edge miss and read the store again.
 */
export function canonicalFirstLookSearch(params: URLSearchParams): string {
  const extra = firstLookExtra(params.get("also"));
  return extra ? `?also=${extra}` : "";
}
