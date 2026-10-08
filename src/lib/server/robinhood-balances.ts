import {
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  isAddress,
  multicall3Abi,
  type Address,
  type Hex,
} from "viem";
import { TOKEN_LISTINGS, type TokenListing } from "@/lib/listings";
import { robinhoodRpcBatch, type RpcCall } from "@/lib/server/token-multipliers";

/**
 * What accounts hold in their own wallets on Robinhood Chain (chain 4663),
 * read on the server: the native Robinhood stock tokens a buy is delivered
 * as (lib/delivery), the server's mirror of the browser's read
 * (lib/account-holdings, lib/robinhood-chain). The portfolio snapshot, the
 * history chart's live point, the assistant's holdings and the thirty day
 * hold check read it (plan P1b).
 *
 * The public RPC meters every call inside a batch (lib/server/token-
 * multipliers TOKENS_PER_BATCH says how hard), so the reads are shaped for
 * it: every balanceOf of many owners rides inside one Multicall3
 * `aggregate3` eth_call (one metered call, however many balances), at most
 * CALLS_PER_REQUEST such calls go in one HTTP batch, the batches go one
 * after another for the whole process (never side by side, whichever
 * caller asks), a 429 is waited out the way the multiplier reader waits it
 * out (robinhoodRpcBatch), and an owner's read is remembered for MEMO_MS
 * so a snapshot that reads every account up front answers each account's
 * own read from memory.
 *
 * A read that does not answer is unknown, never zero: a balance comes back
 * null, an owner is left out of the answer, and the callers decide what
 * unknown means (the snapshot writes no row, the hold check retries).
 */

/** Multicall3 at its usual address on 4663 (eth_getCode read 2026-10-05), as lib/robinhood-chain uses it. */
export const ROBINHOOD_MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

/**
 * Balances inside one aggregate3 call: ten owners' worth of the 24 tokens.
 * One eth_call is metered once, and 240 balanceOf reads stay far inside
 * any node's eth_call gas cap.
 */
export const BALANCES_PER_CALL = 240;

/** aggregate3 calls per HTTP batch; the RPC lets about fifty calls through at once, so three is far inside it. */
export const CALLS_PER_REQUEST = 3;

/** How long an owner's read is remembered: long enough for a snapshot run to answer each account from its first read. */
export const ROBINHOOD_MEMO_MS = 2 * 60_000;

/** One request's budget, 429 waits included. */
const REQUEST_TIMEOUT_MS = 8_000;

/** Past this many remembered owners, the stale ones are let go. */
const MEMO_PRUNE_AT = 5_000;

/**
 * The listings with a token on Robinhood Chain: stocks and funds only, as
 * the browser reads them (lib/account-holdings robinhoodReadPlan). Cash is
 * parked and unparked on the hub and is never delivered there.
 */
export const ROBINHOOD_LISTINGS: readonly (TokenListing & { rhAddress: Address })[] = TOKEN_LISTINGS.filter(
  (listing): listing is TokenListing & { rhAddress: Address } => listing.kind === "stock" && !!listing.rhAddress,
);

/** One balance to read on Robinhood Chain: `token`'s balanceOf at `holder`. */
export type RobinhoodBalanceQuery = { holder: string; token: string };

/**
 * One balance as read: the raw amount; null when it could not be read (the
 * request failed, timed out, or answered nothing usable); "reverted" when
 * the chain answered and that one token's balanceOf failed inside the
 * aggregate (a token that reverts or has no code), which says nothing
 * about any other token.
 */
export type RobinhoodBalance = bigint | null | "reverted";

/** Raw balances, one per query in order. Never throws. */
export type RobinhoodBalanceReader = (queries: readonly RobinhoodBalanceQuery[]) => Promise<RobinhoodBalance[]>;

/**
 * Each owner's Robinhood Chain listings, in listing units by symbol (only
 * what is held), keyed by the lowercased owner. An owner whose read failed
 * is left out: unknown, never empty.
 */
export type RobinhoodHoldingsReader = (owners: readonly string[]) => Promise<Map<string, Record<string, number>>>;

