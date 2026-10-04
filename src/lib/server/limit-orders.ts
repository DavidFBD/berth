import { ChainKeys, getChainKeyFromRelayChainId, getIntentRelayChainId, type Intent, type IntentResponse } from "@sodax/sdk";
import { HOME_CHAIN } from "@/lib/account";
import { formatUnits } from "viem";
import { getSql } from "@/lib/server/db";
import { getSodax, holdsIntentCreated, ownsIntent, readReceipt } from "@/lib/server/pour-verify";
import type { OwnedWallet } from "@/lib/server/pour-ownership";
import { recordOrderMarks, saveOrder } from "@/lib/server/orders";
import { forgoHold, isNoXp, markNoXp } from "@/lib/server/no-xp";
import { readOrder } from "@/lib/orders";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { formatTokenAmount, formatUsdPrecise } from "@/lib/format";
import { sendNotice } from "@/lib/server/email/notify";
import type { Notice } from "@/lib/server/email/compose";
import {
  effectivePrice,
  fillProgress,
  isWaiting,
  limitStateFrom,
  pastDeadline,
  switchedOn,
  type IntentRecord,
  type LimitSide,
  type LimitState,
  type LimitStatus,
} from "@/lib/limit-orders";

/**
 * Limit orders, the server half: who may place them (the switch), the
 * record of each one placed, and keeping that record in step with the
 * intent on the hub.
 *
 * The truth is the intent. Everything stored here is read from the chain
 * (the intent's amounts and deadline, via its IntentCreated log) or from
 * SODAX's backend (fills and cancels, GET /v1/be/intent/tx/:hash), never
 * taken from the client, except the price the person typed, which is kept
 * only when the intent agrees with it.
 *
 * A waiting order is not an order in `orders`: it is money that has not
 * bought anything, so it lives in `limit_orders` alone and no holdings,
 * performance or hold reader ever sees it. A fill is written into `orders`
 * like any other, marked order_type 'limit'.
 */

/** Placed through the limit path: a dated order must still have this long to run. */
export const MIN_WAIT_SECONDS = 120;
/**
 * The sweep takes an intent it did not see placed only when it waits
 * forever or longer than any market order: five minutes on most chains,
 * three hours from Bitcoin (lib/pour-lifecycle BITCOIN_INTENT_DEADLINE_SECONDS).
 */
export const SWEEP_MIN_WAIT_SECONDS = 4 * 3600;

/** The switch, read server side on every call so a redeploy is never needed to turn it off. */
export function limitOrdersOn(identifiers: readonly (string | null | undefined)[]): boolean {
  return switchedOn(process.env.LIMIT_ORDERS_USERS, identifiers);
}

type Row = {
  id: string;
  intent_tx: string;
  intent_hash: string | null;
  direction: LimitSide;
  listing_symbol: string;
  listing_address: string;
  pay_symbol: string | null;
  pay_chain: string | null;
  src_chain: string | null;
  input_raw: string;
  input_decimals: number;
  min_output_raw: string;
  output_decimals: number;
  limit_price: string;
  expires_at: string | Date | null;
  status: LimitStatus;
  remaining_raw: string | null;
  received_raw: string | null;
  fill_tx: string | null;
  close_tx: string | null;
  fill_recorded_at: string | Date | null;
  cancel_asked_at: string | Date | null;
  announced_at: string | Date | null;
  placed_at: string | Date;
};

const COLUMNS = `id, intent_tx, intent_hash, direction, listing_symbol, listing_address,
  pay_symbol, pay_chain, src_chain, input_raw::text as input_raw, input_decimals,
  min_output_raw::text as min_output_raw, output_decimals, limit_price::text as limit_price,
  expires_at, status, remaining_raw::text as remaining_raw, received_raw::text as received_raw,
  fill_tx, close_tx, fill_recorded_at, cancel_asked_at, announced_at, placed_at`;

