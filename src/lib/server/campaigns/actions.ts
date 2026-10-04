import { getAddress } from "viem";
import { getSql } from "@/lib/server/db";
import { staffAdminIds, staffAudit } from "@/lib/server/staff-auth";
import { sendNotice } from "@/lib/server/email/notify";
import { normalizeCampaignCode, REJECT_REASONS, campaignUsd } from "@/lib/campaigns";
import { claimById, campaignById } from "@/lib/server/campaigns/store";
import { claimPerson, MAX_STAY_DAYS, MIN_STAY_DAYS, staffIneligible, stillEligible } from "@/lib/server/campaigns/eligibility";
import { personAccounts } from "@/lib/server/campaigns/store";
import {
  fetchBaseReceipt,
  fetchUsdcTransfers,
  PAYOUT_CHAIN,
  payoutSenders,
  TX_HASH_SHAPE,
  USDC_BASE,
  type ReceiptFetcher,
} from "@/lib/server/campaigns/usdc";
import { COPY } from "@/lib/copy";

/**
 * What staff may do to a campaign or a claim (app/api/staff/campaigns).
 * Every caller has already passed requireStaff (and, for the acts that
 * matter, requireFreshStaff). Nothing here moves money: "Mark paid"
 * records a payment David made by hand, after a read only check of it.
 *
 * Every action is audited. A write and its audit row are one statement
 * (a data modifying CTE, so one transaction): an action never stands
 * unaudited, and an audit row never claims an action that did not
 * happen. A refused attempt has nothing to be atomic with and is written
 * through staffAudit. Email goes only after the write committed.
 */

export type ActionRefusal =
  | "not_found"
  | "wrong_state"
  | "no_payout_address"
  | "bad_hash"
  | "tx_failed"
  | "mismatch"
  | "bad_reason"
  | "bad_input"
  | "code_taken"
  | "stay_out_of_range"
  | "places_over_budget"
  | "counsel_required"
  | "no_payout_senders"
  | "one_per_person"
  | "wallet_used"
  | "email_used"
  | "retired"
  | "active"
  | "has_places"
  | "existing_customer"
  | "staff_ineligible"
  | "no_person"
  | "bad_address"
  | "source_exists"
  | "zero_address"
  | "funding_check_required"
  | "no_funding_wallet"
  | "error";

/** Never a wallet: USDC sent there is gone. */
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

export type ActionResult = { ok: true; detail?: Record<string, unknown> } | { ok: false; refusal: ActionRefusal; detail?: Record<string, unknown> };

/** A refused attempt, audited on its own. */
async function refused(
  staffUserId: string,
  action: string,
  target: string | null,
  refusal: ActionRefusal,
  detail: Record<string, unknown> = {},
): Promise<ActionResult> {
  await staffAudit({ staffUserId, action, target, detail: { ...detail, outcome: refusal } });
  return { ok: false, refusal, ...(Object.keys(detail).length ? { detail } : {}) };
}

/**
 * A write and its audit row in one statement: the audit row is written
 * only when the write touched a row, and both commit or neither does.
 */
async function auditedWrite<T>(
  write: { text: string; params: unknown[] },
  audit: { staffUserId: string; action: string; target: string | null; detail?: Record<string, unknown> },
): Promise<T[]> {
  const n = write.params.length;
  const text = `with act as (${write.text}),
    aud as (
      insert into staff_audit (staff_user_id, action, target, detail)
      select $${n + 1}::uuid, $${n + 2}, $${n + 3}, $${n + 4}::jsonb || jsonb_build_object('outcome', 'done')
        from (select 1 from act limit 1) as touched
      returning 1
    )
    select * from act`;
  return (await getSql().query(text, [
    ...write.params,
    audit.staffUserId,
    audit.action,
    audit.target,
    JSON.stringify(audit.detail ?? {}),
  ])) as T[];
}

export type CampaignInput = {
  code: unknown;
  title: unknown;
  amountUsd: unknown;
  budgetUsd: unknown;
  maxClaims: unknown;
  /** Days after setting up that the new account must still be using Berth (campaigns.hold_days). */
  stayDays: unknown;
  startsAt: unknown;
  endsAt: unknown;
  /** The funding wallet, optional here: when given it must be a wallet, and it becomes the campaign's first payout source. */
  payoutAddress?: unknown;
};

