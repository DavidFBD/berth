import { EvmSolverService, IntentsAbi, type Intent, type IntentResponse } from "@sodax/sdk";
import { forgoHold, isNoXp } from "@/lib/server/no-xp";
import { parseEventLogs, type Log } from "viem";
import { awardXp } from "@/lib/server/accounts";
import { getSql } from "@/lib/server/db";
import { fetchIntentRecord } from "@/lib/server/limit-orders";
import { recordOrder } from "@/lib/server/orders";
import { getSodax } from "@/lib/server/pour-verify";
import { limitStateFrom, type IntentRecord } from "@/lib/limit-orders";
import type { RewardList } from "@/lib/profile-types";

/**
 * XP for an order, only once it has filled. A verified intent is not yet
 * an order that happened: a limit order can rest and then be cancelled or
 * expire, and a market order can fail to fill. So the pour route asks
 * whether the intent filled before it pays, and when it cannot tell yet
 * (the backend indexes a few seconds behind the hub, or a limit order still
 * waits) it keeps a claim that the evening pass settles.
 *
 * Filled is decided from the chain first: the fill transaction the client
 * names must hold an IntentFilled event for THIS intent's hash with
 * nothing remaining. The client's hash is never trusted on its own; it is
 * only where to look. Failing that, SODAX's backend record decides.
 */

export type FillVerdict = "filled" | "notFilled" | "unknown";

type Receipt = { status?: string; logs: Log[] } | null;

/** The pure reading of a fill receipt: does it fill `intentHash` whole, from the Intents contract? */
export function fillsIntent(receipt: Receipt, intentHash: string, intentsContract: string): boolean {
  if (!receipt || receipt.status === "reverted" || receipt.status === "0x0") return false;
  try {
    const logs = parseEventLogs({ abi: IntentsAbi, eventName: "IntentFilled", logs: receipt.logs, strict: false });
    return logs.some(
      (log) =>
        log.address.toLowerCase() === intentsContract.toLowerCase() &&
        typeof log.args.intentHash === "string" &&
        log.args.intentHash.toLowerCase() === intentHash.toLowerCase() &&
        log.args.intentState?.remainingInput === 0n,
    );
  } catch {
    return false;
  }
}

/** The backend's record as a verdict: filled, closed without filling, or not decided yet. */
export function verdictFromRecord(record: IntentResponse | null, now = new Date()): FillVerdict {
  if (!record) return "unknown";
  const state = limitStateFrom(
    { open: record.open, intent: { deadline: record.intent.deadline, inputAmount: record.intent.inputAmount }, events: (record.events ?? []) as IntentRecord["events"] },
    { now },
  );
  if (!state) return "unknown";
  if (state.status === "filled") return "filled";
  if (state.status === "cancelled" || state.status === "expired") return "notFilled";
  return "unknown";
}

