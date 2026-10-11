import { DUST_USD } from "@/lib/dust";
import { TERMS_VERSION } from "@/lib/legal-version";

/**
 * Two plain facts about what people on Berth did, in place of any score
 * (David, 2026-10-02): how many people bought each listing this week, and
 * how many of your friends hold it. Counts only: no amounts, no adjectives,
 * no arrows, nothing that reads as a call to buy. The pure rules live here;
 * lib/server/social-proof gathers the rows and caches the answers.
 */

/**
 * The week is a fixed one, Monday 00:00 to Monday 00:00 UTC, published once
 * after it ends and then kept as published (lib/server/social-proof stores
 * it), so the count never moves by one from day to day and a single buy
 * cannot be dated inside the week (M2, R1, R2 of reports/social-proof-*).
 */
export const MOST_BOUGHT_DAYS = 7;
/**
 * The first week that may be counted: the first Monday on or after the
 * policy that announced Most bought took effect (2 October 2026), so no buy
 * from before it is ever counted (R3).
 */
export const MOST_BOUGHT_FIRST_WEEK = "2026-10-05";
/**
 * A week is published this long after it ends, once the late recording has
 * settled: the evening cron's claims (22:00 UTC), limit fills and recovered
 * orders. A week ending Monday 00:00 is published Tuesday 00:00 UTC.
 */
export const MOST_BOUGHT_SETTLE_MS = 24 * 3_600_000;
/** The list shows only when at least this many people bought anything that week. */
export const MOST_BOUGHT_MIN_PEOPLE = 10;
/** A listing bought by fewer people than this is left out: small numbers mislead and can point at someone. */
export const MOST_BOUGHT_MIN_PER_LISTING = 5;
/** A buyer counts only if their account was at least this old when the week closed... */
export const MOST_BOUGHT_MIN_ACCOUNT_DAYS = 7;
/** ...and had a verified email, and this buy was at least this many dollars. */
export const MOST_BOUGHT_MIN_BUY_USD = 10;
/** Counts up to this are shown exactly; above it, rounded down to a multiple of five, with a plus. */
export const MOST_BOUGHT_EXACT_UP_TO = 10;
/** Rows on the board at most. */
export const MOST_BOUGHT_SHOWN = 5;

const DAY_MS = 86_400_000;

/** One fixed week: [start, end), Monday to Monday UTC; `label` is the Monday, "2026-10-05". */
export type MostBoughtWeek = { start: Date; end: Date; label: string };

/** The Monday 00:00 UTC on or before `at`. */
export function mondayOf(at: Date): Date {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - sinceMonday * DAY_MS);
}

function weekFrom(start: Date): MostBoughtWeek {
  return { start, end: new Date(start.getTime() + MOST_BOUGHT_DAYS * DAY_MS), label: start.toISOString().slice(0, 10) };
}

/**
 * The week the board shows at `now`: the latest week that ended at least
 * MOST_BOUGHT_SETTLE_MS ago, and none before `firstWeek` (Most bought's
 * MOST_BOUGHT_FIRST_WEEK unless another weekly count, lib/most-held, names
 * its own). Null until the first week has been published.
 */
export function publishedWeek(now: Date, firstWeek = MOST_BOUGHT_FIRST_WEEK): MostBoughtWeek | null {
  const latest = new Date(mondayOf(new Date(now.getTime() - MOST_BOUGHT_SETTLE_MS)).getTime() - MOST_BOUGHT_DAYS * DAY_MS);
  if (latest.getTime() < Date.parse(`${firstWeek}T00:00:00Z`)) return null;
  return weekFrom(latest);
}

/** When the next week will be published after `now`: the moment the shown answer changes. */
export function nextPublishAt(now: Date, firstWeek = MOST_BOUGHT_FIRST_WEEK): Date {
  const first = Date.parse(`${firstWeek}T00:00:00Z`) + MOST_BOUGHT_DAYS * DAY_MS + MOST_BOUGHT_SETTLE_MS;
  if (now.getTime() < first) return new Date(first);
  const thisWeeks = mondayOf(new Date(now.getTime() - MOST_BOUGHT_SETTLE_MS)).getTime() + MOST_BOUGHT_SETTLE_MS;
  return new Date(thisWeeks + MOST_BOUGHT_DAYS * DAY_MS);
}

