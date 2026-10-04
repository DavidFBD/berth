import { getSql } from "@/lib/server/db";
import { isStaff } from "@/lib/server/social/handles";
import { SHOWN_SQL, type SocialViewer } from "@/lib/server/social/people";
import { staffRoleFor } from "@/lib/server/staff-session";
import { CASH_LISTING, STOCK_LISTINGS } from "@/lib/listings";
import { rankForXp } from "@/lib/xp";
import {
  FRIEND_HOLDINGS_MAX_AGE_DAYS,
  MOST_BOUGHT_DAYS,
  friendsHoldingByListing,
  nextPublishAt,
  publishedWeek,
  type MostBoughtWeek,
  holdsListings,
  rankMostBought,
  type AccountFact,
  type BuyFact,
  type FriendHoldingsFact,
  type FriendsHoldingResponse,
  type MostBoughtResponse,
} from "@/lib/social-proof";

/**
 * The rows behind lib/social-proof's two facts.
 *
 * "Most bought on Berth this week" reads the orders ledger: filled buys of
 * a board listing in the last seven days that are ownership proven (no row
 * in no_xp_intents, which marks a buy from where Berth is not available or
 * whose payer cannot be proven the account's), placed by a known account.
 * It counts one fixed Monday to Sunday week (UTC), published once after
 * the week ends and stored (most_bought_weeks), only buyers whose account
 * was a week old with a verified email and buys of at least $10, and rounds
 * counts above ten. It is the same for everyone and shared through the CDN
 * (app/api/most-bought).
 *
 * "Your friends hold" is per viewer, private and opt in on both sides: it
 * is answered through the social route (POST, no-store), never from a
 * shared cache, and only between friends who both turned sharing on.
 */

/** The board listings that may be counted: stocks and funds, never cash. */
export const COUNTED_SYMBOLS: readonly string[] = STOCK_LISTINGS.map((listing) => listing.symbol).filter(
  (symbol) => symbol !== CASH_LISTING.symbol,
);

/** The staff accounts named by the environment (lib/server/staff-session), lowercased. */
function staffIdsFromEnv(env: Record<string, string | undefined>): string[] {
  return `${env.STAFF_ADMIN_IDS ?? ""},${env.STAFF_VIEWER_IDS ?? ""}`
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => staffRoleFor(value, env) !== null);
}

/** Every account the buys name, every staff account, and every account their merges led into. */
async function loadAccounts(ids: readonly string[], env: Record<string, string | undefined>): Promise<Map<string, AccountFact>> {
  const accounts = new Map<string, AccountFact>();
  let pending = [...new Set(ids)];
  // A merge chain is one or two links long; the bound only guards a loop.
  for (let round = 0; round < 8 && pending.length > 0; round += 1) {
    const rows = (await getSql().query(
      `select id::text as id, retired_into::text as retired_into, email, created_at from users where id = any($1::uuid[])`,
      [pending],
    )) as { id: string; retired_into: string | null; email: string | null; created_at: string | Date }[];
    for (const row of rows) {
      accounts.set(row.id, {
        id: row.id,
        retiredInto: row.retired_into,
        staff: staffRoleFor(row.id, env) !== null || isStaff({ id: row.id, email: row.email }),
        createdAt: new Date(row.created_at).toISOString(),
        hasEmail: row.email !== null,
      });
    }
    pending = rows.map((row) => row.retired_into).filter((next): next is string => !!next && !accounts.has(next));
  }
  return accounts;
}

