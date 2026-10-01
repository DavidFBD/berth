import { getSql } from "@/lib/server/db";
import { liveAccount, normalizeWallet, type UserRow } from "@/lib/server/accounts";
import { NOT_NO_XP } from "@/lib/server/no-xp";
import { hubWalletFor } from "@/lib/server/portfolio";
import { parseCaip10 } from "@/lib/identity/caip";
import { STOCK_LISTINGS } from "@/lib/listings";
import { SLOT_STATES, type CampaignProgress, type ClaimState } from "@/lib/campaigns";
import { readHoldWindow, type HoldReading, type HoldVerifier } from "@/lib/server/campaigns/hold-window";
import {
  CAMPAIGN_COLUMNS,
  CLAIM_COLUMNS,
  personAccounts,
  toCampaign,
  toClaim,
  type CampaignRow,
  type ClaimRow,
} from "@/lib/server/campaigns/store";

/**
 * Whether a campaign claim has earned its USDC, computed on the server from
 * what Berth already records. Nothing here pays anyone: the furthest a
 * claim gets on its own is `qualified`; staff approve, David pays by hand.
 *
 * THE RULES, every one of them, in the order a claim meets them:
 *
 * 1. Attributed. The account arrived through the campaign's link, new
 *    (lib/server/campaigns/store attributeCampaign). Never from where
 *    Berth is not available: the profile route does not attribute there.
 * 2. Verified email. The person (the live account, after any merge) has a
 *    verified email (users.email, written only from Privy's verified
 *    record). Until then the claim stays `attributed`; then `buying`.
 * 3. A new customer. Every account that is this person (merged ones
 *    included) is no older than the claim's own 72 hour window, and none
 *    has an order from before the claim. Else `rejected`,
 *    existing_customer: the offer is for people new to Berth, and an old
 *    account merged into the new one (or the new one into it) is not new.
 * 4. The first qualifying buy. The earliest order in the `orders` table
 *    (one row per verified fill, written by the pour route, the evening
 *    claims pass and the limit order fill, never by a claim) that is:
 *    a market buy (a limit buy fills at a time and a place Berth never
 *    learns, so it cannot be judged against "never where Berth is not";
 *    it does not count); of a stock or fund (STOCK_LISTINGS: kind
 *    "stock", the companies and the index funds; never cash, SGOV, which
 *    Berth calls cash, and never a vault); worth at least min_buy_usd by
 *    its recorded usd_value (an order whose dollar value was never known
 *    does not qualify); with its fill read (quantity); not a no XP buy
 *    (no_xp_intents); filled after the claim was made and inside the
 *    campaign's dates; and the person's own: delivered to the hub wallet
 *    of one of the person's EVM wallets (the home, any time; a linked
 *    wallet, only while it was linked), and, when the payer is an EVM
 *    address, paid from one of those wallets or their hub wallets. An
 *    order somebody else's money bought for somebody else's account,
 *    recorded on this account by hash (a non EVM sourced intent passes
 *    the pour route's ownership gate unchecked), never counts.
 * 5. A slot, reserved atomically (db/schema.sql campaign_reserve): the
 *    campaign is active; one claim per person (a sibling claim of a merged
 *    account already holding a slot rejects this one, one_per_person); one
 *    per wallet (any wallet this person ever linked, its home, the buy's
 *    payer or its delivery wallet already standing on another claim of the
 *    campaign rejects this one, wallet_used); and the budget and
 *    max_claims, counted over every claim holding a slot (holding,
 *    qualified, approved, paid) and the waitlisted claims ahead. No place:
 *    the claim waits, in order, and a place that frees goes to the one
 *    that waited longest. The claim is then `holding`, since the buy's
 *    fill, eligible hold_days later.
 * 6. Kept for the whole hold. On the first morning run at or after
 *    eligible_at, the listing's Transfer logs at the delivery wallet,
 *    from the buy's fill to now, read on Sonic (campaigns/hold-window):
 *    the lowest balance between the fill and eligible_at covers the buy's
 *    quantity. Held: `qualified`. Not: `rejected`, not_held. Unreadable:
 *    tried again the next morning, never judged on doubt.
 *
 * The deadline: a claim not holding a slot by ends_at + hold_days (the
 * buy itself must fall inside the dates) is `expired`, full when it was
 * waiting for a place, else ended. A paused campaign (active false)
 * reserves nobody new; claims already holding a slot carry on.
 */