const money = (value: unknown, max: number): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 && n <= max && Math.abs(Math.round(n * 100) - n * 100) < 1e-6 ? n : null;
};
const whole = (value: unknown, min: number, max: number): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const date = (value: unknown): Date | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * A signup campaign (the only kind made since 5 October 2026), always
 * created inactive: it counts nobody until activated with counsel's review
 * confirmed. Places times the amount must fit in the budget, so the places
 * are a promise the budget can keep.
 */
export async function createCampaign(staffUserId: string, input: CampaignInput): Promise<ActionResult> {
  const code = normalizeCampaignCode(input.code);
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 80) : "";
  const amount = money(input.amountUsd, 1_000);
  const budget = money(input.budgetUsd, 100_000);
  const maxClaims = whole(input.maxClaims, 1, 10_000);
  const stayRaw = whole(input.stayDays, 1, 365);
  const startsAt = date(input.startsAt);
  const endsAt = date(input.endsAt);
  const shown = { code, title, amount, budget, maxClaims, stayDays: stayRaw, startsAt: startsAt?.toISOString(), endsAt: endsAt?.toISOString() };
  if (stayRaw !== null && (stayRaw < MIN_STAY_DAYS || stayRaw > MAX_STAY_DAYS)) {
    return refused(staffUserId, "campaign.create", code, "stay_out_of_range", shown);
  }
  const stayDays = stayRaw;
  const wantsWallet = typeof input.payoutAddress === "string" && input.payoutAddress.trim() !== "";
  const wallet = wantsWallet ? checksummedAddress(input.payoutAddress) : null;
  if (wantsWallet && !wallet) {
    return refused(staffUserId, "campaign.create", code, "bad_address", { ...shown, address: String(input.payoutAddress).slice(0, 60) });
  }
  if (wallet === ZERO_ADDRESS) return refused(staffUserId, "campaign.create", code, "zero_address", shown);
  if (!code || !title || !amount || !budget || !maxClaims || !stayDays || !startsAt || !endsAt || endsAt <= startsAt || amount > budget) {
    return refused(staffUserId, "campaign.create", code, "bad_input", shown);
  }
  if (Math.round(amount * 100) * maxClaims > Math.round(budget * 100)) return refused(staffUserId, "campaign.create", code, "places_over_budget", shown);
  try {
    const rows = await auditedWrite<{ id: string }>(
      {
        text: `insert into campaigns (code, title, kind, amount_usd, budget_usd, max_claims, hold_days, starts_at, ends_at, active)
               values ($1, $2, 'signup', $3, $4, $5, $6, $7, $8, false)
               on conflict (code) do nothing returning id`,
        params: [code, title, amount, budget, maxClaims, stayDays, startsAt.toISOString(), endsAt.toISOString()],
      },
      { staffUserId, action: "campaign.create", target: code, detail: shown },
    );
    if (!rows[0]) return refused(staffUserId, "campaign.create", code, "code_taken", shown);
    if (wallet) {
      // Its own audited write: the campaign stands either way, inactive, and its card says when it has no wallet.
      const source = await addPayoutSource(staffUserId, rows[0].id, wallet, COPY.campaign.staff.funding.createdReason);
      return { ok: true, detail: { id: rows[0].id, payoutSource: source.ok } };
    }
    return { ok: true, detail: { id: rows[0].id } };
  } catch {
    return refused(staffUserId, "campaign.create", code, "bad_input", shown);
  }
}

/**
 * Activate or pause. Activation asks for `counselReviewed: true` and
 * `fundingChecked: true`, which the page sends only from its confirmation
 * naming counsel review and the funding wallet, network and token. A
 * campaign activates only with a payout wallet of its own, and the audit
 * row keeps which wallet, network and token were confirmed.
 */
