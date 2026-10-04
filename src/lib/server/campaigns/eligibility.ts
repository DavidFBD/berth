import { getSql } from "@/lib/server/db";
import { liveAccount, normalizeWallet, type UserRow } from "@/lib/server/accounts";
import { parseCaip10 } from "@/lib/identity/caip";
import { PAID_LINE_DAYS, type CampaignProgress, type ClaimState } from "@/lib/campaigns";
import {
  CAMPAIGN_COLUMNS,
  CLAIM_COLUMNS,
  personAccounts,
  toCampaign,
  toClaim,
  type CampaignRow,
  type ClaimRow,
} from "@/lib/server/campaigns/store";
import { foldEmail } from "@/lib/server/campaigns/fold-email";

/**
 * Whether an invite claim has earned its USDC, computed on the server from
 * what Berth already records. Nothing here pays anyone: the furthest a
 * claim gets on its own is `qualified`; staff approve, David pays by hand.
 * The one paid is the INVITER. Nothing anywhere asks for a buy, a holding
 * or a trading volume.
 *
 * THE RULES, every one of them, in the order a claim meets them:
 *
 * 1. Attributed (lib/server/campaigns/store attributeInvite). The invited
 *    account carries someone's invite (users.referred_by, bound only to a
 *    new account), was opened inside a live invite campaign's dates, is no
 *    older than 72 hours when the claim is made, and the sync came from
 *    where Berth is available. One claim per account, ever.
 * 2. The farming guards, asked of the invited PERSON (the live account and
 *    every account merged into it) and the inviter's person:
 *    - inviter_gone: the inviter's account is not there any more.
 *    - self_invite: the two are one person (merged into one), or share any
 *      wallet (linked, unlinked or home) or a folded email (plus tag
 *      dropped, Gmail's dots too).
 *    - existing_customer: any account of the invited person is older than
 *      72 hours before the claim, or has an order from before it: an
 *      account that merged with an older one is not new.
 *    - staff_ineligible: staff marked the invited person or the inviter
 *      not eligible (users.campaign_ineligible_at).
 *    - email_used: another account outside both people has the invited
 *      person's folded email: the same person already on Berth.
 * 3. Set up (SET_UP_SQL), all three on the invited person's live
 *    account: a verified email (users.email, written only from Privy's
 *    verified record), a username (a handles row) and a wallet (a home
 *    address, users.wallet_address). Until then the claim stays
 *    `attributed`. The terms are not asked: Berth asks for them only before
 *    a first buy, and a buy is never a condition.
 * 4. A place, reserved atomically (db/schema.sql campaign_reserve_invite):
 *    the campaign is active; one payout per real person, across every
 *    invite campaign (any wallet or the folded email of the invited person
 *    already standing on another claim: wallet_used, email_used); the per
 *    inviter cap (max_per_inviter of the inviter's friends holding a place
 *    in this campaign: inviter_cap); the budget and max_claims, with a
 *    waiting line. The claim is then `holding` from onboarded_at, eligible
 *    hold_days later.
 * 5. Still using Berth. On the first morning run at or after eligible_at:
 *    the invited person opened Berth signed in (users.last_seen_at, bumped
 *    by the profile sync at most once a UTC day) at or after the later of
 *    eligible_at minus ACTIVE_WINDOW_DAYS and onboarded_at plus one day,
 *    so a return on a later day inside the last week of the stay. Yes:
 *    `qualified`. No: `rejected`, not_active.
 *
 * The deadline: a claim not holding a place by ends_at + hold_days is
 * `expired`, full when it was waiting for a place, else ended. A paused
 * campaign reserves nobody new; claims already holding a place carry on.
 * At approval (lib/server/campaigns/actions) rule 2 and the one payout per
 * person are asked again of both people as they are then.
 *
 * Retired buy campaigns (kind 'buy') take no part: an open claim of one is
 * expired as ended on the next run, and nothing judges a buy any more.
 */

