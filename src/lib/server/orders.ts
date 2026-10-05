import { EvmSolverService, type Intent, type Sodax } from "@sodax/sdk";
import { BENCHMARKS } from "@/lib/benchmarks";
import { displayToken } from "@/lib/chains";
import { getSql } from "@/lib/server/db";
import { ROUTE_READ, hubRpc } from "@/lib/server/hub-rpc";
import { HUB_RPC_URLS } from "@/lib/sodax-config";
import { COINGECKO_ID_BY_LOWER_SYMBOL } from "@/lib/coingecko-ids";
import { listListings } from "@/lib/listings";
import {
  INTENT_FILLED_TOPIC,
  TRANSFER_TOPIC,
  addressTopic,
  holdingChainOf,
  isDollarStable,
  listingOfIntent,
  pickFill,
  pickIntentFill,
  priceIdFor,
  readOrder,
  type OrderRecord,
} from "@/lib/orders";
import { cachedMultiplierHistories, toTokenPrices, type MultiplierReader } from "@/lib/server/token-multipliers";
import { LLAMA_SHARE_QUOTES_FROM_MS } from "@/lib/token-multiplier";

/**
 * Writing the order record at fill time: which listing, how much, what it
 * cost, when. Called from the pour route once the intent has been verified
 * (lib/server/pour-verify), so nothing here re-proves ownership; it only
 * reads what the chain says happened.
 *
 * Best effort by design. A failed read or write logs and returns; the XP
 * award that called it has already been decided and must not fail over
 * bookkeeping. A missing fill is written as a row without a quantity, and a
 * later call for the same intent fills the gaps in (the upsert keeps what is
 * known and adds what is new).
 */

/** Sonic makes a block about every 0.3s; this is well over an hour of them. */
const FILL_SEARCH_BLOCKS = 20_000;

/**
 * The fill search's endpoints. Its 20k block range is inside publicnode's
 * 50k log cap but over dRPC's free 10k (code 35, HTTP 400, every time), so
 * dRPC is left out rather than spending part of the budget on a sure
 * refusal: publicnode, then soniclabs.
 */
export const FILL_LOG_URLS: readonly string[] = HUB_RPC_URLS.filter((url) => !url.includes("drpc"));

/**
 * A hub read through the failover list (lib/server/hub-rpc), undefined when
 * nothing answered or there is no such thing. The route budget (4s an
 * endpoint, 8s a read), the one pour-verify uses: buildOrder makes up to
 * four of these in a row inside the pour route, after its proofs, so a
 * hung publicnode costs 4s a read, not 10. What is missed is filled in on a
 * later call (the evening pass, orders:recover).
 */
export async function orderRpc<T>(
  method: string,
  params: unknown[],
  {
    urls,
    fetcher,
    budget = ROUTE_READ,
  }: { urls?: readonly string[]; fetcher?: typeof fetch; budget?: { attemptMs: number; totalMs: number } } = {},
): Promise<T | undefined> {
  const answer = await hubRpc<T>(method, params, { ...budget, urls, fetcher });
  return answer.ok ? (answer.result ?? undefined) : undefined;
}

const rpc = orderRpc;

export type PriceAtMoment = { price: number; /** When DefiLlama's price was taken. */ pricedAt: Date };

/**
 * Several coins' dollar prices at a moment, in one request to DefiLlama's
 * historical endpoint (keyless, the same source as the app's other
 * prices), keyed by CoinGecko id. A coin it has no price for is absent,
 * which leaves that figure unknown rather than guessed. Never throws.
 */
