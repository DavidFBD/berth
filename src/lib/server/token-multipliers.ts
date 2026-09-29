import { ROBINHOOD_CHAIN_ADDRESS_BY_SYMBOL } from "@/lib/market-ids";
import {
  LLAMA_SHARE_QUOTES_FROM_MS,
  llamaQuotesShares,
  llamaTokenPrice,
  multiplierFromFixed,
  type MultiplierChange,
  type MultiplierHistory,
} from "@/lib/token-multiplier";

/**
 * The Robinhood tokens' multipliers, read from Robinhood Chain, and the
 * one step every DefiLlama price of a listing takes before Berth values a
 * token with it (lib/token-multiplier says why).
 *
 * `uiMultiplier()` is the multiplier now. The RPC keeps no archive state,
 * so a past multiplier is read from the token's
 * `UIMultiplierUpdated(uint256 old, uint256 new, uint256 effectiveAt)`
 * events instead: the RPC answers `eth_getLogs` over at most ten million
 * blocks (about two weeks) for one address and one topic, so a window is
 * walked back from the newest block a span at a time, all tokens in one
 * batched request per span.
 */

export const ROBINHOOD_RPC = "https://rpc.mainnet.chain.robinhood.com";
/** keccak256("uiMultiplier()"), first four bytes. */
const UI_MULTIPLIER_SELECTOR = "0xa60bf13d";
/** keccak256("UIMultiplierUpdated(uint256,uint256,uint256)"). */
export const UI_MULTIPLIER_UPDATED_TOPIC =
  "0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055";
/** The RPC's cap on one `eth_getLogs` range. */
const LOG_SPAN_BLOCKS = 10_000_000;
/** A runaway guard: twenty spans is most of a year. */
const MAX_SPANS = 20;
/** Multipliers change about once a month; an hour's memo is generous. */
const MEMO_MS = 60 * 60 * 1000;

export type MultiplierRead = {
  histories: Record<string, MultiplierHistory>;
  /** Symbols whose multiplier could not be read, with why. */
  failures: string[];
};

export type MultiplierReader = (symbols: readonly string[], sinceMs: number) => Promise<MultiplierRead>;

type RpcCall = { method: string; params: unknown[] };
type RpcAnswer = { id?: number; result?: unknown; error?: { message?: string } };

/** Tries per batch; the public RPC answers 429 when a burst of calls arrives. */
const BATCH_TRIES = 4;
const RETRY_BASE_MS = 750;

async function batch(calls: readonly RpcCall[], timeoutMs: number): Promise<RpcAnswer[]> {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(ROBINHOOD_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(calls.map((call, id) => ({ jsonrpc: "2.0", id, ...call }))),
      cache: "no-store",
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    });
    if (response.status === 429 && attempt < BATCH_TRIES) {
      const wait = RETRY_BASE_MS * 2 ** (attempt - 1);
      if (Date.now() + wait < deadline) {
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }
    }
    if (!response.ok) throw new Error(`Robinhood Chain RPC answered ${response.status}`);
    const answers = (await response.json()) as RpcAnswer[];
    if (!Array.isArray(answers)) throw new Error("Robinhood Chain RPC answered no batch");
    const byId = new Map(answers.map((answer) => [answer.id, answer]));
    return calls.map((_, id) => byId.get(id) ?? { error: { message: "no answer" } });
  }
}

const hex = (value: number) => `0x${value.toString(16)}`;

type Log = { data?: string };

function decodeChange(log: Log): MultiplierChange | undefined {
  const words = (log.data ?? "").replace(/^0x/, "").match(/.{64}/g);
  if (!words || words.length < 3) return undefined;
  const [from, to, effectiveAt] = words.map((word) => BigInt(`0x${word}`));
  return { from: multiplierFromFixed(from), to: multiplierFromFixed(to), effectiveAt: Number(effectiveAt) };
}

/**
 * Each symbol's multiplier now and every change since `sinceMs`. A symbol
 * that is not a Robinhood token is left out and is not a failure. Throws
 * only when the RPC cannot be reached at all.
 */