/** The listings a qualifying buy may be of: stocks and index funds, never cash or a vault. */
export function qualifyingListings(): string[] {
  return STOCK_LISTINGS.filter((listing) => listing.kind === "stock").map((listing) => listing.address.toLowerCase());
}

const EFFECTIVE_AT = "coalesce(o.filled_at, o.placed_at, o.created_at)";
const DAY_MS = 86_400_000;
/** An account older than this before its claim was made is not new (the attribution window). */
export const NEW_ACCOUNT_MS = 72 * 3_600_000;
/** How many candidate buys are looked at for the first one that is the person's own. */
const CANDIDATE_LIMIT = 25;

export type EligibilityDeps = {
  /** The hub wallet an EVM address derives on the home chain (lib/server/portfolio). */
  deriveHubWallet?: (spoke: string) => Promise<string>;
};

export type QualifyingBuy = {
  orderId: string;
  intentTx: string;
  fillTx: string | null;
  usd: number;
  quantity: string;
  listingAddress: string;
  deliveredTo: string;
  payer: string | null;
  effectiveAt: Date;
};

export const QUALIFYING_BUY_SQL = `select o.id, o.intent_tx, o.fill_tx, o.usd_value::float8 as usd, o.quantity::text as quantity,
       o.listing_address, o.delivered_to, coalesce(o.wallet_address, o.src_address) as wallet_address, ${EFFECTIVE_AT} as effective_at
  from orders o
 where o.user_id = any($1::uuid[])
   and o.direction = 'buy'
   and o.order_type = 'market'
   and lower(o.listing_address) = any($2::text[])
   and o.usd_value is not null and o.usd_value >= $3
   and o.quantity is not null and o.quantity > 0
   and o.delivered_to ~ '^0x[0-9a-f]{40}$'
   and ${NOT_NO_XP("o")}
   and ${EFFECTIVE_AT} >= $4::timestamptz
   and ${EFFECTIVE_AT} <= $5::timestamptz
 order by ${EFFECTIVE_AT} asc, o.id asc
 limit $6`;

/** One EVM wallet of the person, and when it was theirs (null: always, the home). */
export type OwnWallet = { address: string; since: number | null; until: number | null };

/** The person's EVM wallets: every home, and every linked EVM identity with its linked span. */
export async function ownEvmWallets(accountIds: readonly string[]): Promise<OwnWallet[]> {
  const sql = getSql();
  const homes = (await sql.query(
    `select wallet_address from users where id = any($1::uuid[]) and wallet_address ~ '^0x[0-9a-f]{40}$'`,
    [accountIds],
  )) as { wallet_address: string }[];
  const linked = (await sql.query(
    `select value, coalesce(verified_at, created_at) as since, unlinked_at, is_home
       from user_identities where user_id = any($1::uuid[]) and kind = 'wallet' and family = 'evm'`,
    [accountIds],
  )) as { value: string; since: string | Date; unlinked_at: string | Date | null; is_home: boolean }[];
  const out = new Map<string, OwnWallet>();
  for (const row of homes) out.set(row.wallet_address, { address: row.wallet_address, since: null, until: null });
  for (const row of linked) {
    const address = parseCaip10(row.value)?.address?.toLowerCase();
    if (!address || out.get(address)?.since === null) continue;
    out.set(address, {
      address,
      since: row.is_home ? null : new Date(row.since).getTime(),
      until: row.unlinked_at ? new Date(row.unlinked_at).getTime() : null,
    });
  }
  return [...out.values()];
}