/** A filled, ownership proven buy in the window: the account that placed it, the listing, and its dollar value when known. */
export type BuyFact = { userId: string; symbol: string; usd: number | null };

/**
 * An account the counting needs to know about. `retiredInto` is set when a
 * merge folded it into another (users.retired_into); `staff` when it is a
 * staff account (on STAFF_ADMIN_IDS or STAFF_VIEWER_IDS, or a verified
 * @sodax.com email); `hasEmail` when it has a verified email.
 */
export type AccountFact = { id: string; retiredInto: string | null; staff: boolean; createdAt: string; hasEmail: boolean };

/** One row: the count as shown, and whether it was rounded down ("15+"). */
export type MostBoughtRow = { symbol: string; people: number; plus: boolean };

/** The board's answer: empty when there is nothing that may be shown. `week` is the counted week's Monday. */
export type MostBoughtResponse = { rows: MostBoughtRow[]; days: number; week?: string };

/**
 * The person behind an account: the end of its merge chain. Two accounts
 * one person merged are one person, however many times they merged. A
 * chain that loops (never written, but cheap to refuse) ends where it
 * would repeat.
 */
export function personOf(id: string, accounts: ReadonlyMap<string, AccountFact>): string {
  let current = id;
  const seen = new Set<string>([current]);
  for (;;) {
    const next = accounts.get(current)?.retiredInto;
    if (!next || seen.has(next)) return current;
    seen.add(next);
    current = next;
  }
}

/** A count as the board says it: exact up to ten, then down to a multiple of five with a plus. */
export function shownCount(people: number): { people: number; plus: boolean } {
  if (people <= MOST_BOUGHT_EXACT_UP_TO) return { people, plus: false };
  return { people: Math.floor(people / 5) * 5, plus: true };
}

/**
 * Who may be counted in a weekly public count, as of `windowEnd`: a person
 * (merges folded, personOf) whose surviving account has a verified email,
 * whose oldest account was opened at least MOST_BOUGHT_MIN_ACCOUNT_DAYS
 * before `windowEnd`, and none of whose accounts is staff. One rule for
 * Most bought and Most held (lib/most-held).
 */
export function countablePerson(accounts: ReadonlyMap<string, AccountFact>, windowEnd: Date): (person: string) => boolean {
  const staffPeople = new Set<string>();
  const oldest = new Map<string, number>();
  for (const account of accounts.values()) {
    const person = personOf(account.id, accounts);
    if (account.staff) staffPeople.add(person);
    const opened = new Date(account.createdAt).getTime();
    if (Number.isFinite(opened)) oldest.set(person, Math.min(oldest.get(person) ?? Infinity, opened));
  }
  const ageCutoff = windowEnd.getTime() - MOST_BOUGHT_MIN_ACCOUNT_DAYS * DAY_MS;
  return (person) =>
    !staffPeople.has(person) && accounts.get(person)?.hasEmail === true && (oldest.get(person) ?? Infinity) <= ageCutoff;
}

/**
 * Listings ranked by how many distinct people bought them, never by volume
 * or dollars. Buys are counted per person (merges folded). A person counts
 * only if their surviving account has a verified email, the oldest of their
 * accounts was opened at least MOST_BOUGHT_MIN_ACCOUNT_DAYS before
 * `windowEnd`, and the buy itself was at least MOST_BOUGHT_MIN_BUY_USD.
 * Staff people are left out entirely (any of their accounts being staff is
 * enough), and only `listed` symbols count, so cash and anything delisted
 * never appear.
 *
 * Nothing is shown while fewer than MOST_BOUGHT_MIN_PEOPLE people counted,
 * and a listing below MOST_BOUGHT_MIN_PER_LISTING is left out. Ranked on
 * the count as shown, ties in the order of `listed`, so the order says no
 * more than the numbers do.
 */