export async function setCampaignActive(
  staffUserId: string,
  campaignId: string,
  active: boolean,
  counselReviewed: unknown,
  fundingChecked?: unknown,
): Promise<ActionResult> {
  const action = active ? "campaign.activate" : "campaign.pause";
  let funding: Record<string, unknown> = {};
  if (active) {
    const campaign = await campaignById(campaignId);
    if (!campaign) return refused(staffUserId, action, campaignId, "not_found");
    // The first campaigns rewarded a buy, the next ones the inviter. They stay retired.
    if (campaign.kind !== "signup") return refused(staffUserId, action, campaignId, "retired");
    if (counselReviewed !== true) return refused(staffUserId, action, campaignId, "counsel_required");
    if (fundingChecked !== true) return refused(staffUserId, action, campaignId, "funding_check_required");
    const wallets = (await getSql().query(
      `select address from campaign_payout_sources where campaign_id = $1 and removed_at is null order by added_at`,
      [campaignId],
    )) as { address: string }[];
    if (wallets.length === 0) return refused(staffUserId, action, campaignId, "no_funding_wallet");
    funding = { fundingChecked: true, fundingWallet: wallets[0].address, chain: PAYOUT_CHAIN.key, token: USDC_BASE };
  }
  const rows = await auditedWrite(
    {
      text: `update campaigns set active = $2, activated_at = case when $2 then now() else activated_at end
              where id = $1 returning id`,
      params: [campaignId, active],
    },
    { staffUserId, action, target: campaignId, detail: active ? { counselReviewed: true, ...funding } : {} },
  );
  if (rows.length === 0) return refused(staffUserId, action, campaignId, "not_found");
  return { ok: true };
}

/**
 * Qualified to approved, fixing where the USDC goes: the claim's own
 * account's home address (its live account, after any merge), on Base:
 * the person who opened through the campaign's link is the one paid.
 * Before it, the guards and the one payout per person are asked again of
 * the person as they are now (a merge or a wallet linked since can make
 * them someone who already counted). A claim of a retired campaign is not
 * approved.
 */
export async function approveClaim(staffUserId: string, claimId: string): Promise<ActionResult> {
  const claim = await claimById(claimId);
  if (!claim) return refused(staffUserId, "claim.approve", claimId, "not_found");
  if (claim.state !== "qualified") return refused(staffUserId, "claim.approve", claimId, "wrong_state");
  const campaign = await campaignById(claim.campaign_id);
  if (!campaign || campaign.kind !== "signup") return refused(staffUserId, "claim.approve", claimId, "retired");
  const still = await stillEligible(claim);
  if (still) return refused(staffUserId, "claim.approve", claimId, still === "no_person" ? "no_person" : still);
  const rows = await auditedWrite<{ payout_address: string }>(
    {
      text: `update campaign_claims cl
                set state = 'approved', approved_at = now(), approved_by = $2,
                    payout_address = p.wallet_address, payout_chain = $3, updated_at = now()
               from users u join users p on p.id = coalesce(u.retired_into, u.id)
              where cl.id = $1 and u.id = cl.user_id and cl.state = 'qualified'
                and p.wallet_address ~ '^0x[0-9a-f]{40}$'
              returning cl.payout_address`,
      params: [claimId, staffUserId, PAYOUT_CHAIN.key],
    },
    { staffUserId, action: "claim.approve", target: claimId, detail: { chain: PAYOUT_CHAIN.key, paidTo: "signup" } },
  );
  if (rows[0]) return { ok: true, detail: { payoutAddress: rows[0].payout_address, chain: PAYOUT_CHAIN.key } };
  const now = await claimById(claimId);
  return refused(staffUserId, "claim.approve", claimId, now?.state !== "qualified" ? "wrong_state" : "no_payout_address");
}

const REJECTABLE = ["attributed", "buying", "holding", "qualified", "approved"];

