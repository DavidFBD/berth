import { getSql } from "@/lib/server/db";
import { normalizeCampaignCode, type CampaignKind, type ClaimState } from "@/lib/campaigns";

/**
 * Campaign rows and attribution (db/schema.sql, campaigns and
 * campaign_claims). An invite claim is made for the INVITED account, naming
 * its inviter, when the account's invite binds (lib/server/accounts
 * bindReferral, or claimReferral by hand) and a live invite campaign covers
 * the moment the account was opened: the account is young (72 hours), was
 * opened inside the campaign's dates, is not merged into another, and the
 * sync comes from where Berth is available (the profile route asks before
 * calling). An account holds one claim, ever. Attribution never touches
 * referred_by or friends; it reads them.
 */

export type CampaignRow = {
  id: string;
  code: string;
  title: string;
  kind: CampaignKind;
  max_per_inviter: number;
  amount_usd: number;
  budget_usd: number;
  max_claims: number;
  min_buy_usd: number;
  hold_days: number;
  starts_at: Date;
  ends_at: Date;
  active: boolean;
  activated_at: Date | null;
  created_at: Date;
};

export const CAMPAIGN_COLUMNS = `id, code, title, kind, max_per_inviter, amount_usd::float8 as amount_usd, budget_usd::float8 as budget_usd,
  max_claims, min_buy_usd::float8 as min_buy_usd, hold_days, starts_at, ends_at, active, activated_at, created_at`;

export type ClaimRow = {
  id: string;
  campaign_id: string;
  user_id: string;
  /** The account that invited this one (invite claims); null on a retired buy claim. */
  inviter_id: string | null;
  onboarded_at: Date | null;
  state: ClaimState;
  order_id: string | null;
  intent_tx: string | null;
  buy_usd: number | null;
  holding_since: Date | null;
  eligible_at: Date | null;
  hold_checked_at: Date | null;
  hold_attempted_at: Date | null;
  hold_unreadable_since: Date | null;
  hold_evidence: Record<string, unknown> | null;
  qualified_at: Date | null;
  approved_at: Date | null;
  approved_by: string | null;
  rejected_at: Date | null;
  rejected_by: string | null;
  reject_reason: string | null;
  expired_at: Date | null;
  expire_reason: string | null;
  waitlisted_at: Date | null;
  payout_address: string | null;
  payout_chain: string | null;
  paid_at: Date | null;
  paid_by: string | null;
  paid_tx: string | null;
  paid_verified: boolean | null;
  paid_check: Record<string, unknown> | null;
  created_at: Date;
};

export const CLAIM_COLUMNS = `id, campaign_id, user_id, inviter_id, onboarded_at, state, order_id, intent_tx, buy_usd::float8 as buy_usd,
  holding_since, eligible_at, hold_checked_at, hold_attempted_at, hold_unreadable_since, hold_evidence, qualified_at,
  approved_at, approved_by, rejected_at, rejected_by, reject_reason, expired_at, expire_reason, waitlisted_at,
  payout_address, payout_chain, paid_at, paid_by, paid_tx, paid_verified, paid_check, created_at`;

const asDate = (value: unknown): Date | null => (value === null || value === undefined ? null : new Date(value as string));

export function toCampaign(row: Record<string, unknown>): CampaignRow {
  return {
    ...(row as unknown as CampaignRow),
    amount_usd: Number(row.amount_usd),
    budget_usd: Number(row.budget_usd),
    min_buy_usd: Number(row.min_buy_usd),
    max_claims: Number(row.max_claims),
    max_per_inviter: Number(row.max_per_inviter ?? 1),
    hold_days: Number(row.hold_days),
    starts_at: new Date(row.starts_at as string),
    ends_at: new Date(row.ends_at as string),
    activated_at: asDate(row.activated_at),
    created_at: new Date(row.created_at as string),
  };
}

