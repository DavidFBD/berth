import { getSql } from "@/lib/server/db";
import { detectFamily, normalizeAddress, toCaip10 } from "@/lib/identity/caip";
import { emailValue } from "@/lib/server/identities";
import { readPrefs } from "@/lib/server/email/store";
import { foldHandle } from "@/lib/handle";
import { rankForXp } from "@/lib/xp";
import { maskEmail, maskWallet, scrubPersonal, scrubText } from "@/lib/staff/mask";
import type { EmailPrefs } from "@/lib/email-kinds";
import { stageLateral, type StageName } from "@/lib/server/staff/overview";

/**
 * The staff Users list and a person's page (app/staff/users). Every email
 * and wallet address is masked here, on the server, before anything is
 * returned: the full value leaves only through the reveal route, which is
 * audited (lib/server/staff/reveal). Search is exact for anything personal
 * (an email, a wallet address, an account id) and by prefix only for a
 * username, which is public by design.
 */

/**
 * The address an account's notices go to, as SQL over `$1`: its primary
 * email identity, else (an older account the identity backfill never
 * reached) the users.email column, normalised. Staff suppression reads it.
 */
export const NOTICE_ADDRESS_SQL = `coalesce(
  (select value from user_identities where user_id = $1 and kind = 'email' and is_primary limit 1),
  (select lower(btrim(email)) from users where id = $1 and email is not null and btrim(email) <> ''))`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SearchKind =
  | { kind: "none" }
  | { kind: "id"; id: string }
  | { kind: "email"; value: string }
  | { kind: "wallet"; caip: string; column: string }
  | { kind: "username"; fold: string }
  | { kind: "invalid" };

/** What a search box string is: exact identifiers by their shape, anything else a username prefix. */
export function classifySearch(raw: string | null | undefined): SearchKind {
  const q = (raw ?? "").trim();
  if (!q) return { kind: "none" };
  if (UUID.test(q)) return { kind: "id", id: q.toLowerCase() };
  if (q.includes("@") && !q.startsWith("@")) {
    const value = emailValue(q);
    return value ? { kind: "email", value } : { kind: "invalid" };
  }
  const bare = q.replace(/^(?:eip155|solana|bip122):/, "");
  const family = detectFamily(bare);
  if (family) {
    const caip = toCaip10(family, bare);
    const column = normalizeAddress(family, bare);
    if (caip && column) return { kind: "wallet", caip, column };
  }
  const name = q.replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,24}$/.test(name)) return { kind: "invalid" };
  return { kind: "username", fold: foldHandle(name) };
}

export type UserFilters = {
  q?: string | null;
  stage?: StageName | null;
  /** Signed up on or after (YYYY-MM-DD, UTC). */
  from?: string | null;
  /** Signed up on or before (YYYY-MM-DD, UTC). */
  to?: string | null;
  hasEmail?: boolean | null;
  referred?: boolean | null;
  hidden?: boolean | null;
  ineligible?: boolean | null;
  /** Holds a campaign claim: invited inside an invite campaign (or arrived through a retired buy campaign's link). */
  campaign?: boolean | null;
  page?: number;
  pageSize?: number;
};

export type UserRow = {
  id: string;
  handle: string | null;
  createdAt: string;
  stage: StageName;
  xp: number;
  rank: string;
  orders: number;
  email: string | null;
  wallet: string | null;
  referred: boolean;
  hidden: boolean;
  ineligible: boolean;
};

export type UserPage = { rows: UserRow[]; total: number; page: number; pageSize: number; pages: number; search: SearchKind["kind"] };

export const USERS_PAGE_SIZE = 50;

