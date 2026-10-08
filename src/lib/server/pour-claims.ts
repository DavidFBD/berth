import { EvmSolverService, IntentsAbi, type Intent, type IntentResponse } from "@sodax/sdk";
import { forgoHold, isNoXp, markNoXp, pourPaid } from "@/lib/server/no-xp";
import { isRobinhoodBuy, settleRobinhoodClaim, type ClaimDelivery } from "@/lib/server/delivery-gate";
import { parseEventLogs, type Log } from "viem";
import { awardXp } from "@/lib/server/accounts";
import { getSql } from "@/lib/server/db";
import { fetchIntentRecord } from "@/lib/server/limit-orders";
import { recordOrder } from "@/lib/server/orders";
import { UNKNOWN, accountOwnedWallets, withTimeout, type OwnershipVerdict } from "@/lib/server/pour-ownership";
import { getSodax, ownsIntent } from "@/lib/server/pour-verify";
import { limitStateFrom, type IntentRecord } from "@/lib/limit-orders";
import type { RewardList } from "@/lib/profile-types";
import { holdingChainOf } from "@/lib/orders";
import { payRobinhoodSell, robinhoodPourXp, type PourXpVerdict } from "@/lib/server/robinhood-xp";

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
 * and on a referred account its own first buy XP (invite_accepted), all
 * index-deduped, so a replay pays nothing. The inviter is never paid for a
 * buy: since 2026-10-05 they earn friend_stayed for a friend who sets up
 * and stays (lib/server/invite-xp). `announced` false parks it for the next profile
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
  }
  return { rewards, xp };
}

/**
 * awardFilledPour for a sell from Robinhood Chain (D2): the pour_out is
 * checked against the account's Berth buys there and paid in one locked
 * step (lib/server/robinhood-xp payRobinhoodSell); only when it is paid
 * does the rest of the award follow. `wait` and `never` pay nothing.
 */
export async function awardRobinhoodSell(
  user: { id: string; referred_by: string | null },
  intentTx: string,
  { announced = true }: { announced?: boolean } = {},
): Promise<{ verdict: "paid" | "wait" | "never"; rewards: RewardList; xp: number | null }> {
  const sold = await payRobinhoodSell(intentTx, { userId: user.id, announced });
  if (sold.verdict !== "paid") return { verdict: sold.verdict === "wait" ? "wait" : "never", rewards: [], xp: null };
  const rewards: RewardList = sold.awarded > 0 ? [{ kind: "pour_out", amount: sold.awarded }] : [];
  let xp = sold.xp;
  if (user.referred_by) {
    const accepted = await awardXp(user.id, "invite_accepted", null, { announced });
    xp = accepted.xp;
    if (accepted.awarded > 0) rewards.push({ kind: "invite_accepted", amount: accepted.awarded });
  }
  return { verdict: "paid", rewards, xp };
}

/** How long the evening pass may keep starting claims (the stage allows ten seconds). */
export const CLAIMS_BUDGET_MS = 8_000;

/** The claim's order row as recorded, or undefined while there is none. */
async function orderRow(intentTx: string): Promise<{ quantity: string | null } | undefined> {
  const rows = (await getSql().query(`select quantity from orders where intent_tx = $1 limit 1`, [intentTx.toLowerCase()])) as {
    quantity: string | null;
  }[];
  return rows[0];
}

/** How long a claim is kept open for its order row to be completed (the fill read again each night). */
const CLAIM_LIFE_MS = 30 * 86_400_000;

