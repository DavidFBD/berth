import { ChainKeys, EvmSolverService, type Intent, type IntentResponse } from "@sodax/sdk";
import { HOME_CHAIN } from "@/lib/account";
import { decodeFeeReceiver, type OrderRecord } from "@/lib/orders";
import { listListings } from "@/lib/listings";
import { PARTNER_FEE } from "@/lib/sodax-config";
import { getSql } from "@/lib/server/db";
import { markNoXp } from "@/lib/server/no-xp";
import type { WalletFamily } from "@/lib/identity/caip";
import { accountOwnedWallets } from "@/lib/server/pour-ownership";
import { buildOrder, recordOrderMarks } from "@/lib/server/orders";
import { placeRunForOrder } from "@/lib/server/recurring";
import { fillsIntent, verdictFromRecord } from "@/lib/server/pour-claims";
import { getSodax, verifyPourTx, type VerifiedPour } from "@/lib/server/pour-verify";

/**
 * Recovering orders that filled but were never written to `orders`.
 *
 * Before XP was paid only on fill (lib/server/pour-claims), judgePour
 * refused every sell made from an account's hub wallet, so the pour route
 * answered "not your pour" and no row was written; the account's ledger
 * then cannot explain what it holds. This finds those orders in SODAX's
 * backend (the intents of every EVM address on the account and of each
 * one's hub wallet, and of the hub wallet each Solana or Bitcoin address
 * on it derives), keeps only Berth's (a listing on the traded side and
 * the partner fee paid to Berth, the same test the pour route applies),
 * proves each the way the pour route does (verifyPourTx for the intent and
 * its owner, fillsIntent for a whole fill on chain) and builds the row with
 * buildOrder, the pour route's own reading.
 *
 * A row is only ever inserted, `on conflict (intent_tx) do nothing`: an
 * order Berth already holds is never touched. No XP is paid here; the
 * report counts the recovered orders the ledger has no pour XP for, and
 * paying them is a separate decision. A recovered buy is also stamped
 * hold-checked with no outcome, so the thirty day hold never pays for it.
 */

export type RecoveryRejection = VerifiedPourRejection | "fill not on chain" | "not built" | "another account";
type VerifiedPourRejection = Extract<VerifiedPour, { ok: false }>["reason"];

export type RecoveredOrder = OrderRecord & { userId: string; xpPaid: boolean };

export type AccountRecovery = {
  userId: string;
  /** EVM addresses on the account and every wallet's hub wallet, deduplicated. */
  addresses: number;
  /** Intents the backend knows for those addresses. */
  intents: number;
  /** Of those, Berth's filled orders. */
  berthFilled: number;
  /** Already in `orders`. */
  alreadyRecorded: number;
  recovered: RecoveredOrder[];
  rejected: { intentTx: string; reason: RecoveryRejection }[];
  /** Rows actually inserted; zero on a dry run. */
  written: number;
};

export type Candidate = { intentTx: string; direction: "buy" | "sell"; fillTx: string };

/**
 * The pure sieve: of the backend's intents, the ones that are Berth's and
 * filled whole. Berth's means a listing on the side the order trades (the
 * output of a buy, else the input of a sell, as the limit sweep reads it)
 * and the partner fee paid to Berth's receiver. Filled means the backend's
 * record reads filled (verdictFromRecord, the pour route's fallback) and
 * names the fill transaction, which the caller then proves on chain.
 */