/** Whether a buy is the person's own (rule 4): delivered to their hub, paid from them when the payer is EVM. Pure. */
export function ownBuy(
  buy: Pick<QualifyingBuy, "deliveredTo" | "payer" | "effectiveAt">,
  wallets: readonly (OwnWallet & { hub: string | null })[],
): boolean {
  const at = buy.effectiveAt.getTime();
  const theirs = wallets.filter((wallet) => (wallet.since === null || wallet.since <= at) && (wallet.until === null || wallet.until > at));
  const delivered = buy.deliveredTo.toLowerCase();
  if (!theirs.some((wallet) => wallet.hub === delivered)) return false;
  const payer = buy.payer?.toLowerCase() ?? null;
  if (payer && /^0x[0-9a-f]{40}$/.test(payer)) {
    return theirs.some((wallet) => wallet.address === payer || wallet.hub === payer);
  }
  return true;
}

async function withHubs(wallets: readonly OwnWallet[], derive: (spoke: string) => Promise<string>) {
  return Promise.all(
    wallets.map(async (wallet) => ({ ...wallet, hub: await derive(wallet.address).then((hub) => hub.toLowerCase()).catch(() => null) })),
  );
}

export async function firstQualifyingBuy(
  accountIds: readonly string[],
  window: { min_buy_usd: number; from: Date; to: Date },
  deps: EligibilityDeps = {},
  listings: readonly string[] = qualifyingListings(),
): Promise<QualifyingBuy | null> {
  const rows = (await getSql().query(QUALIFYING_BUY_SQL, [
    accountIds,
    listings,
    window.min_buy_usd,
    window.from.toISOString(),
    window.to.toISOString(),
    CANDIDATE_LIMIT,
  ])) as Record<string, unknown>[];
  if (rows.length === 0) return null;
  const wallets = await withHubs(await ownEvmWallets(accountIds), deps.deriveHubWallet ?? hubWalletFor);
  for (const row of rows) {
    const buy: QualifyingBuy = {
      orderId: String(row.id),
      intentTx: String(row.intent_tx),
      fillTx: (row.fill_tx as string | null) ?? null,
      usd: Number(row.usd),
      quantity: String(row.quantity),
      listingAddress: String(row.listing_address),
      deliveredTo: String(row.delivered_to),
      payer: (row.wallet_address as string | null) ?? null,
      effectiveAt: new Date(row.effective_at as string),
    };
    if (ownBuy(buy, wallets)) return buy;
  }
  return null;
}

/**
 * Every wallet the person stands on, normalised: each wallet any of their
 * accounts ever linked (unlinked ones too: the account once held it), each
 * account's home address, and the buy's payer (any family: a Solana or
 * Bitcoin payer counts as much as an EVM one) and delivery wallet.
 */
export async function personWallets(accountIds: readonly string[], buy?: Pick<QualifyingBuy, "payer" | "deliveredTo"> | null): Promise<string[]> {
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
  add(buy?.payer);
  add(buy?.deliveredTo);
  return [...out].sort();
}

/**
 * Rule 3: whether this person was a customer before the claim. Any of
 * their accounts older than the attribution window before the claim, or
 * any order of theirs from before it.
 */
export async function existingCustomer(accountIds: readonly string[], claimCreated: Date): Promise<boolean> {
  const rows = (await getSql().query(
    `select exists (select 1 from users where id = any($1::uuid[]) and created_at < $2::timestamptz - make_interval(secs => $3::int / 1000))
            or exists (select 1 from orders o where o.user_id = any($1::uuid[]) and ${EFFECTIVE_AT} < $2::timestamptz) as old`,
    [accountIds, claimCreated.toISOString(), NEW_ACCOUNT_MS],
  )) as { old: boolean }[];
  return rows[0]?.old === true;
}

/** The last moment a claim may still take a slot: the end, plus the hold's days of grace. */
export function claimDeadline(campaign: Pick<CampaignRow, "ends_at" | "hold_days">): Date {
  return new Date(campaign.ends_at.getTime() + campaign.hold_days * DAY_MS);
}

export type ReserveOutcome = "holding" | "stale" | "inactive" | "outside" | "one_per_person" | "wallet_used" | "waitlisted" | "full";

export type AdvanceOutcome = ClaimState | ReserveOutcome | "no_person" | "existing_customer";

