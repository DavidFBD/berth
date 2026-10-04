import { getAddress } from "viem";
import { getSql } from "@/lib/server/db";
import { parseCaip10 } from "@/lib/identity/caip";
import { CLAIM_STATES, SLOT_STATES, type CampaignKind, type ClaimState } from "@/lib/campaigns";
import { CAMPAIGN_COLUMNS, toCampaign, type CampaignRow } from "@/lib/server/campaigns/store";
import { PAYOUT_CHAIN } from "@/lib/server/campaigns/usdc";
import { foldEmail } from "@/lib/server/campaigns/fold-email";
import { WEBMAIL_DOMAINS } from "@/lib/webmail";
import { stillEligible, type GuardOutcome } from "@/lib/server/campaigns/eligibility";
import { claimById } from "@/lib/server/campaigns/store";

export { foldEmail };

/**
 * The staff review queue (app/staff/campaigns, pnpm campaign:queue): every
 * campaign with its budget meter, and every claim past "arrived, not set
 * up yet" with the evidence a reviewer needs: the account that opened
 * through the campaign's link, who is the one paid (signed up, set up,
 * last opened Berth, wallets, where to pay), and the signals Berth can
 * derive from what it already keeps. Berth keeps no device data, so no
 * device signal exists; the page says so. Read only.
 */

export type SignalCode = "email_alias" | "close_signup" | "shared_wallet" | "same_payout" | "same_email_domain";

export { WEBMAIL_DOMAINS };

/** The domain of a folded email, or null. Pure. */
const emailDomain = (email: string | null): string | null => {
  const folded = foldEmail(email);
  return folded ? folded.split("@")[1] || null : null;
};

type Wallet = { address: string; family: string; linked: boolean };

export type QueueClaim = {
  id: string;
  campaignId: string;
  campaignCode: string;
  campaignKind: CampaignKind;
  state: ClaimState;
  /** The live account (after any merge) that opened through the link: the one paid. */
  userId: string;
  email: string | null;
  signupAt: string;
  attributedAt: string;
  /** When the account was first seen set up; the place was reserved then. */
  onboardedAt: string | null;
  /** When the stay is judged. */
  eligibleAt: string | null;
  /** The last signed in visit: as judged once judged, else as it stands. */
  lastSeenAt: string | null;
  wallets: Wallet[];
  /** Fixed at approval; before it, the address approval would fix (the account's own home). */
  payout: { address: string | null; chain: string; token: "USDC"; amountUsd: number };
  paid: { at: string | null; tx: string | null; verified: boolean | null } | null;
  reason: string | null;
  signals: SignalCode[];
  /**
   * When staff marked the person (any of their accounts) not
   * eligible for campaigns, or null. Mark paid refuses such a claim; the
   * queue says so first, so nobody sends USDC by hand to one marked since.
   */
  staffIneligibleAt: string | null;
  /**
   * An approved claim only: what the campaign's checks say of the person
   * now, or null when they still stand. Something linked or merged since
   * approval shows here, so staff see it before sending USDC by hand.
   */
  eligibilityNow: GuardOutcome | "wallet_used" | null;
};

export type CampaignMeter = {
  id: string;
  code: string;
  title: string;
  kind: CampaignKind;
  active: boolean;
  startsAt: string;
  endsAt: string;
  amountUsd: number;
  budgetUsd: number;
  maxClaims: number;
  /** Days after setting up that the account must still use Berth. */
  stayDays: number;
  /** Never activated: a draft. */
  draft: boolean;
  /**
   * Staff may delete it now: a signup campaign, inactive, and no claim of it
   * holds or ever held a place, was paid, or stands on a person's marks
   * (db/schema.sql campaign_delete asks the same).
   */
  deletable: boolean;
  counts: Record<ClaimState, number>;
  /** Holding, qualified and approved, in dollars. */
  reservedUsd: number;
  paidUsd: number;
  /** Claims holding a place, paid included. */
  slots: number;
  /** The wallets a payout may come from (checksummed), active ones only. */
  payoutSources: { id: string; address: string; addedAt: string; reason: string }[];
};

export type StaffQueue = { campaigns: CampaignMeter[]; claims: QueueClaim[] };

/** Ten minutes: two signups this close together is worth a look. */
export const CLOSE_SIGNUP_MS = 10 * 60_000;

export type SignalInput = {
  id: string;
  campaignId: string;
  /** The person paid. */
  userId: string;
  email: string | null;
  signupAt: number;
  wallets: readonly string[];
  /** Where the USDC would go (fixed at approval, else the account's own home). */
  payout?: string | null;
};