const DAY_MS = 86_400_000;
/** An account older than this before its claim was made is not new (the attribution window). */
export const NEW_ACCOUNT_MS = 72 * 3_600_000;
/** Rule 5: the friend must have opened Berth in this many last days of the stay. */
export const ACTIVE_WINDOW_DAYS = 7;
/** The stay a new campaign may ask for, in days. */
export const MIN_STAY_DAYS = 7;
export const MAX_STAY_DAYS = 60;
/** The per inviter cap a new campaign starts with (db default too). */
export const DEFAULT_PER_INVITER = 3;
/** The stay a new campaign starts with on the create form. */
export const DEFAULT_STAY_DAYS = 14;

/** The SQL fold of an email, the same as foldEmail: a plus tag dropped, and for Gmail the dots too. */
export const FOLD_EMAIL_SQL = (column: string) => `(case
  when split_part(lower(${column}), '@', 2) in ('gmail.com', 'googlemail.com')
    then replace(split_part(split_part(lower(${column}), '@', 1), '+', 1), '.', '') || '@gmail.com'
  else split_part(split_part(lower(${column}), '@', 1), '+', 1) || '@' || split_part(lower(${column}), '@', 2)
end)`;

/**
 * Every wallet the person stands on, normalised: each wallet any of their
 * accounts ever linked (unlinked ones too: the account once held it), and
 * each account's home address.
 */
export async function personWallets(accountIds: readonly string[]): Promise<string[]> {
  const identities = (await getSql().query(
    `select value from user_identities where user_id = any($1::uuid[]) and kind = 'wallet'`,
    [accountIds],
  )) as { value: string }[];
  const homes = (await getSql().query(
    `select wallet_address from users where id = any($1::uuid[]) and wallet_address is not null`,
    [accountIds],
  )) as { wallet_address: string }[];
  const out = new Set<string>();
  const add = (raw: string | null | undefined) => {
    const wallet = normalizeWallet(raw);
    if (wallet) out.add(wallet);
  };
  for (const row of identities) add(parseCaip10(row.value)?.address ?? null);
  for (const row of homes) add(row.wallet_address);
  return [...out].sort();
}

/** Every folded email the person's accounts carry. */
export async function personEmails(accountIds: readonly string[]): Promise<string[]> {
  const rows = (await getSql().query(`select email from users where id = any($1::uuid[]) and email is not null`, [accountIds])) as {
    email: string;
  }[];
  return [...new Set(rows.map((row) => foldEmail(row.email)).filter((email): email is string => email !== null))].sort();
}

/**
 * Whether staff marked any account of this person not eligible for
 * campaigns (users.campaign_ineligible_at, the staff area's audited
 * action): no claim of theirs reserves a place, is approved or is paid.
 */
export async function staffIneligible(accountIds: readonly string[]): Promise<boolean> {
  const rows = (await getSql().query(
    `select 1 from users where id = any($1::uuid[]) and campaign_ineligible_at is not null limit 1`,
    [accountIds],
  )) as unknown[];
  return rows.length > 0;
}

/**
 * Rule 2, existing_customer: whether this person was on Berth before the
 * claim. Any of their accounts older than the attribution window before
 * the claim, or any order of theirs from before it.
 */
export async function existingCustomer(accountIds: readonly string[], claimCreated: Date): Promise<boolean> {
  const rows = (await getSql().query(
    `select exists (select 1 from users where id = any($1::uuid[]) and created_at < $2::timestamptz - make_interval(secs => $3::int / 1000))
            or exists (select 1 from orders o where o.user_id = any($1::uuid[]) and coalesce(o.filled_at, o.placed_at, o.created_at) < $2::timestamptz) as old`,
    [accountIds, claimCreated.toISOString(), NEW_ACCOUNT_MS],
  )) as { old: boolean }[];
  return rows[0]?.old === true;
}

/** Rule 2, self_invite: one person, a shared wallet or a shared folded email. Pure. */
export function sameHands(
  invited: { accounts: readonly string[]; wallets: readonly string[]; emails: readonly string[] },
  inviter: { accounts: readonly string[]; wallets: readonly string[]; emails: readonly string[] },
): boolean {
  if (invited.accounts.some((id) => inviter.accounts.includes(id))) return true;
  if (invited.wallets.some((wallet) => inviter.wallets.includes(wallet))) return true;
  return invited.emails.some((email) => inviter.emails.includes(email));
}