export function rankMostBought(
  buys: readonly BuyFact[],
  accounts: ReadonlyMap<string, AccountFact>,
  listed: readonly string[],
  windowEnd: Date,
  shown = MOST_BOUGHT_SHOWN,
): MostBoughtRow[] {
  const eligible = countablePerson(accounts, windowEnd);
  const allowed = new Set(listed);
  const everyone = new Set<string>();
  const bySymbol = new Map<string, Set<string>>();
  for (const buy of buys) {
    if (!allowed.has(buy.symbol)) continue;
    if (buy.usd === null || !(buy.usd >= MOST_BOUGHT_MIN_BUY_USD)) continue;
    const person = personOf(buy.userId, accounts);
    if (!eligible(person)) continue;
    everyone.add(person);
    const people = bySymbol.get(buy.symbol) ?? new Set<string>();
    people.add(person);
    bySymbol.set(buy.symbol, people);
  }
  if (everyone.size < MOST_BOUGHT_MIN_PEOPLE) return [];
  return listed
    .map((symbol, index) => ({ symbol, exact: bySymbol.get(symbol)?.size ?? 0, index }))
    .filter((row) => row.exact >= MOST_BOUGHT_MIN_PER_LISTING)
    .map((row) => ({ ...row, ...shownCount(row.exact) }))
    .sort((a, b) => b.people - a.people || a.index - b.index)
    .slice(0, shown)
    .map(({ symbol, people, plus }) => ({ symbol, people, plus }));
}

/** How long a friend's last daily value still counts as what they hold now. */
export const FRIEND_HOLDINGS_MAX_AGE_DAYS = 3;
/** Up to this many friends, the line names them; past it, only the count. */
export const FRIEND_NAMES_SHOWN = 2;

/** Up to this many friends' faces sit under a line; past it, "+N" with the rest of the count. */
export const FRIEND_FACES_SHOWN = 4;

/**
 * A friend whose card is shown, with what their last daily value held.
 * `avatarId` and `level` are what their card and the viewer's friends list
 * already show; absent in pure tests that only count.
 */
export type FriendHoldingsFact = {
  handle: string;
  avatarId?: string | null;
  level?: number;
  holdings: readonly { symbol: string; quantity: number; price?: number | null }[];
};

/**
 * One friend's face beside a line: their username (the face's accessible
 * label), their avatar and their rank level, exactly as their card shows
 * them to this viewer. Never XP, never an amount.
 */
export type FriendFace = { handle: string; avatarId: string | null; level: number };

/**
 * One listing's line: how many friends hold it, their usernames when there
 * are few, and up to FRIEND_FACES_SHOWN of their faces, sorted by username.
 */
export type FriendsHolding = { symbol: string; count: number; names: string[]; faces: FriendFace[] };

export type FriendsHoldingResponse = { holding: FriendsHolding[] };

/** Whether a stored holding is something a person holds: more than nothing, and not dust when priced. */
export function holdsSomething(holding: { quantity: number; price?: number | null }): boolean {
  if (!(holding.quantity > 0)) return false;
  const price = holding.price;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return true;
  return holding.quantity * price >= DUST_USD;
}

/**
 * Which listings the viewer's friends hold, by count. Never an amount: the
 * quantities are read to decide yes or no and then dropped. Names are
 * returned only while FRIEND_NAMES_SHOWN or fewer friends hold the
 * listing, sorted, so the order says nothing about who holds more.
 * Faces go to at most FRIEND_FACES_SHOWN friends per line, in the same
 * sorted order: the friends counted are exactly those whose cards already
 * tell this viewer what they hold (friendHolds), so a face says nothing
 * the viewer could not already see.
 */
