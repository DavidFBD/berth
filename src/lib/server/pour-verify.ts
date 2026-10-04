import { Sodax, type Intent } from "@sodax/sdk";
import { sodaxConfig } from "@/lib/sodax-config";
import { ROUTE_READ, hubRpc } from "@/lib/server/hub-rpc";
import { listListings } from "@/lib/listings";
import {
  proveOwnership,
  sodaxOwnershipReads,
  type OwnedWallet,
  type OwnershipFailure,
  type OwnershipVerdict,
  UNKNOWN,
  type HubFunding,
  type Maybe,
  transfersOf,
  withTimeout,
} from "@/lib/server/pour-ownership";

/**
 * Pour verification, hardened (replaces the old hub-tx.ts status check).
 *
 * A claimed hash must be a genuine IntentCreated on the canonical Intents
 * contract (the SDK's getIntent parses the receipt and rejects anything
 * else; a reverted tx has no logs, so failure is covered too), its intent
 * must actually touch a listing in the claimed direction, and it must be
 * the account's own by lib/server/pour-ownership: the hub transaction shows
 * the creator paying for it (or, on Sonic, the EOA sending it), the creator
 * is the hub wallet its source derives, that source is a wallet on the
 * account at the intent's time (in any family that can be linked), and a
 * buy is delivered to the account. A read that fails is "not yet known",
 * never a refusal.
 */

let instance: Sodax | undefined;

/** Module singleton: the config is static and the SDK client is stateless. */
export function getSodax(): Sodax {
  instance ??= new Sodax(sodaxConfig);
  return instance;
}

export type PourRejection =
  | "not confirmed" // reverted, or not an intent at all (no receipt yet is "not yet known")
  | "not a pour" // a real intent, but no tea vault on the claimed side
  | "not your pour" // not proven the account's (lib/server/pour-ownership)
  | "not yet known"; // a read did not answer: try again later, never a refusal

export type PourVerdict = { ok: true } | { ok: false; reason: PourRejection };

/** A verified pour, with what it was, for the order record (lib/server/orders). */
export type VerifiedPour =
  | {
      ok: true;
      intent: Intent;
      sodax: Sodax;
      /**
       * A buy delivered to the account's own hub wallet whose payer is not
       * proven the account's (lib/server/pour-ownership): record it, pay
       * nothing (lib/server/no-xp, 'unproven_source').
       */
      unprovenSource?: true;
    }
  | {
      ok: false;
      reason: PourRejection;
      why?: OwnershipFailure;
      /** With "not yet known": the intent itself was read, so a claim may be kept for the evening pass. */
      intent?: Intent;
      sodax?: Sodax;
      /**
       * With "not yet known": the receipt holds an IntentCreated from the
       * Intents contract, though the intent could not be read. A real
       * intent, so a claim may be kept on its hash alone.
       */
      intentCreated?: true;
    };

/**
 * The pure listing test, separated from the RPC fetch so it can be tested
 * without a chain: the intent must buy a listing (its output) or sell one
 * (its input). Whose it is, is lib/server/pour-ownership's question.
 */
export function judgePour({
  direction,
  intent,
  vaultAddresses,
}: {
  direction: "in" | "out";
  intent: Pick<Intent, "inputToken" | "outputToken">;
  /** Lowercased addresses of every listing (the cups and the tokens). */
  vaultAddresses: ReadonlySet<string>;
}): PourVerdict {
  const touched =
    direction === "in"
      ? intent.outputToken.toLowerCase()
      : intent.inputToken.toLowerCase();
  return vaultAddresses.has(touched) ? { ok: true } : { ok: false, reason: "not a pour" };
}

/** A hub read through the failover list (lib/server/hub-rpc): the result, null when the node has none, or UNKNOWN. */
async function rpc<T>(method: string, params: unknown[]): Promise<Maybe<T | null>> {
  const answer = await hubRpc<T>(method, params, ROUTE_READ);
  return answer.ok ? answer.result : UNKNOWN;
}

export type HubLog = { address: string; topics: readonly string[]; data: string };
export type HubReceipt = { blockNumber: string | null; from: string | null; to: string | null; logs: readonly HubLog[] };

/**
 * The hub transaction's receipt, said three ways: it succeeded (with its
 * sender and logs), it reverted, or it is not known yet (the read could not
 * answer, or the node has no receipt for it). One cheap read before the SDK gets involved: getIntent waits and
 * polls for receipts, so an invented hash would hold the route open.
 */
export async function readReceipt(txHash: string): Promise<{ state: "ok"; receipt: HubReceipt } | { state: "failed" } | { state: "unknown" }> {
  const result = await rpc<{ status?: string; blockNumber?: string; from?: string; to?: string | null; logs?: HubLog[] }>("eth_getTransactionReceipt", [txHash]);
  // No receipt yet is not a refusal: a node a few blocks behind answers null
  // for a transaction seconds old, so the caller asks again later.
  if (result === UNKNOWN || result === null) return { state: "unknown" };
  if (result.status !== "0x1") return { state: "failed" };
  return {
    state: "ok",
    receipt: { blockNumber: result.blockNumber ?? null, from: result.from?.toLowerCase() ?? null, to: result.to?.toLowerCase() ?? null, logs: result.logs ?? [] },
  };
}