/** Rule 2, email_used: an account outside both people carries one of these folded emails. */
export async function emailElsewhere(emails: readonly string[], insiders: readonly string[]): Promise<boolean> {
  if (emails.length === 0) return false;
  const rows = (await getSql().query(
    `select 1 from users where email is not null and not (id = any($2::uuid[])) and ${FOLD_EMAIL_SQL("email")} = any($1::text[]) limit 1`,
    [emails, insiders],
  )) as unknown[];
  return rows.length > 0;
}

/**
 * Rule 3 as SQL, on a users row aliased `alias`: a verified email, a
 * username and a wallet. Invite XP (lib/server/invite-xp) asks the same.
 */
export const SET_UP_SQL = (alias: string) =>
  `(${alias}.email is not null and ${alias}.wallet_address is not null and exists (select 1 from handles h where h.user_id = ${alias}.id))`;

/** Rule 3, on the live account: a verified email, a username and a wallet. */
export async function onboarded(personId: string): Promise<boolean> {
  const rows = (await getSql().query(
    `select ${SET_UP_SQL("u")} as done
       from users u where u.id = $1`,
    [personId],
  )) as { done: boolean }[];
  return rows[0]?.done === true;
}

/** The last time any account of the person opened Berth signed in. */
export async function lastSeen(accountIds: readonly string[]): Promise<Date | null> {
  const rows = (await getSql().query(`select max(last_seen_at) as seen from users where id = any($1::uuid[])`, [accountIds])) as {
    seen: string | Date | null;
  }[];
  return rows[0]?.seen ? new Date(rows[0].seen) : null;
}

/** Rule 5: from when a visit counts. Pure. */
export function activeFrom(claim: Pick<ClaimRow, "eligible_at" | "onboarded_at">): Date {
  const eligible = claim.eligible_at?.getTime() ?? 0;
  const onboardedAt = claim.onboarded_at?.getTime() ?? eligible;
  return new Date(Math.max(eligible - ACTIVE_WINDOW_DAYS * DAY_MS, onboardedAt + DAY_MS));
}

/** Rule 5. Pure. */
export function stillActive(claim: Pick<ClaimRow, "eligible_at" | "onboarded_at">, seen: Date | null): boolean {
  return seen !== null && seen.getTime() >= activeFrom(claim).getTime();
}

/** The last moment a claim may still take a place: the end, plus the stay's days. */
export function claimDeadline(campaign: Pick<CampaignRow, "ends_at" | "hold_days">): Date {
  return new Date(campaign.ends_at.getTime() + campaign.hold_days * DAY_MS);
}

export type ReserveOutcome = "holding" | "stale" | "inactive" | "wallet_used" | "email_used" | "inviter_cap" | "waitlisted" | "full";

export type GuardOutcome = "no_person" | "inviter_gone" | "self_invite" | "existing_customer" | "staff_ineligible" | "email_used";

export type AdvanceOutcome = ClaimState | ReserveOutcome | GuardOutcome;

async function userRow(id: string): Promise<UserRow | undefined> {
  const rows = (await getSql().query(
    `select id, privy_did, wallet_address, email, avatar_id, xp, referral_code, referred_by, retired_into from users where id = $1`,
    [id],
  )) as UserRow[];
  return rows[0];
}

/** The live account a claim belongs to now (the invited friend), after any merge. */
export async function claimPerson(claim: Pick<ClaimRow, "user_id">): Promise<UserRow | undefined> {
  return liveAccount(await userRow(claim.user_id));
}

/** The live account of the claim's inviter (the one paid), after any merge. */
export async function claimInviter(claim: Pick<ClaimRow, "inviter_id">): Promise<UserRow | undefined> {
  return claim.inviter_id ? liveAccount(await userRow(claim.inviter_id)) : undefined;
}

/** The people behind a claim, with what the guards compare. */
type People = {
  person: UserRow;
  inviter: UserRow;
  invited: { accounts: string[]; wallets: string[]; emails: string[] };
  inviting: { accounts: string[]; wallets: string[]; emails: string[] };
};

async function who(accountId: string) {
  const accounts = await personAccounts(accountId);
  return { accounts, wallets: await personWallets(accounts), emails: await personEmails(accounts) };
}