export function friendsHoldingByListing(friends: readonly FriendHoldingsFact[], listed: readonly string[]): FriendsHolding[] {
  const allowed = new Set(listed);
  const bySymbol = new Map<string, Map<string, FriendFace>>();
  for (const friend of friends) {
    for (const holding of friend.holdings) {
      if (!allowed.has(holding.symbol) || !holdsSomething(holding)) continue;
      const people = bySymbol.get(holding.symbol) ?? new Map<string, FriendFace>();
      people.set(friend.handle, { handle: friend.handle, avatarId: friend.avatarId ?? null, level: friend.level ?? 1 });
      bySymbol.set(holding.symbol, people);
    }
  }
  return listed
    .filter((symbol) => bySymbol.has(symbol))
    .map((symbol) => {
      const people = [...bySymbol.get(symbol)!.values()].sort((a, b) => a.handle.localeCompare(b.handle));
      const names = people.map((person) => person.handle);
      return {
        symbol,
        count: names.length,
        names: names.length <= FRIEND_NAMES_SHOWN ? names : [],
        faces: people.slice(0, FRIEND_FACES_SHOWN).map(({ handle, avatarId, level }) => ({ handle, avatarId, level })),
      };
    });
}

/** The listings one friend holds, in the order of `listed`: what their card says, never how much. */
export function holdsListings(holdings: FriendHoldingsFact["holdings"], listed: readonly string[]): string[] {
  const held = new Set(holdings.filter(holdsSomething).map((holding) => holding.symbol));
  return listed.filter((symbol) => held.has(symbol));
}

/** The once per account in-app notice of the two counts and the new switch (lib/server/notices). */
export const SOCIAL_NOTICE_ID = "social-proof-2026-10";
/** The once per account in-app notice of the terms and privacy policy effective 5 October 2026, Most held included. */
export const POLICY_NOTICE_ID = "policy-2026-10-05";
/** Every notice an account may be told once; the server answers only these. */
export const ACCOUNT_NOTICES: readonly string[] = [SOCIAL_NOTICE_ID, POLICY_NOTICE_ID];

/**
 * When a notice has nothing to tell an account. Every notice in
 * ACCOUNT_NOTICES announces a change from a date, so an account created on
 * or after that date (UTC) met Berth as it is and is never told it is new.
 */
export type AccountNoticeRule = {
  /** The day the change took effect, ISO, UTC. */
  effectiveFrom: string;
  /** A terms version whose acceptance means the account already read what the notice says. */
  termsVersion?: string;
  /** Says nothing to an account that already shares its holdings with friends. */
  quietWhenSharingHoldings?: boolean;
};

export const ACCOUNT_NOTICE_RULES: Readonly<Record<string, AccountNoticeRule>> = {
  // Most bought and the holdings switch shipped on 2 October 2026 (d46d5ab);
  // from the 3rd every new account found the switch in onboarding.
  [SOCIAL_NOTICE_ID]: { effectiveFrom: "2026-10-03", quietWhenSharingHoldings: true },
  // The notice names LEGAL_EFFECTIVE_DATE, so it follows TERMS_VERSION.
  [POLICY_NOTICE_ID]: { effectiveFrom: TERMS_VERSION, termsVersion: TERMS_VERSION },
};

export type NoticeAccount = {
  createdAt: Date;
  /** Notices already closed. */
  seen: ReadonlySet<string>;
  /** Terms versions this account accepted. */
  acceptedTerms: ReadonlySet<string>;
  sharesHoldings: boolean;
};

/** The notices still due for this account, in ACCOUNT_NOTICES order. */
export function dueNotices(account: NoticeAccount, rules: Readonly<Record<string, AccountNoticeRule>> = ACCOUNT_NOTICE_RULES): string[] {
  return ACCOUNT_NOTICES.filter((notice) => {
    if (account.seen.has(notice)) return false;
    const rule = rules[notice];
    if (!rule) return true;
    if (account.createdAt.getTime() >= Date.parse(`${rule.effectiveFrom}T00:00:00Z`)) return false;
    if (rule.termsVersion && account.acceptedTerms.has(rule.termsVersion)) return false;
    if (rule.quietWhenSharingHoldings && account.sharesHoldings) return false;
    return true;
  });
}