export async function pricesAt(
  ids: readonly string[],
  at: Date,
  /** How far from `at` DefiLlama may look, e.g. "4h"; its own default when absent. */
  searchWidth?: string,
  timeoutMs = 8_000,
): Promise<Record<string, PriceAtMoment>> {
  const out: Record<string, PriceAtMoment> = {};
  if (ids.length === 0 || Number.isNaN(at.getTime())) return out;
  try {
    const seconds = Math.floor(at.getTime() / 1000);
    const coins = ids.map((id) => `coingecko:${id}`).join(",");
    const query = searchWidth ? `?searchWidth=${searchWidth}` : "";
    const response = await fetch(`https://coins.llama.fi/prices/historical/${seconds}/${coins}${query}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return out;
    const payload = (await response.json()) as {
      coins?: Record<string, { price?: number; timestamp?: number }>;
    };
    for (const id of ids) {
      const coin = payload.coins?.[`coingecko:${id}`];
      if (typeof coin?.price === "number" && coin.price > 0) {
        const stamp = typeof coin.timestamp === "number" ? coin.timestamp * 1000 : at.getTime();
        out[id] = { price: coin.price, pricedAt: new Date(stamp) };
      }
    }
  } catch {
    // unknown stays unknown
  }
  return out;
}

/** One coin's dollar price at a moment (pricesAt for one id). */
export async function priceAt(id: string, at: Date): Promise<number | undefined> {
  return (await pricesAt([id], at))[id]?.price;
}

/**
 * Every benchmark's price at an order's minute, into table `order_marks`,
 * so the benchmark is bought when the order was, never at an earlier close
 * that hands it a session (a weekend, for Gold and Bitcoin) the order did
 * not live through. One request for all five. Idempotent: a price already
 * stored is kept. Returns how many were written; never throws, the same
 * rule as the order itself.
 */
/**
 * How far from the order a benchmark price may be and still be its
 * minute's. DefiLlama prints these every few minutes, weekends included
 * (checked 2026-09-25: within two minutes on a Sunday).
 */
const ORDER_MARK_SEARCH_WIDTH = "4h";

/**
 * How long the pour route waits for the prices before answering; what
 * does not arrive in time the evening cron fills in.
 */
export const POUR_ORDER_MARKS_MS = 3_000;

/** How far before an order the multiplier window starts: past DefiLlama's search width, with room. */
const MULTIPLIER_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function recordOrderMarks(
  orderId: string,
  placedAt: Date,
  /** How long DefiLlama may take; the pour route passes POUR_ORDER_MARKS_MS. */
  timeoutMs = 8_000,
  readMultipliers: MultiplierReader = cachedMultiplierHistories,
): Promise<number> {
  try {
    // A listing benchmark (the S&P 500, Nasdaq 100 and Treasury bill funds)
    // is bought as the token, so its price is the token's: DefiLlama's
    // share quote times the dividend multiplier (lib/token-multiplier). The
    // chain read runs beside DefiLlama's, under the same time limit; a
    // benchmark it misses stays unmarked and the evening mends it.
    const since = placedAt.getTime() - MULTIPLIER_WINDOW_MS;
    const listingSymbols = BENCHMARKS.filter((benchmark) => benchmark.listingAddress).map((benchmark) => benchmark.symbol);
    let multipliers: ReturnType<MultiplierReader> | undefined;
    if (placedAt.getTime() + MULTIPLIER_WINDOW_MS >= LLAMA_SHARE_QUOTES_FROM_MS) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      multipliers = Promise.race([
        readMultipliers(listingSymbols, since),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("multiplier read timed out")), timeoutMs);
        }),
      ]).finally(() => clearTimeout(timer));
      multipliers.catch(() => undefined);
    }
    const prices = await pricesAt(
      BENCHMARKS.map((benchmark) => benchmark.marketId),
      placedAt,
      ORDER_MARK_SEARCH_WIDTH,
      timeoutMs,
    );
    const priced = Object.fromEntries(
      BENCHMARKS.filter((benchmark) => prices[benchmark.marketId]).map((benchmark) => {
        const { price, pricedAt } = prices[benchmark.marketId];
        return [benchmark.symbol, [{ timestamp: pricedAt.getTime() / 1000, price, pricedAt }]];
      }),
    );
    const { prices: tokenPrices, unread } = await toTokenPrices(priced, (symbols, sinceMs) =>
      multipliers ?? readMultipliers(symbols, sinceMs),
    );
    if (unread.length > 0) console.warn("[orders] dividend multiplier unread, left unmarked", orderId, unread.join(","));
    const found = BENCHMARKS.filter((benchmark) => tokenPrices[benchmark.symbol]?.[0]).map((benchmark) => ({
      symbol: benchmark.symbol,
      ...tokenPrices[benchmark.symbol][0],
    }));
    if (found.length === 0) return 0;
    const rows = (await getSql().query(
      `insert into order_marks (order_id, symbol, price, priced_at, source)
       select $1::uuid, s, p, t, 'defillama'
         from unnest($2::text[], $3::numeric[], $4::timestamptz[]) as x(s, p, t)
       on conflict (order_id, symbol) do nothing
       returning symbol`,
      [
        orderId,
        found.map((mark) => mark.symbol),
        found.map((mark) => mark.price),
        found.map((mark) => mark.pricedAt.toISOString()),
      ],
    )) as unknown[];
    return rows.length;
  } catch (error) {
    console.warn("[orders] benchmark prices not recorded", orderId, error instanceof Error ? error.message : error);
    return 0;
  }
}

async function blockTime(blockHex: string): Promise<Date | null> {
  const block = await rpc<{ timestamp: string }>("eth_getBlockByNumber", [blockHex, false]);
  return block ? new Date(Number.parseInt(block.timestamp, 16) * 1000) : null;
}

/**
 * The listing an intent buys (its output) or sells (its input), if it is
 * one of ours: by its Sonic address on the hub, by its Robinhood Chain hub
 * asset on Robinhood Chain (lib/orders listingOfIntent). Either way the
 * listing returned carries the Sonic address, which is what the order row
 * keeps as listing_address.
 */
function orderListing(sodax: Sodax, intent: Intent, direction: "buy" | "sell") {
  return listingOfIntent(listListings(sodax.leverageYield.listVaults()), intent, direction);
}

/** The symbol of the listing an intent buys or sells, or null (a pour claim keeps it). Never throws. */
export function orderListingSymbol(sodax: Sodax, intent: Intent, direction: "buy" | "sell"): string | null {
  try {
    return orderListing(sodax, intent, direction)?.symbol ?? null;
  } catch {
    return null;
  }
}

export async function buildOrder({
  sodax,
  intentTx,
  direction,
  intent,
  claimedFillTx,
}: {
  sodax: Sodax;
  intentTx: string;
  direction: "buy" | "sell";
  intent: Intent;
  claimedFillTx?: string | null;
}): Promise<OrderRecord | undefined> {
  const listing = orderListing(sodax, intent, direction);
  if (!listing) return undefined;
  const other = direction === "buy" ? intent.inputToken : intent.outputToken;
  const payToken = displayToken(sodax.config.getXTokenFromHubAsset(other));

  const receipt = await rpc<{ blockNumber: string }>("eth_getTransactionReceipt", [intentTx]);
  const placedAt = receipt ? await blockTime(receipt.blockNumber) : null;

  let fill: ReturnType<typeof pickFill>;
  // A buy delivered on the hub lands in the hub wallet on Sonic, where the
  // Transfer can be read. A sell pays out on the destination chain, which
  // is not read here.
  if (direction === "buy" && receipt && holdingChainOf(direction, intent) === "sonic") {
    const from = Number.parseInt(receipt.blockNumber, 16);
    const logs = await rpc<{ transactionHash: string; data: string; blockNumber: string }[]>(
      "eth_getLogs",
      [
        {
          fromBlock: receipt.blockNumber,
          toBlock: `0x${(from + FILL_SEARCH_BLOCKS).toString(16)}`,
          address: listing.address,
          topics: [TRANSFER_TOPIC, null, addressTopic(intent.dstAddress)],
        },
      ],
      { urls: FILL_LOG_URLS },
    );
    fill = logs ? pickFill(logs, claimedFillTx) : undefined;
  } else if (direction === "buy" && receipt) {
    // Delivered on Robinhood Chain: the solver's fill on Sonic hands the
    // listing's hub asset to the asset manager, which delivers the native
    // token on 4663, so no Transfer of the listing reaches the buyer on
    // Sonic. The fill is the Intents contract's IntentFilled for this
    // intent's hash, and its receivedOutput is the quantity. A hub asset
    // keeps its spoke token's raw units (it has no decimals of its own:
    // decimals() reads 0 on Sonic, for USDC's as for NVDA's, 2026-10-05),
    // and the native token has the listing's 18 (lib/listings.test holds
    // the SDK's decimals to the listing's), so listing.decimals reads it.
    const from = Number.parseInt(receipt.blockNumber, 16);
    const logs = await rpc<{ transactionHash: string; data: string; blockNumber: string }[]>(
      "eth_getLogs",
      [
        {
          fromBlock: receipt.blockNumber,
          toBlock: `0x${(from + FILL_SEARCH_BLOCKS).toString(16)}`,
          address: sodax.config.solver.intentsContract,
          topics: [INTENT_FILLED_TOPIC],
        },
      ],
      { urls: FILL_LOG_URLS },
    );
    fill = logs ? pickIntentFill(logs, EvmSolverService.getIntentHash(intent)) : undefined;
  }
  const filledAt = fill ? await blockTime(`0x${fill.blockNumber.toString(16)}`) : null;

  const priceId =
    direction === "buy" && payToken && !isDollarStable(payToken.symbol)
      ? priceIdFor(payToken.symbol, COINGECKO_ID_BY_LOWER_SYMBOL)
      : undefined;
  const payUsdPrice = priceId && placedAt ? await priceAt(priceId, placedAt) : undefined;

  return readOrder({
    payUsdPrice,
    intentTx,
    direction,
    intent,
    listing: { symbol: listing.symbol, address: listing.address, decimals: listing.decimals },
    pay: payToken
      ? { symbol: payToken.symbol, decimals: payToken.decimals, chainKey: payToken.chainKey }
      : undefined,
    received: fill?.received,
    fillTx: fill?.fillTx ?? null,
    placedAt,
    filledAt,
  });
}

/**
 * Insert or complete, returning the row's id. Known values are never
 * overwritten with unknowns. Every new row names its holding chain
 * (lib/orders holdingChainOf), so a null there keeps meaning only "legacy,
 * on the hub"; a legacy row completed later takes the chain then. Every path that records a buy comes through
 * here (the pour route, the evening pass over pour claims, a limit order's
 * fill).
 */
export async function saveOrder(userId: string | null, order: OrderRecord): Promise<string | undefined> {
  const rows = (await getSql().query(
    `insert into orders (
       user_id, wallet_address, intent_tx, fill_tx, direction, listing_symbol,
       listing_address, quantity, min_quantity, pay_symbol, pay_chain,
       pay_amount, fee_amount, usd_value, placed_at, filled_at, usd_source,
       delivered_to, src_address, holding_chain
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     on conflict (intent_tx) do update set
       user_id = coalesce(orders.user_id, excluded.user_id),
       holding_chain = coalesce(orders.holding_chain, excluded.holding_chain),
       delivered_to = coalesce(orders.delivered_to, excluded.delivered_to),
       wallet_address = coalesce(orders.wallet_address, excluded.wallet_address),
       src_address = coalesce(orders.src_address, excluded.src_address),
       fill_tx = coalesce(orders.fill_tx, excluded.fill_tx),
       quantity = coalesce(orders.quantity, excluded.quantity),
       pay_amount = coalesce(orders.pay_amount, excluded.pay_amount),
       usd_value = coalesce(orders.usd_value, excluded.usd_value),
       usd_source = coalesce(orders.usd_source, excluded.usd_source),
       placed_at = coalesce(orders.placed_at, excluded.placed_at),
       filled_at = coalesce(orders.filled_at, excluded.filled_at)
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
      order.srcAddress ?? null,
      order.holdingChain,
    ],
  )) as { id: string }[];
  return rows[0]?.id;
}

/**
 * The pour route's call: build and save, then the benchmarks' prices at
 * the order's minute (lib/server/order-marks), never throw. A price that
 * does not arrive within POUR_ORDER_MARKS_MS is filled in by the evening
 * cron, so a slow DefiLlama never holds up the pour's answer.
 */
export async function recordOrder(args: {
  sodax: Sodax;
  userId: string | null;
  intentTx: string;
  direction: "buy" | "sell";
  intent: Intent;
  claimedFillTx?: string | null;
}): Promise<{ id: string; order: OrderRecord } | undefined> {
  try {
    const order = await buildOrder(args);
    if (!order) return undefined;
    const id = await saveOrder(args.userId, order);
    if (id && order.placedAt) await recordOrderMarks(id, order.placedAt, POUR_ORDER_MARKS_MS);
    return id ? { id, order } : undefined;
  } catch (error) {
    console.warn("[orders] not recorded", args.intentTx, error instanceof Error ? error.message : error);
    return undefined;
  }
}