async function userRow(id: string): Promise<UserRow | undefined> {
  const rows = (await getSql().query(
    `select id, privy_did, wallet_address, email, avatar_id, xp, referral_code, referred_by, retired_into from users where id = $1`,
    [id],
  )) as UserRow[];
  return rows[0];
}

/** The live account a claim belongs to now, after any merge. */
export async function claimPerson(claim: Pick<ClaimRow, "user_id">): Promise<UserRow | undefined> {
  return liveAccount(await userRow(claim.user_id));
}

/** Rejects a claim by the rules (no staff member), from any state not yet paid or closed. */
async function ruleReject(claimId: string, reason: string, now: Date): Promise<void> {
  await getSql().query(
    `update campaign_claims set state = 'rejected', reject_reason = $2, rejected_at = $3, updated_at = $3
      where id = $1 and state in ('attributed', 'buying', 'holding', 'qualified')`,
    [claimId, reason, now.toISOString()],
  );
}

/**
 * Moves a claim through rules 1 to 5 (database only, no balance read):
 * to buying once the email is verified, to holding when the first
 * qualifying buy is in and a slot is free, to waiting while every place
 * is taken, to expired past the deadline. Any other state is left as it
 * is. Safe to run as often as asked.
 */
export async function advanceClaim(
  claim: ClaimRow,
  campaign: CampaignRow,
  now: Date = new Date(),
  deps: EligibilityDeps = {},
): Promise<AdvanceOutcome> {
  if (claim.state !== "attributed" && claim.state !== "buying") return claim.state;
  const sql = getSql();
  const person = await claimPerson(claim);
  if (!person) return "no_person";
  if (now.getTime() > claimDeadline(campaign).getTime()) {
    const reason = claim.waitlisted_at ? "full" : "ended";
    await sql.query(
      `update campaign_claims set state = 'expired', expire_reason = $3, expired_at = $2, updated_at = $2
        where id = $1 and state in ('attributed', 'buying')`,
      [claim.id, now.toISOString(), reason],
    );
    return "expired";
  }
  if (!person.email) return "attributed";
  if (claim.state === "attributed") {
    await sql.query(
      `update campaign_claims set state = 'buying', updated_at = $2 where id = $1 and state = 'attributed'`,
      [claim.id, now.toISOString()],
    );
  }
  const accounts = await personAccounts(person.id);
  if (await existingCustomer(accounts, claim.created_at)) {
    await ruleReject(claim.id, "existing_customer", now);
    return "existing_customer";
  }
  const from = new Date(Math.max(campaign.starts_at.getTime(), claim.created_at.getTime()));
  const buy = await firstQualifyingBuy(accounts, { min_buy_usd: campaign.min_buy_usd, from, to: campaign.ends_at }, deps);
  if (!buy) return "buying";
  const wallets = await personWallets(accounts, buy);
  const rows = (await sql.query(
    `select campaign_reserve($1, $2, $3, $4, $5, $6::timestamptz, $7::text[], $8::timestamptz) as outcome`,
    [claim.id, person.id, buy.orderId, buy.intentTx, buy.usd, buy.effectiveAt.toISOString(), wallets, now.toISOString()],
  )) as { outcome: ReserveOutcome }[];
  return rows[0]?.outcome ?? "stale";
}

/**
 * Rules 3 and 5 asked again of a claim already holding a slot, for
 * approval: the person now (after any merge since), against every other
 * claim of the campaign. Null when it still stands, else why not.
 */
export async function personStillEligible(claim: ClaimRow): Promise<"one_per_person" | "wallet_used" | "existing_customer" | "no_person" | null> {
  const sql = getSql();
  const person = await claimPerson(claim);
  if (!person) return "no_person";
  const accounts = await personAccounts(person.id);
  if (await existingCustomer(accounts, claim.created_at)) return "existing_customer";
  const sibling = (await sql.query(
    `select 1 from campaign_claims o join users u on u.id = o.user_id
      where o.campaign_id = $1 and o.id <> $2 and coalesce(u.retired_into, u.id) = $3
        and o.state = any($4::text[]) limit 1`,
    [claim.campaign_id, claim.id, person.id, SLOT_STATES],
  )) as unknown[];
  if (sibling.length) return "one_per_person";
  const wallets = await personWallets(accounts);
  const used = (await sql.query(
    `select 1 from campaign_claim_wallets w join campaign_claims o on o.id = w.claim_id
      where w.campaign_id = $1 and w.claim_id <> $2 and w.wallet = any($3::text[])
        and o.state <> 'expired' limit 1`,
    [claim.campaign_id, claim.id, wallets],
  )) as unknown[];
  if (used.length) return "wallet_used";
  return null;
}

