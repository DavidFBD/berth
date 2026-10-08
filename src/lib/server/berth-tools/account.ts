import type { BenchmarkSymbol } from "@/lib/benchmarks";
import { TOKEN_LISTINGS, type TokenListing } from "@/lib/listings";
import type { Range } from "@/lib/portfolio-history";
import { getSql } from "@/lib/server/db";
import { fetchPrivyWallet } from "@/lib/server/privy";
import { accountEvmAddresses } from "@/lib/server/identities";
import {
  hasRobinhoodOrders,
  liveListingPrices,
  noRobinhoodRead,
  readAccountBalances,
  readReturnedHoldings,
} from "@/lib/server/portfolio";
import { robinhoodDeliveryOn } from "@/lib/server/delivery";
import { readRobinhoodHoldingsFresh } from "@/lib/server/robinhood-balances";

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
 * The EVM addresses an account's holdings live behind, home first: every
 * wallet linked to it (lib/server/identities accountEvmAddresses), each
 * with its own hub wallet. An account with none recorded falls back to
 * what it read before phase 2: for a Privy account, the wallet Privy says
 * is linked to it now (lib/server/privy fetchPrivyWallet, cached), else the
 * address stored on the row. Empty when there is none to read.
 */
export async function spokesOf(row: AccountRow): Promise<{ home: string | null; all: string[] }> {
  const linked = await accountEvmAddresses(row.id, isEvmAddress(row.wallet_address) ? row.wallet_address : null);
  if (linked.all.length > 0) return linked;
  if (row.privy_did) {
    const lookup = await withTimeout(fetchPrivyWallet(row.privy_did), CHAIN_READ_MS, "account lookup").catch(() => null);
    if (lookup?.ok && isEvmAddress(lookup.address)) {
      const address = lookup.address.toLowerCase();
      return { home: address, all: [address] };
    }
  }
  return { home: null, all: [] };
}

export type HoldingLine = {
  listing: TokenListing;
  /** Everything held: `hub` plus `robinhood`. */
  quantity: number;
  /** In the Berth account on Sonic, every linked address's hub wallet added up. */
  hub: number;
  /** In the person's own wallets on Robinhood Chain, added up. */
  robinhood: number;
  /** The most any one wallet holds on Robinhood Chain: a sell from there spends one wallet. */
  robinhoodLargest: number;
  /**
   * Back on Sonic from a sell from Robinhood Chain that did not fill, in the
   * hub wallet derived for (robinhood, the wallet) (lib/robinhood-returned):
   * counted in `quantity`, never in `hub`, and no sell spends it.
   */
  returned: number;
  price?: number;
  value?: number;
};

/**
 * What the account holds right now across every linked address's hub
 * wallet and the same addresses' own wallets on Robinhood Chain
 * (lib/server/portfolio readAccountBalances), read on chain, valued at the
 * solver oracle's prices. `hubWallets` is every hub wallet read, home
 * first; `robinhoodWallets` the addresses holding anything on Robinhood
 * Chain. One failed read fails the whole.
 */
export async function readHoldings(
  spokes: string | readonly string[],
  /**
   * `userId`: the account read. One with Robinhood Chain orders also has
   * what its sells there left on Sonic read (lib/robinhood-returned); a
   * failed check reads it too, since reading more can only show more. Its
   * own wallets on Robinhood Chain are read only when its side is read at
   * all (lib/server/portfolio robinhoodReads); without a `userId`, always.
   */
  { userId }: { userId?: string } = {},
): Promise<{
  hubWallet: string;
  hubWallets: string[];
  robinhoodWallets: string[];
  /** Robinhood Chain did not answer: the lines are the Berth account's alone, and the tools say so. */
  robinhoodUnread: boolean;
  lines: HoldingLine[];
  total: number;
  unpriced: number;
}> {
  const list = typeof spokes === "string" ? [spokes] : spokes;
  const onRobinhood = userId ? await hasRobinhoodOrders(userId).catch(() => true) : false;
  const readsSide = !userId || onRobinhood || robinhoodDeliveryOn([userId, ...list]);
  const [read, prices] = await Promise.all([
    // Robinhood Chain unread leaves the hub's lines, said as such: a sell cap
    // from them can only be lower than the truth, never higher.
    // Read fresh, never from the two minute memo: the sell cap must not see
    // a balance a sell has just spent (rh-server m5).
    withTimeout(
      readAccountBalances(
        list,
        undefined,
        undefined,
        readsSide ? readRobinhoodHoldingsFresh : noRobinhoodRead,
        "hub only",
        onRobinhood ? readReturnedHoldings : undefined,
      ),
      CHAIN_READ_MS,
      "balance read",
    ),
    liveListingPrices().catch(() => ({}) as Record<string, number>),
  ]);
  const balances = read.total;
  const onChain = read.robinhood ?? {};
  const returnedBy = read.returned ?? {};
  const owners = [...read.robinhoodByOwner.entries()];
  const lines: HoldingLine[] = [];
  let total = 0;
  let unpriced = 0;
  for (const listing of TOKEN_LISTINGS) {
    const quantity = balances[listing.symbol];
    if (!quantity) continue;
    const robinhood = onChain[listing.symbol] ?? 0;
    const returned = returnedBy[listing.symbol] ?? 0;
    const robinhoodLargest = owners.reduce((most, [, holdings]) => Math.max(most, holdings[listing.symbol] ?? 0), 0);
    const price = prices[listing.symbol];
    const value = price !== undefined ? quantity * price : undefined;
    if (value !== undefined) total += value;
    else unpriced += 1;
    lines.push({ listing, quantity, hub: Math.max(0, quantity - robinhood - returned), robinhood, robinhoodLargest, returned, price, value });
  }
  lines.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const hubWallets = read.byWallet.map((wallet) => wallet.hubWallet);
  const robinhoodWallets = owners.filter(([, holdings]) => Object.keys(holdings).length > 0).map(([owner]) => owner);
  return { hubWallet: hubWallets[0], hubWallets, robinhoodWallets, robinhoodUnread: read.robinhood === null, lines, total, unpriced };
}

/**
 * The most of a listing one sell can spend: a market sell spends either
 * the Berth account or one wallet on Robinhood Chain, never the two
 * together, so the larger of the two; a limit sell waits on the hub and
 * spends the Berth account alone.
 */
export function sellableOf(line: HoldingLine | undefined, orderType: "market" | "limit" = "market"): number {
  if (!line) return 0;
  return orderType === "limit" ? line.hub : Math.max(line.hub, line.robinhoodLargest);
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