export function berthFilledIntents(
  items: readonly IntentResponse[],
  listingAddresses: ReadonlySet<string>,
  feeReceiver: string = PARTNER_FEE.address,
): Candidate[] {
  const out = new Map<string, Candidate>();
  for (const item of items) {
    const intent = item.intent;
    const direction = listingAddresses.has(intent.outputToken.toLowerCase())
      ? "buy"
      : listingAddresses.has(intent.inputToken.toLowerCase())
        ? "sell"
        : null;
    if (!direction) continue;
    if (decodeFeeReceiver(intent.data) !== feeReceiver.toLowerCase()) continue;
    if (verdictFromRecord(item) !== "filled") continue;
    const fills = ((item.events ?? []) as { eventType?: string; txHash?: string }[]).filter(
      (event) => event.eventType === "intent-filled" && typeof event.txHash === "string",
    );
    const fillTx = fills.at(-1)?.txHash;
    if (!fillTx) continue;
    out.set(item.txHash.toLowerCase(), { intentTx: item.txHash.toLowerCase(), direction, fillTx: fillTx.toLowerCase() });
  }
  return [...out.values()];
}

export type RecoveryDeps = {
  /** Every intent the backend knows for one address. */
  fetchIntents: (address: string) => Promise<IntentResponse[]>;
  /** The address's hub wallet, lowercased, or null: on the home chain for EVM, on its own chain otherwise. */
  hubOf: (address: string, family: WalletFamily) => Promise<string | null>;
  /** The pour route's own check of the intent and its owner. */
  verify: typeof verifyPourTx;
  /** Whether `fillTx` fills `intent` whole on chain, and when. */
  fillOnChain: (fillTx: string, intent: Intent) => Promise<{ ok: boolean; filledAt: Date | null }>;
  /** The pour route's reading of the order (lib/server/orders buildOrder). */
  build: (args: { intentTx: string; direction: "buy" | "sell"; intent: Intent; claimedFillTx: string }) => Promise<OrderRecord | undefined>;
  /** Benchmark prices at the order's minute, as the pour route records them. */
  marks: (orderId: string, placedAt: Date) => Promise<number>;
};

/** The chain a wallet's hub wallet is derived on, as the backend files its intents. */
const HUB_CHAIN_OF: Record<WalletFamily, Parameters<ReturnType<typeof getSodax>["hubProvider"]["getUserHubWalletAddress"]>[1]> = {
  evm: HOME_CHAIN,
  solana: ChainKeys.SOLANA_MAINNET,
  bitcoin: ChainKeys.BITCOIN_MAINNET,
};

const PAGE = 50;
const MAX_PAGES = 20;

/** Every page of GET /v1/be/intent/user/:address; what it cannot read it leaves out. */
export async function fetchAllUserIntents(address: string): Promise<IntentResponse[]> {
  const sodax = getSodax();
  const items: IntentResponse[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const answer = await sodax.backendApi
      .getUserIntents({ userAddress: address as `0x${string}`, limit: String(PAGE), offset: String(page * PAGE) })
      .catch(() => null);
    if (!answer?.ok) break;
    items.push(...answer.value.items);
    if (answer.value.items.length < PAGE || items.length >= answer.value.total) break;
  }
  return items;
}

export function defaultRecoveryDeps(): RecoveryDeps {
  const sodax = getSodax();
  return {
    fetchIntents: fetchAllUserIntents,
    hubOf: (address, family) =>
      sodax.hubProvider
        .getUserHubWalletAddress(address, HUB_CHAIN_OF[family])
        .then((wallet) => wallet.toLowerCase())
        .catch(() => null),
    verify: verifyPourTx,
    fillOnChain: async (fillTx, intent) => {
      const client = sodax.hubProvider.publicClient;
      const receipt = await client.getTransactionReceipt({ hash: fillTx as `0x${string}` }).catch(() => null);
      const ok = fillsIntent(receipt as never, EvmSolverService.getIntentHash(intent), sodax.config.solver.intentsContract);
      if (!ok || !receipt) return { ok, filledAt: null };
      const block = await client.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null);
      return { ok, filledAt: block ? new Date(Number(block.timestamp) * 1000) : null };
    },
    build: (args) => buildOrder({ sodax, ...args }),
    marks: (orderId, placedAt) => recordOrderMarks(orderId, placedAt),
  };
}