/** The signals, per claim, from the other claims of the same campaign. Pure. */
export function deriveSignals(claims: readonly SignalInput[]): Map<string, SignalCode[]> {
  const out = new Map<string, SignalCode[]>();
  for (const claim of claims) {
    const others = claims.filter((other) => other.campaignId === claim.campaignId && other.userId !== claim.userId);
    const signals: SignalCode[] = [];
    const folded = foldEmail(claim.email);
    const close = (other: SignalInput) => Math.abs(other.signupAt - claim.signupAt) <= CLOSE_SIGNUP_MS;
    if (folded && others.some((other) => foldEmail(other.email) === folded)) signals.push("email_alias");
    if (others.some(close)) signals.push("close_signup");
    if (others.some((other) => other.wallets.some((wallet) => claim.wallets.includes(wallet)))) signals.push("shared_wallet");
    if (claim.payout && claims.some((other) => other.userId !== claim.userId && other.payout === claim.payout)) signals.push("same_payout");
    const domain = emailDomain(claim.email);
    if (domain && !WEBMAIL_DOMAINS.has(domain) && others.some((other) => emailDomain(other.email) === domain)) signals.push("same_email_domain");
    out.set(claim.id, signals);
  }
  return out;
}

const iso = (value: unknown): string | null => (value === null || value === undefined ? null : new Date(value as string).toISOString());

/** Closed claims (rejected, expired) listed: the most recent this many. */
export const CLOSED_SHOWN = 50;

/** "a•••@example.com": the first letter and the domain. */
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.split("@");
  return domain ? `${local.slice(0, 1)}•••@${domain}` : "•••";
}

/** "0x1234…abcd", or the same shape for any family. */
export function maskWallet(address: string | null): string | null {
  if (!address) return null;
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : "•••";
}

const maskWallets = (wallets: Wallet[]) => wallets.map((wallet) => ({ ...wallet, address: maskWallet(wallet.address)! }));

/** The claim with every email and wallet masked: how the queue goes out unless a field is revealed. */
export function maskClaim(claim: QueueClaim): QueueClaim {
  return {
    ...claim,
    email: maskEmail(claim.email),
    wallets: maskWallets(claim.wallets),
    payout: { ...claim.payout, address: maskWallet(claim.payout.address) },
  };
}

export type RevealField = "email" | "wallets";

/** One claim's field in full, for an audited reveal on the staff page. */
export async function revealClaim(claimId: string, field: RevealField): Promise<Record<string, unknown> | null> {
  const claim = (await staffQueue({ reveal: true })).claims.find((entry) => entry.id === claimId);
  if (!claim) return null;
  if (field === "email") return { email: claim.email };
  return { wallets: claim.wallets, payout: claim.payout.address };
}

/**
 * The queue. Emails and wallets are masked unless `reveal` (the CLI's
 * --reveal, or one claim's audited reveal on the page).
 */