export type HoldEvidence = {
  listing: string;
  wallet: string;
  /** Decimal units the buy delivered. */
  needed: string;
  /** Raw units at the wallet when read, as a decimal string. */
  balanceRaw: string | null;
  /** The lowest raw balance between the fill and the end of the hold. */
  lowestRaw: string | null;
  outflows: number | null;
  checkedAt: string;
};

type DueRow = {
  id: string;
  quantity: string | null;
  listing_address: string | null;
  delivered_to: string | null;
  intent_tx: string | null;
  fill_tx: string | null;
  eligible_at: string | Date;
  order_id: string | null;
  no_xp: boolean;
};

export type CampaignStepSummary = {
  /** holding claims due, judged first. */
  judged: number;
  qualified: number;
  notHeld: number;
  retried: number;
  /** attributed or buying claims looked at, after the judging, while time was left. */
  advanced: number;
  reserved: number;
  expired: number;
};

/** Most claims either half of the step looks at per run. */
export const CAMPAIGN_STEP_LIMIT = 200;
/** A hold window unreadable this long is flagged on the queue for review. */
export const UNREADABLE_FLAG_MS = 3 * DAY_MS;
/** And this long, rejected (hold_unreadable): its slot goes to the next claim. */
export const UNREADABLE_RELEASE_MS = 7 * DAY_MS;
/** Hold windows read at once. */
const HOLD_CONCURRENCY = 4;

/** The query for one due claim, from its order. */
export function holdQuery(row: Pick<DueRow, "delivered_to" | "listing_address" | "fill_tx" | "intent_tx" | "quantity" | "eligible_at">) {
  return {
    holder: row.delivered_to!.toLowerCase(),
    listing: row.listing_address!.toLowerCase(),
    startTx: (row.fill_tx ?? row.intent_tx)!,
    quantity: row.quantity!,
    until: new Date(row.eligible_at),
  };
}

export function evidenceOf(reading: HoldReading, row: Pick<DueRow, "listing_address" | "delivered_to" | "quantity">, now: Date): HoldEvidence {
  return {
    listing: row.listing_address!,
    wallet: row.delivered_to!,
    needed: row.quantity!,
    balanceRaw: reading.verdict === "unknown" ? null : reading.balanceRaw,
    lowestRaw: reading.verdict === "unknown" ? null : reading.lowestRaw,
    outflows: reading.verdict === "unknown" ? null : reading.outflows,
    checkedAt: now.toISOString(),
  };
}

const DUE_SQL = `select cl.id, o.quantity::text as quantity, o.listing_address, o.delivered_to, cl.intent_tx, o.fill_tx,
            cl.eligible_at, cl.order_id,
            exists (select 1 from no_xp_intents n where n.intent_tx = cl.intent_tx) as no_xp
       from campaign_claims cl
       left join orders o on o.id = cl.order_id
      where cl.state = 'holding' and cl.eligible_at <= $1::timestamptz`;

/**
 * The daily step, inside the morning run (lib/server/morning). Judging
 * comes first, so a pile of link arrivals who never buy can never keep a
 * held buy from qualifying; then open claims are advanced, waiting claims
 * first in the order they waited, until `deadline`. Holding to qualified
 * happens here and only here.
 */