export async function readMultiplierHistories(
  symbols: readonly string[],
  sinceMs: number,
  timeoutMs = 8_000,
): Promise<MultiplierRead> {
  const tokens = symbols
    .filter((symbol) => ROBINHOOD_CHAIN_ADDRESS_BY_SYMBOL[symbol])
    .map((symbol) => ({ symbol, address: ROBINHOOD_CHAIN_ADDRESS_BY_SYMBOL[symbol] }));
  const out: MultiplierRead = { histories: {}, failures: [] };
  if (tokens.length === 0) return out;

  const head = await batch(
    [
      { method: "eth_blockNumber", params: [] },
      ...tokens.map(({ address }) => ({
        method: "eth_call",
        params: [{ to: address, data: UI_MULTIPLIER_SELECTOR }, "latest"],
      })),
    ],
    timeoutMs,
  );
  if (typeof head[0].result !== "string") throw new Error("Robinhood Chain RPC gave no block number");
  const latest = Number.parseInt(head[0].result, 16);

  const current = new Map<string, number>();
  const failed = new Set<string>();
  tokens.forEach(({ symbol }, index) => {
    const answer = head[index + 1];
    if (typeof answer.result === "string" && answer.result.length >= 66) {
      current.set(symbol, multiplierFromFixed(BigInt(answer.result.slice(0, 66))));
    } else {
      failed.add(symbol);
      out.failures.push(`${symbol}: uiMultiplier unread (${answer.error?.message ?? "empty"})`);
    }
  });

  const changes = new Map<string, MultiplierChange[]>(tokens.map(({ symbol }) => [symbol, []]));
  const sinceSeconds = Math.floor(sinceMs / 1000);
  let end = latest;
  for (let span = 0; span < MAX_SPANS && end >= 0; span += 1) {
    const start = Math.max(0, end - LOG_SPAN_BLOCKS + 1);
    const answers = await batch(
      [
        { method: "eth_getBlockByNumber", params: [hex(start), false] },
        ...tokens.map(({ address }) => ({
          method: "eth_getLogs",
          params: [{ address, fromBlock: hex(start), toBlock: hex(end), topics: [UI_MULTIPLIER_UPDATED_TOPIC] }],
        })),
      ],
      timeoutMs,
    );
    tokens.forEach(({ symbol }, index) => {
      const answer = answers[index + 1];
      if (!Array.isArray(answer.result)) {
        if (!failed.has(symbol)) out.failures.push(`${symbol}: multiplier events unread (${answer.error?.message ?? "empty"})`);
        failed.add(symbol);
        return;
      }
      for (const log of answer.result as Log[]) {
        const change = decodeChange(log);
        if (change) changes.get(symbol)!.push(change);
      }
    });
    const block = answers[0].result as { timestamp?: string } | null | undefined;
    const startSeconds = block?.timestamp ? Number.parseInt(block.timestamp, 16) : undefined;
    if (start === 0 || startSeconds === undefined || startSeconds <= sinceSeconds) break;
    end = start - 1;
  }

  for (const { symbol } of tokens) {
    if (failed.has(symbol)) continue;
    out.histories[symbol] = { current: current.get(symbol)!, changes: changes.get(symbol)! };
  }
  return out;
}

const memo = new Map<string, { at: number; read: Promise<MultiplierRead> }>();

/**
 * readMultiplierHistories, remembered for an hour per symbol set and UTC
 * day of `sinceMs` (the window reaches back to that day's start, which only
 * widens it). A read that throws is forgotten at once.
 */
export const cachedMultiplierHistories: MultiplierReader = (symbols, sinceMs) => {
  const dayStart = Math.floor(sinceMs / 86_400_000) * 86_400_000;
  const key = `${[...symbols].sort().join(",")}|${dayStart}`;
  const now = Date.now();
  const hit = memo.get(key);
  if (hit && now - hit.at < MEMO_MS) return hit.read;
  const read = readMultiplierHistories(symbols, dayStart);
  memo.set(key, { at: now, read });
  read.catch(() => memo.delete(key));
  return read;
};

type TimedPrice = { timestamp: number; price: number };

/**
 * DefiLlama prices, by symbol, re-based to what one token is worth
 * (lib/token-multiplier llamaTokenPrice). A symbol that is not a
 * Robinhood token, or whose prices all predate DefiLlama's switch to share
 * quotes, passes through as it is. A Robinhood token whose multiplier
 * could not be read is left out and named in `unread`: its prices are the
 * share's, and a caller that stores them must not take them as the
 * token's.
 */
export async function toTokenPrices<T extends TimedPrice>(
  bySymbol: Readonly<Record<string, readonly T[]>>,
  read: MultiplierReader = cachedMultiplierHistories,
): Promise<{ prices: Record<string, T[]>; unread: string[] }> {
  const prices: Record<string, T[]> = {};
  const needs: string[] = [];
  let earliest = Infinity;
  for (const [symbol, points] of Object.entries(bySymbol)) {
    const shareQuoted = points.filter((point) => llamaQuotesShares(point.timestamp * 1000));
    if (!ROBINHOOD_CHAIN_ADDRESS_BY_SYMBOL[symbol] || shareQuoted.length === 0) {
      prices[symbol] = [...points];
      continue;
    }
    needs.push(symbol);
    for (const point of shareQuoted) earliest = Math.min(earliest, point.timestamp * 1000);
  }
  if (needs.length === 0) return { prices, unread: [] };

  let histories: Record<string, MultiplierHistory> = {};
  try {
    ({ histories } = await read(needs, Math.max(earliest, LLAMA_SHARE_QUOTES_FROM_MS)));
  } catch (error) {
    console.warn("[token-multipliers] unread", error instanceof Error ? error.message : error);
  }
  const unread: string[] = [];
  for (const symbol of needs) {
    const history = histories[symbol];
    if (!history) {
      unread.push(symbol);
      continue;
    }
    prices[symbol] = bySymbol[symbol].map((point) => ({
      ...point,
      price: llamaTokenPrice(point.price, point.timestamp * 1000, history),
    }));
  }
  return { prices, unread };
}