/** Whether the intent filled, from the claimed fill transaction on chain, else the backend. */
export async function fillVerdict({
  intentTx,
  intent,
  claimedFillTx,
  fetchRecord = fetchIntentRecord,
  readReceipt,
}: {
  intentTx: string;
  intent: Intent;
  claimedFillTx?: string | null;
  fetchRecord?: (intentTx: string) => Promise<IntentResponse | null>;
  readReceipt?: (txHash: string) => Promise<Receipt>;
}): Promise<FillVerdict> {
  const sodax = getSodax();
  const intentsContract = sodax.config.solver.intentsContract;
  if (claimedFillTx) {
    const read =
      readReceipt ??
      ((hash: string) =>
        sodax.hubProvider.publicClient
          .getTransactionReceipt({ hash: hash as `0x${string}` })
          .then((receipt) => receipt as unknown as Receipt)
          .catch(() => null));
    if (fillsIntent(await read(claimedFillTx), EvmSolverService.getIntentHash(intent), intentsContract)) return "filled";
  }
  // The backend trails the hub by seconds: a second look covers a fill just made.
  for (let attempt = 0; attempt < 2; attempt++) {
    const verdict = verdictFromRecord(await fetchRecord(intentTx));
    if (verdict !== "unknown") return verdict;
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return "unknown";
}

/**
 * The award itself, for a pour known to have filled: the pour's own XP,
 * and on a referred account the referral pair, all index-deduped, so a
 * replay pays nothing. `announced` false parks it for the next profile
 * sync (the evening pass pays while nobody is looking).
 */
export async function awardFilledPour(
  user: { id: string; referred_by: string | null },
  kind: "pour_in" | "pour_out",
  intentTx: string,
  { announced = true }: { announced?: boolean } = {},
): Promise<{ rewards: RewardList; xp: number }> {
  const rewards: RewardList = [];
  const pour = await awardXp(user.id, kind, intentTx, { announced });
  let xp = pour.xp;
  if (pour.awarded > 0) rewards.push({ kind, amount: pour.awarded });
  if (user.referred_by) {
    const accepted = await awardXp(user.id, "invite_accepted", null, { announced });
    xp = accepted.xp;
    if (accepted.awarded > 0) rewards.push({ kind: "invite_accepted", amount: accepted.awarded });
    await awardXp(user.referred_by, "friend_poured", user.id, { announced: false });
  }
  return { rewards, xp };
}

/** How long the evening pass may keep starting claims (the stage allows ten seconds). */
export const CLAIMS_BUDGET_MS = 8_000;

async function orderExists(intentTx: string): Promise<boolean> {
  const rows = (await getSql().query(`select 1 from orders where intent_tx = $1 limit 1`, [intentTx.toLowerCase()])) as unknown[];
  return rows.length > 0;
}

/** How a settled claim ended: paid, dropped unfilled, or recorded for a buy that pays nothing (lib/server/no-xp). */
export type ClaimOutcome = "paid" | "dropped" | "recorded_no_xp";

/** A claim the client's own later call settled: closed, so the evening pass never looks at it again. */
export async function closePourClaim(intentTx: string, now = new Date(), outcome: Exclude<ClaimOutcome, "dropped"> = "paid"): Promise<void> {
  await getSql().query(`update pour_claims set settled_at = $2, outcome = $3 where intent_tx = $1 and settled_at is null`, [
    intentTx.toLowerCase(),
    now.toISOString(),
    outcome,
  ]);
}

/**
 * Keep a claim for a pour that could not be judged filled yet. Idempotent
 * per intent. `listingSymbol`, when the intent names a listing, lets an
 * open buy claim hold back a recurring run of that listing until the
 * evening pass settles it (lib/server/recurring). Whether it will pay is
 * not the claim's to say: a no XP buy is marked by intent (lib/server/no-xp).
 */
export async function savePourClaim(
  userId: string,
  intentTx: string,
  direction: "buy" | "sell",
  fillTx: string | null,
  listingSymbol: string | null = null,
): Promise<void> {
  await getSql().query(
    `insert into pour_claims (intent_tx, user_id, direction, fill_tx, listing_symbol) values ($1, $2, $3, $4, $5)
     on conflict (intent_tx) do update set fill_tx = coalesce(pour_claims.fill_tx, excluded.fill_tx),
       listing_symbol = coalesce(pour_claims.listing_symbol, excluded.listing_symbol)
     where pour_claims.user_id = excluded.user_id`,
    [intentTx.toLowerCase(), userId, direction, fillTx, listingSymbol],
  );
}

/** `recorded`: filled claims for a no XP buy, written into the ledger and paid nothing. */
export type ClaimSummary = { checked: number; paid: number; dropped: number; recorded: number };

export type SettledClaim = {
  user_id: string;
  intent_tx: string;
  direction: "buy" | "sell";
  referred_by: string | null;
  fill_tx: string | null;
  /** A no XP buy (lib/server/no-xp): record the order, pay nothing. Absent reads as false. */
  no_xp?: boolean;
};

/**
 * What a claim earns once its order row stands: the pour's XP (parked for
 * the next profile sync), or, for a no XP buy, nothing, and no hold is
 * judged. Answers which it was.
 */
export async function payRecordedClaim(claim: SettledClaim): Promise<"paid" | "recorded_no_xp"> {
  if (claim.no_xp || (claim.direction === "buy" && (await isNoXp(claim.intent_tx)))) {
    await forgoHold(claim.intent_tx);
    return "recorded_no_xp";
  }
  await awardFilledPour({ id: claim.user_id, referred_by: claim.referred_by }, claim.direction === "sell" ? "pour_out" : "pour_in", claim.intent_tx, {
    announced: false,
  });
  return "paid";
}

export { forgoHold };

/**
 * The evening's pass over open claims, oldest first: a filled one is
 * recorded as an order and paid (parked for the next profile sync), or
 * for a no XP buy recorded and paid nothing (lib/server/no-xp), a
 * closed one is dropped unpaid, anything still undecided waits for the
 * next night. A claim older than 30 days that never filled is dropped.
 */
export async function settlePourClaims({
  limit = 15,
  now = new Date(),
  verdictOf = async (intentTx: string) => verdictFromRecord(await fetchIntentRecord(intentTx), now),
  pay = async (claim: SettledClaim) => {
    // The order row first: a claim is only settled once `orders` holds
    // it, so a failed intent read leaves the claim for the next night.
    const sodax = getSodax();
    const intent = await sodax.swaps.getIntent(claim.intent_tx as `0x${string}`).catch(() => null);
    if (!intent?.ok) return false;
    await recordOrder({ sodax, userId: claim.user_id, intentTx: claim.intent_tx, direction: claim.direction, intent: intent.value, claimedFillTx: claim.fill_tx });
    if (!(await orderExists(claim.intent_tx))) return false;
    return payRecordedClaim(claim);
  },
  budgetMs = CLAIMS_BUDGET_MS,
  clock = Date.now,
}: {
  limit?: number;
  now?: Date;
  verdictOf?: (intentTx: string) => Promise<FillVerdict>;
  /**
   * Resolves how the claim settled once its order is recorded: "paid", or
   * "recorded_no_xp" for a no XP buy. true reads as "paid"; false leaves the
   * claim open.
   */
  pay?: (claim: SettledClaim) => Promise<boolean | "paid" | "recorded_no_xp">;
  /** Starts no claim after this long, inside the evening stage's own budget. */
  budgetMs?: number;
  clock?: () => number;
} = {}): Promise<ClaimSummary> {
  const sql = getSql();
  const started = clock();
  const claims = (await sql.query(
    `select c.intent_tx, c.user_id, c.direction, c.fill_tx, c.created_at, u.referred_by,
            exists (select 1 from no_xp_intents n where n.intent_tx = c.intent_tx) as no_xp
       from pour_claims c join users u on u.id = c.user_id
      where c.settled_at is null
      order by c.last_checked_at asc nulls first, c.created_at asc limit $1`,
    [limit],
  )) as (SettledClaim & { created_at: string | Date })[];
  const summary: ClaimSummary = { checked: claims.length, paid: 0, dropped: 0, recorded: 0 };
  for (const claim of claims) {
    if (clock() - started > budgetMs) break;
    const verdict = await verdictOf(claim.intent_tx);
    const stale = now.getTime() - new Date(claim.created_at).getTime() > 30 * 86_400_000;
    // Undecided or unpaid claims go to the back of the line, so one that
    // stays stuck can never starve the ones behind it.
    const later = () => sql.query(`update pour_claims set last_checked_at = $2 where intent_tx = $1`, [claim.intent_tx, now.toISOString()]);
    let outcome: ClaimOutcome;
    if (verdict === "filled") {
      const settled = await pay(claim);
      if (!settled) {
        await later();
        continue;
      }
      outcome = settled === "recorded_no_xp" ? "recorded_no_xp" : "paid";
      if (outcome === "paid") summary.paid += 1;
      else summary.recorded += 1;
    } else if (verdict === "notFilled" || stale) {
      outcome = "dropped";
      summary.dropped += 1;
    } else {
      await later();
      continue;
    }
    await sql.query(`update pour_claims set settled_at = $2, outcome = $3 where intent_tx = $1`, [claim.intent_tx, now.toISOString(), outcome]);
  }
  return summary;
}