/** The fill transaction SODAX's backend names for an intent, if it has one. */
export function filledTxOf(record: IntentResponse | null): string | null {
  const fills = ((record?.events ?? []) as { eventType?: string; txHash?: string }[]).filter(
    (event) => event.eventType === "intent-filled" && typeof event.txHash === "string",
  );
  return fills.at(-1)?.txHash?.toLowerCase() ?? null;
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
    /**
     * A buy delivered on Robinhood Chain, or one whose intent could not be
     * read yet (lib/server/delivery-gate): its delivery decision (null
     * while a read kept it open) and the facts it was made from, written in
     * this one statement so no evening pass ever reads the claim without
     * them. A decision once written stands, and so do the facts first kept.
     * Absent on a hub claim, whose statement names none of these columns.
     */
    delivery,
  }: { proven?: boolean; delivery?: ClaimDelivery } = {},
): Promise<void> {
  const tx = intentTx.toLowerCase();
  const sql = getSql();
  // A proven claim: the unproven claims other accounts made on this intent give way.
  if (proven) await sql.query(`delete from pour_claims where intent_tx = $1 and user_id <> $2 and settled_at is null and not proven`, [tx, userId]);
  const columns = delivery ? ", delivery_ok, delivery_signer, delivery_place_ok" : "";
  const values = delivery ? ", $7, $8, $9" : "";
  const updates = delivery
    ? `,
         delivery_ok = coalesce(pour_claims.delivery_ok, excluded.delivery_ok),
         delivery_signer = case when pour_claims.delivery_place_ok is null then excluded.delivery_signer else pour_claims.delivery_signer end,
         delivery_place_ok = coalesce(pour_claims.delivery_place_ok, excluded.delivery_place_ok)`
    : "";
  try {
    await sql.query(
      `insert into pour_claims (intent_tx, user_id, direction, fill_tx, listing_symbol, proven${columns})
       select $1, $2, $3, $4, $5, $6${values}
        where not exists (
          -- Another account's proven or settled claim stands: never a second.
          select 1 from pour_claims o where o.intent_tx = $1 and o.user_id <> $2
             and (o.proven or o.outcome in ('paid', 'recorded_no_xp'))
        )
       on conflict (intent_tx, user_id) do update set
         fill_tx = coalesce(pour_claims.fill_tx, excluded.fill_tx),
         listing_symbol = coalesce(pour_claims.listing_symbol, excluded.listing_symbol),
         proven = pour_claims.proven or excluded.proven${updates}`,
      delivery
        ? [tx, userId, direction, fillTx, listingSymbol, proven, delivery.ok, delivery.signer, delivery.placeOk]
        : [tx, userId, direction, fillTx, listingSymbol, proven],
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
export type ClaimSummary = {
  checked: number;
  paid: number;
  dropped: number;
  recorded: number;
  refused: number;
  /** Claims whose settling threw: logged, left open at the back of the line, never in the way of the rest. */
  failed: number;
};

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
  /** When the claim was kept; a Robinhood Chain claim's delivery decision waits on it (lib/server/delivery-gate). */
  created_at?: string | Date;
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
  /** A claim on a buy delivered on Robinhood Chain: paid only once its delivery is allowed (lib/server/delivery-gate). */
  settleRobinhood?: (claim: SettledClaim, intent: Intent) => Promise<"allowed" | "refused" | "settled" | "wait">;
  /** Whether a buy delivered on Robinhood Chain earns now (lib/server/robinhood-xp, D1). */
  pourXp?: (claim: SettledClaim, intent: Intent) => Promise<PourXpVerdict>;
  /** A sell from Robinhood Chain, checked and paid in one locked step (D2). */
  paySell?: (claim: SettledClaim) => Promise<"paid" | "wait" | "never">;
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
      // A Robinhood Chain buy's fill is read from its fill transaction
      // first (lib/server/orders buildOrder): the claim's, else the one
      // SODAX's backend names, so a fill outside the scan's window is still
      // found on a later night.
      const claimedFillTx =
        claim.fill_tx ?? (isRobinhoodBuy(claim.direction, intent) ? filledTxOf(await fetchIntentRecord(claim.intent_tx).catch(() => null)) : null);
      await recordOrder({ sodax, userId: claim.user_id, intentTx: claim.intent_tx, direction: claim.direction, intent, claimedFillTx });
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
function outlived(claim: SettledClaim, now: Date): boolean {
  return !!claim.created_at && now.getTime() - new Date(claim.created_at).getTime() > CLAIM_LIFE_MS;
}

export async function payClaim(
  claim: SettledClaim,
  deps: ClaimPayDeps = defaultClaimPayDeps(),
  now = new Date(),
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
  // Delivered on Robinhood Chain: paid only once its delivery is allowed,
  // decided from what the claim stored (lib/server/delivery-gate). A
  // refusal marks it to pay nothing (payRecordedClaim reads that below); a
  // decision still open records the order and leaves the claim for the
  // next night.
  const delivery = isRobinhoodBuy(claim.direction, intent) ? await (deps.settleRobinhood ?? settleRobinhoodClaim)(claim, intent) : null;
  await deps.record(claim, intent);
  const row = await orderRow(claim.intent_tx);
  if (!row) return false;
  if (delivery === "wait") return false;
  // A Robinhood Chain buy whose fill was not read yet (the row's quantity
  // empty): the claim stays open and the row is built again the next night,
  // filling only what is missing, for as long as a claim lives (30 days).
  if (delivery !== null && row.quantity === null && !outlived(claim, now)) return false;
  // On Robinhood Chain (lib/server/robinhood-xp): a buy earns once its
  // delivery is in the wallet, waiting night after night for as long as a
  // claim lives and then never; a sell earns only up to the Berth buys
  // delivered there. A no XP buy is settled by payRecordedClaim as before.
  const onRobinhood = holdingChainOf(claim.direction, intent) === "robinhood";
  if (onRobinhood && claim.direction === "sell") {
    const sold = await (deps.paySell ??
      (async (c: SettledClaim) => (await awardRobinhoodSell({ id: c.user_id, referred_by: c.referred_by }, c.intent_tx, { announced: false })).verdict))(claim);
    if (sold === "wait" && !outlived(claim, now)) return false;
    return sold === "paid" ? "paid" : "recorded_no_xp";
  }
  if (onRobinhood && !claim.no_xp && !(await isNoXp(claim.intent_tx))) {
    const gate = await (deps.pourXp ?? ((c: SettledClaim) => robinhoodPourXp(c.intent_tx, { onRobinhood: true })))(claim, intent);
    if (gate === "wait" && !outlived(claim, now)) return false;
    if (gate !== "pay") {
      // A delivery that never arrived (or cannot be judged) pays nothing,
      // then or ever, and counts for no later sell (lib/server/no-xp).
      if (!(await pourPaid(claim.intent_tx))) await markNoXp(claim.intent_tx, "delivery_refused");
      await forgoHold(claim.intent_tx);
      return "recorded_no_xp";
    }
  }
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
  const summary: ClaimSummary = { checked: claims.length, paid: 0, dropped: 0, recorded: 0, refused: 0, failed: 0 };
  /** One claim; undecided or unpaid it simply stays open (it is already at the back of the line). */
  async function settleOne(claim: SettledClaim & { created_at: string | Date }): Promise<void> {
    const verdict = await verdictOf(claim.intent_tx);
    const stale = now.getTime() - new Date(claim.created_at).getTime() > CLAIM_LIFE_MS;
    let outcome: ClaimOutcome;
    if (verdict === "filled") {
      const settled = await pay(claim);
      if (settled === "not_owned") {
        // Never this account's: nothing recorded, nothing paid, and no claim
        // kept that would stand in the real owner's way (one claim per intent).
        await sql.query(`delete from pour_claims where intent_tx = $1 and user_id = $2 and settled_at is null`, [claim.intent_tx, claim.user_id]);
        summary.refused += 1;
        return;
      }
      if (!settled) return;
      outcome = settled === "recorded_no_xp" ? "recorded_no_xp" : "paid";
      if (outcome === "paid") summary.paid += 1;
      else summary.recorded += 1;
    } else if (verdict === "notFilled" || stale) {
      outcome = "dropped";
      summary.dropped += 1;
    } else {
      return;
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
  for (const claim of claims) {
    if (clock() - started > budgetMs) break;
    try {
      // To the back of the line before anything is read: a claim that
      // throws, or hangs past the function's life, never heads the queue
      // again, so one bad claim never stalls the ones behind it night after
      // night.
      await sql.query(`update pour_claims set last_checked_at = $2 where intent_tx = $1 and user_id = $3`, [
        claim.intent_tx,
        now.toISOString(),
        claim.user_id,
      ]);
      await settleOne(claim);
    } catch (error) {
      summary.failed += 1;
      console.warn("[pour-claims] claim failed", claim.intent_tx.slice(0, 10), error instanceof Error ? error.message : error);
    }
  }
  return summary;
}