/** Insert a recovered order; an intent already recorded is left exactly as it is. Returns the new row's id. */
export async function insertRecoveredOrder(userId: string, order: OrderRecord, now = new Date()): Promise<string | undefined> {
  const rows = (await getSql().query(
    `insert into orders (
       user_id, wallet_address, intent_tx, fill_tx, direction, listing_symbol,
       listing_address, quantity, min_quantity, pay_symbol, pay_chain,
       pay_amount, fee_amount, usd_value, placed_at, filled_at, usd_source,
       delivered_to, hold_checked_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     on conflict (intent_tx) do nothing
     returning id`,
    [
      userId,
      order.walletAddress,
      order.intentTx,
      order.fillTx,
      order.direction,
      order.listingSymbol,
      order.listingAddress,
      order.quantity,
      order.minQuantity,
      order.paySymbol,
      order.payChain,
      order.payAmount,
      order.feeAmount,
      order.usdValue,
      order.placedAt,
      order.filledAt,
      order.usdSource,
      order.deliveredTo,
      // Stamped as checked with no outcome, so the thirty day hold cron
      // (lib/server/holds) never pays held_30_days for a recovered buy:
      // retroactive XP is a decision this does not make.
      now.toISOString(),
    ],
  )) as { id: string }[];
  const id = rows[0]?.id;
  // A limit order Berth placed keeps its kind and price, as its own fill record would (lib/server/limit-orders).
  if (id) {
    await getSql().query(
      `update orders set order_type = 'limit', limit_price = l.limit_price
         from limit_orders l where orders.id = $1 and l.intent_tx = orders.intent_tx`,
      [id],
    );
    // A recovered buy answers its recurring run as any recorded buy does (lib/server/recurring).
    if (order.direction === "buy") await placeRunForOrder(id);
  }
  return id;
}

/**
 * One account: find, prove and build its missing orders; with `write`,
 * insert them and their benchmark prices. `taken` holds intents already
 * claimed by an account earlier in the same run, so one intent is never
 * given to two.
 */
