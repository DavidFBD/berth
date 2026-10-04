import { findBenchmark, DEFAULT_BENCHMARK } from "@/lib/benchmarks";
import type { Marks } from "@/lib/benchmark";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { addDays, type IsoDay } from "@/lib/marks";
import { weeklyRef, weeklyWindow, type WeeklyWindow } from "@/lib/weekly-window";
export { WEEKLY_SEND_DAYS, isoWeekKey, weeklyRef, weeklyWindow, type WeeklyWindow } from "@/lib/weekly-window";
import { formatPercentChange, percentChange } from "@/lib/performance";
import { formatUsd } from "@/lib/format";
import { getSql } from "@/lib/server/db";
import { weeklyHasContent, type WeeklyNotice } from "@/lib/server/email/compose";
import { deliver, weeklyDailyCap, type DeliverOutcome, type NoticeInput } from "@/lib/server/email/send";
import { primaryEmailSql, recordUnsent, sendableAddress, sendsToday, suppressedAmong } from "@/lib/server/email/store";
import { readMarks } from "@/lib/server/marks";
import { loadListingOrders, loadPortfolioDays } from "@/lib/server/portfolio";
import { storedComparison } from "@/lib/server/portfolio-view";

/**
 * The weekly summary: opt in (email_prefs kind 'weekly', off by default,
 * lib/email-kinds), one email about the week before, sent from the morning
 * run (lib/server/morning) because Hobby allows no third cron.
 *
 * WHEN. The week is an ISO week, Monday to Sunday in UTC. Its summary goes
 * out on the Monday after, and a person it did not reach (the day's cap, a
 * provider error, the stage's deadline) is tried again on the Tuesday, Wednesday
 * and Thursday mornings; after that the week is let go. One email per person
 * per week: email_sends type 'weekly', ref `<ISO week>:<user id>`
 * ("2026-W39:…"), claimed as every notice is (lib/server/email/store).
 *
 * WHAT. Only numbers the app already shows, from what is stored, never a
 * live read: the account's value at the week's last stored close
 * (portfolio_days), its change over the week and the S&P 500 fund's over
 * the same days as the chart's one week range tells them
 * (lib/server/portfolio-view storedComparison, the same arithmetic, the
 * same refusals), each holding on that day with its price's move over the
 * week (stored closes, marks), and counts of what happened: orders filled,
 * how many of those were limit orders, limit orders expired, new friends
 * and Salutes. Whatever the app would not tell is
 * left out, and a week with nothing to say sends nothing.
 *
 * The S&P 500 fund is the benchmark because the benchmark a person picks
 * in the app is kept in their browser, not on the server.
 */

/** At most this many holdings are listed, largest first. */
export const WEEKLY_MAX_HOLDINGS = 8;
/**
 * How many people a morning looks at for each summary its share of the cap
 * still allows: a week with nothing to say, or a person who cannot be
 * sent, sends nothing and takes no room, so the stage reads past them.
 */
export const WEEKLY_BATCH_FACTOR = 4;
/** email_sends.error for a week that had nothing to say: that person is done for the week. */
export const WEEKLY_EMPTY = "empty";
/** A holding worth less than this is dust and is not listed. */
const HOLDING_FLOOR_USD = 0.01;