/** Every Robinhood Chain request this process makes, one after another. */
let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

/** One aggregate3 eth_call reading every query's balanceOf, each allowed to fail on its own. */
function aggregateCall(queries: readonly RobinhoodBalanceQuery[]): RpcCall {
  const data = encodeFunctionData({
    abi: multicall3Abi,
    functionName: "aggregate3",
    args: [
      queries.map((query) => ({
        target: getAddress(query.token),
        allowFailure: true,
        callData: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [getAddress(query.holder)] }),
      })),
    ],
  });
  return { method: "eth_call", params: [{ to: ROBINHOOD_MULTICALL3, data }, "latest"] };
}

/** An aggregate3 answer as one raw balance per query: a failed inner call is "reverted", an unreadable answer null. */
function decodeAggregate(result: unknown, count: number): RobinhoodBalance[] {
  if (typeof result !== "string" || !result.startsWith("0x") || result.length <= 2) return Array(count).fill(null);
  try {
    const answers = decodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", data: result as Hex });
    if (answers.length !== count) return Array(count).fill(null);
    return answers.map(({ success, returnData }) =>
      !success ? "reverted" : returnData.length === 66 ? BigInt(returnData) : null,
    );
  } catch {
    return Array(count).fill(null);
  }
}

/**
 * The IO edge: every query's raw balanceOf on Robinhood Chain, BALANCES_PER_CALL
 * to an aggregate3 call, CALLS_PER_REQUEST calls to a request, the requests
 * one after another. A request that fails (429 past its tries, a timeout,
 * an error) costs only its own queries, which come back null.
 */
export const readRobinhoodTokenBalances: RobinhoodBalanceReader = async (queries) => {
  const valid = queries.map((query) => isAddress(query.holder, { strict: false }) && isAddress(query.token, { strict: false }));
  const indexed = queries.flatMap((query, index) => (valid[index] ? [{ query, index }] : []));
  const out: RobinhoodBalance[] = queries.map(() => null);
  const calls = chunks(indexed, BALANCES_PER_CALL);
  for (const request of chunks(calls, CALLS_PER_REQUEST)) {
    try {
      const answers = await oneAtATime(() =>
        robinhoodRpcBatch(
          request.map((call) => aggregateCall(call.map((entry) => entry.query))),
          REQUEST_TIMEOUT_MS,
        ),
      );
      request.forEach((call, callIndex) => {
        const answer = answers[callIndex];
        const balances = decodeAggregate(answer?.result, call.length);
        call.forEach((entry, position) => {
          out[entry.index] = balances[position];
        });
      });
    } catch (error) {
      console.warn("[robinhood-balances] request failed, its balances unknown", error instanceof Error ? error.message : error);
    }
  }
  return out;
};

/** Symbols already warned about as reverting, so a broken token logs once per process, not once per wallet. */
const warnedReverting = new Set<string>();

/**
 * One owner's raw balances in ROBINHOOD_LISTINGS order as holdings by
 * symbol; null when any is unknown. A token whose own balanceOf reverted
 * is left out of the holdings and logged (rh-server m1): one broken token
 * must not make every wallet unknown, and so every Robinhood account lose
 * its day.
 */
function holdingsFrom(raw: readonly RobinhoodBalance[]): Record<string, number> | null {
  if (raw.some((value) => value === null)) return null;
  const out: Record<string, number> = {};
  ROBINHOOD_LISTINGS.forEach((listing, index) => {
    const value = raw[index];
    if (value === "reverted") {
      if (!warnedReverting.has(listing.symbol)) {
        warnedReverting.add(listing.symbol);
        console.warn("[robinhood-balances] balanceOf reverted, left out", listing.symbol, listing.rhAddress);
      }
      return;
    }
    if (value !== null && value > 0n) out[listing.symbol] = Number(formatUnits(value, listing.decimals));
  });
  return out;
}