export async function staffQueue({ reveal = false }: { reveal?: boolean } = {}): Promise<StaffQueue> {
  const sql = getSql();
  const campaignRows = ((await sql.query(`select ${CAMPAIGN_COLUMNS} from campaigns order by created_at desc`)) as Record<string, unknown>[]).map(
    toCampaign,
  );
  const rows = (await sql.query(
    `select cl.id, cl.campaign_id, c.code, c.kind, cl.state, cl.created_at, cl.onboarded_at, cl.eligible_at, cl.hold_evidence,
            cl.payout_address, cl.paid_at, cl.paid_tx, cl.paid_verified,
            coalesce(cl.reject_reason, cl.expire_reason) as reason, c.amount_usd::float8 as amount_usd,
            p.id as person_id, p.email, p.created_at as signup_at, p.wallet_address as home,
            (select max(x.last_seen_at) from users x where x.id = p.id or x.retired_into = p.id) as last_seen_at,
            (select max(x.campaign_ineligible_at) from users x where x.id = p.id or x.retired_into = p.id) as staff_ineligible_at
       from campaign_claims cl
       join campaigns c on c.id = cl.campaign_id
       join users u on u.id = cl.user_id
       join users p on p.id = coalesce(u.retired_into, u.id)
      order by cl.updated_at desc, cl.id`,
  )) as Record<string, unknown>[];
  const keptRows = (await sql.query(
    `select distinct cl.campaign_id from campaign_claims cl
      where cl.state in ('holding', 'qualified', 'approved', 'paid')
         or cl.onboarded_at is not null or cl.holding_since is not null or cl.paid_tx is not null or cl.paid_at is not null
         or exists (select 1 from campaign_invitee_marks m where m.claim_id = cl.id)`,
  )) as { campaign_id: string }[];
  const kept = new Set(keptRows.map((row) => String(row.campaign_id)));
  const sourceRows = (await sql.query(
    `select id, campaign_id, address, added_at, added_reason from campaign_payout_sources where removed_at is null order by added_at`,
  )) as { id: string; campaign_id: string; address: string; added_at: string | Date; added_reason: string }[];
  const people = [...new Set(rows.map((row) => String(row.person_id)))];
  const identityRows = (people.length
    ? await sql.query(
        `select coalesce(u.retired_into, u.id) as person, i.value, i.family, i.unlinked_at is null as linked
           from user_identities i join users u on u.id = i.user_id
          where i.kind = 'wallet' and coalesce(u.retired_into, u.id) = any($1::uuid[])
          order by i.is_home desc, i.created_at`,
        [people],
      )
    : []) as { person: string; value: string; family: string; linked: boolean }[];
  const walletsOf = new Map<string, Wallet[]>();
  for (const row of identityRows) {
    const address = parseCaip10(row.value)?.address;
    if (!address) continue;
    const list = walletsOf.get(row.person) ?? [];
    if (!list.some((wallet) => wallet.address === address)) list.push({ address, family: row.family, linked: row.linked });
    walletsOf.set(row.person, list);
  }
  const walletsWithHome = (person: string, home: unknown): Wallet[] => {
    const wallets = [...(walletsOf.get(person) ?? [])];
    if (home && !wallets.some((wallet) => wallet.address === home)) wallets.unshift({ address: String(home), family: "evm", linked: true });
    return wallets;
  };

  const counts = new Map<string, Record<ClaimState, number>>();
  for (const campaign of campaignRows) {
    counts.set(campaign.id, Object.fromEntries(CLAIM_STATES.map((state) => [state, 0])) as Record<ClaimState, number>);
  }
  for (const row of rows) {
    const record = counts.get(String(row.campaign_id));
    if (record) record[row.state as ClaimState] += 1;
  }

  const payoutOf = (row: Record<string, unknown>) => ((row.payout_address as string | null) ?? (row.home as string | null) ?? null)?.toLowerCase() ?? null;
  const signals = deriveSignals(
    rows.map((row) => ({
      id: String(row.id),
      campaignId: String(row.campaign_id),
      userId: String(row.person_id),
      email: (row.email as string | null) ?? null,
      signupAt: new Date(row.signup_at as string).getTime(),
      wallets: walletsWithHome(String(row.person_id), row.home).map((wallet) => wallet.address),
      payout: payoutOf(row),
    })),
  );

  let closedShown = 0;
  const claims: QueueClaim[] = [];
  for (const row of rows) {
    const state = row.state as ClaimState;
    if (state === "attributed" || state === "buying") continue;
    if (state === "rejected" || state === "expired") {
      closedShown += 1;
      if (closedShown > CLOSED_SHOWN) continue;
    }
    const person = String(row.person_id);
    const evidence = (row.hold_evidence as Record<string, unknown> | null) ?? null;
    const judgedSeen = typeof evidence?.lastSeenAt === "string" || evidence?.lastSeenAt === null ? (evidence.lastSeenAt as string | null) : undefined;
    claims.push({
      id: String(row.id),
      campaignId: String(row.campaign_id),
      campaignCode: String(row.code),
      campaignKind: row.kind as CampaignKind,
      state,
      userId: person,
      email: (row.email as string | null) ?? null,
      signupAt: iso(row.signup_at)!,
      attributedAt: iso(row.created_at)!,
      onboardedAt: iso(row.onboarded_at),
      eligibleAt: iso(row.eligible_at),
      lastSeenAt: judgedSeen !== undefined ? iso(judgedSeen) : iso(row.last_seen_at),
      wallets: walletsWithHome(person, row.home),
      payout: {
        address: (row.payout_address as string | null) ?? (row.home as string | null) ?? null,
        chain: PAYOUT_CHAIN.name,
        token: "USDC",
        amountUsd: Number(row.amount_usd),
      },
      paid: row.paid_tx ? { at: iso(row.paid_at), tx: String(row.paid_tx), verified: (row.paid_verified as boolean | null) ?? null } : null,
      reason: (row.reason as string | null) ?? null,
      signals: signals.get(String(row.id)) ?? [],
      staffIneligibleAt: iso(row.staff_ineligible_at),
      eligibilityNow: null,
    });
  }

  for (const claim of claims) {
    if (claim.state !== "approved") continue;
    const stored = await claimById(claim.id);
    claim.eligibilityNow = stored ? await stillEligible(stored) : null;
  }

  return {
    claims: reveal ? claims : claims.map(maskClaim),
    campaigns: campaignRows.map((campaign: CampaignRow) => {
      const record = counts.get(campaign.id)!;
      const reserved = record.holding + record.qualified + record.approved;
      return {
        id: campaign.id,
        code: campaign.code,
        title: campaign.title,
        kind: campaign.kind,
        active: campaign.active,
        startsAt: campaign.starts_at.toISOString(),
        endsAt: campaign.ends_at.toISOString(),
        amountUsd: campaign.amount_usd,
        budgetUsd: campaign.budget_usd,
        maxClaims: campaign.max_claims,
        stayDays: campaign.hold_days,
        draft: campaign.activated_at === null,
        deletable: campaign.kind === "signup" && !campaign.active && !kept.has(campaign.id),
        counts: record,
        reservedUsd: reserved * campaign.amount_usd,
        paidUsd: record.paid * campaign.amount_usd,
        slots: SLOT_STATES.reduce((sum, state) => sum + record[state], 0),
        payoutSources: sourceRows
          .filter((source) => source.campaign_id === campaign.id)
          .map((source) => ({ id: source.id, address: getAddress(source.address), addedAt: iso(source.added_at)!, reason: source.added_reason })),
      };
    }),
  };
}