/** A whole number in [min, max], or the fallback for anything else (NaN, Infinity, text). */
export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}
const DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** One page of live accounts, newest first, with the filters applied. Masked. */
export async function listUsers(filters: UserFilters = {}): Promise<UserPage> {
  const pageSize = clampInt(filters.pageSize, USERS_PAGE_SIZE, 1, 100);
  const page = clampInt(filters.page, 1, 1, 10_000);
  const params: unknown[] = [];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where: string[] = ["u.retired_into is null"];
  const search = classifySearch(filters.q);
  switch (search.kind) {
    case "invalid":
      return { rows: [], total: 0, page, pageSize, pages: 0, search: search.kind };
    case "id":
      where.push(`u.id = ${add(search.id)}`);
      break;
    case "email": {
      const p = add(search.value);
      where.push(`(exists (select 1 from user_identities i where i.user_id = u.id and i.kind = 'email' and i.value = ${p} and i.unlinked_at is null) or lower(btrim(u.email)) = ${p})`);
      break;
    }
    case "wallet":
      where.push(
        `(exists (select 1 from user_identities i where i.user_id = u.id and i.kind = 'wallet' and i.value = ${add(search.caip)} and i.unlinked_at is null) or u.wallet_address = ${add(search.column)})`,
      );
      break;
    case "username":
      where.push(`h.handle_norm like ${add(`${search.fold.replace(/[%_\\]/g, "\\$&")}%`)}`);
      break;
  }
  // The stage is worked out per row (stageLateral); over every account only when it is filtered on.
  if (filters.stage) where.push(`st.stage = ${add(filters.stage)}`);
  if (filters.from && DAY_SHAPE.test(filters.from)) where.push(`u.created_at >= ${add(filters.from)}::date`);
  if (filters.to && DAY_SHAPE.test(filters.to)) where.push(`u.created_at < ${add(filters.to)}::date + 1`);
  const hasEmail = `(u.email is not null or exists (select 1 from user_identities i where i.user_id = u.id and i.kind = 'email' and i.unlinked_at is null))`;
  if (filters.hasEmail === true) where.push(hasEmail);
  if (filters.hasEmail === false) where.push(`not ${hasEmail}`);
  if (filters.referred === true) where.push(`u.referred_by is not null`);
  if (filters.referred === false) where.push(`u.referred_by is null`);
  if (filters.hidden === true) where.push(`p.visible = false`);
  if (filters.ineligible === true) where.push(`u.campaign_ineligible_at is not null`);
  if (filters.campaign === true) where.push(`exists (select 1 from campaign_claims c where c.user_id = u.id)`);
  const from = `from users u
       left join handles h on h.user_id = u.id
       left join profiles p on p.user_id = u.id
       ${filters.stage ? stageLateral("u") : ""}
      where ${where.join(" and ")}`;
  const counted = (await getSql().query(`select count(*)::int as n ${from}`, params)) as { n: number }[];
  const total = Number(counted[0]?.n ?? 0);
  const limit = add(pageSize);
  const offset = add((page - 1) * pageSize);
  const rows = (await getSql().query(
    `with shown as (
       select u.id ${from}
        order by u.created_at desc, u.id
        limit ${limit} offset ${offset}
     )
     select u.id, h.handle, u.created_at, st.stage, u.xp, u.referred_by is not null as referred,
            coalesce(p.visible = false, false) as hidden, u.campaign_ineligible_at is not null as ineligible,
            (select count(*)::int from orders o where o.user_id = u.id) as orders,
            coalesce((select i.value from user_identities i where i.user_id = u.id and i.kind = 'email' and i.unlinked_at is null
                       order by i.is_primary desc, i.created_at limit 1), u.email) as email,
            coalesce((select i.value from user_identities i where i.user_id = u.id and i.kind = 'wallet' and i.unlinked_at is null
                       order by i.is_home desc, i.created_at limit 1), u.wallet_address) as wallet
       from shown
       join users u on u.id = shown.id
       left join handles h on h.user_id = u.id
       left join profiles p on p.user_id = u.id
       ${stageLateral("u")}
      order by u.created_at desc, u.id`,
    params,
  )) as {
    id: string;
    handle: string | null;
    created_at: string | Date;
    stage: StageName;
    xp: number;
    referred: boolean;
    hidden: boolean;
    ineligible: boolean;
    orders: number;
    email: string | null;
    wallet: string | null;
  }[];
  return {
    rows: rows.map((row) => ({
      id: row.id,
      handle: row.handle,
      createdAt: new Date(row.created_at).toISOString(),
      stage: row.stage,
      xp: Number(row.xp),
      rank: rankForXp(Number(row.xp)).name,
      orders: Number(row.orders),
      email: maskEmail(row.email),
      wallet: maskWallet(row.wallet),
      referred: row.referred,
      hidden: row.hidden,
      ineligible: row.ineligible,
    })),
    total,
    page,
    pageSize,
    pages: Math.ceil(total / pageSize),
    search: search.kind,
  };
}

const iso = (value: string | Date | null | undefined) => (value ? new Date(value).toISOString() : null);
const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));
/** A transaction hash, cut short: enough to find it, not a link to the wallet at a glance. */
const shortTx = (value: string | null | undefined) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : null);