export async function runCampaignStep({
  now = new Date(),
  verifyHold = readHoldWindow(),
  limit = CAMPAIGN_STEP_LIMIT,
  deadline = Number.POSITIVE_INFINITY,
  clock = Date.now,
  deps = {},
}: {
  now?: Date;
  verifyHold?: HoldVerifier;
  limit?: number;
  /** Epoch ms (on `clock`) after which no new claim is started. */
  deadline?: number;
  clock?: () => number;
  deps?: EligibilityDeps;
} = {}): Promise<CampaignStepSummary> {
  const sql = getSql();
  const summary: CampaignStepSummary = { judged: 0, qualified: 0, notHeld: 0, retried: 0, advanced: 0, reserved: 0, expired: 0 };

  const unreadable: string[] = [];
  const due = (await sql.query(
    `${DUE_SQL}
      order by cl.hold_attempted_at asc nulls first, cl.eligible_at asc, cl.id asc
      limit $2`,
    [now.toISOString(), limit],
  )) as DueRow[];
  const retried: string[] = [];
  const judge = async (row: DueRow) => {
    if (!row.order_id) {
      // The order behind the claim was deleted: nothing left to judge, ever.
      await ruleReject(row.id, "order_missing", now);
      summary.notHeld += 1;
      return;
    }
    if (!row.quantity || !row.listing_address || !row.delivered_to || !row.intent_tx) {
      retried.push(row.id);
      return;
    }
    summary.judged += 1;
    // A no XP buy never qualifies, whenever the mark was written.
    const reading: HoldReading = row.no_xp
      ? { verdict: "not_held", balanceRaw: "0", lowestRaw: "0", outflows: 0, fromBlock: "0", toBlock: "0" }
      : await verifyHold(holdQuery(row));
    if (reading.verdict === "unknown") {
      retried.push(row.id);
      unreadable.push(row.id);
      return;
    }
    const held = reading.verdict === "held";
    const moved = (await sql.query(
      held
        ? `update campaign_claims set state = 'qualified', qualified_at = $2, hold_checked_at = $2, hold_evidence = $3::jsonb,
                  hold_unreadable_since = null, updated_at = $2
            where id = $1 and state = 'holding' returning id`
        : `update campaign_claims set state = 'rejected', reject_reason = $4, rejected_at = $2, hold_checked_at = $2,
                  hold_evidence = $3::jsonb, hold_unreadable_since = null, updated_at = $2
            where id = $1 and state = 'holding' returning id`,
      held
        ? [row.id, now.toISOString(), JSON.stringify(evidenceOf(reading, row, now))]
        : [row.id, now.toISOString(), JSON.stringify(evidenceOf(reading, row, now)), "not_held"],
    )) as unknown[];
    if (moved.length === 0) return;
    if (held) summary.qualified += 1;
    else summary.notHeld += 1;
  };
  for (let index = 0; index < due.length; index += HOLD_CONCURRENCY) {
    if (clock() > deadline) {
      retried.push(...due.slice(index).map((row) => row.id));
      break;
    }
    await Promise.all(
      due.slice(index, index + HOLD_CONCURRENCY).map((row) =>
        judge(row).catch((error) => {
          console.warn("[campaigns] judge failed", row.id.slice(0, 8), error instanceof Error ? error.message : error);
          retried.push(row.id);
        }),
      ),
    );
  }
  if (retried.length > 0) {
    summary.retried += retried.length;
    await sql.query(`update campaign_claims set hold_attempted_at = $2 where id = any($1::uuid[])`, [retried, now.toISOString()]);
  }
  if (unreadable.length > 0) {
    // When the window first went unread; a week of it, and the slot is let go.
    await sql.query(
      `update campaign_claims set hold_unreadable_since = coalesce(hold_unreadable_since, $2::timestamptz)
        where id = any($1::uuid[]) and state = 'holding'`,
      [unreadable, now.toISOString()],
    );
    const released = (await sql.query(
      `update campaign_claims set state = 'rejected', reject_reason = 'hold_unreadable', rejected_at = $2, updated_at = $2
        where id = any($1::uuid[]) and state = 'holding'
          and hold_unreadable_since <= $2::timestamptz - make_interval(secs => $3::int / 1000)
        returning id`,
      [unreadable, now.toISOString(), UNREADABLE_RELEASE_MS],
    )) as unknown[];
    summary.notHeld += released.length;
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
      const outcome = await advanceClaim(claim, campaign, now, deps);
      if (outcome === "holding") summary.reserved += 1;
      if (outcome === "expired" || outcome === "full") summary.expired += 1;
      // Touch it, so a claim that never moves does not starve the ones behind it.
      if (outcome === "attributed" || outcome === "buying" || outcome === "inactive") {
        await sql.query(`update campaign_claims set updated_at = $2 where id = $1`, [claim.id, now.toISOString()]);
      }
    } catch (error) {
      console.warn("[campaigns] advance failed", claim.id.slice(0, 8), error instanceof Error ? error.message : error);
    }
  }
  return summary;
}