/** Rule 2 for one claim, as the people are now. Null when every guard passes. */
export async function guards(claim: ClaimRow): Promise<{ refusal: GuardOutcome } | { people: People }> {
  const person = await claimPerson(claim);
  if (!person) return { refusal: "no_person" };
  const inviter = await claimInviter(claim);
  if (!inviter) return { refusal: "inviter_gone" };
  const invited = await who(person.id);
  const inviting = await who(inviter.id);
  if (sameHands(invited, inviting)) return { refusal: "self_invite" };
  if (await existingCustomer(invited.accounts, claim.created_at)) return { refusal: "existing_customer" };
  if ((await staffIneligible(invited.accounts)) || (await staffIneligible(inviting.accounts))) return { refusal: "staff_ineligible" };
  if (await emailElsewhere(invited.emails, [...invited.accounts, ...inviting.accounts])) return { refusal: "email_used" };
  return { people: { person, inviter, invited, inviting } };
}

/** The marks one payout per person stands on: every wallet and folded email of the invited person. Pure. */
export function inviteeMarks(invited: { wallets: readonly string[]; emails: readonly string[] }): string[] {
  return [...invited.wallets.map((wallet) => `wallet:${wallet}`), ...invited.emails.map((email) => `email:${email}`)];
}

/** Rejects a claim by the rules (no staff member), from any state not yet paid or closed. */
async function ruleReject(claimId: string, reason: string, now: Date): Promise<void> {
  await getSql().query(
    `update campaign_claims set state = 'rejected', reject_reason = $2, rejected_at = $3, updated_at = $3
      where id = $1 and state in ('attributed', 'buying', 'holding', 'qualified')`,
    [claimId, reason, now.toISOString()],
  );
}

async function expire(claimId: string, reason: "ended" | "full", now: Date): Promise<void> {
  await getSql().query(
    `update campaign_claims set state = 'expired', expire_reason = $3, expired_at = $2, updated_at = $2
      where id = $1 and state in ('attributed', 'buying')`,
    [claimId, now.toISOString(), reason],
  );
}

/**
 * Moves an attributed claim through rules 2 to 4 (database only): rejected
 * by a guard, left attributed until the friend is set up, then a place
 * reserved, waited for, or expired past the deadline. Any other state is
 * left as it is. Safe to run as often as asked.
 */
export async function advanceClaim(claim: ClaimRow, campaign: CampaignRow, now: Date = new Date()): Promise<AdvanceOutcome> {
  if (campaign.kind !== "invite") {
    // A retired buy campaign's open claim closes; nothing judges a buy any more.
    if (claim.state === "attributed" || claim.state === "buying") {
      await expire(claim.id, "ended", now);
      return "expired";
    }
    return claim.state;
  }
  if (claim.state !== "attributed") return claim.state;
  if (now.getTime() > claimDeadline(campaign).getTime()) {
    await expire(claim.id, claim.waitlisted_at ? "full" : "ended", now);
    return "expired";
  }
  const checked = await guards(claim);
  if ("refusal" in checked) {
    if (checked.refusal !== "no_person") await ruleReject(claim.id, checked.refusal, now);
    return checked.refusal;
  }
  const { person, inviter, invited } = checked.people;
  if (!(await onboarded(person.id))) return "attributed";
  const rows = (await getSql().query(`select campaign_reserve_invite($1, $2, $3::text[], $4::timestamptz) as outcome`, [
    claim.id,
    inviter.id,
    inviteeMarks(invited),
    now.toISOString(),
  ])) as { outcome: ReserveOutcome }[];
  return rows[0]?.outcome ?? "stale";
}

/**
 * Rule 2 and the one payout per person asked again of a claim holding a
 * place, for approval: both people now (after any merge or wallet linked
 * since), against every other claim. Null when it still stands, else why not.
 */
export async function inviteStillEligible(claim: ClaimRow): Promise<GuardOutcome | "wallet_used" | null> {
  const checked = await guards(claim);
  if ("refusal" in checked) return checked.refusal;
  const marks = inviteeMarks(checked.people.invited);
  const taken = (await getSql().query(
    `select m.mark from campaign_invitee_marks m join campaign_claims o on o.id = m.claim_id
      where m.mark = any($1::text[]) and m.claim_id <> $2 and o.state <> 'expired'`,
    [marks, claim.id],
  )) as { mark: string }[];
  if (taken.some((row) => row.mark.startsWith("wallet:"))) return "wallet_used";
  if (taken.length) return "email_used";
  return null;
}