export type UserDetail = {
  id: string;
  createdAt: string;
  retiredInto: string | null;
  handle: string | null;
  /** `byStaff`: hidden by staff (moderation), which staff may show again; a person's own hide is theirs. */
  profile: { visible: boolean; hiddenAt: string | null; byStaff: boolean } | null;
  xp: number;
  rank: { level: number; name: string };
  stage: StageName;
  firstStockClosedAt: string | null;
  campaign: { ineligibleAt: string | null };
  identities: {
    id: string | null;
    kind: "email" | "wallet";
    family: string | null;
    masked: string;
    primary: boolean;
    home: boolean;
    proof: string;
    verifiedAt: string | null;
    unlinkedAt: string | null;
    createdAt: string | null;
  }[];
  merges: { id: string; role: "survivor" | "absorbed"; otherId: string; reason: string; status: string; createdAt: string; doneAt: string | null }[];
  accountAudit: { action: string; createdAt: string; detail: Record<string, unknown> }[];
  orders: {
    id: string;
    direction: string;
    symbol: string;
    quantity: number | null;
    usd: number | null;
    paySymbol: string | null;
    payChain: string | null;
    type: string;
    at: string | null;
    tx: string | null;
  }[];
  ordersTotal: number;
  limitOrders: { id: string; direction: string; symbol: string; limitPrice: number; status: string; placedAt: string; expiresAt: string | null; closedAt: string | null }[];
  portfolio: { latest: { day: string; valueUsd: number; holdings: { symbol: string; quantity: number; price: number | null }[] } | null; history: { day: string; value: number }[] };
  xpEvents: { kind: string; amount: number; at: string }[];
  friends: number;
  salutes: number;
  referredBy: { id: string; handle: string | null } | null;
  referralsOut: { total: number; firstBuys: number; rows: { id: string; handle: string | null; createdAt: string }[] };
  email: {
    primary: string | null;
    /** `removable`: only a staff suppression; a bounce or a complaint holds. */
    suppressed: { reason: string; at: string; removable: boolean } | null;
    prefs: EmailPrefs;
    sends: { id: string; type: string; status: string; error: string | null; attempts: number; at: string; stuck: boolean }[];
  };
  assistants: {
    grants: { id: string; client: string | null; scope: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }[];
    mcpCalls30: number;
    chat30: { messages: number; costMicros: number };
  };
};