/**
 * The hold asked again for one claim, for approval (lib/server/campaigns
 * actions): the same window read, against the claim's own order.
 */
export async function recheckHold(claim: ClaimRow, verifyHold: HoldVerifier = readHoldWindow()): Promise<HoldReading> {
  const rows = (await getSql().query(
    `select o.quantity::text as quantity, o.listing_address, o.delivered_to, o.intent_tx, o.fill_tx, $2::timestamptz as eligible_at
       from orders o where o.id = $1`,
    [claim.order_id, (claim.eligible_at ?? new Date()).toISOString()],
  )) as DueRow[];
  const row = rows[0];
  if (!row?.quantity || !row.listing_address || !row.delivered_to) return { verdict: "unknown", error: "order missing" };
  return verifyHold(holdQuery(row));
}

/** How long a closed line (rejected, or expired after a buy) stays on the home. */
export const CLOSED_LINE_DAYS = 14;

/**
 * The person's own claim, advanced first (database only), as the home
 * reads it. The claim of any account merged into this one counts; the one
 * holding a slot wins, else the earliest.
 */
export async function campaignProgress(userId: string, now: Date = new Date(), deps: EligibilityDeps = {}): Promise<CampaignProgress | null> {
  const sql = getSql();
  const accounts = await personAccounts(userId);
  const find = async () =>
    (await sql.query(
      `select ${CLAIM_COLUMNS} from campaign_claims
        where user_id = any($1::uuid[])
        order by (state = any($2::text[])) desc, created_at asc, id asc
        limit 1`,
      [accounts, SLOT_STATES],
    )) as Record<string, unknown>[];
  let rows = await find();
  if (!rows[0]) return null;
  let claim = toClaim(rows[0]);
  const campaignRows = (await sql.query(`select ${CAMPAIGN_COLUMNS} from campaigns where id = $1`, [claim.campaign_id])) as Record<string, unknown>[];
  if (!campaignRows[0]) return null;
  const campaign = toCampaign(campaignRows[0]);
  if (claim.state === "attributed" || claim.state === "buying") {
    await advanceClaim(claim, campaign, now, deps);
    rows = await find();
    if (!rows[0]) return null;
    claim = toClaim(rows[0]);
  }
  // An expiry with no buy behind it says nothing at all; any other close says so for a while, then goes.
  const closedAt = claim.state === "rejected" ? claim.rejected_at : claim.state === "expired" ? claim.expired_at : null;
  if (claim.state === "expired" && !claim.order_id && !claim.waitlisted_at && claim.expire_reason !== "full") return null;
  if (closedAt && now.getTime() - closedAt.getTime() > CLOSED_LINE_DAYS * DAY_MS) return null;
  // The rules line is a promise: while the campaign is paused it is not made.
  if ((claim.state === "attributed" || claim.state === "buying") && !campaign.active && !claim.waitlisted_at) return null;
  return {
    state: claim.state,
    amountUsd: campaign.amount_usd,
    minBuyUsd: campaign.min_buy_usd,
    holdDays: campaign.hold_days,
    holdingSince: claim.holding_since?.toISOString() ?? null,
    eligibleAt: claim.eligible_at?.toISOString() ?? null,
    paidAt: claim.paid_at?.toISOString() ?? null,
    waitlisted: claim.state === "buying" && claim.waitlisted_at !== null,
    closedAt: closedAt?.toISOString() ?? null,
  };
}
