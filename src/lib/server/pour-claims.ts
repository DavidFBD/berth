import { EvmSolverService, IntentsAbi, type Intent, type IntentResponse } from "@sodax/sdk";
import { forgoHold, isNoXp, markNoXp, pourPaid } from "@/lib/server/no-xp";
import { parseEventLogs, type Log } from "viem";
import { awardXp } from "@/lib/server/accounts";
import { getSql } from "@/lib/server/db";
import { fetchIntentRecord } from "@/lib/server/limit-orders";
import { recordOrder } from "@/lib/server/orders";
import { UNKNOWN, accountOwnedWallets, withTimeout, type OwnershipVerdict } from "@/lib/server/pour-ownership";
import { getSodax, ownsIntent } from "@/lib/server/pour-verify";
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
    // Bounded (5s): the SDK client's own failover waits out a hung first
    // endpoint for longer than the pour route can spare. Unread falls
    // through to the backend's record.
    const read =
      readReceipt ??
      (async (hash: string) => {
        const receipt = await withTimeout(() => sodax.hubProvider.publicClient.getTransactionReceipt({ hash: hash as `0x${string}` }));
        return receipt === UNKNOWN ? null : (receipt as unknown as Receipt);
      });
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

/**
 * A claim the client's own later call settled: closed, so the evening pass
 * never looks at it again. With `userId`, that account's claim is the one
 * closed, and any other account's unproven claim on the intent is dropped:
 * the intent has proved whose it is.
 */
export async function closePourClaim(
  intentTx: string,
  now = new Date(),
  outcome: Exclude<ClaimOutcome, "dropped"> = "paid",
  userId?: string,
): Promise<void> {
  const tx = intentTx.toLowerCase();
  if (!userId) {
    await getSql().query(`update pour_claims set settled_at = $2, outcome = $3 where intent_tx = $1 and settled_at is null`, [tx, now.toISOString(), outcome]);
    return;
  }
  await dropOtherClaims(tx, userId);
  await getSql().query(`update pour_claims set settled_at = $2, outcome = $3 where intent_tx = $1 and user_id = $4 and settled_at is null`, [
    tx,
    now.toISOString(),
    outcome,
    userId,
  ]);
}

/** Every other account's open claim on an intent that has proved whose it is. */
async function dropOtherClaims(intentTx: string, userId: string): Promise<void> {
  await getSql().query(`delete from pour_claims where intent_tx = $1 and user_id <> $2 and settled_at is null`, [intentTx, userId]);
}

/**
 * Keep a claim for a pour that could not be judged filled yet. Idempotent
 * per intent. `listingSymbol` is kept when the intent names a listing; it
 * held back a recurring run of that listing until recurring buys were
 * retired on 2026-10-04, and nothing reads it now. Whether it will pay is
 * not the claim's to say: a no XP buy is marked by intent (lib/server/no-xp).
 */
export async function savePourClaim(
  userId: string,
  intentTx: string,
  direction: "buy" | "sell",
  fillTx: string | null,
  listingSymbol: string | null = null,
  {
    /**
     * false: kept while the ownership proof could not be read (a failed
     * read), so the evening pass proves it. Unproven claims of several
     * accounts stand side by side until one proves; a proven claim makes
     * the others give way, so a stranger's report made while the chain did
     * not answer never stands in the owner's way.
     */
    proven = true,
  }: { proven?: boolean } = {},
): Promise<void> {
  const tx = intentTx.toLowerCase();
  const sql = getSql();
  // A proven claim: the unproven claims other accounts made on this intent give way.
  if (proven) await sql.query(`delete from pour_claims where intent_tx = $1 and user_id <> $2 and settled_at is null and not proven`, [tx, userId]);
  try {
    await sql.query(
      `insert into pour_claims (intent_tx, user_id, direction, fill_tx, listing_symbol, proven)
       select $1, $2, $3, $4, $5, $6
        where not exists (
          -- Another account's proven or settled claim stands: never a second.
          select 1 from pour_claims o where o.intent_tx = $1 and o.user_id <> $2
             and (o.proven or o.outcome in ('paid', 'recorded_no_xp'))
        )
       on conflict (intent_tx, user_id) do update set
         fill_tx = coalesce(pour_claims.fill_tx, excluded.fill_tx),
         listing_symbol = coalesce(pour_claims.listing_symbol, excluded.listing_symbol),
         proven = pour_claims.proven or excluded.proven`,
      [tx, userId, direction, fillTx, listingSymbol, proven],
    );
  } catch (error) {
    // Two proven claims racing: the one-proven index lets the first stand.
    if ((error as { code?: unknown })?.code !== "23505") throw error;
  }
}

/**
 * `recorded`: filled claims for a no XP buy, written into the ledger and
 * paid nothing. `refused`: claims whose intent is not proven the account's
 * (lib/server/pour-ownership), removed unpaid and unrecorded so the real
 * owner can still report the intent.
 */
export type ClaimSummary = { checked: number; paid: number; dropped: number; recorded: number; refused: number };

