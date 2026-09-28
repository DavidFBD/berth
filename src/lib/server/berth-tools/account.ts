import type { BenchmarkSymbol } from "@/lib/benchmarks";
import { TOKEN_LISTINGS, type TokenListing } from "@/lib/listings";
import type { Range } from "@/lib/portfolio-history";
import { getSql } from "@/lib/server/db";
import { fetchPrivyWallet } from "@/lib/server/privy";
import { hubWalletFor, liveListingPrices, readListingBalances } from "@/lib/server/portfolio";

/**
 * The account reads the Berth tools share (lib/server/berth-tools/registry):
 * the account row, the home chain address it derives from, and what it
 * holds on chain. Moved here from the MCP tools unchanged, so both doors
 * (MCP and the in-app chat) read an account the same way.
 */

/** How long a chain read may take before a tool gives up on it. */
export const CHAIN_READ_MS = 8_000;

export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export type AccountRow = {
  id: string;
  privy_did: string | null;
  wallet_address: string | null;
  email: string | null;
  xp: number;
  created_at: string | Date;
};

export async function loadAccountRow(userId: string): Promise<AccountRow | null> {
  const rows = (await getSql().query(
    `select id, privy_did, wallet_address, email, xp, created_at from users where id = $1`,
    [userId],
  )) as AccountRow[];
  return rows[0] ?? null;
}

const isEvmAddress = (value: string | null | undefined): value is string => !!value && /^0x[0-9a-f]{40}$/i.test(value);

/**
 * The home chain address an account is derived from, resolved the way the
 * app's own account routes do (app/api/portfolio/history): for a Privy
 * account, the wallet Privy says is linked to it now (lib/server/privy
 * fetchPrivyWallet, cached), else the address stored on the row; for a
 * wallet account, its stored address. Null when there is none to read.
 */
export async function spokeOf(row: AccountRow): Promise<string | null> {
  if (row.privy_did) {
    const lookup = await withTimeout(fetchPrivyWallet(row.privy_did), CHAIN_READ_MS, "account lookup").catch(() => null);
    if (lookup?.ok && isEvmAddress(lookup.address)) return lookup.address.toLowerCase();
  }
  return isEvmAddress(row.wallet_address) ? row.wallet_address : null;
}

export type HoldingLine = { listing: TokenListing; quantity: number; price?: number; value?: number };

/** What the account holds right now, read on chain, valued at the solver oracle's prices. */
export async function readHoldings(spoke: string): Promise<{ hubWallet: string; lines: HoldingLine[]; total: number; unpriced: number }> {
  const [hubWallet, prices] = await Promise.all([
    withTimeout(hubWalletFor(spoke), CHAIN_READ_MS, "account lookup"),
    liveListingPrices().catch(() => ({}) as Record<string, number>),
  ]);
  const balances = await withTimeout(readListingBalances(hubWallet), CHAIN_READ_MS, "balance read");
  const lines: HoldingLine[] = [];
  let total = 0;
  let unpriced = 0;
  for (const listing of TOKEN_LISTINGS) {
    const quantity = balances[listing.symbol];
    if (!quantity) continue;
    const price = prices[listing.symbol];
    const value = price !== undefined ? quantity * price : undefined;
    if (value !== undefined) total += value;
    else unpriced += 1;
    lines.push({ listing, quantity, price, value });
  }
  lines.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return { hubWallet, lines, total, unpriced };
}

export const PERIODS: Record<string, { range: Range; words: string }> = {
  week: { range: "1w", words: "the last week" },
  month: { range: "1m", words: "the last month" },
  three_months: { range: "3m", words: "the last three months" },
  since_first_buy: { range: "since", words: "since the first buy" },
};

export const BENCHMARK_CHOICES: Record<string, BenchmarkSymbol> = {
  sp500: "SPY",
  nasdaq100: "QQQ",
  gold: "PAXG",
  bitcoin: "BTC",
  treasury_bills: "SGOV",
};

export const STATUS_WORDS: Record<string, string> = {
  unexplained_balance:
    "Money moved in or out without a Berth order, so neither percentage can be told honestly. The dollar values stand. A comparison starts from the next evening whose balances the orders add up to.",
  unpriced_orders: "Some orders were paid in a coin Berth could not price at the time, so the percentages cannot be told.",
  no_marks: "The benchmark has no price for part of this window, so it cannot be compared.",
  too_short: "There are fewer than two days of history in this window.",
};