export type CampaignStepSummary = {
  /** Invite claims whose stay ended, judged first. */
  judged: number;
  qualified: number;
  notActive: number;
  /** Open claims looked at, after the judging, while time was left. */
  advanced: number;
  reserved: number;
  expired: number;
};

/** Most claims either half of the step looks at per run. */
export const CAMPAIGN_STEP_LIMIT = 200;

/**
 * The daily step, inside the morning run (lib/server/morning). Judging
 * comes first (rule 5, database only), so a pile of invited accounts that
 * never set up can never keep a friend who stayed from qualifying; then
 * open claims are advanced, waiting ones first in the order they waited,
 * until `deadline`. Holding to qualified happens here and only here.
 */
export async function runCampaignStep({
  now = new Date(),
  limit = CAMPAIGN_STEP_LIMIT,
  deadline = Number.POSITIVE_INFINITY,
  clock = Date.now,
}: {
  now?: Date;
  limit?: number;
  /** Epoch ms (on `clock`) after which no new claim is started. */
  deadline?: number;
  clock?: () => number;
} = {}): Promise<CampaignStepSummary> {
  const sql = getSql();
  const summary: CampaignStepSummary = { judged: 0, qualified: 0, notActive: 0, advanced: 0, reserved: 0, expired: 0 };

  const due = ((await sql.query(
    `select ${CLAIM_COLUMNS.replace(/(^|,\s*)(\w+)/g, "$1cl.$2")}
       from campaign_claims cl join campaigns c on c.id = cl.campaign_id
      where c.kind = 'invite' and cl.state = 'holding' and cl.eligible_at <= $1::timestamptz
      order by cl.eligible_at asc, cl.id asc
      limit $2`,
    [now.toISOString(), limit],
  )) as Record<string, unknown>[]).map(toClaim);
  for (const claim of due) {
    if (clock() > deadline) break;
    try {
      const person = await claimPerson(claim);
      const seen = person ? await lastSeen(await personAccounts(person.id)) : null;
      const active = stillActive(claim, seen);
      const evidence = JSON.stringify({ lastSeenAt: seen?.toISOString() ?? null, activeFrom: activeFrom(claim).toISOString(), checkedAt: now.toISOString() });
      const moved = (await sql.query(
        active
          ? `update campaign_claims set state = 'qualified', qualified_at = $2, hold_checked_at = $2, hold_evidence = $3::jsonb, updated_at = $2
              where id = $1 and state = 'holding' returning id`
          : `update campaign_claims set state = 'rejected', reject_reason = 'not_active', rejected_at = $2, hold_checked_at = $2,
                    hold_evidence = $3::jsonb, updated_at = $2
              where id = $1 and state = 'holding' returning id`,
        [claim.id, now.toISOString(), evidence],
      )) as unknown[];
      if (moved.length === 0) continue;
      summary.judged += 1;
      if (active) summary.qualified += 1;
      else summary.notActive += 1;
    } catch (error) {
      console.warn("[campaigns] judge failed", claim.id.slice(0, 8), error instanceof Error ? error.message : error);
    }
  }

  const open = (await sql.query(
    `select ${CLAIM_COLUMNS}
       from campaign_claims
      where state in ('attributed', 'buying')
      order by waitlisted_at asc nulls last, updated_at asc, id asc
      limit $1`,
    [limit],
  )) as Record<string, unknown>[];
  const campaigns = new Map<string, CampaignRow>();
  const campaignOf = async (id: string) => {
    let campaign = campaigns.get(id);
    if (!campaign) {
      const rows = (await sql.query(`select ${CAMPAIGN_COLUMNS} from campaigns where id = $1`, [id])) as Record<string, unknown>[];
      campaign = rows[0] ? toCampaign(rows[0]) : undefined;
      if (campaign) campaigns.set(id, campaign);
    }
    return campaign;
  };
  for (const raw of open) {
    if (clock() > deadline) break;
    const claim = toClaim(raw);
    const campaign = await campaignOf(claim.campaign_id);
    if (!campaign) continue;
    summary.advanced += 1;
    try {
      const outcome = await advanceClaim(claim, campaign, now);
      if (outcome === "holding") summary.reserved += 1;
      if (outcome === "expired" || outcome === "full") summary.expired += 1;
      // Touch it, so a claim that never moves does not starve the ones behind it.
      if (outcome === "attributed" || outcome === "inactive" || outcome === "waitlisted") {
        await sql.query(`update campaign_claims set updated_at = $2 where id = $1`, [claim.id, now.toISOString()]);
      }
    } catch (error) {
      console.warn("[campaigns] advance failed", claim.id.slice(0, 8), error instanceof Error ? error.message : error);
    }
  }
  return summary;
}