/** Most bought over one fixed week, uncached and unstored (loadMostBought stores it). */
export async function computeMostBought(
  week: MostBoughtWeek,
  env: Record<string, string | undefined> = process.env,
): Promise<MostBoughtResponse> {
  const empty: MostBoughtResponse = { rows: [], days: MOST_BOUGHT_DAYS, week: week.label };
  const rows = (await getSql().query(
    `select o.user_id::text as user_id, o.listing_symbol as symbol, o.usd_value::float8 as usd
     from orders o
     where o.direction = 'buy'
       and o.user_id is not null
       and o.listing_symbol = any($2::text[])
       and coalesce(o.filled_at, o.placed_at, o.created_at) >= $1::timestamptz
       and coalesce(o.filled_at, o.placed_at, o.created_at) < $3::timestamptz
       and not exists (select 1 from no_xp_intents n where n.intent_tx = o.intent_tx)`,
    [week.start.toISOString(), COUNTED_SYMBOLS, week.end.toISOString()],
  )) as { user_id: string; symbol: string; usd: number | null }[];
  const buys: BuyFact[] = rows.map((row) => ({ userId: row.user_id, symbol: row.symbol, usd: row.usd === null ? null : Number(row.usd) }));
  if (buys.length === 0) return empty;
  const accounts = await loadAccounts([...buys.map((buy) => buy.userId), ...staffIdsFromEnv(env)], env);
  return { ...empty, rows: rankMostBought(buys, accounts, COUNTED_SYMBOLS, week.end) };
}

/** The stored answer for a week (most_bought_weeks), or null if it was never published. */
async function storedWeek(label: string): Promise<MostBoughtResponse | null> {
  const rows = (await getSql().query(`select answer from most_bought_weeks where week_start = $1::date`, [label])) as { answer: unknown }[];
  const answer = rows[0]?.answer;
  if (!answer) return null;
  return (typeof answer === "string" ? JSON.parse(answer) : answer) as MostBoughtResponse;
}

let cached: { label: string; value: MostBoughtResponse } | null = null;

/**
 * Most bought for the week the board shows now (lib/social-proof
 * publishedWeek). The first request after a week is published computes it
 * and stores it, insert on conflict do nothing; every later request, on
 * every instance, serves the stored row, so the list for a week never
 * changes once published whatever is recorded late. Empty until the first
 * week has been published.
 */
export async function loadMostBought(now = new Date(), env: Record<string, string | undefined> = process.env): Promise<MostBoughtResponse> {
  const week = publishedWeek(now);
  if (!week) return { rows: [], days: MOST_BOUGHT_DAYS };
  if (cached && cached.label === week.label) return cached.value;
  let value = await storedWeek(week.label);
  if (!value) {
    const computed = await computeMostBought(week, env);
    await getSql().query(
      `insert into most_bought_weeks (week_start, answer) values ($1::date, $2::jsonb) on conflict (week_start) do nothing`,
      [week.label, JSON.stringify(computed)],
    );
    // Another instance may have stored its answer first: serve the row, never our own copy.
    value = (await storedWeek(week.label)) ?? computed;
  }
  cached = { label: week.label, value };
  return value;
}

/** How long the CDN may keep the answer: until the next week is published, at most a day, at least a minute. */
export function mostBoughtMaxAge(now = new Date()): number {
  const seconds = Math.ceil((nextPublishAt(now).getTime() - now.getTime()) / 1000);
  return Math.max(60, Math.min(86_400, seconds));
}

/** Tests only: forget the cached answer. */
export function forgetMostBought(): void {
  cached = null;
}

/**
 * Whether the account `userId` (an SQL expression) shares what it holds with
 * its friends: its card is shown (SHOWN_SQL) and its own switch, "Let my
 * friends see which stocks and funds I hold", is on. Off by default. The
 * one statement of it, asked of both sides: a friend is counted only when
 * it holds, and a viewer sees anyone's only when it holds for the viewer
 * too (each sees the others' only by sharing their own).
 */
export const SHARES_HOLDINGS_SQL = (userId: string) => `
  (${SHOWN_SQL(userId)}
   and exists (select 1 from profiles sp where sp.user_id = ${userId} and sp.share_holdings))`;

/** Whether the viewer may see friends' holdings at all. */
async function viewerShares(viewerId: string): Promise<boolean> {
  const rows = (await getSql().query(`select ${SHARES_HOLDINGS_SQL("$1::uuid")} as ok`, [viewerId])) as { ok: boolean }[];
  return rows[0]?.ok === true;
}