export async function rejectClaim(staffUserId: string, claimId: string, reason: unknown, note: unknown): Promise<ActionResult> {
  const why = typeof reason === "string" && (REJECT_REASONS as readonly string[]).includes(reason) ? reason : null;
  const text = typeof note === "string" ? note.trim().slice(0, 500) : "";
  if (!why) return refused(staffUserId, "claim.reject", claimId, "bad_reason");
  const rows = await auditedWrite(
    {
      text: `update campaign_claims set state = 'rejected', reject_reason = $2, rejected_at = now(), rejected_by = $3, updated_at = now()
              where id = $1 and state = any($4::text[]) returning id`,
      params: [claimId, why, staffUserId, REJECTABLE],
    },
    { staffUserId, action: "claim.reject", target: claimId, detail: { reason: why, note: text } },
  );
  if (rows.length) return { ok: true };
  const claim = await claimById(claimId);
  return refused(staffUserId, "claim.reject", claimId, claim ? "wrong_state" : "not_found", { reason: why });
}

/**
 * Records the payment David sent by hand, to the claim's own account. The hash is read on Base, read
 * only, and counts only USDC from an active payout source of the claim's
 * campaign (campaign_payout_sources), or from STAFF_PAYOUT_ADDRESSES, the
 * optional global fallback. One transaction may pay several claims: it
 * must pay this claim's address at least the sum of every claim recorded
 * against it there. Then the claim is paid, and its person is emailed.
 *
 * A hash that cannot be read (not mined yet, a typo, the RPC down) keeps
 * the claim approved with the hash pending: no "Paid" line, no email. It
 * can be checked again, or replaced by another hash, both audited. A
 * receipt that reads as reverted or as too little is refused, and a
 * pending hash that turns out so is cleared.
 */
export async function markClaimPaid(
  staffUserId: string,
  claimId: string,
  rawHash: unknown,
  fetchReceipt: ReceiptFetcher = fetchBaseReceipt,
  env: Record<string, string | undefined> = process.env,
): Promise<ActionResult> {
  const txHash = typeof rawHash === "string" ? rawHash.trim().toLowerCase() : "";
  if (!TX_HASH_SHAPE.test(txHash)) return refused(staffUserId, "claim.mark_paid", claimId, "bad_hash");
  const claim = await claimById(claimId);
  if (!claim) return refused(staffUserId, "claim.mark_paid", claimId, "not_found", { txHash });
  if (claim.state !== "approved") return refused(staffUserId, "claim.mark_paid", claimId, "wrong_state", { txHash });
  if (!claim.payout_address) return refused(staffUserId, "claim.mark_paid", claimId, "no_payout_address", { txHash });
  // The one paid, the claim's own person, may not be marked not eligible.
  const payee = await claimPerson(claim);
  if (payee && (await staffIneligible(await personAccounts(payee.id)))) return refused(staffUserId, "claim.mark_paid", claimId, "staff_ineligible", { txHash });
  const campaign = await campaignById(claim.campaign_id);
  if (!campaign) return refused(staffUserId, "claim.mark_paid", claimId, "not_found", { txHash });
  const senders = await claimPayoutSenders(claim.campaign_id, env);
  if (senders.size === 0) return refused(staffUserId, "claim.mark_paid", claimId, "no_payout_senders", { txHash });
  const replacing = claim.paid_tx !== null && claim.paid_tx !== txHash ? claim.paid_tx : null;
  const action = replacing ? "claim.replace_paid_tx" : claim.paid_tx === txHash ? "claim.recheck_paid" : "claim.mark_paid";
  const base = { txHash, to: claim.payout_address, chain: PAYOUT_CHAIN.key, amountUsd: campaign.amount_usd, ...(replacing ? { replaced: replacing } : {}) };

  const transfers = await fetchUsdcTransfers(txHash, senders, fetchReceipt);
  const clearPending = async (refusal: ActionRefusal, detail: Record<string, unknown>) => {
    if (claim.paid_tx === txHash) {
      await auditedWrite(
        {
          text: `update campaign_claims set paid_tx = null, paid_verified = null, paid_check = $2::jsonb, updated_at = now()
                  where id = $1 and state = 'approved' and paid_tx = $3 returning id`,
          params: [claimId, JSON.stringify(transfers), txHash],
        },
        { staffUserId, action: "claim.clear_paid_tx", target: claimId, detail: { ...base, because: refusal } },
      );
    }
    return refused(staffUserId, action, claimId, refusal, detail);
  };
  if (transfers.outcome === "tx_failed") return clearPending("tx_failed", base);

  if (transfers.outcome === "not_found" || transfers.outcome === "unreachable") {
    const rows = await auditedWrite(
      {
        text: `update campaign_claims set paid_tx = $2, paid_verified = false, paid_check = $3::jsonb, updated_at = now()
                where id = $1 and state = 'approved' returning id`,
        params: [claimId, txHash, JSON.stringify(transfers)],
      },
      { staffUserId, action, target: claimId, detail: { ...base, pending: transfers.outcome } },
    );
    if (!rows.length) return refused(staffUserId, action, claimId, "wrong_state", base);
    return { ok: true, detail: { verified: false } };
  }

  // The sum check and the write in one locked statement (db/schema.sql campaign_mark_paid): two
  // claims at one address cannot both be paid by a transfer meant for one.
  const paidRaw = transfers.byRecipient[claim.payout_address] ?? "0";
  const outcome = (
    (await getSql().query(`select campaign_mark_paid($1, $2, $3::numeric, $4, $5::jsonb, $6, $7::jsonb) as outcome`, [
      claimId,
      txHash,
      paidRaw,
      staffUserId,
      JSON.stringify(transfers),
      action,
      JSON.stringify({ ...base, verified: true, block: transfers.block }),
    ])) as { outcome: "paid" | "short" | "wrong_state" }[]
  )[0]?.outcome;
  if (outcome === "short") return clearPending("mismatch", { ...base, paid: paidRaw });
  if (outcome !== "paid") return refused(staffUserId, action, claimId, "wrong_state", base);
  // After the commit: the one paid, the claim's own person, is told once, deduped on the claim.
  const person = (await getSql().query(`select coalesce(retired_into, id) as id from users where id = $1`, [claim.user_id])) as { id: string }[];
  sendNotice({
    userId: person[0]?.id ?? claim.user_id,
    ref: claimId,
    notice: { type: "campaign_paid", amount: campaignUsd(campaign.amount_usd), chain: PAYOUT_CHAIN.name },
  });
  return { ok: true, detail: { verified: true } };
}