/** The queue as plain text, for pnpm campaign:queue. Pure. */
export function formatQueue(queue: StaffQueue): string {
  const usd = (value: number) => `$${value.toFixed(2)}`;
  const day = (value: string | null) => (value ? value.slice(0, 16).replace("T", " ") : "?");
  const list = (wallets: Wallet[]) => wallets.map((wallet) => `${wallet.address}${wallet.linked ? "" : " (unlinked)"}`).join(", ") || "none";
  const lines: string[] = [];
  for (const campaign of queue.campaigns) {
    lines.push(
      `${campaign.code} (${campaign.title}) ${campaign.kind === "signup" ? "" : `RETIRED ${campaign.kind} campaign, `}${campaign.active ? "ACTIVE" : "inactive"}, ${day(campaign.startsAt)} to ${day(campaign.endsAt)}`,
      `  ${usd(campaign.amountUsd)} to each new account opened through the link, set up and still using Berth ${campaign.stayDays} days after setting up`,
      `  budget: ${usd(campaign.reservedUsd)} reserved, ${usd(campaign.paidUsd)} paid, of ${usd(campaign.budgetUsd)}; ${campaign.slots}/${campaign.maxClaims} places`,
      `  ${Object.entries(campaign.counts)
        .map(([state, count]) => `${state} ${count}`)
        .join(", ")}`,
    );
  }
  const order = ["qualified", "approved", "holding", "paid", "rejected", "expired"] as const;
  for (const state of order) {
    const claims = queue.claims.filter((claim) => claim.state === state);
    if (claims.length === 0) continue;
    lines.push("", `${state.toUpperCase()} (${claims.length})`);
    for (const claim of claims) {
      lines.push(`  ${claim.id.slice(0, 8)} ${claim.campaignCode} account ${claim.userId.slice(0, 8)} ${claim.email ?? "(no email)"}, signed up ${day(claim.signupAt)}`);
      if (claim.onboardedAt) lines.push(`    set up ${day(claim.onboardedAt)}, judged ${day(claim.eligibleAt)}, last opened Berth ${day(claim.lastSeenAt)}`);
      lines.push(`    wallets ${list(claim.wallets)}`);
      if (claim.state === "qualified" || claim.state === "approved") {
        lines.push(`    pay the account ${usd(claim.payout.amountUsd)} ${claim.payout.token} on ${claim.payout.chain} to ${claim.payout.address ?? "(no home address)"}`);
      }
      if (claim.paid) lines.push(`    paid ${day(claim.paid.at)} tx ${claim.paid.tx} ${claim.paid.verified ? "verified" : "NOT verified"}`);
      if (claim.reason) lines.push(`    reason ${claim.reason}`);
      lines.push(`    signals ${claim.signals.join(", ") || "none"} (no device data is kept)`);
    }
  }
  return lines.join("\n");
}