/** Open invite claims of one inviter advanced on a progress read, at most. */
const PROGRESS_ADVANCE_LIMIT = 10;

/**
 * The inviter's view, as the home reads it: the live invite campaign's
 * rules (the one that started first), and how the friends this person
 * invited are getting on, their open claims advanced first (database
 * only). Null when no invite campaign is live and nobody this person
 * invited holds a claim. Never says anything to the invited friend.
 */
export async function campaignProgress(userId: string, now: Date = new Date()): Promise<CampaignProgress | null> {
  const sql = getSql();
  const live = ((await sql.query(
    `select ${CAMPAIGN_COLUMNS} from campaigns
      where kind = 'invite' and active and now() >= starts_at and now() <= ends_at
      order by starts_at asc, created_at asc, id asc limit 1`,
  )) as Record<string, unknown>[]).map(toCampaign)[0];
  const mine = async () =>
    ((await sql.query(
      `select ${CLAIM_COLUMNS.replace(/(^|,\s*)(\w+)/g, "$1cl.$2")}
         from campaign_claims cl
         join campaigns c on c.id = cl.campaign_id
         join users i on i.id = cl.inviter_id
        where c.kind = 'invite' and coalesce(i.retired_into, i.id) = $1
        order by cl.created_at asc, cl.id asc`,
      [userId],
    )) as Record<string, unknown>[]).map(toClaim);
  let claims = await mine();
  const open = claims.filter((claim) => claim.state === "attributed").slice(0, PROGRESS_ADVANCE_LIMIT);
  if (open.length) {
    for (const claim of open) {
      const rows = (await sql.query(`select ${CAMPAIGN_COLUMNS} from campaigns where id = $1`, [claim.campaign_id])) as Record<string, unknown>[];
      if (rows[0]) await advanceClaim(claim, toCampaign(rows[0]), now);
    }
    claims = await mine();
  }
  if (!live && claims.length === 0) return null;
  const terms =
    live ??
    ((await sql.query(`select ${CAMPAIGN_COLUMNS} from campaigns where id = $1`, [claims[claims.length - 1].campaign_id])) as Record<string, unknown>[]).map(
      toCampaign,
    )[0];
  if (!terms) return null;
  const amounts = new Map<string, number>();
  for (const claim of claims) {
    if (!amounts.has(claim.campaign_id)) {
      const rows = (await sql.query(`select amount_usd::float8 as amount_usd from campaigns where id = $1`, [claim.campaign_id])) as { amount_usd: number }[];
      amounts.set(claim.campaign_id, Number(rows[0]?.amount_usd ?? 0));
    }
  }
  const recent = claims.filter(
    (claim) => claim.state === "paid" && claim.paid_at && now.getTime() - claim.paid_at.getTime() <= PAID_LINE_DAYS * DAY_MS,
  );
  const staying = claims.filter((claim) => claim.state === "holding" && claim.eligible_at);
  const nextEligible = staying.map((claim) => claim.eligible_at!.getTime()).sort((a, b) => a - b)[0];
  return {
    amountUsd: terms.amount_usd,
    stayDays: terms.hold_days,
    perInviter: terms.max_per_inviter,
    open: Boolean(live),
    invited: claims.filter((claim) => claim.state === "attributed").length,
    staying: staying.length,
    nextEligibleAt: nextEligible === undefined ? null : new Date(nextEligible).toISOString(),
    qualified: claims.filter((claim) => claim.state === "qualified" || claim.state === "approved").length,
    paidUsd: recent.reduce((sum, claim) => sum + (amounts.get(claim.campaign_id) ?? 0), 0),
    paidAt: recent.map((claim) => claim.paid_at!.toISOString()).sort().at(-1) ?? null,
  };
}