/** A limit order as the page reads it. Amounts are raw integers as strings. */
export type LimitOrderView = {
  intentTx: string;
  direction: LimitSide;
  symbol: string;
  limitPrice: number;
  expiresAt: string | null;
  status: LimitStatus;
  inputRaw: string;
  inputDecimals: number;
  minOutputRaw: string;
  outputDecimals: number;
  receivedRaw: string;
  /** How much has filled, 0 to 1. */
  progress: number;
  paySymbol: string | null;
  /** The chain the intent was signed on (the order's source), for cancelling. */
  srcChain: string | null;
  placedAt: string;
  cancelAsked: boolean;
  /** Set once, on the first answer after the order closed: the page announces it then. */
  justClosed?: boolean;
  fillTx: string | null;
};

const iso = (value: string | Date | null): string | null => (value === null ? null : new Date(value).toISOString());

function viewOf(row: Row, justClosed = false): LimitOrderView {
  const input = BigInt(row.input_raw);
  const remaining = row.remaining_raw === null ? input : BigInt(row.remaining_raw);
  return {
    intentTx: row.intent_tx,
    direction: row.direction,
    symbol: row.listing_symbol,
    limitPrice: Number(row.limit_price),
    expiresAt: iso(row.expires_at),
    status: isWaiting(row.status) && pastDeadline(row.expires_at) ? "expired" : row.status,
    inputRaw: row.input_raw,
    inputDecimals: row.input_decimals,
    minOutputRaw: row.min_output_raw,
    outputDecimals: row.output_decimals,
    receivedRaw: row.received_raw ?? "0",
    progress: row.status === "filled" ? 1 : fillProgress(input, remaining),
    paySymbol: row.pay_symbol,
    srcChain: row.src_chain,
    placedAt: iso(row.placed_at)!,
    cancelAsked: row.cancel_asked_at !== null,
    fillTx: row.fill_tx,
    ...(justClosed && { justClosed: true }),
  };
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** The backend's record of the intent a hub transaction created, or null when it has none (yet) or cannot answer. */
export async function fetchIntentRecord(intentTx: string, timeoutMs = 6_000): Promise<IntentResponse | null> {
  try {
    const answer = await withTimeout(getSodax().backendApi.getIntentByTxHash(intentTx), timeoutMs);
    return answer.ok ? answer.value : null;
  } catch {
    return null;
  }
}

/** Whether an intent is the account's, by the proof every path to the ledger shares; "unknown" when a read failed. */
export type OwnsIntent = (intentTx: string, intent: Intent, direction: LimitSide) => Promise<boolean | "unknown">;

/** The shared proof (lib/server/pour-ownership) for one account's wallets. */
export function limitOwnership(wallets: readonly OwnedWallet[]): OwnsIntent {
  return async (intentTx, intent, direction) => {
    const owned = await ownsIntent({ intent, direction: direction === "buy" ? "in" : "out", wallets, txHash: intentTx });
    if (owned.ok) return true;
    if (owned.unknown) return "unknown";
    // A limit buy delivered to the account by a payer not proven its: kept,
    // and its fill recorded, but it never pays (lib/server/no-xp).
    if (!owned.deliveredToAccount) return false;
    await markNoXp(intentTx, "unproven_source");
    return true;
  };
}

export type PlaceRejection = "not confirmed" | "not a limit order" | "not yours" | "not a listing" | "switched off" | "not yet known";

/**
 * The pure judgement of a placed intent: that it is a buy or sell of a
 * token listing on the claimed side, that the account owns it, and that
 * it waits (a deadline of 0, or one further out than a market order's
 * five minutes). `owners` are the account's addresses, lowercased: its
 * home address, its hub wallet, the address on its row.
 */
export function judgeLimitIntent({
  intent,
  direction,
  owners,
  nowSeconds,
  minWaitSeconds = MIN_WAIT_SECONDS,
  homeHub,
}: {
  /**
   * The home address's hub wallet. A limit sell must have been created by
   * it: v1 records, sweeps and cancels only the home hub wallet's sells.
   */
  homeHub?: string | null;
  /** The least a dated order must still wait to be taken as a limit order. */
  minWaitSeconds?: number;
  intent: { inputToken: string; outputToken: string; srcAddress: string; creator: string; deadline: bigint };
  direction: LimitSide;
  owners: ReadonlySet<string>;
  nowSeconds: number;
}): { ok: true; listing: (typeof TOKEN_LISTINGS)[number] } | { ok: false; reason: PlaceRejection } {
  const ours = (direction === "buy" ? intent.outputToken : intent.inputToken).toLowerCase();
  const listing = TOKEN_LISTINGS.find((entry) => entry.address.toLowerCase() === ours);
  if (!listing) return { ok: false, reason: "not a listing" };
  const owned = owners.has(intent.creator.toLowerCase()) || owners.has(intent.srcAddress.toLowerCase());
  if (!owned) return { ok: false, reason: "not yours" };
  if (direction === "sell" && (!homeHub || intent.creator.toLowerCase() !== homeHub.toLowerCase())) {
    return { ok: false, reason: "not yours" };
  }
  // Placed through the limit path, anything still two minutes from its
  // deadline, or waiting forever, is a limit order (a same-day expiry
  // placed late in the evening included). The sweep, which cannot tell a
  // limit from a market order, asks for more (SWEEP_MIN_WAIT_SECONDS).
  const waits = intent.deadline === 0n || Number(intent.deadline) >= nowSeconds + minWaitSeconds;
  if (!waits) return { ok: false, reason: "not a limit order" };
  return { ok: true, listing };
}

/**
 * The price to keep: the one the person typed when the intent agrees with
 * it (within half a percent, the fee and the rounding between), otherwise
 * the price the intent itself implies, which is the one that will fill.
 */
export function keptPrice(typed: number | undefined, implied: number): number {
  if (typed !== undefined && Number.isFinite(typed) && typed > 0 && Math.abs(typed - implied) / implied <= 0.005) return typed;
  return Number(implied.toPrecision(8));
}

/** Record a limit order the person just placed. Verifies the intent on chain first. */
export async function placeLimitOrder({
  userId,
  owners,
  owns,
  intentTx,
  direction,
  typedPrice,
  intentHash,
  srcChain,
  homeHub,
  readIntent,
}: {
  homeHub?: string | null;
  /** The SDK's intent read, injectable for tests. */
  readIntent?: (intentTx: string) => Promise<{ ok: true; value: Intent } | { ok: false }>;
  userId: string;
  owners: ReadonlySet<string>;
  /** The ownership proof every ledger path shares (limitOwnership, lib/server/pour-ownership). */
  owns: OwnsIntent;
  intentTx: string;
  direction: LimitSide;
  typedPrice?: number;
  intentHash?: string;
  srcChain?: string;
}): Promise<{ ok: true; order: LimitOrderView } | { ok: false; reason: PlaceRejection }> {
  const receipt = await readReceipt(intentTx);
  if (receipt.state === "unknown") return { ok: false, reason: "not yet known" };
  if (receipt.state === "failed") return { ok: false, reason: "not confirmed" };
  const sodax = getSodax();
  const read = readIntent ?? ((tx: string) => sodax.swaps.getIntent(tx as `0x${string}`));
  let intent: Intent | undefined;
  try {
    const result = await withTimeout(read(intentTx), 15_000);
    if (result.ok) intent = result.value;
  } catch {
    // A timeout or a failed read, judged below.
  }
  if (!intent) {
    // The receipt succeeded (above) and may come from another endpoint than
    // the SDK's read, which can lag or time out. When it holds an
    // IntentCreated from the Intents contract, the read failed, not the
    // intent: not yet known, asked again (as verifyPourTx answers). Otherwise
    // it is not an intent.
    return holdsIntentCreated(receipt.receipt.logs, sodax.config.solver.intentsContract)
      ? { ok: false, reason: "not yet known" }
      : { ok: false, reason: "not confirmed" };
  }
  const recorded = await saveVerifiedIntent({ userId, owners, owns, intentTx, intent, direction, typedPrice, intentHash, homeHub });
  // The chain the page says it signed on must be the chain the intent came from.
  if (recorded.ok && srcChain && recorded.order.srcChain && srcChain !== recorded.order.srcChain) {
    console.warn("[limit-orders] claimed source chain differs from the intent's", intentTx, srcChain, recorded.order.srcChain);
  }
  return recorded;
}

/** The chain an intent was created from, by its relay chain id; undefined when unknown. */
export function sourceChainOf(relayChainId: bigint): string | undefined {
  try {
    // A sell from the account is created by the hub wallet on Sonic and
    // signed on the home chain, which is where its cancel is signed too.
    if (relayChainId === getIntentRelayChainId(ChainKeys.SONIC_MAINNET)) return HOME_CHAIN;
    return getChainKeyFromRelayChainId(relayChainId as never) as string;
  } catch {
    return undefined;
  }
}

/**
 * Judge an intent read from the chain or the backend, and record it. The
 * source chain is the intent's own, never the client's word.
 */
export async function saveVerifiedIntent({
  userId,
  owners,
  owns,
  intentTx,
  intent,
  direction,
  typedPrice,
  intentHash,
  now = new Date(),
  minWaitSeconds,
  homeHub,
}: {
  minWaitSeconds?: number;
  homeHub?: string | null;
  userId: string;
  owners: ReadonlySet<string>;
  owns: OwnsIntent;
  intentTx: string;
  intent: Intent;
  direction: LimitSide;
  typedPrice?: number;
  intentHash?: string;
  now?: Date;
}): Promise<{ ok: true; order: LimitOrderView } | { ok: false; reason: PlaceRejection }> {
  const sodax = getSodax();
  const verdict = judgeLimitIntent({ intent, direction, owners, nowSeconds: Math.floor(now.getTime() / 1000), minWaitSeconds, homeHub });
  if (!verdict.ok) return verdict;
  // The v1 rules above first, then the proof every path to the ledger
  // shares: a limit order becomes an order row when it fills, so it must be
  // the account's by the same test as a market order.
  // A read that did not answer defers: the page asks again, the sweep
  // tries on its next pass. Never "not yours" on a read that failed.
  const owned = await owns(intentTx, intent, direction);
  if (owned === "unknown") return { ok: false, reason: "not yet known" };
  if (!owned) return { ok: false, reason: "not yours" };
  const { listing } = verdict;
  const other = direction === "buy" ? intent.inputToken : intent.outputToken;
  const pay = sodax.config.getXTokenFromHubAsset(other);
  if (!pay) return { ok: false, reason: "not a listing" };
  const srcChain = sourceChainOf(BigInt(intent.srcChain as unknown as bigint));
  const inputDecimals = direction === "buy" ? pay.decimals : listing.decimals;
  const outputDecimals = direction === "buy" ? listing.decimals : pay.decimals;
  const implied = effectivePrice({
    side: direction,
    swapInput: intent.inputAmount,
    minOutput: intent.minOutputAmount,
    inputDecimals,
    outputDecimals,
  });
  const price = keptPrice(typedPrice, implied);
  const expiresAt = intent.deadline === 0n ? null : new Date(Number(intent.deadline) * 1000).toISOString();

  const rows = (await getSql().query(
    `insert into limit_orders (
       user_id, intent_tx, intent_hash, direction, listing_symbol, listing_address,
       pay_symbol, pay_chain, src_chain, input_raw, input_decimals, min_output_raw,
       output_decimals, limit_price, expires_at, remaining_raw, received_raw
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$10,0)
     on conflict (intent_tx) do update set
       intent_hash = coalesce(limit_orders.intent_hash, excluded.intent_hash),
       -- The intent's own chain; an upsert without one never erases it.
       src_chain = coalesce(excluded.src_chain, limit_orders.src_chain)
     where limit_orders.user_id = excluded.user_id
     returning ${COLUMNS}`,
    [
      userId,
      intentTx.toLowerCase(),
      intentHash ?? null,
      direction,
      listing.symbol,
      listing.address.toLowerCase(),
      pay.symbol,
      pay.chainKey,
      srcChain ?? null,
      intent.inputAmount.toString(),
      inputDecimals,
      intent.minOutputAmount.toString(),
      outputDecimals,
      price,
      expiresAt,
    ],
  )) as Row[];
  if (!rows[0]) return { ok: false, reason: "not yours" };
  return { ok: true, order: viewOf(rows[0]) };
}

/** The backend's intent response in the shape lib/limit-orders reads. */
function recordOf(response: IntentResponse): IntentRecord {
  return {
    open: response.open,
    intent: { deadline: response.intent.deadline, inputAmount: response.intent.inputAmount },
    events: (response.events ?? []) as IntentRecord["events"],
  };
}

/** The Intent struct of a backend response, with its numbers as bigints. */
function intentOf(response: IntentResponse): Intent {
  const raw = response.intent;
  return {
    intentId: BigInt(raw.intentId),
    creator: raw.creator,
    inputToken: raw.inputToken,
    outputToken: raw.outputToken,
    inputAmount: BigInt(raw.inputAmount),
    minOutputAmount: BigInt(raw.minOutputAmount),
    deadline: BigInt(raw.deadline),
    allowPartialFill: raw.allowPartialFill,
    srcChain: BigInt(raw.srcChain),
    dstChain: BigInt(raw.dstChain),
    srcAddress: raw.srcAddress,
    dstAddress: raw.dstAddress,
    solver: raw.solver,
    data: raw.data,
  } as unknown as Intent;
}

/**
 * Write a filled limit order into `orders`, as a market fill would have
 * been, with the exact output the backend reports, the fill's own block
 * time, order_type 'limit' and the price. Best effort: a failure logs and
 * the next sync, or the pour route's own record, fills it in.
 */
async function recordFill(row: Row, userId: string, response: IntentResponse, state: LimitState): Promise<boolean> {
  try {
    const sodax = getSodax();
    const intent = intentOf(response);
    const listing = TOKEN_LISTINGS.find((entry) => entry.address.toLowerCase() === row.listing_address);
    if (!listing) return false;
    const other = row.direction === "buy" ? intent.inputToken : intent.outputToken;
    const pay = sodax.config.getXTokenFromHubAsset(other);
    const fillEvent = [...(response.events as IntentRecord["events"])].reverse().find((event) => event.eventType === "intent-filled");
    let filledAt: Date | null = null;
    if (fillEvent?.blockNumber) {
      const block = await withTimeout(
        sodax.hubProvider.publicClient.getBlock({ blockNumber: BigInt(fillEvent.blockNumber) }),
        6_000,
      ).catch(() => null);
      if (block) filledAt = new Date(Number(block.timestamp) * 1000);
    }
    const order = readOrder({
      intentTx: row.intent_tx,
      direction: row.direction,
      intent,
      listing: { symbol: listing.symbol, address: listing.address, decimals: listing.decimals },
      pay: pay ? { symbol: pay.symbol, decimals: pay.decimals, chainKey: pay.chainKey } : undefined,
      received: row.direction === "buy" ? state.receivedOutput : undefined,
      fillTx: state.fillTx ?? null,
      placedAt: new Date(row.placed_at),
      filledAt: filledAt ?? new Date(),
    });
    // A sell's proceeds are known exactly here, not only its floor.
    if (row.direction === "sell" && pay && state.receivedOutput > 0n) {
      order.payAmount = formatUnits(state.receivedOutput, pay.decimals);
    }
    const id = await saveOrder(userId, order);
    if (!id) return false;
    // A limit buy first seen from where Berth is not available pays nothing (lib/server/no-xp).
    if (row.direction === "buy" && (await isNoXp(row.intent_tx))) await forgoHold(row.intent_tx);
    await getSql().query(`update orders set order_type = 'limit', limit_price = $2 where id = $1`, [id, row.limit_price]);
    await recordOrderMarks(id, order.filledAt ?? new Date(), 3_000);
    return true;
  } catch (error) {
    console.warn("[limit-orders] fill not recorded", row.intent_tx, error instanceof Error ? error.message : error);
    return false;
  }
}

/** What the email says when a waiting order closes: names, not tickers; the price the person set. */
export function closingNotice(row: Row): Notice | null {
  const listing = TOKEN_LISTINGS.find((entry) => entry.address.toLowerCase() === row.listing_address.toLowerCase());
  const name = listing?.name ?? row.listing_symbol;
  if (row.status === "expired") return { type: "order_expired", side: row.direction, name };
  if (row.status !== "filled") return null;
  let received: string | null = null;
  try {
    const raw = row.received_raw ? BigInt(row.received_raw) : 0n;
    if (raw > 0n) {
      const unit = row.direction === "buy" ? name : row.pay_symbol;
      if (unit) received = `${formatTokenAmount(raw, row.output_decimals)} ${unit}`;
    }
  } catch {
    received = null;
  }
  return { type: "order_filled", side: row.direction, name, price: formatUsdPrecise(Number(row.limit_price)), received };
}

/**
 * Bring waiting rows in step with the backend. A row the backend has not
 * indexed yet stays as it is. A waiting row past its own deadline that the
 * backend still calls open reads as expired: the contract will not fill
 * it, and SODAX's keeper cancels and refunds such intents. Returns the
 * rows as they now stand.
 */
export async function syncRows(
  rows: readonly (Row & { user_id: string })[],
  {
    now = new Date(),
    fetchRecord = fetchIntentRecord,
    onFilled = recordFill,
  }: {
    now?: Date;
    fetchRecord?: (intentTx: string) => Promise<IntentResponse | null>;
    onFilled?: (row: Row, userId: string, response: IntentResponse, state: LimitState) => Promise<boolean>;
  } = {},
): Promise<Row[]> {
  const out: Row[] = [];
  await Promise.all(
    rows.map(async (row) => {
      // A fill whose record in `orders` failed is tried again, order_type 'limit' and all.
      const unrecordedFill = row.status === "filled" && row.fill_recorded_at === null;
      if (!isWaiting(row.status) && !unrecordedFill) {
        out.push(row);
        return;
      }
      const response = await fetchRecord(row.intent_tx);
      const state = response ? limitStateFrom(recordOf(response), { now, cancelAsked: row.cancel_asked_at !== null }) : null;
      // A lapsed deadline alone never closes the row: the backend may lag a
      // fill that landed just before it. The row stays waiting, and synced,
      // until the backend reports how it ended; the view calls it expired
      // meanwhile (viewOf).
      const status: LimitStatus = state?.status ?? row.status;
      const next: Row = {
        ...row,
        status,
        remaining_raw: state ? state.remainingInput.toString() : row.remaining_raw,
        received_raw: state ? state.receivedOutput.toString() : row.received_raw,
        fill_tx: state?.fillTx ?? row.fill_tx,
        close_tx: state?.closeTx ?? row.close_tx,
      };
      await getSql().query(
        `update limit_orders set status = $2, remaining_raw = $3, received_raw = $4, fill_tx = $5,
           close_tx = $6, checked_at = $7,
           closed_at = case when $2 in ('filled', 'cancelled', 'expired') then coalesce(closed_at, $7) else null end
         where id = $1`,
        [row.id, next.status, next.remaining_raw, next.received_raw, next.fill_tx, next.close_tx, now.toISOString()],
      );
      if (status === "filled" && response && state && (await onFilled(next, row.user_id, response, state))) {
        await getSql().query(`update limit_orders set fill_recorded_at = $2 where id = $1`, [row.id, now.toISOString()]);
      }
      // The moment it closed, by fill or by its deadline: an order notice, once per order.
      if (isWaiting(row.status) && (status === "filled" || status === "expired")) {
        const notice = closingNotice(next);
        if (notice) sendNotice({ userId: row.user_id, ref: row.id, notice });
      }
      out.push(next);
    }),
  );
  return out;
}

/**
 * The account's limit orders for the page: every waiting one, synced
 * against the backend first, and any that closed since the page last
 * asked, marked as announced so each closing is told once.
 */
export async function listLimitOrders(
  userId: string,
  options: Parameters<typeof syncRows>[1] = {},
): Promise<LimitOrderView[]> {
  const sql = getSql();
  const rows = (await sql.query(
    `select ${COLUMNS}, user_id from limit_orders
      where user_id = $1 and (status in ('resting', 'partial') or announced_at is null
        or (status = 'filled' and fill_recorded_at is null))
      order by placed_at desc limit 50`,
    [userId],
  )) as (Row & { user_id: string })[];
  if (rows.length === 0) return [];
  const synced = await syncRows(rows, options);
  const closing = synced.filter((row) => !isWaiting(row.status) && row.announced_at === null);
  // Claimed in one statement, so two tabs or a tab and the cron never both announce it.
  const claimed =
    closing.length > 0
      ? ((await sql.query(
          `update limit_orders set announced_at = now() where id = any($1::uuid[]) and announced_at is null returning id`,
          [closing.map((row) => row.id)],
        )) as { id: string }[])
      : [];
  const closingIds = new Set(claimed.map((row) => row.id));
  return synced
    .map((row) => viewOf(row, closingIds.has(row.id)))
    .sort((a, b) => b.placedAt.localeCompare(a.placedAt));
}

/** Whether the account has any limit order still waiting, so turning the switch off never strands one. */
export async function hasWaitingOrders(userId: string): Promise<boolean> {
  const rows = (await getSql().query(
    `select 1 from limit_orders where user_id = $1 and status in ('resting', 'partial') limit 1`,
    [userId],
  )) as unknown[];
  return rows.length > 0;
}

/** The person asked to cancel (and signed): remembered so a cancel after the deadline still reads as theirs. */
export async function markCancelAsked(userId: string, intentTx: string, cancelTx: string): Promise<boolean> {
  // Only ever together with the cancel transaction the person signed, so a
  // bare claim can never turn an expiry into "cancelled".
  if (!/^0x[0-9a-f]{64}$/i.test(cancelTx)) return false;
  const rows = (await getSql().query(
    `update limit_orders set cancel_asked_at = coalesce(cancel_asked_at, now()), cancel_tx = coalesce(cancel_tx, $3)
      where user_id = $1 and intent_tx = $2 returning id`,
    [userId, intentTx.toLowerCase(), cancelTx.toLowerCase()],
  )) as { id: string }[];
  return rows.length > 0;
}

export type LimitSyncSummary = { checked: number; filled: number; closed: number };

/**
 * The evening's pass (lib/server/evening): every waiting order across all
 * accounts, least recently checked first, at most `limit`, so fills and
 * expiries are recorded even for a person who never came back to look.
 */
export async function syncWaitingOrders({ limit = 40, now = new Date() }: { limit?: number; now?: Date } = {}): Promise<LimitSyncSummary> {
  const rows = (await getSql().query(
    `select ${COLUMNS}, user_id from limit_orders
      where status in ('resting', 'partial') or (status = 'filled' and fill_recorded_at is null)
      order by checked_at asc nulls first limit $1`,
    [limit],
  )) as (Row & { user_id: string })[];
  const synced = await syncRows(rows, { now });
  return {
    checked: rows.length,
    filled: synced.filter((row) => row.status === "filled").length,
    closed: synced.filter((row) => row.status === "cancelled" || row.status === "expired").length,
  };
}


/** The backend's intents for one address (GET /v1/be/intent/user/:address), newest first; empty when it cannot answer. */
export async function fetchUserIntents(address: string, timeoutMs = 6_000): Promise<IntentResponse[]> {
  try {
    const answer = await withTimeout(getSodax().backendApi.getUserIntents({ userAddress: address as `0x${string}`, limit: "50" }), timeoutMs);
    return answer.ok ? answer.value.items : [];
  } catch {
    return [];
  }
}

const lastSweep = new Map<string, number>();
/** How often one account is swept at most, unless the page says it holds an unsaved order. */
export const SWEEP_EVERY_MS = 5 * 60_000;
/** The least time between two sweeps of one account, even when the page asks. */
export const FORCED_SWEEP_EVERY_MS = 2 * 60_000;

/**
 * The safety net under the record call: every open, waiting intent the
 * backend knows for the account's addresses that Berth has no row for is
 * judged and recorded, so an order that reached the hub is never left
 * resting on chain unseen, whatever happened in the browser that placed
 * it (a closed tab, a failed record, a relay the page stopped watching).
 * Only intents that wait (deadline 0 or past a quarter hour) and touch a
 * listing are taken; judgeLimitIntent decides the rest. Returns how many
 * were recorded.
 */
export async function sweepMissing(
  userId: string,
  owners: ReadonlySet<string>,
  {
    owns,
    now = new Date(),
    force = false,
    fetchIntents = fetchUserIntents,
    homeHub,
    noXpBuys = false,
  }: {
    /** The ownership proof (limitOwnership). */
    owns: OwnsIntent;
    now?: Date;
    force?: boolean;
    fetchIntents?: (address: string) => Promise<IntentResponse[]>;
    homeHub?: string | null;
    /**
     * The sweep runs for a caller where Berth is not available: every limit
     * buy it finds, proven this account's, pays nothing (lib/server/no-xp).
     * The route refused to record it; the sweep keeps it visible and
     * cancellable, never paid.
     */
    noXpBuys?: boolean;
  },
): Promise<number> {
  const last = lastSweep.get(userId) ?? 0;
  // A page holding an unsaved order may ask for one sooner, but never more
  // than once every two minutes, however often it polls.
  if (now.getTime() - last < (force ? FORCED_SWEEP_EVERY_MS : SWEEP_EVERY_MS)) return 0;
  lastSweep.set(userId, now.getTime());
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const seen = new Map<string, IntentResponse>();
  for (const address of owners) {
    for (const item of await fetchIntents(address)) {
      if (!item.open) continue;
      const deadline = BigInt(item.intent.deadline);
      if (!(deadline === 0n || Number(deadline) > nowSeconds + SWEEP_MIN_WAIT_SECONDS)) continue;
      seen.set(item.txHash.toLowerCase(), item);
    }
  }
  if (seen.size === 0) return 0;
  const known = (await getSql().query(`select intent_tx from limit_orders where intent_tx = any($1::text[])`, [[...seen.keys()]])) as {
    intent_tx: string;
  }[];
  const have = new Set(known.map((row) => row.intent_tx));
  let recorded = 0;
  for (const [intentTx, item] of seen) {
    if (have.has(intentTx)) continue;
    const intent = intentOf(item);
    const isListing = (address: string) => TOKEN_LISTINGS.some((listing) => listing.address.toLowerCase() === address.toLowerCase());
    const direction: LimitSide | null = isListing(intent.outputToken) ? "buy" : isListing(intent.inputToken) ? "sell" : null;
    if (!direction) continue;
    const saved = await saveVerifiedIntent({
      userId,
      owners,
      owns,
      intentTx,
      intent,
      direction,
      intentHash: item.intentHash,
      now,
      minWaitSeconds: SWEEP_MIN_WAIT_SECONDS,
      homeHub,
    });
    if (saved.ok) {
      recorded += 1;
      if (noXpBuys && direction === "buy") await markNoXp(intentTx);
    }
  }
  return recorded;
}