/**
 * Every owner's Robinhood Chain listings (RobinhoodHoldingsReader), each
 * owner read at most once per ROBINHOOD_MEMO_MS and the owners not
 * remembered read together. A failed owner is forgotten at once, so the
 * next ask reads it again. Anything not an EVM address is left out.
 */
export function makeRobinhoodHoldingsReader(
  readBalances: RobinhoodBalanceReader = readRobinhoodTokenBalances,
  memoMs: number = ROBINHOOD_MEMO_MS,
): RobinhoodHoldingsReader {
  const memo = new Map<string, { at: number; read: Promise<Record<string, number> | null> }>();
  return async (owners) => {
    const wanted = [
      ...new Set(owners.filter((owner) => isAddress(owner, { strict: false })).map((owner) => owner.toLowerCase())),
    ];
    const now = Date.now();
    if (memo.size > MEMO_PRUNE_AT) {
      for (const [owner, entry] of memo) if (now - entry.at >= memoMs) memo.delete(owner);
    }
    const stale = wanted.filter((owner) => {
      const hit = memo.get(owner);
      return !hit || now - hit.at >= memoMs;
    });
    if (stale.length > 0 && ROBINHOOD_LISTINGS.length > 0) {
      const read = readBalances(
        stale.flatMap((holder) => ROBINHOOD_LISTINGS.map((listing) => ({ holder, token: listing.rhAddress }))),
      ).catch(() => stale.flatMap(() => ROBINHOOD_LISTINGS.map(() => null)));
      stale.forEach((owner, position) => {
        const entry = {
          at: now,
          read: read.then((raw) =>
            holdingsFrom(raw.slice(position * ROBINHOOD_LISTINGS.length, (position + 1) * ROBINHOOD_LISTINGS.length)),
          ),
        };
        memo.set(owner, entry);
        // Remembered from when the answer came, not from when it was asked,
        // so a long read is not stale the moment it lands.
        void entry.read.then((holdings) => {
          if (memo.get(owner) !== entry) return;
          if (holdings === null) memo.delete(owner);
          else entry.at = Date.now();
        });
      });
    }
    const entries = wanted.map((owner) => [owner, memo.get(owner)] as const);
    const out = new Map<string, Record<string, number>>();
    for (const [owner, entry] of entries) {
      const holdings = entry ? await entry.read : ROBINHOOD_LISTINGS.length === 0 ? {} : null;
      if (holdings) out.set(owner, holdings);
    }
    return out;
  };
}

/** The live reader, remembered per owner for the whole process. */
export const readRobinhoodHoldings: RobinhoodHoldingsReader = makeRobinhoodHoldingsReader();

/**
 * The owners' Robinhood Chain listings added up by symbol, with each
 * owner's own part (`byOwner`, lowercased owner to holdings: a sell spends
 * one wallet, never the sum). Throws when any owner could not be read: a
 * total missing a wallet would read low, and unknown is never zero.
 */
export async function robinhoodTotal(
  owners: readonly string[],
  read: RobinhoodHoldingsReader = readRobinhoodHoldings,
): Promise<Record<string, number>> {
  return (await robinhoodParts(owners, read)).total;
}

/** robinhoodTotal with each owner's own part beside the sum. */
export async function robinhoodParts(
  owners: readonly string[],
  read: RobinhoodHoldingsReader = readRobinhoodHoldings,
): Promise<{ total: Record<string, number>; byOwner: Map<string, Record<string, number>> }> {
  const wanted = [
    ...new Set(owners.filter((owner) => isAddress(owner, { strict: false })).map((owner) => owner.toLowerCase())),
  ];
  const byOwner = new Map<string, Record<string, number>>();
  if (wanted.length === 0) return { total: {}, byOwner };
  const answered = await read(wanted);
  const total: Record<string, number> = {};
  for (const owner of wanted) {
    const holdings = answered.get(owner);
    if (!holdings) throw new Error(`Robinhood Chain balances unread for ${owner}`);
    byOwner.set(owner, holdings);
    for (const [symbol, quantity] of Object.entries(holdings)) total[symbol] = (total[symbol] ?? 0) + quantity;
  }
  return { total, byOwner };
}