export async function recoverAccountOrders(
  account: { id: string; wallet_address: string | null },
  {
    write = false,
    deps = defaultRecoveryDeps(),
    taken = new Set<string>(),
  }: { write?: boolean; deps?: RecoveryDeps; taken?: Set<string> } = {},
): Promise<AccountRecovery> {
  const report: AccountRecovery = {
    userId: account.id,
    addresses: 0,
    intents: 0,
    berthFilled: 0,
    alreadyRecorded: 0,
    recovered: [],
    rejected: [],
    written: 0,
  };
  // Every wallet on the account, in every family: an EVM address and its
  // home chain hub wallet (where a sell is made), a Solana or Bitcoin
  // address through the hub wallet it derives on its own chain, which is
  // the creator SODAX's backend files its intents under.
  const wallets = await accountOwnedWallets(account.id, account.wallet_address);
  const distinct = [...new Map(wallets.map((wallet) => [`${wallet.family}:${wallet.address}`, wallet])).values()];
  const hubs = await Promise.all(distinct.map((wallet) => deps.hubOf(wallet.address, wallet.family)));
  const addresses = [
    ...new Set([
      ...distinct.filter((wallet) => wallet.family === "evm").map((wallet) => wallet.address),
      ...hubs.filter((hub): hub is string => !!hub),
    ]),
  ];
  report.addresses = addresses.length;

  const seen = new Map<string, IntentResponse>();
  for (const address of addresses) {
    for (const item of await deps.fetchIntents(address)) seen.set(item.txHash.toLowerCase(), item);
  }
  report.intents = seen.size;

  const listingAddresses = new Set(listListings(getSodax().leverageYield.listVaults()).map((listing) => listing.address.toLowerCase()));
  const candidates = berthFilledIntents([...seen.values()], listingAddresses);
  report.berthFilled = candidates.length;
  if (candidates.length === 0) return report;

  const known = (await getSql().query(`select intent_tx from orders where intent_tx = any($1::text[])`, [
    candidates.map((candidate) => candidate.intentTx),
  ])) as { intent_tx: string }[];
  const have = new Set(known.map((row) => row.intent_tx.toLowerCase()));
  const paid = (await getSql().query(
    `select lower(ref) as ref from xp_events where kind in ('pour_in', 'pour_out') and lower(ref) = any($1::text[])`,
    [candidates.map((candidate) => candidate.intentTx)],
  )) as { ref: string }[];
  const xpPaid = new Set(paid.map((row) => row.ref));

  for (const candidate of candidates) {
    if (have.has(candidate.intentTx)) {
      report.alreadyRecorded += 1;
      continue;
    }
    if (taken.has(candidate.intentTx)) {
      report.rejected.push({ intentTx: candidate.intentTx, reason: "another account" });
      continue;
    }
    const verified = await deps.verify({
      txHash: candidate.intentTx,
      direction: candidate.direction === "buy" ? "in" : "out",
      wallets,
    });
    if (!verified.ok) {
      report.rejected.push({ intentTx: candidate.intentTx, reason: verified.reason });
      continue;
    }
    const fill = await deps.fillOnChain(candidate.fillTx, verified.intent);
    if (!fill.ok) {
      report.rejected.push({ intentTx: candidate.intentTx, reason: "fill not on chain" });
      continue;
    }
    const order = await deps.build({
      intentTx: candidate.intentTx,
      direction: candidate.direction,
      intent: verified.intent,
      claimedFillTx: candidate.fillTx,
    });
    if (!order) {
      report.rejected.push({ intentTx: candidate.intentTx, reason: "not built" });
      continue;
    }
    // A sell pays out off the hub, so buildOrder reads no fill for it; the
    // fill just proven on chain is its fill.
    if (!order.fillTx) order.fillTx = candidate.fillTx;
    if (!order.filledAt) order.filledAt = fill.filledAt;
    taken.add(candidate.intentTx);
    report.recovered.push({ ...order, userId: account.id, xpPaid: xpPaid.has(candidate.intentTx) });
    if (write) {
      // Delivered to the account, paid by someone not proven its: the row
      // is written, and the intent never pays (lib/server/no-xp).
      // One whose XP was already paid is history, never marked after the fact.
      if (verified.unprovenSource && !xpPaid.has(candidate.intentTx)) await markNoXp(candidate.intentTx, "unproven_source");
      const id = await insertRecoveredOrder(account.id, order);
      if (id) {
        report.written += 1;
        if (order.placedAt) await deps.marks(id, order.placedAt);
      }
    }
  }
  return report;
}

export type RecoverySummary = {
  accounts: number;
  recovered: number;
  written: number;
  /** Recovered orders the XP ledger holds no pour award for. XP is not paid here. */
  xpUnpaid: number;
  rejected: number;
};

/** Every live account (retired ones are read through their survivor), in order of creation. */
export async function recoverOrders({
  write = false,
  deps,
  onReport,
}: { write?: boolean; deps?: RecoveryDeps; onReport?: (report: AccountRecovery) => void } = {}): Promise<RecoverySummary> {
  const accounts = (await getSql().query(
    `select id, wallet_address from users where retired_into is null order by created_at, id`,
  )) as { id: string; wallet_address: string | null }[];
  const taken = new Set<string>();
  const summary: RecoverySummary = { accounts: accounts.length, recovered: 0, written: 0, xpUnpaid: 0, rejected: 0 };
  const resolved = deps ?? defaultRecoveryDeps();
  for (const account of accounts) {
    const report = await recoverAccountOrders(account, { write, deps: resolved, taken });
    summary.recovered += report.recovered.length;
    summary.written += report.written;
    summary.xpUnpaid += report.recovered.filter((order) => !order.xpPaid).length;
    summary.rejected += report.rejected.length;
    onReport?.(report);
  }
  return summary;
}