/** "21 September", or with the weekday "Friday 25 September", in UTC. */
function dayLabel(day: IsoDay, weekday: boolean): string {
  return new Intl.DateTimeFormat("en-GB", {
    ...(weekday ? { weekday: "long" as const } : {}),
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
}

/** The stored close on `day` or the nearest market day before it, with its date. */
function closeOnOrBefore(marks: Marks | undefined, day: IsoDay): { day: IsoDay; close: number } | undefined {
  if (!marks) return undefined;
  let found: { day: IsoDay; close: number } | undefined;
  for (let index = 0; index < marks.dates.length; index += 1) {
    if (marks.dates[index] <= day) found = { day: marks.dates[index], close: marks.values[index] };
    else break;
  }
  return found;
}

const NAME_BY_SYMBOL = new Map(TOKEN_LISTINGS.map((listing) => [listing.symbol, listing.name]));
const LISTING_SYMBOL_LIST = TOKEN_LISTINGS.map((listing) => listing.symbol);

type Counts = {
  /**
   * Of the week's filled orders (the `orders` rows the Filled line counts,
   * by the same time and the same listings, lib/server/order-marks), how
   * many were limit orders: a part of that count, never added to it, so a
   * filled limit order is told once, as the app's order log shows it.
   */
  limitsFilled: number;
  limitsExpired: number;
  friendsAdded: number;
  salutes: number;
};

/** Everything countable about the week, in one round trip. */
async function readCounts(userId: string, window: WeeklyWindow): Promise<Counts> {
  const rows = (await getSql().query(
    `select
       (select count(*)::int from orders where user_id = $1 and order_type = 'limit' and listing_symbol = any($4::text[])
           and coalesce(filled_at, placed_at, created_at) >= $2 and coalesce(filled_at, placed_at, created_at) < $3) as limits_filled,
       (select count(*)::int from limit_orders where user_id = $1 and status = 'expired' and closed_at >= $2 and closed_at < $3) as limits_expired,
       (select count(*)::int from friends where (a_id = $1 or b_id = $1) and since >= $2 and since < $3) as friends_added,
       (select count(*)::int from salutes where recipient_id = $1 and revoked_at is null and first_at >= $2 and first_at < $3) as salutes`,
    [userId, window.from.toISOString(), window.to.toISOString(), LISTING_SYMBOL_LIST],
  )) as {
    limits_filled: number;
    limits_expired: number;
    friends_added: number;
    salutes: number;
  }[];
  const row = rows[0];
  return {
    limitsFilled: row.limits_filled,
    limitsExpired: row.limits_expired,
    friendsAdded: row.friends_added,
    salutes: row.salutes,
  };
}

/** One person's summary of `window`, from stored data only. */
export async function weeklyNotice(userId: string, window: WeeklyWindow): Promise<WeeklyNotice> {
  const benchmark = findBenchmark(DEFAULT_BENCHMARK)!;
  // One name for the fund in the whole email: the listing's, as the holdings name it.
  const benchmarkName = NAME_BY_SYMBOL.get(benchmark.symbol) ?? benchmark.name;
  const end = window.to.getTime();
  const [allDays, allOrders, counts] = await Promise.all([
    loadPortfolioDays(userId),
    loadListingOrders(userId),
    readCounts(userId, window),
  ]);
  // The week as it stood at its end: nothing stored or ordered after it.
  const days = allDays.filter((day) => day.day <= window.sunday);
  const orders = allOrders.filter((order) => Date.parse(order.placedAt) < end);
  const last = days.at(-1);
  const lastInWeek = last && last.day >= window.monday ? last : undefined;

  let account: WeeklyNotice["account"] = null;
  let holdings: WeeklyNotice["holdings"] = [];
  let holdingsRest: WeeklyNotice["holdingsRest"] = null;
  if (lastInWeek && lastInWeek.value > 0) {
    const symbols = [...new Set([benchmark.symbol, ...orders.map((order) => order.symbol), ...days.flatMap((day) => day.holdings.map((h) => h.symbol))])];
    const marks = await readMarks(symbols);
    const week = storedComparison({ days, orders, benchmark, marks }).ranges["1w"];
    // The chart's one week range, and only when it ends on this week's close.
    const told = week && week.days.at(-1)?.day === lastInWeek.day ? week : undefined;
    const change = told?.changePct ?? null;
    const benchmarkPct = told && told.benchmarkStatus === "ok" ? told.benchmarkPct : null;
    account = {
      worth: formatUsd(lastInWeek.value),
      change: change === null ? null : formatPercentChange(change),
      benchmark: change !== null && benchmarkPct !== null ? { name: benchmarkName, change: formatPercentChange(benchmarkPct) } : null,
    };

    // Each holding's move starts where the account's change does: the chart's one week range's first
    // close when a change is told (after a holiday that can be the Monday), else the last close before
    // the week, read on or before that day as the benchmark's is. A start close older than a week before
    // the Monday (a gap in a listing's closes) would span more than the week, so that move is left out.
    const start = told?.since ?? addDays(window.monday, -1);
    const oldest = addDays(window.monday, -7);
    const worthy = lastInWeek.holdings
      .map((holding) => ({ holding, worth: holding.quantity * holding.price, name: NAME_BY_SYMBOL.get(holding.symbol) }))
      .filter((entry) => entry.worth >= HOLDING_FLOOR_USD)
      .sort((a, b) => b.worth - a.worth);
    const listed = worthy.filter((entry): entry is typeof entry & { name: string } => Boolean(entry.name)).slice(0, WEEKLY_MAX_HOLDINGS);
    // Whatever is not listed (past the largest, or not a listing Berth names) is still told, as a count and a worth,
    // so the list never quietly falls short of the account's worth.
    const rest = worthy.filter((entry) => !listed.includes(entry as (typeof listed)[number]));
    holdingsRest = rest.length > 0 ? { count: rest.length, worth: formatUsd(rest.reduce((sum, entry) => sum + entry.worth, 0)) } : null;
    holdings = listed.map(({ holding, worth, name }) => {
        const from = closeOnOrBefore(marks[holding.symbol], start);
        const to = closeOnOrBefore(marks[holding.symbol], lastInWeek.day);
        // Both closes stored, the last one inside the week and the first no older than the week before it.
        const move = from && to && from.day >= oldest && to.day >= window.monday ? percentChange(from.close, to.close) : undefined;
        return { name, worth: formatUsd(worth), move: move === undefined ? null : formatPercentChange(move) };
      });
  }

  const inWeek = orders.filter((order) => Date.parse(order.placedAt) >= window.from.getTime());
  const buys = inWeek.filter((order) => order.direction === "buy").length;
  const sells = inWeek.length - buys;

  return {
    type: "weekly",
    weekOf: dayLabel(window.monday, false),
    closeDay: lastInWeek ? dayLabel(lastInWeek.day, true) : null,
    account,
    holdings,
    holdingsRest,
    orders:
      buys + sells + counts.limitsExpired > 0
        ? { buys, sells, limitsFilled: Math.min(counts.limitsFilled, buys + sells), limitsExpired: counts.limitsExpired }
        : null,
    friends: counts.friendsAdded + counts.salutes > 0 ? { added: counts.friendsAdded, salutes: counts.salutes } : null,
  };
}

/**
 * The people this morning's stage may write to: the switch on, the account
 * not merged away, a verified primary email that is not suppressed, and no
 * summary of this week sent, under way, found empty ('empty') or already
 * tried this morning (UTC day). Everyone not yet tried this week comes
 * first, oldest switch first; whoever a failed build or send left behind
 * comes after them, so nobody who cannot be sent can hold the front of the
 * queue morning after morning.
 */
async function candidates(window: WeeklyWindow, limit: number): Promise<string[]> {
  const rows = (await getSql().query(
    `select p.user_id, (${primaryEmailSql("p.user_id")}) as address
       from email_prefs p
       join users u on u.id = p.user_id and u.retired_into is null
       left join email_sends s on s.type = 'weekly' and s.ref = $1 || ':' || p.user_id::text
      where p.kind = 'weekly' and p.enabled
        and exists (${primaryEmailSql("p.user_id")})
        and (s.id is null
             or (s.status = 'failed' and s.error is distinct from $3
                 and s.created_at < date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'))
      order by (s.id is not null), p.updated_at, p.user_id
      limit $2`,
    [window.key, limit, WEEKLY_EMPTY],
  )) as { user_id: string; address: string | null }[];
  // The address as the send will read it (lib/server/email/store), and the suppression list checked the same way.
  // Anyone dropped here is recorded for the day, so they sort behind the untried tomorrow and never hold the front of the queue.
  const dropped: { userId: string; reason: "no_address" | "suppressed" }[] = [];
  const people = rows.flatMap((row) => {
    const address = sendableAddress(row.address);
    if (!address) dropped.push({ userId: row.user_id, reason: "no_address" });
    return address ? [{ userId: row.user_id, address }] : [];
  });
  const suppressed = await suppressedAmong(people.map((person) => person.address));
  for (const person of people) {
    if (suppressed.has(person.address)) dropped.push({ userId: person.userId, reason: "suppressed" });
  }
  await Promise.all(
    dropped.map(({ userId, reason }) =>
      recordUnsent(userId, "weekly", weeklyRef(window, userId), reason).catch(() => undefined),
    ),
  );
  return people.filter((person) => !suppressed.has(person.address)).map((person) => person.userId);
}

export type WeeklyRunSummary = {
  /** The ISO week summarised, or null on a morning that sends none. */
  week: string | null;
  sent: number;
  /** Opted in, but the week had nothing the app would tell. */
  empty: number;
  /** Not sent for another reason (a provider error, the switch turned off meanwhile); tried again tomorrow within the week. */
  notSent: number;
  /** Left for tomorrow: the stage's deadline, or the day's share of the cap. */
  deferred: number;
};

/**
 * The morning stage. Reads up to WEEKLY_BATCH_FACTOR people for each
 * summary the weekly share of the day's cap (EMAIL_WEEKLY_DAILY_CAP,
 * lib/server/email/send) still allows, and sends until that share is
 * sent or the deadline comes. Every outcome but a send is recorded
 * (recordUnsent): an empty week is done for the week, anything else is
 * tried again the next morning within the week, after the people not yet
 * tried. Whoever the deadline or the share left is tried the next morning.
 */
export async function runWeeklySummaries({
  now = new Date(),
  deadline = Number.POSITIVE_INFINITY,
  clock = Date.now,
  build = weeklyNotice,
  send = deliver,
}: {
  now?: Date;
  deadline?: number;
  clock?: () => number;
  build?: (userId: string, window: WeeklyWindow) => Promise<WeeklyNotice>;
  send?: (input: NoticeInput) => Promise<DeliverOutcome>;
} = {}): Promise<WeeklyRunSummary> {
  const window = weeklyWindow(now);
  const summary: WeeklyRunSummary = { week: window?.key ?? null, sent: 0, empty: 0, notSent: 0, deferred: 0 };
  if (!window) return summary;
  const room = weeklyDailyCap() - (await sendsToday("weekly"));
  if (room <= 0) return summary;
  const people = await candidates(window, room * WEEKLY_BATCH_FACTOR);
  for (const [index, userId] of people.entries()) {
    if (summary.sent >= room || clock() >= deadline) {
      summary.deferred += people.length - index;
      break;
    }
    const ref = weeklyRef(window, userId);
    let outcome: DeliverOutcome;
    try {
      const notice = await build(userId, window);
      if (!weeklyHasContent(notice)) {
        summary.empty += 1;
        await recordUnsent(userId, "weekly", ref, WEEKLY_EMPTY);
        continue;
      }
      outcome = await send({ userId, ref, notice });
    } catch (error) {
      console.warn("[weekly] summary failed", error instanceof Error ? error.name : "error");
      summary.notSent += 1;
      // Recorded, so tomorrow it comes after everyone not yet tried; the claim itself (a failed send) is recorded by deliver.
      await recordUnsent(userId, "weekly", ref, "build").catch(() => undefined);
      continue;
    }
    if (outcome === "sent") summary.sent += 1;
    else if (outcome === "daily_volume" || outcome === "off") {
      // The day is full, or sending stopped: nobody after this one goes out today either.
      summary.deferred += people.length - index;
      break;
    } else {
      summary.notSent += 1;
      // Refused before any claim (no address, suppressed, switched off meanwhile): recorded the same way.
      if (outcome === "no_address" || outcome === "suppressed" || outcome === "pref_off") {
        await recordUnsent(userId, "weekly", ref, outcome).catch(() => undefined);
      }
    }
  }
  return summary;
}