/** Did the hub transaction succeed. An unanswered read reads as false here; callers that must tell the two apart use readReceipt. */
export async function receiptSucceeded(txHash: string): Promise<false | { blockNumber: string | null }> {
  const read = await readReceipt(txHash);
  return read.state === "ok" ? { blockNumber: read.receipt.blockNumber } : false;
}

/** A block's timestamp, epoch ms, or UNKNOWN when the read fails. */
async function blockTime(blockNumber: string): Promise<Maybe<number>> {
  const block = await rpc<{ timestamp?: string }>("eth_getBlockByNumber", [blockNumber, false]);
  if (block === UNKNOWN || !block?.timestamp) return UNKNOWN;
  return Number(BigInt(block.timestamp)) * 1000;
}

/**
 * Whether an intent is the account's (lib/server/pour-ownership), with the
 * chain reads made through the SDK. The intent's time is read from its hub
 * block only when a wallet that joined later is the one that proves it:
 * from `blockNumber` when the caller has it, else from the receipt of
 * `txHash`. A read that fails makes the verdict unknown.
 */
export async function ownsIntent({
  sodax = getSodax(),
  intent,
  direction,
  wallets,
  txHash,
  blockNumber,
  receipt,
}: {
  sodax?: Sodax;
  intent: Intent;
  direction: "in" | "out";
  wallets: readonly OwnedWallet[];
  txHash: string;
  blockNumber?: string | null;
  /** The hub transaction's receipt, when the caller already read it. */
  receipt?: HubReceipt;
}): Promise<OwnershipVerdict> {
  let held: Maybe<HubReceipt> | undefined = receipt;
  const hubReceipt = async (): Promise<Maybe<HubReceipt>> => {
    if (held === undefined) {
      const read = await readReceipt(txHash);
      // The intent was read, so its transaction succeeded: a receipt that
      // reads as unknown (no answer, or a node behind with none yet) or as
      // reverted (a node that disagrees) is a read that failed here.
      held = read.state === "ok" ? read.receipt : UNKNOWN;
    }
    return held;
  };
  const intentAt = async (): Promise<Maybe<number>> => {
    let block = blockNumber ?? null;
    if (!block) {
      const read = await hubReceipt();
      if (read === UNKNOWN || !read.blockNumber) return UNKNOWN;
      block = read.blockNumber;
    }
    return blockTime(block);
  };
  const funding = async (): Promise<Maybe<HubFunding>> => {
    const read = await hubReceipt();
    if (read === UNKNOWN || !read.from) return UNKNOWN;
    return { txFrom: read.from, txTo: read.to, transfers: transfersOf(read.logs) };
  };
  return proveOwnership({
    direction: direction === "in" ? "buy" : "sell",
    intent,
    wallets,
    reads: sodaxOwnershipReads(sodax, intentAt, funding),
  });
}

/** The IntentCreated topic, to tell an intent the SDK failed to read from a transaction that holds none. */
const INTENT_CREATED_TOPIC = "0x29fecd55";

/** Whether a receipt's logs hold an IntentCreated from the Intents contract. */
export function holdsIntentCreated(logs: readonly HubLog[], intentsContract: string): boolean {
  const intents = intentsContract.toLowerCase();
  return logs.some((log) => log.address.toLowerCase() === intents && !!log.topics[0]?.toLowerCase().startsWith(INTENT_CREATED_TOPIC));
}

/** Full check for a claimed pour: fetch + decode the intent, then judge it. */
export async function verifyPourTx({
  txHash,
  direction,
  wallets,
}: {
  txHash: string;
  direction: "in" | "out";
  /** The account's wallets (lib/server/pour-ownership accountOwnedWallets). */
  wallets: readonly OwnedWallet[];
}): Promise<VerifiedPour> {
  const read = await readReceipt(txHash);
  if (read.state === "unknown") return { ok: false, reason: "not yet known" };
  if (read.state === "failed") return { ok: false, reason: "not confirmed" };
  const { receipt } = read;

  const sodax = getSodax();
  // Belt on top of the receipt gate: never let the SDK's own receipt
  // polling hold a serverless route open.
  const result = await withTimeout(() => sodax.swaps.getIntent(txHash as `0x${string}`), 15_000);
  if (result === UNKNOWN || !result.ok) {
    // The receipt holds an IntentCreated from the Intents contract: the
    // SDK's read failed, not the intent. Otherwise it is not an intent.
    const holds = holdsIntentCreated(receipt.logs, sodax.config.solver.intentsContract);
    return holds ? { ok: false, reason: "not yet known", intentCreated: true } : { ok: false, reason: "not confirmed" };
  }
  const intent = result.value;

  // Every listing counts, not only the cups: a stock or SGOV bought through
  // the house is a pour for the ledger too (lib/listings).
  const vaultAddresses = new Set(
    listListings(sodax.leverageYield.listVaults()).map((listing) =>
      listing.address.toLowerCase(),
    ),
  );
  const listed = judgePour({ direction, intent, vaultAddresses });
  if (!listed.ok) return listed;
  const owned = await ownsIntent({ sodax, intent, direction, wallets, txHash, blockNumber: receipt.blockNumber, receipt });
  if (owned.ok) return { ok: true, intent, sodax };
  if (owned.unknown) return { ok: false, reason: "not yet known", why: owned.why, intent, sodax };
  if (owned.deliveredToAccount) return { ok: true, intent, sodax, unprovenSource: true };
  return { ok: false, reason: "not your pour", why: owned.why };
}
