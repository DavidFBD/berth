import { getAddress } from "viem";
import { getSql } from "@/lib/server/db";
import { parseCaip10 } from "@/lib/identity/caip";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { CLAIM_STATES, SLOT_STATES, type ClaimState } from "@/lib/campaigns";
import { CAMPAIGN_COLUMNS, toCampaign, type CampaignRow } from "@/lib/server/campaigns/store";
import { PAYOUT_CHAIN } from "@/lib/server/campaigns/usdc";
import { UNREADABLE_FLAG_MS } from "@/lib/server/campaigns/eligibility";

/**
 * The staff review queue (app/staff/campaigns, pnpm campaign:queue): every
 * campaign with its budget meter, and every claim past "waiting for a buy"
 * with the evidence a reviewer needs: the qualifying order, the hold
 * check, the person's wallets, when they signed up, where to pay, and the
 * signals Berth can derive from what it already keeps. Berth keeps no
 * device data, so no device signal exists; the page says so. Read only.
 */

export type SignalCode =
  | "same_payer"
  | "email_alias"
  | "close_signup"
  | "referred_by_claimant"
  | "same_delivery"
  | "shared_wallet"
  | "same_payout"
  | "hold_unreadable";

export type QueueClaim = {
  id: string;
  campaignId: string;
  campaignCode: string;
  state: ClaimState;
  /** The live account (after any merge). */
  userId: string;
  email: string | null;
  signupAt: string;
  attributedAt: string;
  buy: {
    intentTx: string;
    listing: string;
    usd: number | null;
    quantity: string | null;
    filledAt: string | null;
    deliveredTo: string | null;
    payer: string | null;
  } | null;
  holdingSince: string | null;
  eligibleAt: string | null;
  /** The hold window has gone unread since then (null when it reads). */
  unreadableSince: string | null;
  hold: {
    checkedAt: string | null;
    needed: string | null;
    balanceRaw: string | null;
    /** The lowest balance between the fill and the end of the hold. */
    lowestRaw: string | null;
    /** Transfers out of the delivery wallet in that window. */
    outflows: number | null;
    wallet: string | null;
  } | null;
  wallets: { address: string; family: string; linked: boolean }[];
  /** Fixed at approval; before it, the address approval would fix. */
  payout: { address: string | null; chain: string; token: "USDC"; amountUsd: number };
  paid: { at: string | null; tx: string | null; verified: boolean | null } | null;
  reason: string | null;
  signals: SignalCode[];
  /**
   * When staff marked this person (any of its accounts) not eligible for
   * campaigns, or null. Mark paid refuses such a claim; the queue says so
   * first, so nobody sends USDC by hand to an approved claim marked since.
   */
  staffIneligibleAt: string | null;
};

export type CampaignMeter = {
  id: string;
  code: string;
  title: string;
  active: boolean;
  startsAt: string;
  endsAt: string;
  amountUsd: number;
  budgetUsd: number;
  maxClaims: number;
  minBuyUsd: number;
  holdDays: number;
  counts: Record<ClaimState, number>;
  /** Holding, qualified and approved, in dollars. */
  reservedUsd: number;
  paidUsd: number;
  /** Claims holding a slot, paid included. */
  slots: number;
  /** The wallets a payout may come from (checksummed), active ones only. */
  payoutSources: { id: string; address: string; addedAt: string; reason: string }[];
};

export type StaffQueue = { campaigns: CampaignMeter[]; claims: QueueClaim[] };

/** The address an alias folds to: a plus tag dropped, and for Gmail the dots too. */
export function foldEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.trim().toLowerCase().split("@");
  if (!local || !domain) return null;
  const host = domain === "googlemail.com" ? "gmail.com" : domain;
  let name = local.split("+")[0];
  if (host === "gmail.com") name = name.replace(/\./g, "");
  return `${name}@${host}`;
}

/** Ten minutes: two claimants signing up this close together is worth a look. */
export const CLOSE_SIGNUP_MS = 10 * 60_000;