/** Everything staff may see of one account, masked. Null for no such account. */
export async function userDetail(userId: string): Promise<UserDetail | null> {
  if (!UUID.test(userId)) return null;
  const sql = getSql();
  const users = (await sql.query(
    `select u.id, u.created_at, u.retired_into, u.xp, u.email, u.wallet_address, u.referred_by, u.first_stock_closed_at,
            u.campaign_ineligible_at, h.handle, p.visible, p.hidden_at, p.staff_hidden_at, p.user_id as profile_id, st.stage
       from users u
       left join handles h on h.user_id = u.id
       left join profiles p on p.user_id = u.id
       ${stageLateral("u")}
      where u.id = $1`,
    [userId],
  )) as Record<string, unknown>[];
  const user = users[0];
  if (!user) return null;
  const id = user.id as string;

  const [identities, merges, audit, orders, ordersCount, limits, latest, history, xp, social, refIn, refOut, sends, suppressed, primary, grants, usage] =
    await Promise.all([
      sql.query(
        `select id, kind, value, family, is_primary, is_home, proof, verified_at, unlinked_at, created_at
           from user_identities where user_id = $1 order by kind, is_primary desc, is_home desc, created_at`,
        [id],
      ),
      sql.query(
        `select id, case when survivor_id = $1 then 'survivor' else 'absorbed' end as role,
                case when survivor_id = $1 then absorbed_id else survivor_id end as other_id, reason, status, created_at, done_at
           from account_merges where survivor_id = $1 or absorbed_id = $1 order by created_at desc`,
        [id],
      ),
      sql.query(`select action, detail, created_at from account_audit where user_id = $1 order by created_at desc limit 50`, [id]),
      sql.query(
        `select id, direction, listing_symbol, quantity, usd_value, pay_symbol, pay_chain, order_type, coalesce(filled_at, placed_at, created_at) as at, intent_tx
           from orders where user_id = $1 order by coalesce(filled_at, placed_at, created_at) desc limit 50`,
        [id],
      ),
      sql.query(`select count(*)::int as n from orders where user_id = $1`, [id]),
      sql.query(
        `select id, direction, listing_symbol, limit_price, status, placed_at, expires_at, closed_at
           from limit_orders where user_id = $1 order by placed_at desc limit 30`,
        [id],
      ),
      sql.query(`select day, value_usd, holdings from portfolio_days where user_id = $1 order by day desc limit 1`, [id]),
      sql.query(
        `select to_char(day, 'YYYY-MM-DD') as day, value_usd::float8 as value from portfolio_days
          where user_id = $1 and day >= (now() at time zone 'UTC')::date - 180 order by day`,
        [id],
      ),
      sql.query(`select kind, amount, created_at from xp_events where user_id = $1 order by created_at desc limit 30`, [id]),
      sql.query(
        `select (select count(*)::int from friends where a_id = $1 or b_id = $1) as friends,
                (select count(*)::int from salutes where recipient_id = $1 and revoked_at is null) as salutes`,
        [id],
      ),
      user.referred_by
        ? sql.query(`select u.id, h.handle from users u left join handles h on h.user_id = u.id where u.id = $1`, [user.referred_by])
        : Promise.resolve([]),
      sql.query(
        `select u.id, h.handle, u.created_at, count(*) over ()::int as total,
                count(*) filter (where exists (select 1 from orders o where o.user_id = u.id and o.direction = 'buy' and o.listing_symbol <> 'SGOV')) over ()::int as buys
           from users u left join handles h on h.user_id = u.id
          where u.referred_by = $1 and u.retired_into is null order by u.created_at desc limit 50`,
        [id],
      ),
      sql.query(
        `select id, type, status, error, attempts, created_at,
                (status = 'pending' and created_at < now() - interval '10 minutes') as stuck
           from email_sends where user_id = $1 order by created_at desc limit 30`,
        [id],
      ),
      sql.query(
        `select s.reason, s.at from email_suppressions s
          where s.address = (${NOTICE_ADDRESS_SQL})`,
        [id],
      ),
      sql.query(`select (${NOTICE_ADDRESS_SQL}) as value`, [id]),
      sql.query(
        `select id, client_name, scope, created_at, last_used_at, revoked_at from oauth_grants where user_id = $1 order by created_at desc`,
        [id],
      ),
      sql.query(
        `select (select count(*)::int from mcp_calls where user_id = $1 and created_at >= now() - interval '30 days') as mcp,
                (select count(*)::int from chat_usage where user_id = $1 and created_at >= now() - interval '30 days') as messages,
                (select coalesce(sum(cost_micros), 0)::bigint from chat_usage where user_id = $1 and created_at >= now() - interval '30 days') as cost`,
        [id],
      ),
    ]);

  const identityRows: UserDetail["identities"] = (identities as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    kind: row.kind as "email" | "wallet",
    family: (row.family as string | null) ?? null,
    masked: (row.kind === "email" ? maskEmail(row.value as string) : maskWallet(row.value as string)) ?? "…",
    primary: Boolean(row.is_primary),
    home: Boolean(row.is_home),
    proof: row.proof as string,
    verifiedAt: iso(row.verified_at as string | null),
    unlinkedAt: iso(row.unlinked_at as string | null),
    createdAt: iso(row.created_at as string | null),
  }));
  // The users columns, where the identity rows never recorded them (older accounts).
  const legacyEmail = emailValue(user.email as string | null);
  if (legacyEmail && !(identities as { kind: string; value: string }[]).some((row) => row.kind === "email" && row.value === legacyEmail)) {
    identityRows.unshift({ id: null, kind: "email", family: null, masked: maskEmail(legacyEmail) ?? "…", primary: false, home: false, proof: "column", verifiedAt: null, unlinkedAt: null, createdAt: null });
  }
  const legacyWallet = user.wallet_address as string | null;
  if (legacyWallet && !(identities as { kind: string; value: string }[]).some((row) => row.kind === "wallet" && row.value.endsWith(legacyWallet))) {
    identityRows.push({ id: null, kind: "wallet", family: detectFamily(legacyWallet), masked: maskWallet(legacyWallet) ?? "…", primary: false, home: false, proof: "column", verifiedAt: null, unlinkedAt: null, createdAt: null });
  }

  const latestRow = (latest as Record<string, unknown>[])[0];
  const xpTotal = Number(user.xp ?? 0);
  const rank = rankForXp(xpTotal);
  const socialRow = (social as { friends: number; salutes: number }[])[0];
  const outRows = refOut as { id: string; handle: string | null; created_at: string; total: number; buys: number }[];
  const usageRow = (usage as { mcp: number; messages: number; cost: string | number }[])[0];
  const suppressedRow = (suppressed as { reason: string; at: string }[])[0];
  const refInRow = (refIn as { id: string; handle: string | null }[])[0];

  return {
    id,
    createdAt: iso(user.created_at as string)!,
    retiredInto: (user.retired_into as string | null) ?? null,
    handle: (user.handle as string | null) ?? null,
    profile: user.profile_id ? { visible: Boolean(user.visible), hiddenAt: iso(user.hidden_at as string | null), byStaff: Boolean(user.staff_hidden_at) } : null,
    xp: xpTotal,
    rank: { level: rank.level, name: rank.name },
    stage: ((user.stage as StageName | null) ?? "none") as StageName,
    firstStockClosedAt: iso(user.first_stock_closed_at as string | null),
    campaign: { ineligibleAt: iso(user.campaign_ineligible_at as string | null) },
    identities: identityRows,
    merges: (merges as Record<string, unknown>[]).map((row) => ({
      id: row.id as string,
      role: row.role as "survivor" | "absorbed",
      otherId: row.other_id as string,
      reason: row.reason as string,
      status: row.status as string,
      createdAt: iso(row.created_at as string)!,
      doneAt: iso(row.done_at as string | null),
    })),
    accountAudit: (audit as Record<string, unknown>[]).map((row) => ({
      action: row.action as string,
      createdAt: iso(row.created_at as string)!,
      detail: scrubPersonal((row.detail as Record<string, unknown>) ?? {}),
    })),
    orders: (orders as Record<string, unknown>[]).map((row) => ({
      id: row.id as string,
      direction: row.direction as string,
      symbol: row.listing_symbol as string,
      quantity: num(row.quantity),
      usd: num(row.usd_value),
      paySymbol: (row.pay_symbol as string | null) ?? null,
      payChain: (row.pay_chain as string | null) ?? null,
      type: (row.order_type as string) ?? "market",
      at: iso(row.at as string | null),
      tx: shortTx(row.intent_tx as string | null),
    })),
    ordersTotal: Number((ordersCount as { n: number }[])[0]?.n ?? 0),
    limitOrders: (limits as Record<string, unknown>[]).map((row) => ({
      id: row.id as string,
      direction: row.direction as string,
      symbol: row.listing_symbol as string,
      limitPrice: Number(row.limit_price),
      status: row.status as string,
      placedAt: iso(row.placed_at as string)!,
      expiresAt: iso(row.expires_at as string | null),
      closedAt: iso(row.closed_at as string | null),
    })),
    portfolio: {
      latest: latestRow
        ? {
            day: iso(latestRow.day as string)!.slice(0, 10),
            valueUsd: Number(latestRow.value_usd),
            holdings: ((latestRow.holdings as { symbol: string; quantity: unknown; price: unknown }[]) ?? []).map((holding) => ({
              symbol: holding.symbol,
              quantity: Number(holding.quantity),
              price: num(holding.price),
            })),
          }
        : null,
      history: (history as { day: string; value: number }[]).map((row) => ({ day: row.day, value: Number(row.value) })),
    },
    xpEvents: (xp as Record<string, unknown>[]).map((row) => ({ kind: row.kind as string, amount: Number(row.amount), at: iso(row.created_at as string)! })),
    friends: Number(socialRow?.friends ?? 0),
    salutes: Number(socialRow?.salutes ?? 0),
    referredBy: refInRow ? { id: refInRow.id, handle: refInRow.handle } : null,
    referralsOut: {
      total: Number(outRows[0]?.total ?? 0),
      firstBuys: Number(outRows[0]?.buys ?? 0),
      rows: outRows.map((row) => ({ id: row.id, handle: row.handle, createdAt: iso(row.created_at)! })),
    },
    email: {
      primary: maskEmail((primary as { value: string }[])[0]?.value ?? null),
      suppressed: suppressedRow ? { reason: suppressedRow.reason, at: iso(suppressedRow.at)!, removable: suppressedRow.reason === "staff" } : null,
      prefs: await readPrefs(id),
      sends: (sends as Record<string, unknown>[]).map((row) => ({
        id: row.id as string,
        type: row.type as string,
        status: row.status as string,
        error: row.error ? scrubText(row.error as string) : null,
        attempts: Number(row.attempts),
        at: iso(row.created_at as string)!,
        stuck: Boolean(row.stuck),
      })),
    },
    assistants: {
      grants: (grants as Record<string, unknown>[]).map((row) => ({
        id: row.id as string,
        client: (row.client_name as string | null) ?? null,
        scope: row.scope as string,
        createdAt: iso(row.created_at as string)!,
        lastUsedAt: iso(row.last_used_at as string | null),
        revokedAt: iso(row.revoked_at as string | null),
      })),
      mcpCalls30: Number(usageRow?.mcp ?? 0),
      chat30: { messages: Number(usageRow?.messages ?? 0), costMicros: Number(usageRow?.cost ?? 0) },
    },
  };
}

export type RevealField = { kind: "identity"; identityId: string } | { kind: "column"; column: "email" | "wallet" };