type FriendDay = { user_id: string; handle: string; avatar_id: string | null; xp: number | string | null; holdings: unknown };

/**
 * The viewer's friends who share, with their last daily value. Retired
 * accounts, blocks either way, and days older than
 * FRIEND_HOLDINGS_MAX_AGE_DAYS are left out. `onlyId` narrows it to one
 * friend (their card).
 */
async function sharingFriendDays(viewerId: string, now: Date, onlyId?: string): Promise<FriendDay[]> {
  const since = new Date(now.getTime() - FRIEND_HOLDINGS_MAX_AGE_DAYS * 86_400_000).toISOString().slice(0, 10);
  return (await getSql().query(
    `with mine as (
       select case when f.a_id = $1::uuid then f.b_id else f.a_id end as id
       from friends f
       where f.a_id = $1::uuid or f.b_id = $1::uuid
     )
     select m.id::text as user_id, h.handle, u.avatar_id, u.xp, d.holdings
     from mine m
     join users u on u.id = m.id and u.retired_into is null
     join handles h on h.user_id = m.id
     join lateral (
       select pd.holdings from portfolio_days pd
       where pd.user_id = m.id and pd.day >= $2::date
       order by pd.day desc
       limit 1
     ) d on true
     where ($3::uuid is null or m.id = $3::uuid)
       and ${SHARES_HOLDINGS_SQL("m.id")}
       and not exists (
         select 1 from blocks b
         where (b.blocker_id = $1::uuid and b.blocked_id = m.id)
            or (b.blocker_id = m.id and b.blocked_id = $1::uuid)
       )`,
    [viewerId, since, onlyId ?? null],
  )) as FriendDay[];
}

/**
 * "Your friends hold": which board listings the viewer's friends hold, as
 * counts, for the Friends screen. Empty unless the viewer shares too; a
 * friend counts only while they share. What they hold is their last daily
 * value (portfolio_days), read on chain each evening; amounts never leave
 * this function. Each line carries up to four faces (username, avatar and
 * rank level, as the friend's card already shows them): XP is read only to
 * find the level and goes no further.
 */
export async function friendsHolding(viewer: SocialViewer, now = new Date()): Promise<FriendsHoldingResponse> {
  if (!(await viewerShares(viewer.id))) return { holding: [] };
  const rows = await sharingFriendDays(viewer.id, now);
  const friends: FriendHoldingsFact[] = rows.map((row) => ({
    handle: row.handle,
    avatarId: row.avatar_id ?? null,
    level: rankForXp(Number(row.xp) || 0).level,
    holdings: parseHoldings(row.holdings),
  }));
  return { holding: friendsHoldingByListing(friends, COUNTED_SYMBOLS) };
}

/**
 * The board listings one friend holds, in the registry's order, for their
 * card as the viewer sees it. Null when it may not be said: not friends,
 * either side not sharing, a block, or no recent daily value.
 */
export async function friendHolds(viewer: SocialViewer, friendId: string, now = new Date()): Promise<string[] | null> {
  if (friendId === viewer.id || !(await viewerShares(viewer.id))) return null;
  const rows = await sharingFriendDays(viewer.id, now, friendId);
  if (!rows[0]) return null;
  return holdsListings(parseHoldings(rows[0].holdings), COUNTED_SYMBOLS);
}

/** A stored day's holdings (jsonb, or its text on a driver that does not parse it), reduced to what the rule reads. */
function parseHoldings(raw: unknown): FriendHoldingsFact["holdings"] {
  const value = typeof raw === "string" ? safeJson(raw) : raw;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { symbol, quantity, price } = item as { symbol?: unknown; quantity?: unknown; price?: unknown };
    if (typeof symbol !== "string") return [];
    const qty = Number(quantity);
    if (!Number.isFinite(qty)) return [];
    const priced = Number(price);
    return [{ symbol, quantity: qty, price: Number.isFinite(priced) ? priced : null }];
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