export type SignalInput = {
  id: string;
  campaignId: string;
  userId: string;
  email: string | null;
  signupAt: number;
  referredBy: string | null;
  payer: string | null;
  deliveredTo: string | null;
  wallets: readonly string[];
  /** Where the USDC would go (fixed at approval, else the home). */
  payout?: string | null;
};

/** The signals, per claim, from the other claims of the same campaign. Pure. */
export function deriveSignals(claims: readonly SignalInput[]): Map<string, SignalCode[]> {
  const out = new Map<string, SignalCode[]>();
  for (const claim of claims) {
    const others = claims.filter((other) => other.campaignId === claim.campaignId && other.userId !== claim.userId);
    const signals: SignalCode[] = [];
    const folded = foldEmail(claim.email);
    if (claim.payer && others.some((other) => other.payer === claim.payer)) signals.push("same_payer");
    if (folded && others.some((other) => foldEmail(other.email) === folded)) signals.push("email_alias");
    if (others.some((other) => Math.abs(other.signupAt - claim.signupAt) <= CLOSE_SIGNUP_MS)) signals.push("close_signup");
    if (claim.referredBy && others.some((other) => other.userId === claim.referredBy)) signals.push("referred_by_claimant");
    if (claim.deliveredTo && others.some((other) => other.deliveredTo === claim.deliveredTo)) signals.push("same_delivery");
    if (others.some((other) => other.wallets.some((wallet) => claim.wallets.includes(wallet)))) signals.push("shared_wallet");
    if (claim.payout && claims.some((other) => other.id !== claim.id && other.payout === claim.payout)) signals.push("same_payout");
    out.set(claim.id, signals);
  }
  return out;
}

const NAME_BY_ADDRESS = new Map(TOKEN_LISTINGS.map((listing) => [listing.address.toLowerCase(), listing.name]));

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

/** The claim with its email and every wallet masked: how the queue goes out unless a field is revealed. */
export function maskClaim(claim: QueueClaim): QueueClaim {
  return {
    ...claim,
    email: maskEmail(claim.email),
    buy: claim.buy ? { ...claim.buy, payer: maskWallet(claim.buy.payer), deliveredTo: maskWallet(claim.buy.deliveredTo) } : null,
    hold: claim.hold ? { ...claim.hold, wallet: maskWallet(claim.hold.wallet) } : null,
    wallets: claim.wallets.map((wallet) => ({ ...wallet, address: maskWallet(wallet.address)! })),
    payout: { ...claim.payout, address: maskWallet(claim.payout.address) },
  };
}

export type RevealField = "email" | "wallets";