export function toClaim(row: Record<string, unknown>): ClaimRow {
  const out = { ...(row as unknown as ClaimRow) };
  for (const key of [
    "onboarded_at",
    "holding_since",
    "eligible_at",
    "hold_checked_at",
    "hold_attempted_at",
    "hold_unreadable_since",
    "qualified_at",
    "approved_at",
    "rejected_at",
    "expired_at",
    "waitlisted_at",
    "paid_at",
  ] as const) {
    out[key] = asDate(row[key]);
  }
  out.created_at = new Date(row.created_at as string);
  out.buy_usd = row.buy_usd === null || row.buy_usd === undefined ? null : Number(row.buy_usd);
  return out;
}

export async function campaignById(id: string): Promise<CampaignRow | undefined> {
  const rows = (await getSql().query(`select ${CAMPAIGN_COLUMNS} from campaigns where id = $1`, [id])) as Record<string, unknown>[];
  return rows[0] ? toCampaign(rows[0]) : undefined;
}

export async function claimById(id: string): Promise<ClaimRow | undefined> {
  const rows = (await getSql().query(`select ${CLAIM_COLUMNS} from campaign_claims where id = $1`, [id])) as Record<string, unknown>[];
  return rows[0] ? toClaim(rows[0]) : undefined;
}

/**
 * What the /c/<code> landing may say: an invite campaign's promise, only
 * while it is active and inside its dates. Anything else (unknown,
 * inactive, over, a retired buy campaign, or a database that cannot be
 * read) is no campaign at all.
 */
export async function campaignForLanding(
  raw: string,
): Promise<{ code: string; amountUsd: number; stayDays: number; perInviter: number } | null> {
  const code = normalizeCampaignCode(raw);
  if (!code) return null;
  try {
    const rows = (await getSql().query(
      `select code, amount_usd::float8 as amount_usd, hold_days, max_per_inviter
         from campaigns
        where code = $1 and kind = 'invite' and active and now() >= starts_at and now() <= ends_at`,
      [code],
    )) as { code: string; amount_usd: number; hold_days: number; max_per_inviter: number }[];
    const row = rows[0];
    return row
      ? { code: row.code, amountUsd: Number(row.amount_usd), stayDays: Number(row.hold_days), perInviter: Number(row.max_per_inviter) }
      : null;
  } catch (error) {
    console.warn("[campaigns] landing read failed", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Makes the invite claim of a new account that arrived with someone's
 * invite, when a live invite campaign covers the moment it was opened. The
 * campaign whose code the account also arrived with wins (a /c/<code>
 * link), else the live one that started first. Returns the claim id, or
 * null when nothing was written: no invite, not new (older than 72 hours,
 * or opened outside every live campaign's dates), merged into another
 * account, invited by itself, or a claim already made.
 */
export async function attributeInvite(userId: string, rawCode?: unknown): Promise<string | null> {
  const code = normalizeCampaignCode(rawCode);
  const rows = (await getSql().query(
    `insert into campaign_claims (campaign_id, user_id, inviter_id, state)
     select c.id, u.id, u.referred_by, 'attributed'
       from users u
       join lateral (
         select c.id from campaigns c
          where c.kind = 'invite' and c.active
            and now() >= c.starts_at and now() <= c.ends_at
            and u.created_at >= c.starts_at and u.created_at <= c.ends_at
          order by (c.code = $2) desc nulls last, c.starts_at asc, c.created_at asc, c.id asc
          limit 1
       ) c on true
      where u.id = $1
        and u.referred_by is not null
        and u.referred_by <> u.id
        and u.retired_into is null
        and u.created_at > now() - interval '72 hours'
     on conflict (user_id) do nothing
     returning id`,
    [userId, code],
  )) as { id: string }[];
  return rows[0]?.id ?? null;
}

/** Every account that is this person: the live account and every account merged into it. */
export async function personAccounts(personId: string): Promise<string[]> {
  const rows = (await getSql().query(
    `select id from users where id = $1 or retired_into = $1`,
    [personId],
  )) as { id: string }[];
  return rows.map((row) => row.id);
}
