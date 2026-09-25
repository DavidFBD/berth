import { erc20Abi, formatUnits, type Address } from "viem";
import { HOME_CHAIN } from "@/lib/account";
import type { OrderFacts } from "@/lib/benchmark";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { snapshotDay, valueHoldings, type Holding, type ValuedDay } from "@/lib/portfolio-days";
import type { PortfolioDay } from "@/lib/portfolio-history";
import { getSql } from "@/lib/server/db";
import { loadListingPrices } from "@/lib/server/listing-prices";
import { readMarks } from "@/lib/server/marks";
import { loadOrderFacts } from "@/lib/server/order-marks";
import { getSodax } from "@/lib/server/pour-verify";

/**
 * The portfolio's server half: whose account is where, what it holds, what
 * that was worth, and the table that remembers it (`portfolio_days`). The
 * rules for a row are in lib/portfolio-days; the drawing in
 * lib/portfolio-history.
 *
 * Only token listings (stocks, funds, cash) are counted. The old vault
 * positions are valued through previewRedeem and live at a different hub
 * wallet per source chain, so they are neither read nor drawn here.
 */

const LISTING_BY_ADDRESS = new Map(
  TOKEN_LISTINGS.map((listing) => [listing.address.toLowerCase(), listing]),
);
const LISTING_SYMBOLS = new Set(TOKEN_LISTINGS.map((listing) => listing.symbol));

/** The account: the hub wallet derived from the spoke address on the home chain (lib/account). */
export async function hubWalletFor(spokeAddress: string): Promise<string> {
  const wallet = await getSodax().hubProvider.getUserHubWalletAddress(spokeAddress, HOME_CHAIN);
  return wallet.toLowerCase();
}

/** Listing balances at a hub wallet, in listing units, by symbol. Throws when unknown. */
export type ListingBalanceReader = (hubWallet: string) => Promise<Record<string, number>>;

/** Every token listing's balanceOf in one multicall; a failed read throws, never zero. */
export const readListingBalances: ListingBalanceReader = async (hubWallet) => {
  const results = await getSodax().hubProvider.publicClient.multicall({
    allowFailure: false,
    contracts: TOKEN_LISTINGS.map((listing) => ({
      address: listing.address,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [hubWallet as Address] as const,
    })),
  });
  const balances: Record<string, number> = {};
  TOKEN_LISTINGS.forEach((listing, index) => {
    const raw = BigInt(results[index] as bigint);
    if (raw > 0n) balances[listing.symbol] = Number(formatUnits(raw, listing.decimals));
  });
  return balances;
};

/** The solver's live prices, by listing symbol. Empty when the oracle is down. */
export async function liveListingPrices(): Promise<Record<string, number>> {
  const { prices } = await loadListingPrices();
  const out: Record<string, number> = {};
  for (const [address, price] of Object.entries(prices)) {
    const listing = LISTING_BY_ADDRESS.get(address);
    if (listing) out[listing.symbol] = price;
  }
  return out;
}

/** An account's listing orders, oldest first, with their benchmark prices (lib/server/order-marks). */
export async function loadListingOrders(userId: string): Promise<OrderFacts[]> {
  return (await loadOrderFacts(userId)).filter((order) => LISTING_SYMBOLS.has(order.symbol));
}

export type StoredPortfolioDay = PortfolioDay & {
  asOf: string;
  holdings: Holding[];
  source: "snapshot" | "ledger";
};

export async function loadPortfolioDays(userId: string): Promise<StoredPortfolioDay[]> {
  const rows = (await getSql().query(
    `select to_char(day, 'YYYY-MM-DD') as day, value_usd::float8 as value, holdings, source, as_of
       from portfolio_days
      where user_id = $1
      order by day`,
    [userId],
  )) as { day: string; value: number; holdings: Holding[]; source: "snapshot" | "ledger"; as_of: string | Date }[];
  return rows.map((row) => ({
    day: row.day,
    value: Number(row.value),
    holdings: row.holdings ?? [],
    source: row.source,
    asOf: new Date(row.as_of).toISOString(),
  }));
}

/**
 * Write one day. A snapshot replaces whatever was there, since it read the
 * chain; a ledger row never replaces a snapshot.
 */
export async function savePortfolioDay(
  userId: string,
  day: string,
  valued: ValuedDay,
  source: "snapshot" | "ledger",
  asOf: string,
): Promise<boolean> {
  const rows = (await getSql().query(
    `insert into portfolio_days (user_id, day, value_usd, holdings, source, as_of)
     values ($1, $2::date, $3, $4::jsonb, $5, $6::timestamptz)
     on conflict (user_id, day) do update set
       value_usd = excluded.value_usd,
       holdings = excluded.holdings,
       source = excluded.source,
       as_of = excluded.as_of
     where excluded.source = 'snapshot' or portfolio_days.source = 'ledger'
     returning day`,
    [userId, day, valued.value, JSON.stringify(valued.holdings), source, asOf],
  )) as unknown[];
  return rows.length > 0;
}

/**
 * Accounts worth a snapshot: an EVM spoke address (the ones that have a
 * hub wallet) and at least one order or an earlier row. An account that
 * never ordered holds no listing it bought here, and reading every signup
 * each evening would outgrow the run. Oldest accounts first, so the newest
 * are the ones a run cut short would miss.
 */
export async function snapshotAccounts(): Promise<{ id: string; wallet: string }[]> {
  const rows = (await getSql().query(
    `select u.id, u.wallet_address from users u
      where u.wallet_address ~ '^0x[0-9a-f]{40}$'
        and (exists (select 1 from orders o where o.user_id = u.id)
             or exists (select 1 from portfolio_days p where p.user_id = u.id))
      order by u.created_at`,
  )) as { id: string; wallet_address: string }[];
  return rows.map((row) => ({ id: row.id, wallet: row.wallet_address }));
}