export type SettledClaim = {
  user_id: string;
  intent_tx: string;
  direction: "buy" | "sell";
  referred_by: string | null;
  fill_tx: string | null;
  /** The account's users.wallet_address, for the ownership proof. Absent reads as none. */
  wallet_address?: string | null;
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

/** What settling one filled claim reads and writes, injectable for tests. */
export type ClaimPayDeps = {
  readIntent: (intentTx: string) => Promise<Intent | null>;
  prove: (claim: SettledClaim, intent: Intent) => Promise<OwnershipVerdict>;
  record: (claim: SettledClaim, intent: Intent) => Promise<void>;
};

export function defaultClaimPayDeps(): ClaimPayDeps {
  const sodax = getSodax();
  return {
    readIntent: async (intentTx) => {
      const intent = await sodax.swaps.getIntent(intentTx as `0x${string}`).catch(() => null);
      return intent?.ok ? intent.value : null;
    },
    prove: async (claim, intent) =>
      ownsIntent({
        sodax,
        intent,
        direction: claim.direction === "sell" ? "out" : "in",
        wallets: await accountOwnedWallets(claim.user_id, claim.wallet_address ?? null),
        txHash: claim.intent_tx,
      }),
    record: async (claim, intent) => {
      await recordOrder({ sodax, userId: claim.user_id, intentTx: claim.intent_tx, direction: claim.direction, intent, claimedFillTx: claim.fill_tx });
    },
  };
}

/**
 * Settling one filled claim: the order row first (a claim is only settled
 * once `orders` holds it, so a failed intent read leaves the claim for the
 * next night), proven the account's as every path to the ledger is. A read
 * that did not answer leaves it open too; only a proven "not the
 * account's" removes it ("not_owned").
 */
export async function payClaim(
  claim: SettledClaim,
  deps: ClaimPayDeps = defaultClaimPayDeps(),
): Promise<boolean | "paid" | "recorded_no_xp" | "not_owned"> {
  const intent = await deps.readIntent(claim.intent_tx);
  if (!intent) return false;
  const owned = await deps.prove(claim, intent);
  if (!owned.ok && owned.unknown) return false;
  if (!owned.ok && !owned.deliveredToAccount) return "not_owned";
  // Delivered to the account but paid by someone not proven its: recorded,
  // never paid (lib/server/no-xp), which payRecordedClaim reads below. A
  // buy already paid is a replay and is never marked after the fact.
  if (!owned.ok && !(await pourPaid(claim.intent_tx))) await markNoXp(claim.intent_tx, "unproven_source");
  await deps.record(claim, intent);
  if (!(await orderExists(claim.intent_tx))) return false;
  return payRecordedClaim(claim);
}

/**
 * The evening's pass over open claims, oldest first: a filled one is
 * proven the account's again, then recorded as an order and paid (parked for the next profile sync), or
 * for a no XP buy recorded and paid nothing (lib/server/no-xp), a
 * closed one is dropped unpaid, anything still undecided waits for the
 * next night. A claim older than 30 days that never filled is dropped.
 */
export async function settlePourClaims({
  limit = 15,
  now = new Date(),
  verdictOf = async (intentTx: string) => verdictFromRecord(await fetchIntentRecord(intentTx), now),
  pay = (claim: SettledClaim) => payClaim(claim),
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
  pay?: (claim: SettledClaim) => Promise<boolean | "paid" | "recorded_no_xp" | "not_owned">;
  /** Starts no claim after this long, inside the evening stage's own budget. */
  budgetMs?: number;
  clock?: () => number;
} = {}): Promise<ClaimSummary> {
  const sql = getSql();
  const started = clock();
  const claims = (await sql.query(
    `select c.intent_tx, c.user_id, c.direction, c.fill_tx, c.created_at, u.referred_by, u.wallet_address,
            exists (select 1 from no_xp_intents n where n.intent_tx = c.intent_tx) as no_xp
       from pour_claims c join users u on u.id = c.user_id
      where c.settled_at is null
      order by c.last_checked_at asc nulls first, c.created_at asc limit $1`,
    [limit],
  )) as (SettledClaim & { created_at: string | Date })[];
  const summary: ClaimSummary = { checked: claims.length, paid: 0, dropped: 0, recorded: 0, refused: 0 };
  for (const claim of claims) {
    if (clock() - started > budgetMs) break;
    const verdict = await verdictOf(claim.intent_tx);
    const stale = now.getTime() - new Date(claim.created_at).getTime() > 30 * 86_400_000;
    // Undecided or unpaid claims go to the back of the line, so one that
    // stays stuck can never starve the ones behind it.
    const later = () =>
      sql.query(`update pour_claims set last_checked_at = $2 where intent_tx = $1 and user_id = $3`, [claim.intent_tx, now.toISOString(), claim.user_id]);
    let outcome: ClaimOutcome;
    if (verdict === "filled") {
      const settled = await pay(claim);
      if (settled === "not_owned") {
        // Never this account's: nothing recorded, nothing paid, and no claim
        // kept that would stand in the real owner's way (one claim per intent).
        await sql.query(`delete from pour_claims where intent_tx = $1 and user_id = $2 and settled_at is null`, [claim.intent_tx, claim.user_id]);
        summary.refused += 1;
        continue;
      }
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
    // The claim that proved settles; any other account's on the intent goes.
    if (outcome !== "dropped") await dropOtherClaims(claim.intent_tx, claim.user_id);
    await sql.query(`update pour_claims set settled_at = $2, outcome = $3 where intent_tx = $1 and user_id = $4`, [
      claim.intent_tx,
      now.toISOString(),
      outcome,
      claim.user_id,
    ]);
  }
  return summary;
}
