import { newYorkDate, newYorkInstant, sessionOn, shiftDate, type IsoDate } from "@/lib/market-calendar";

/**
 * When the X column may go back to X, and how much it may read, as pure
 * arithmetic so the budget can be tested without a clock, a network or a
 * database. lib/server/x-refresh does the reading; this decides whether.
 *
 * Why it is shaped like this: X bills every post it returns, once per UTC
 * day per post (measured 2026-09-30: 525 unique posts behind 16 requests of
 * up to 100 each, and the day's bill read 540). So the cost is the number
 * of distinct posts touched in a day, not the number of requests, and the
 * old design's worst habit was reading the same week of posts again every
 * morning. Posts are now kept in the database and each query only asks for
 * what is newer than the last post it saw (`since_id`); what is left to
 * decide is how many new posts a day are worth their price.
 *
 * The schedule, in New York time, from lib/market-calendar:
 *
 * - A trading day: one slot before the open (07:00), one every two hours
 *   from the open (09:30, 11:30, 13:30, 15:30) and one after the close
 *   (17:30, or 14:30 on a half day). The last slot runs until the next
 *   day's first.
 * - A weekend or holiday: one slot, at noon.
 *
 * At most one fetch per slot, claimed in the database so two instances
 * cannot both make it (the 2026-09-30 logs show /api/moves and
 * /api/listing-x fetching the same slot in the same second). A failed fetch
 * may be tried once more, five minutes later. The column's refresh button
 * gets one extra fetch per slot, of one query.
 *
 * And a hard ceiling under all of it: `X_DAILY_POST_CAP` posts per UTC day,
 * reserved in the database before a request is sent at the most it could
 * return, so the cap holds whatever the traffic. The day's budget is spread
 * over the slots still to come rather than spent by the first visitor.
 */

/** X refuses fewer than ten on recent search; the judge reads at most eight a name. */
export const MAX_RESULTS = 10;

/**
 * Posts per dollar, from the bill: 2026-09-29 read 715 posts for about
 * $3.60, which is $0.005 a post.
 */
export const POSTS_PER_DOLLAR = 200;

/** About $0.25 a day at POSTS_PER_DOLLAR. */
export const DEFAULT_DAILY_POST_CAP = 50;

/**
 * Whether this process may go to X at all: production on Vercel, or a
 * machine that says so with `X_FETCH_LOCAL=1`. The cap lives in whichever
 * database the process talks to, so a dev server or a preview would
 * otherwise spend the production column's budget (the same DATABASE_URL)
 * or open a second one on the same bill (a branch database).
 */
export function xFetchAllowedHere(env: Record<string, string | undefined> = process.env): boolean {
  if (env.X_FETCH_LOCAL === "1") return true;
  return env.NODE_ENV === "production" && env.VERCEL_ENV === "production";
}

/** The day's ceiling on posts read, from `X_DAILY_POST_CAP` when it is a sane number. */
export function dailyPostCap(env: string | undefined = process.env.X_DAILY_POST_CAP): number {
  const parsed = env === undefined || env.trim() === "" ? Number.NaN : Number(env);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_DAILY_POST_CAP;
}

const HOUR_MS = 60 * 60 * 1000;
/** The first slot of a trading day opens this long before the bell. */
export const PRE_MARKET_LEAD_MS = 2.5 * HOUR_MS;
/** The slots through the session. */
export const MARKET_EVERY_MS = 2 * HOUR_MS;
/** The after-hours slot, this long after the close. */
export const AFTER_HOURS_LAG_MS = 1.5 * HOUR_MS;
/** How long a failed fetch waits before the one retry its slot allows. */
export const RETRY_AFTER_MS = 5 * 60 * 1000;
/**
 * A claim still unfinished after this long is taken to have died (a killed
 * function, a lost connection) and may be claimed again, as one of the
 * slot's attempts. A fetch takes seconds; its requests time out at twelve.
 */
export const STALE_CLAIM_MS = 2 * 60 * 1000;
/** A slot's fetch, and its one retry. */
export const MAX_ATTEMPTS_PER_SLOT = 2;
/** The refresh button asks again only if the last fetch is older than this. */
export const REFRESH_AFTER_MS = 15 * 60 * 1000;