/** Run `task` over `items`, at most `limit` at once. */
export async function inPool<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await task(item);
    }
  });
  await Promise.all(workers);
}

export type SnapshotSummary = {
  day: string | null;
  skipped?: "not within a market day's snapshot hours";
  accounts: number;
  written: number;
  /** Nothing held and no earlier row: nothing to remember. */
  empty: number;
  /**
   * Holdings valued at the oracle because the day's close was missing or
   * stood more than MARK_ORACLE_DRIFT from the oracle's price.
   */
  oraclePriced: number;
  /** Includes accounts whose read passed ACCOUNT_TIMEOUT_MS. */
  failed: number;
};

/** Accounts read at once; each is a derivation and one multicall. */
export const SNAPSHOT_CONCURRENCY = 4;

/** How long one account's read may take before it counts as failed and the run moves on. */
export const ACCOUNT_TIMEOUT_MS = 8_000;

/**
 * How far a stored close may stand from the solver oracle's live price
 * before the snapshot trusts the oracle instead. The newest close has had
 * no day after it to be despiked against (lib/marks settleMarks), and a
 * row once written is kept; a bad print (101 read as 500) must not be.
 */
export const MARK_ORACLE_DRIFT = 0.05;

/**
 * The price a snapshot values a holding at: the day's close, unless it is
 * missing or stands more than MARK_ORACLE_DRIFT from the oracle's price,
 * then the oracle's. With no oracle price the close stands alone.
 */
export function snapshotPrice(
  close: number | undefined,
  oracle: number | undefined,
): { price: number; source: "mark" | "oracle" } | undefined {
  const liveOk = oracle !== undefined && oracle > 0;
  if (close === undefined || !(close > 0)) return liveOk ? { price: oracle, source: "oracle" } : undefined;
  if (liveOk && Math.abs(close / oracle - 1) > MARK_ORACLE_DRIFT) return { price: oracle, source: "oracle" };
  return { price: close, source: "mark" };
}

/**
 * Today's row for every account: balances read on chain, valued at today's
 * stored close, or the oracle's live price where the close is missing or
 * out of line with it (snapshotPrice). One account failing, or taking
 * longer than ACCOUNT_TIMEOUT_MS, costs that account its row and nothing
 * else.
 */
export async function runPortfolioSnapshot({
  now = new Date(),
  readBalances = readListingBalances,
  deriveHubWallet = hubWalletFor,
  livePrices = liveListingPrices,
  accounts,
  accountTimeoutMs = ACCOUNT_TIMEOUT_MS,
}: {
  accountTimeoutMs?: number;
  now?: Date;
  readBalances?: ListingBalanceReader;
  deriveHubWallet?: (spokeAddress: string) => Promise<string>;
  livePrices?: () => Promise<Record<string, number>>;
  accounts?: { id: string; wallet: string }[];
} = {}): Promise<SnapshotSummary> {
  const day = snapshotDay(now);
  const summary: SnapshotSummary = { day: day ?? null, accounts: 0, written: 0, empty: 0, oraclePriced: 0, failed: 0 };
  if (!day) return { ...summary, skipped: "not within a market day's snapshot hours" };

  const list = accounts ?? (await snapshotAccounts());
  summary.accounts = list.length;
  if (list.length === 0) return summary;

  const symbols = TOKEN_LISTINGS.map((listing) => listing.symbol);
  const closes = await readMarks(symbols, day);
  // One oracle read for the whole run, however many accounts ask at once.
  let oracle: Promise<Record<string, number>> | undefined;
  const oraclePrices = () =>
    (oracle ??= livePrices().catch(() => ({}) as Record<string, number>));

  const withRows = new Set(
    (
      (await getSql().query(
        `select distinct user_id from portfolio_days where user_id = any($1::uuid[])`,
        [list.map((account) => account.id)],
      )) as { user_id: string }[]
    ).map((row) => row.user_id),
  );

  const snapshotOne = async (account: { id: string; wallet: string }, expired: () => boolean) => {
    const balances = await readBalances(await deriveHubWallet(account.wallet));
    const live = Object.keys(balances).length > 0 ? await oraclePrices() : {};
    const valued = valueHoldings(balances, (symbol) => {
      const marks = closes[symbol];
      const close = marks?.dates.at(-1) === day ? marks.values.at(-1) : undefined;
      return snapshotPrice(close, live[symbol]);
    });
    // Already counted as failed: a late answer counts and writes nothing.
    if (expired()) return;
    if (!valued.ok) {
      console.warn("[portfolio] unpriced, no row", account.id, valued.unpriced.join(","));
      summary.failed += 1;
      return;
    }
    if (valued.day.value <= 0 && !withRows.has(account.id)) {
      summary.empty += 1;
      return;
    }
    await savePortfolioDay(account.id, day, valued.day, "snapshot", now.toISOString());
    summary.written += 1;
    summary.oraclePriced += valued.day.holdings.filter((holding) => holding.source === "oracle").length;
  };

  await inPool(list, SNAPSHOT_CONCURRENCY, async (account) => {
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        snapshotOne(account, () => expired),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            expired = true;
            reject(new Error(`timed out after ${accountTimeoutMs}ms`));
          }, accountTimeoutMs);
        }),
      ]);
    } catch (error) {
      console.warn("[portfolio] snapshot failed", account.id, error instanceof Error ? error.message : error);
      summary.failed += 1;
    } finally {
      clearTimeout(timer);
    }
  });
  return summary;
}