/**
 * Deletes a signup campaign that never took on money, with a reason:
 * allowed while it is inactive and no claim of it holds or ever held a
 * place, was paid, or stands on a person's marks (a draft never activated
 * always qualifies). Refused while active, for a retired campaign, or once
 * any of that happened: money history and the one payout per person
 * record are never erased. Its open, rejected and expired claims and its
 * payout wallets go with it, the audit row with the reason in the same
 * transaction (db/schema.sql campaign_delete), and its code is free for a
 * new campaign.
 */
export async function deleteCampaign(staffUserId: string, campaignId: string, rawReason: unknown): Promise<ActionResult> {
  const reason = reasonOf(rawReason);
  if (!reason) return refused(staffUserId, "campaign.delete", campaignId, "bad_reason");
  const campaign = await campaignById(campaignId);
  if (!campaign) return refused(staffUserId, "campaign.delete", campaignId, "not_found", { reason });
  const outcome = (
    (await getSql().query(`select campaign_delete($1, $2, $3::jsonb) as outcome`, [
      campaignId,
      staffUserId,
      JSON.stringify({ reason, neverActivated: campaign.activated_at === null }),
    ])) as { outcome: "deleted" | "not_found" | "retired" | "active" | "has_places" }[]
  )[0]?.outcome;
  if (outcome === "deleted") return { ok: true, detail: { code: campaign.code } };
  const refusal: ActionRefusal =
    outcome === "active" || outcome === "has_places" || outcome === "not_found" || outcome === "retired" ? outcome : "error";
  return refused(staffUserId, "campaign.delete", campaignId, refusal, { code: campaign.code, reason });
}

/**
 * The wallets a payment for this campaign may come from: its active
 * payout sources, plus STAFF_PAYOUT_ADDRESSES when set (an optional global
 * fallback, for every campaign at once).
 */