/** One claim's field in full, for an audited reveal on the staff page. */
export async function revealClaim(claimId: string, field: RevealField): Promise<Record<string, unknown> | null> {
  const claim = (await staffQueue({ reveal: true })).claims.find((entry) => entry.id === claimId);
  if (!claim) return null;
  if (field === "email") return { email: claim.email };
  return {
    wallets: claim.wallets,
    payout: claim.payout.address,
    payer: claim.buy?.payer ?? null,
    deliveredTo: claim.buy?.deliveredTo ?? null,
  };
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
    `select cl.id, cl.campaign_id, c.code, cl.state, cl.created_at, cl.holding_since, cl.eligible_at, cl.intent_tx,
            cl.hold_checked_at, cl.hold_unreadable_since, cl.hold_evidence, cl.payout_address, cl.paid_at, cl.paid_tx, cl.paid_verified,
            coalesce(cl.reject_reason, cl.expire_reason) as reason, c.amount_usd::float8 as amount_usd,
            p.id as person_id, p.email,
            (select max(x.campaign_ineligible_at) from users x where x.id = p.id or x.retired_into = p.id) as staff_ineligible_at, p.created_at as signup_at, p.wallet_address as home, p.referred_by,
            o.listing_address, o.quantity::text as quantity, o.usd_value::float8 as usd, o.filled_at, o.delivered_to,
            coalesce(o.wallet_address, o.src_address) as payer
       from campaign_claims cl
       join campaigns c on c.id = cl.campaign_id
       join users u on u.id = cl.user_id
       join users p on p.id = coalesce(u.retired_into, u.id)
       left join orders o on o.id = cl.order_id
      order by cl.updated_at desc, cl.id`,
  )) as Record<string, unknown>[];
  const sourceRows = (await sql.query(
    `select id, campaign_id, address, added_at, added_reason from campaign_payout_sources where removed_at is null order by added_at`,
  )) as { id: string; campaign_id: string; address: string; added_at: string | Date; added_reason: string }[];
  const people = [...new Set(rows.map((row) => String(row.person_id)))];
  const identityRows = (people.length
    ? await sql.query(
        `select i.user_id, i.value, i.family, i.unlinked_at is null as linked
           from user_identities i where i.kind = 'wallet' and i.user_id = any($1::uuid[])
          order by i.is_home desc, i.created_at`,
        [people],
      )
    : []) as { user_id: string; value: string; family: string; linked: boolean }[];
  const walletsOf = new Map<string, { address: string; family: string; linked: boolean }[]>();
  for (const row of identityRows) {
    const address = parseCaip10(row.value)?.address;
    if (!address) continue;
    const list = walletsOf.get(row.user_id) ?? [];
    list.push({ address, family: row.family, linked: row.linked });
    walletsOf.set(row.user_id, list);
  }

  const counts = new Map<string, Record<ClaimState, number>>();
  for (const campaign of campaignRows) {
    counts.set(campaign.id, Object.fromEntries(CLAIM_STATES.map((state) => [state, 0])) as Record<ClaimState, number>);
  }
  for (const row of rows) {
    const record = counts.get(String(row.campaign_id));
    if (record) record[row.state as ClaimState] += 1;
  }

  const signalInputs: SignalInput[] = rows.map((row) => {
    const person = String(row.person_id);
    const wallets = new Set((walletsOf.get(person) ?? []).map((wallet) => wallet.address));
    if (row.home) wallets.add(String(row.home));
    return {
      id: String(row.id),
      campaignId: String(row.campaign_id),
      userId: person,
      email: (row.email as string | null) ?? null,
      signupAt: new Date(row.signup_at as string).getTime(),
      referredBy: (row.referred_by as string | null) ?? null,
      payer: (row.payer as string | null) ?? null,
      deliveredTo: (row.delivered_to as string | null) ?? null,
      wallets: [...wallets],
      payout: ((row.payout_address as string | null) ?? (row.home as string | null) ?? null)?.toLowerCase() ?? null,
    };
  });
  const signals = deriveSignals(signalInputs);

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
    const wallets = [...(walletsOf.get(person) ?? [])];
    if (row.home && !wallets.some((wallet) => wallet.address === row.home)) {
      wallets.unshift({ address: String(row.home), family: "evm", linked: true });
    }
    claims.push({
      id: String(row.id),
      campaignId: String(row.campaign_id),
      campaignCode: String(row.code),
      state,
      userId: person,
      email: (row.email as string | null) ?? null,
      signupAt: iso(row.signup_at)!,
      attributedAt: iso(row.created_at)!,
      staffIneligibleAt: iso(row.staff_ineligible_at),
      buy: row.intent_tx
        ? {
            intentTx: String(row.intent_tx),
            listing: NAME_BY_ADDRESS.get(String(row.listing_address ?? "").toLowerCase()) ?? String(row.listing_address ?? ""),
            usd: row.usd === null || row.usd === undefined ? null : Number(row.usd),
            quantity: (row.quantity as string | null) ?? null,
            filledAt: iso(row.filled_at),
            deliveredTo: (row.delivered_to as string | null) ?? null,
            payer: (row.payer as string | null) ?? null,
          }
        : null,
      holdingSince: iso(row.holding_since),
      eligibleAt: iso(row.eligible_at),
      unreadableSince: iso(row.hold_unreadable_since),
      hold:
        row.hold_checked_at || evidence
          ? {
              checkedAt: iso(row.hold_checked_at),
              needed: (evidence?.needed as string | undefined) ?? null,
              balanceRaw: (evidence?.balanceRaw as string | null | undefined) ?? null,
              lowestRaw: (evidence?.lowestRaw as string | null | undefined) ?? null,
              outflows: (evidence?.outflows as number | null | undefined) ?? null,
              wallet: (evidence?.wallet as string | undefined) ?? null,
            }
          : null,
      wallets,
      payout: {
        address: (row.payout_address as string | null) ?? (row.home as string | null) ?? null,
        chain: PAYOUT_CHAIN.name,
        token: "USDC",
        amountUsd: Number(row.amount_usd),
      },
      paid: row.paid_tx ? { at: iso(row.paid_at), tx: String(row.paid_tx), verified: (row.paid_verified as boolean | null) ?? null } : null,
      reason: (row.reason as string | null) ?? null,
      signals: [
        ...(signals.get(String(row.id)) ?? []),
        ...(row.hold_unreadable_since && Date.now() - new Date(row.hold_unreadable_since as string).getTime() > UNREADABLE_FLAG_MS
          ? (["hold_unreadable"] as SignalCode[])
          : []),
      ],
    });
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
        active: campaign.active,
        startsAt: campaign.starts_at.toISOString(),
        endsAt: campaign.ends_at.toISOString(),
        amountUsd: campaign.amount_usd,
        budgetUsd: campaign.budget_usd,
        maxClaims: campaign.max_claims,
        minBuyUsd: campaign.min_buy_usd,
        holdDays: campaign.hold_days,
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
  const lines: string[] = [];
  for (const campaign of queue.campaigns) {
    lines.push(
      `${campaign.code} (${campaign.title}) ${campaign.active ? "ACTIVE" : "inactive"}, ${day(campaign.startsAt)} to ${day(campaign.endsAt)}`,
      `  ${usd(campaign.amountUsd)} each, buy ${usd(campaign.minBuyUsd)}+, hold ${campaign.holdDays} days`,
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
      lines.push(
        `  ${claim.id.slice(0, 8)} ${claim.campaignCode} account ${claim.userId.slice(0, 8)} ${claim.email ?? "(no email)"}, signed up ${day(claim.signupAt)}`,
      );
      if (claim.buy) {
        lines.push(
          `    buy ${claim.buy.usd === null ? "?" : usd(claim.buy.usd)} of ${claim.buy.listing}, ${claim.buy.quantity ?? "?"} units, filled ${day(claim.buy.filledAt)}, intent ${claim.buy.intentTx}`,
          `    delivered to ${claim.buy.deliveredTo ?? "?"}, paid from ${claim.buy.payer ?? "?"}`,
        );
      }
      if (claim.holdingSince) lines.push(`    holding since ${day(claim.holdingSince)}, eligible ${day(claim.eligibleAt)}`);
      if (claim.hold) lines.push(`    hold check ${day(claim.hold.checkedAt)}: balance ${claim.hold.balanceRaw ?? "unread"} raw, needed ${claim.hold.needed ?? "?"}`);
      lines.push(`    wallets ${claim.wallets.map((wallet) => `${wallet.address}${wallet.linked ? "" : " (unlinked)"}`).join(", ") || "none"}`);
      if (claim.state === "qualified" || claim.state === "approved") {
        lines.push(`    pay ${usd(claim.payout.amountUsd)} ${claim.payout.token} on ${claim.payout.chain} to ${claim.payout.address ?? "(no home address)"}`);
      }
      if (claim.paid) lines.push(`    paid ${day(claim.paid.at)} tx ${claim.paid.tx} ${claim.paid.verified ? "verified" : "NOT verified"}`);
      if (claim.reason) lines.push(`    reason ${claim.reason}`);
      lines.push(`    signals ${claim.signals.join(", ") || "none"} (no device data is kept)`);
    }
  }
  return lines.join("\n");
}