/** Every slot that starts on one New York calendar day, epoch ms, in order. */
export function slotStartsOn(date: IsoDate): number[] {
  const session = sessionOn(date);
  if (!session) return [newYorkInstant(date, 12, 0).getTime()];
  const open = session.open.getTime();
  const close = session.close.getTime();
  const starts = [open - PRE_MARKET_LEAD_MS];
  for (let at = open; at < close; at += MARKET_EVERY_MS) starts.push(at);
  starts.push(close + AFTER_HOURS_LAG_MS);
  return starts;
}

function startsAround(now: number): number[] {
  const today = newYorkDate(new Date(now));
  return [-1, 0, 1].flatMap((offset) => slotStartsOn(shiftDate(today, offset)));
}

export type FetchSlot = {
  /** Stable name for the slot, its start as an ISO instant. */
  key: string;
  startsAt: number;
};

/** The slot `now` falls in: the latest start at or before it. */
export function currentSlot(now: number): FetchSlot {
  const startsAt = Math.max(...startsAround(now).filter((start) => start <= now));
  return { key: new Date(startsAt).toISOString(), startsAt };
}

/** The UTC day `now` falls in, `YYYY-MM-DD`: X bills by it. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** The current slot and every one still to start before the UTC day ends. */
export function slotsLeftToday(now: number): number {
  const { startsAt } = currentSlot(now);
  const midnight = Date.parse(`${utcDay(now)}T00:00:00Z`) + 24 * HOUR_MS;
  return 1 + startsAround(now).filter((start) => start > startsAt && start < midnight).length;
}

/**
 * How many posts this fetch may read: the day's remainder shared evenly
 * over the slots left, but never less than one request's worth while one
 * request still fits, so a small cap still moves.
 */
export function allowance({
  cap,
  spent,
  slotsLeft,
}: {
  cap: number;
  spent: number;
  slotsLeft: number;
}): number {
  const remaining = cap - spent;
  if (remaining < MAX_RESULTS) return 0;
  const share = Math.floor(remaining / Math.max(1, slotsLeft));
  return Math.min(remaining, Math.max(share, MAX_RESULTS));
}

/**
 * Which queries this fetch runs: the ones that have waited longest, never
 * fetched first, as many as the allowance pays for at `MAX_RESULTS` each.
 * Ties keep the given order.
 */
export function pickQueries<Q extends { fetchedAt?: number }>(
  queries: readonly Q[],
  allowed: number,
  most = queries.length,
): Q[] {
  const count = Math.min(most, Math.floor(allowed / MAX_RESULTS));
  if (count <= 0) return [];
  return queries
    .map((query, index) => ({ query, index }))
    .sort(
      (a, b) =>
        (a.query.fetchedAt ?? -Infinity) - (b.query.fetchedAt ?? -Infinity) || a.index - b.index,
    )
    .slice(0, count)
    .map(({ query }) => query);
}

/** The larger of two X post ids. Ids are decimal strings longer than a double holds. */
export function newerId(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (a.length !== b.length) return a.length > b.length ? a : b;
  return a > b ? a : b;
}

/**
 * X's search reaches back seven days, and a `since_id` older than that is
 * refused. A query whose newest post is older than this starts again from
 * the week's best. The age is the post's own, read from its id, not when we
 * last asked: a query that matched nothing all week asked often.
 */
export const SINCE_ID_MAX_AGE_MS = 6.5 * 24 * HOUR_MS;

/** X's epoch for post ids (Snowflake): 2010-11-04T01:42:54.657Z. */
const SNOWFLAKE_EPOCH = 1_288_834_974_657n;

/** When a post was made, epoch ms, read from its id; undefined for an id that is not one. */
export function idPostedAt(id: string): number | undefined {
  if (!/^\d{1,20}$/.test(id)) return undefined;
  return Number((BigInt(id) >> 22n) + SNOWFLAKE_EPOCH);
}

/** `sinceId` while X will still take it, else undefined. */
export function usableSinceId(sinceId: string | undefined, now: number): string | undefined {
  if (sinceId === undefined) return undefined;
  const postedAt = idPostedAt(sinceId);
  return postedAt !== undefined && now - postedAt < SINCE_ID_MAX_AGE_MS ? sinceId : undefined;
}