export async function claimPayoutSenders(campaignId: string, env: Record<string, string | undefined> = process.env): Promise<Set<string>> {
  const rows = (await getSql().query(
    `select address from campaign_payout_sources where campaign_id = $1 and removed_at is null`,
    [campaignId],
  )) as { address: string }[];
  return new Set([...rows.map((row) => row.address), ...payoutSenders(env)]);
}

/**
 * An EVM address, lowercased for storage; null for anything else. All
 * lowercase or all uppercase hex carries no checksum and is taken as it
 * is. Mixed case is an EIP-55 checksum, and one that does not check out is
 * a typo: refused.
 */
export function checksummedAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return null;
  const hex = trimmed.slice(2);
  if (hex === hex.toLowerCase() || hex === hex.toUpperCase()) return trimmed.toLowerCase();
  try {
    return getAddress(trimmed) === trimmed ? trimmed.toLowerCase() : null;
  } catch {
    return null;
  }
}

const reasonOf = (value: unknown) => (typeof value === "string" ? value.trim().slice(0, 300) : "");

/** Tells every staff admin, after the change committed. Security kind: no switch stops it. */
function tellAdmins(sourceId: string, change: "added" | "removed", campaign: string, address: string, reason: string): void {
  for (const adminId of staffAdminIds()) {
    sendNotice({
      userId: adminId,
      ref: `${sourceId}:${change}:${adminId}`,
      notice: { type: "payout_source_changed", change, campaign, address: getAddress(address), reason },
    });
  }
}

/** Adds a payout source to a campaign: an address (a mixed case one must check out) and a reason, audited in the same statement. */
export async function addPayoutSource(staffUserId: string, campaignId: string, rawAddress: unknown, rawReason: unknown): Promise<ActionResult> {
  const address = checksummedAddress(rawAddress);
  const reason = reasonOf(rawReason);
  if (!address) return refused(staffUserId, "campaign.add_payout_source", campaignId, "bad_address", { address: String(rawAddress ?? "").slice(0, 60) });
  if (address === ZERO_ADDRESS) return refused(staffUserId, "campaign.add_payout_source", campaignId, "zero_address", { address });
  if (!reason) return refused(staffUserId, "campaign.add_payout_source", campaignId, "bad_reason", { address });
  const campaign = await campaignById(campaignId);
  if (!campaign) return refused(staffUserId, "campaign.add_payout_source", campaignId, "not_found", { address });
  const rows = await auditedWrite<{ id: string }>(
    {
      text: `insert into campaign_payout_sources (campaign_id, address, added_by, added_reason)
             select $1, $2, $3, $4
              where not exists (select 1 from campaign_payout_sources where campaign_id = $1 and address = $2 and removed_at is null)
             on conflict do nothing
             returning id`,
      params: [campaignId, address, staffUserId, reason],
    },
    { staffUserId, action: "campaign.add_payout_source", target: campaignId, detail: { address, reason } },
  );
  if (!rows[0]) return refused(staffUserId, "campaign.add_payout_source", campaignId, "source_exists", { address });
  tellAdmins(rows[0].id, "added", campaign.title, address, reason);
  return { ok: true, detail: { sourceId: rows[0].id } };
}

/** Removes a payout source, with a reason. Claims it already paid stay paid: only new payments are judged without it. */
export async function removePayoutSource(staffUserId: string, sourceId: string, rawReason: unknown): Promise<ActionResult> {
  const reason = reasonOf(rawReason);
  if (!reason) return refused(staffUserId, "campaign.remove_payout_source", sourceId, "bad_reason");
  const rows = await auditedWrite<{ campaign_id: string; address: string }>(
    {
      text: `update campaign_payout_sources set removed_at = now(), removed_by = $2, removed_reason = $3
              where id = $1 and removed_at is null returning campaign_id, address`,
      params: [sourceId, staffUserId, reason],
    },
    { staffUserId, action: "campaign.remove_payout_source", target: sourceId, detail: { reason } },
  );
  if (!rows[0]) return refused(staffUserId, "campaign.remove_payout_source", sourceId, "not_found");
  const campaign = await campaignById(rows[0].campaign_id);
  tellAdmins(sourceId, "removed", campaign?.title ?? "a campaign", rows[0].address, reason);
  return { ok: true };
}
