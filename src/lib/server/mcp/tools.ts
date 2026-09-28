import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { requireScopes } from "@modelcontextprotocol/server";
import { z } from "zod";
import { findBenchmark, type BenchmarkSymbol } from "@/lib/benchmarks";
import { draftOrder, findTokenListing } from "@/lib/draft-order";
import { TOKEN_LISTINGS, type TokenListing } from "@/lib/listings";
import { isNotableMove } from "@/lib/moves";
import type { Range } from "@/lib/portfolio-history";
import { rankForXp } from "@/lib/xp";
import { getSql } from "@/lib/server/db";
import { fetchPrivyWallet } from "@/lib/server/privy";
import { loadPerformance } from "@/lib/server/listing-performance";
import { loadListingNews } from "@/lib/server/listing-news";
import { loadListingX } from "@/lib/server/listing-x";
import { gatherPosts } from "@/lib/server/x-column";
import { loadMoves } from "@/lib/server/moves";
import { SCOPE_DRAFT, SCOPE_READ } from "@/lib/server/oauth/config";
import { loadOrderLog } from "@/lib/server/order-marks";
import { hubWalletFor, liveListingPrices, readListingBalances } from "@/lib/server/portfolio";
import { loadPortfolioHistory } from "@/lib/server/portfolio-view";
import { authOf, guarded, refuse, text, type BerthAuth, type ToolResult } from "@/lib/server/mcp/guard";
import { ago, clip, day, moment, named, pct, units, usd } from "@/lib/server/mcp/text";

/**
 * The tools an assistant gets at /mcp (app/mcp). Every one reads, except
 * draft_order, which writes a link and nothing else: the person opens it in
 * Berth, checks it and signs. None can move money, because nothing on this
 * server holds a key.
 *
 * Each tool reuses the function the app's own route uses, so the assistant
 * sees exactly what the person sees. Output is compact text written for an
 * assistant to read and retell: names before tickers, dollars as dollars,
 * and a plain line when something could not be read rather than a guess.
 */

export { authOf, type BerthAuth } from "@/lib/server/mcp/guard";

function needScope(ctx: ServerContext, scope: string): (BerthAuth & { scopes: string[] }) | ToolResult {
  const auth = authOf(ctx);
  if (!auth) return refuse("Not signed in to Berth. Reconnect Berth in your assistant's settings.");
  if (!auth.scopes.includes(scope)) {
    return refuse(`This connection was not allowed to do that (it needs ${scope}). Reconnect Berth and allow it.`);
  }
  return auth;
}

const LISTING_ARG = z
  .string()
  .min(1)
  .max(60)
  .describe('A listing on the board, by ticker or name, e.g. "NVDA" or "NVIDIA". list_listings has them all.');

/** How long a chain read may take before a tool gives up on it. */
const CHAIN_READ_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

type AccountRow = {
  id: string;
  privy_did: string | null;
  wallet_address: string | null;
  email: string | null;
  xp: number;
  created_at: string | Date;
};

async function loadAccountRow(userId: string): Promise<AccountRow | null> {
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
async function spokeOf(row: AccountRow): Promise<string | null> {
  if (row.privy_did) {
    const lookup = await withTimeout(fetchPrivyWallet(row.privy_did), CHAIN_READ_MS, "account lookup").catch(() => null);
    if (lookup?.ok && isEvmAddress(lookup.address)) return lookup.address.toLowerCase();
  }
  return isEvmAddress(row.wallet_address) ? row.wallet_address : null;
}

type HoldingLine = { listing: TokenListing; quantity: number; price?: number; value?: number };

/** What the account holds right now, read on chain, valued at the solver oracle's prices. */
async function readHoldings(spoke: string): Promise<{ hubWallet: string; lines: HoldingLine[]; total: number; unpriced: number }> {
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

const PERIODS: Record<string, { range: Range; words: string }> = {
  week: { range: "1w", words: "the last week" },
  month: { range: "1m", words: "the last month" },
  three_months: { range: "3m", words: "the last three months" },
  since_first_buy: { range: "since", words: "since the first buy" },
};

const BENCHMARK_CHOICES: Record<string, BenchmarkSymbol> = {
  sp500: "SPY",
  nasdaq100: "QQQ",
  gold: "PAXG",
  bitcoin: "BTC",
  treasury_bills: "SGOV",
};

const STATUS_WORDS: Record<string, string> = {
  unexplained_balance:
    "Money moved in or out without a Berth order, so neither percentage can be told honestly. The dollar values stand. A comparison starts from the next evening whose balances the orders add up to.",
  unpriced_orders: "Some orders were paid in a coin Berth could not price at the time, so the percentages cannot be told.",
  no_marks: "The benchmark has no price for part of this window, so it cannot be compared.",
  too_short: "There are fewer than two days of history in this window.",
};

export function registerBerthTools(server: McpServer, { origin }: { origin: string }): void {
  const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

  server.registerTool(
    "list_listings",
    {
      title: "List what Berth offers",
      description:
        "Every stock, fund and the cash fund on Berth's board, with the current price and the change over the last trading day. Prices are the solver oracle's, the ones an order would be filled against. Use the ticker or name from here in the other tools.",
      inputSchema: z.object({}),
      annotations: { title: "List what Berth offers", ...READ_ONLY },
    },
    async (_args, ctx) =>
      guarded("list_listings", ctx, async () => {
        const [prices, performance] = await Promise.all([
          liveListingPrices().catch(() => ({}) as Record<string, number>),
          loadPerformance().catch(() => ({ performance: {} }) as Awaited<ReturnType<typeof loadPerformance>>),
        ]);
        const lines = TOKEN_LISTINGS.map((listing) => {
          const kind = listing.kind === "cash" ? "cash (a Treasury bill fund)" : listing.category === "etf" ? "fund" : "stock";
          const change = performance.performance[listing.symbol]?.changePct;
          return `${named(listing)}, ${kind}: ${usd(prices[listing.symbol])}, ${pct(change)} on the last trading day`;
        });
        return text(
          [`${TOKEN_LISTINGS.length} listings on Berth, tokenised US stocks and funds on Sonic, bought with stablecoins or Bitcoin.`, ...lines].join("\n"),
        );
      }),
  );

  server.registerTool(
    "get_listing",
    {
      title: "Look at one listing",
      description:
        "One listing in detail: its price, its recent daily closes and change, whether its last move was large for it and the post that reported it, recent headlines, and the most substantial recent posts on X about it (read and ranked by Jev, a model by TypeSafe).",
      inputSchema: z.object({ listing: LISTING_ARG }),
      annotations: { title: "Look at one listing", ...READ_ONLY, openWorldHint: true },
    },
    async ({ listing: query }, ctx) =>
      guarded("get_listing", ctx, async () => {
        const listing = findTokenListing(query);
        if (!listing) return refuse(`Berth does not offer "${query}". Call list_listings for what is on the board.`);
        // One X gathering and one performance read, shared by the moves and the column.
        const feed = gatherPosts();
        const performanceRead = loadPerformance();
        feed.catch(() => undefined);
        performanceRead.catch(() => undefined);
        const [prices, performance, moves, news, posts] = await Promise.all([
          liveListingPrices().catch(() => ({}) as Record<string, number>),
          performanceRead.catch(() => undefined),
          loadMoves({ performance: performanceRead, feed }).catch(() => ({ moves: [] })),
          loadListingNews(listing.symbol).catch(() => ({ items: [] })),
          loadListingX(listing.symbol, feed).catch(() => ({ items: [], reserve: [] })),
        ]);
        const entry = performance?.performance[listing.symbol];
        const out = [`${named(listing)}. ${listing.issuerName}.`, `Price now: ${usd(prices[listing.symbol])}.`];
        if (entry?.series && entry.seriesDates) {
          const closes = entry.series.slice(-6).map((close, index, all) => {
            const date = entry.seriesDates![entry.seriesDates!.length - all.length + index];
            return `${day(date)} ${usd(close)}`;
          });
          const first = entry.series[0];
          const last = entry.series.at(-1)!;
          out.push(
            entry.noCleanClose
              ? "Last trading day: no clean close the day before to measure against, so no change is given."
              : `Last trading day: ${pct(entry.changePct)}${isNotableMove(entry.series, entry.changePct) ? ", a large move for it" : ""}.`,
            `Recent closes: ${closes.join(", ")}.`,
            `Since ${day(entry.seriesFrom ?? entry.seriesDates[0])}: ${pct(((last - first) / first) * 100)}.`,
          );
        }
        const move = moves.moves.find((candidate) => candidate.symbol === listing.symbol);
        if (move) out.push(`Around that move, ${move.post.name} (@${move.post.username}) posted: ${move.post.url}`);
        if (news.items.length > 0) {
          out.push("", "Headlines:");
          for (const item of news.items.slice(0, 5)) out.push(`${item.title} (${item.source}, ${ago(item.publishedAt)}) ${item.url}`);
        }
        if (posts.items.length > 0) {
          out.push("", "On X:");
          for (const post of posts.items.slice(0, 5)) {
            out.push(`${post.author.name} (@${post.author.username}), ${ago(post.publishedAt)}${post.verdict ? `, read as ${post.verdict}` : ""}: ${clip(post.text)} ${post.url}`);
          }
        }
        return text(out.join("\n"));
      }),
  );

  server.registerTool(
    "get_moves",
    {
      title: "What moved",
      description:
        "Every listing's change over the last trading day, largest first, marking the moves that were large for that listing (at least twice its usual day and 1%) and, where Jev found one, the post from around that day that reported something related. Never a cause, only what was being said.",
      inputSchema: z.object({}),
      annotations: { title: "What moved", ...READ_ONLY, openWorldHint: true },
    },
    async (_args, ctx) =>
      guarded("get_moves", ctx, async () => {
        const [performance, moves] = await Promise.all([loadPerformance(), loadMoves().catch(() => ({ moves: [] }))]);
        const rows = TOKEN_LISTINGS.map((listing) => ({ listing, entry: performance.performance[listing.symbol] }))
          .filter((row) => row.entry?.changePct !== undefined)
          .sort((a, b) => Math.abs(b.entry!.changePct!) - Math.abs(a.entry!.changePct!));
        if (rows.length === 0) return text("No listing has two recent closes to compare right now.");
        const asOf = rows[0].entry?.seriesDates?.at(-1);
        const out = [`Change over the last trading day${asOf ? `, to the close of ${day(asOf)}` : ""}:`];
        for (const { listing, entry } of rows) {
          const notable = isNotableMove(entry!.series ?? [], entry!.changePct);
          const move = moves.moves.find((candidate) => candidate.symbol === listing.symbol);
          out.push(
            `${named(listing)}: ${pct(entry!.changePct)}${notable ? ", large for it" : ""}${move ? `. In the news: ${move.post.name}, ${move.post.url}` : ""}`,
          );
        }
        const unclean = TOKEN_LISTINGS.filter((listing) => performance.performance[listing.symbol]?.noCleanClose);
        for (const listing of unclean) out.push(`${named(listing)}: no clean close the day before, so no change is given.`);
        return text(out.join("\n"));
      }),
  );

  server.registerTool(
    "get_market_feed",
    {
      title: "What is being said",
      description:
        "Berth's live market column: recent posts on X about the listings, from the companies and a press list, each read by Jev (a model by TypeSafe) and kept only if it reports something. Optionally narrowed to one listing.",
      inputSchema: z.object({ listing: LISTING_ARG.optional() }),
      annotations: { title: "What is being said", ...READ_ONLY, openWorldHint: true },
    },
    async ({ listing: query }, ctx) =>
      guarded("get_market_feed", ctx, async () => {
        const listing = query ? findTokenListing(query) : undefined;
        if (query && !listing) return refuse(`Berth does not offer "${query}". Call list_listings for what is on the board.`);
        const feed = await loadListingX(listing?.symbol);
        if (feed.items.length === 0) return text("Nothing substantial has been posted in the last while.");
        const out = feed.curation
          ? [`Jev read ${feed.curation.read} of ${feed.curation.seen} posts this week and kept ${feed.curation.kept}. Newest and most substantial first:`]
          : ["Newest and most substantial first:"];
        for (const post of feed.items) {
          out.push(
            `About ${post.name}: ${post.author.name} (@${post.author.username}), ${ago(post.publishedAt)}${post.verdict ? `, read as ${post.verdict}` : ""}. ${clip(post.text)} ${post.url}`,
          );
        }
        return text(out.join("\n"));
      }),
  );

  server.registerTool(
    "get_account",
    {
      title: "The Berth account",
      description:
        "The signed in person's Berth account: its rank and XP, the address it is derived from and the account address on Sonic where holdings live, and what it holds in total at current prices.",
      inputSchema: z.object({}),
      annotations: { title: "The Berth account", ...READ_ONLY },
      scopeChallenge: requireScopes(SCOPE_READ),
    },
    async (_args, ctx) =>
      guarded("get_account", ctx, async () => {
        const auth = needScope(ctx, SCOPE_READ);
        if ("content" in auth) return auth;
        const row = await loadAccountRow(auth.userId);
        if (!row) return refuse("This Berth account no longer exists.");
        const rank = rankForXp(row.xp);
        const out = [
          `Rank: ${rank.name}, level ${rank.level} of 10, ${row.xp} XP${rank.nextName ? `, ${rank.span - rank.into} XP to ${rank.nextName}` : ""}.`,
          `Member since ${day(row.created_at)}. Signed in with ${row.email ? "email" : "a wallet"}.`,
        ];
        const spoke = await spokeOf(row);
        if (!spoke) {
          out.push("This account has no EVM address, so it holds nothing on Berth yet.");
          return text(out.join("\n"));
        }
        out.push(`Derived from ${spoke} on Base.`);
        try {
          const holdings = await readHoldings(spoke);
          out.push(
            `Account on Sonic: ${holdings.hubWallet}.`,
            holdings.lines.length === 0
              ? "It holds no listings right now."
              : `It holds ${holdings.lines.length} listing${holdings.lines.length === 1 ? "" : "s"} worth ${usd(holdings.total)} in total${holdings.unpriced ? `, plus ${holdings.unpriced} without a live price` : ""}. get_holdings has the detail.`,
          );
        } catch {
          out.push("The account's holdings could not be read from the chain just now.");
        }
        return text(out.join("\n"));
      }),
  );

  server.registerTool(
    "get_holdings",
    {
      title: "What the account owns",
      description:
        "Every listing the account holds right now, read from the chain: quantity, current price, value in dollars and share of the total. Cash is the Treasury bill fund. Does not include funds still in the person's own wallets on other networks, nor shares in Berth's earlier leveraged vaults, which the app lists separately.",
      inputSchema: z.object({}),
      annotations: { title: "What the account owns", ...READ_ONLY },
      scopeChallenge: requireScopes(SCOPE_READ),
    },
    async (_args, ctx) =>
      guarded("get_holdings", ctx, async () => {
        const auth = needScope(ctx, SCOPE_READ);
        if ("content" in auth) return auth;
        const row = await loadAccountRow(auth.userId);
        const spoke = row ? await spokeOf(row) : null;
        if (!spoke) return text("This account holds nothing on Berth yet.");
        const holdings = await readHoldings(spoke);
        if (holdings.lines.length === 0) return text("The account holds no listings right now.");
        const out = [`Holdings, ${usd(holdings.total)} in total at current prices:`];
        for (const line of holdings.lines) {
          const share = line.value !== undefined && holdings.total > 0 ? `, ${((line.value / holdings.total) * 100).toFixed(1)}% of the total` : "";
          out.push(
            `${named(line.listing)}: ${units(line.quantity)} at ${usd(line.price)}, worth ${line.value !== undefined ? usd(line.value) : "unknown (no live price)"}${share}`,
          );
        }
        return text(out.join("\n"));
      }),
  );

  server.registerTool(
    "get_performance",
    {
      title: "How the money has done",
      description:
        "How the account's money has done over a period, beside the same dollars put into a benchmark on the same days: the S&P 500 fund, the Nasdaq 100 fund, Gold, Bitcoin or Treasury bills. The account's change is time weighted, so money added or taken out does not count as gain or loss. Refuses rather than guesses when the history cannot support a number.",
      inputSchema: z.object({
        period: z
          .enum(["week", "month", "three_months", "since_first_buy"])
          .default("since_first_buy")
          .describe("The window to measure."),
        benchmark: z
          .enum(["sp500", "nasdaq100", "gold", "bitcoin", "treasury_bills"])
          .default("sp500")
          .describe("What to compare with."),
      }),
      annotations: { title: "How the money has done", ...READ_ONLY },
      scopeChallenge: requireScopes(SCOPE_READ),
    },
    async ({ period, benchmark: choice }, ctx) =>
      guarded("get_performance", ctx, async () => {
        const auth = needScope(ctx, SCOPE_READ);
        if ("content" in auth) return auth;
        const row = await loadAccountRow(auth.userId);
        if (!row) return refuse("This Berth account no longer exists.");
        const benchmark = findBenchmark(BENCHMARK_CHOICES[choice])!;
        const history = await loadPortfolioHistory({ userId: row.id, spoke: await spokeOf(row), benchmark });
        const wanted = PERIODS[period];
        const result = history.ranges[wanted.range];
        if (!result || result.days.length === 0) {
          const offered = history.available.length > 0 ? ` Periods with enough history: ${history.available.join(", ")}.` : "";
          return text(`There is not enough history for ${wanted.words} yet.${offered}`);
        }
        const last = result.days.at(-1)!;
        const out = [
          // Since the first buy reads from the first day on record, which can
          // be later than the first buy itself (the daily record began with
          // the evening cron), so the date is named as the record's start.
          period === "since_first_buy" && result.rebasedFrom
            ? `Since ${day(result.rebasedFrom)}, not the first buy: the comparison starts there. ${result.tradingDays} market day${result.tradingDays === 1 ? "" : "s"}.`
            : period === "since_first_buy"
            ? `Since the first buy. Daily values are on record from ${day(result.days[0].day)}, ${result.tradingDays} market day${result.tradingDays === 1 ? "" : "s"}.`
            : `${wanted.words[0].toUpperCase()}${wanted.words.slice(1)}, from ${day(result.since ?? result.days[0].day)}, ${result.tradingDays} market day${result.tradingDays === 1 ? "" : "s"}.`,
          `The account: ${pct(result.changePct)}. The same dollars in ${benchmark.name}: ${pct(result.benchmarkPct)}.`,
          `Value now ${usd(last.value)}${last.benchmark !== null ? `, the ${benchmark.name} line ${usd(last.benchmark)}` : ""}.`,
        ];
        if (result.benchmarkStatus !== "ok" && STATUS_WORDS[result.benchmarkStatus]) out.push(STATUS_WORDS[result.benchmarkStatus]);
        else if (result.rebasedFrom) {
          out.push(
            `Money moved in or out without a Berth order before ${day(result.rebasedFrom)}, so both figures are measured from that day, with only later orders counted as money in or out.`,
          );
        }
        if (result.tradingDays < 20) out.push("Under about twenty market days, a comparison like this is mostly noise.");
        const step = Math.max(1, Math.ceil(result.days.length / 10));
        const sampled = result.days.filter((_, index) => index % step === 0 || index === result.days.length - 1);
        out.push(
          "",
          "Daily values (account, then benchmark line):",
          ...sampled.map((point) => `${day(point.day)}: ${usd(point.value)}${point.benchmark !== null ? `, ${usd(point.benchmark)}` : ""}`),
        );
        return text(out.join("\n"));
      }),
  );

  server.registerTool(
    "get_orders",
    {
      title: "Past orders",
      description: "The account's orders on Berth, newest first: what, how much, what it cost in dollars, and when. Filled orders read as bought or sold; an order placed but not filled says so.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(20).describe("How many of the newest orders to return."),
      }),
      annotations: { title: "Past orders", ...READ_ONLY },
      scopeChallenge: requireScopes(SCOPE_READ),
    },
    async ({ limit }, ctx) =>
      guarded("get_orders", ctx, async () => {
        const auth = needScope(ctx, SCOPE_READ);
        if ("content" in auth) return auth;
        const { total, entries } = await loadOrderLog(auth.userId, limit);
        if (total === 0) return text("No orders yet.");
        const out = [`${total} order${total === 1 ? "" : "s"} in all. Newest first:`];
        for (const order of entries) {
          const listing = TOKEN_LISTINGS.find((candidate) => candidate.symbol === order.symbol);
          const name = listing ? named(listing) : order.symbol;
          const amount = order.quantity !== null ? `${units(order.quantity)} ${name}` : name;
          const money = order.usd !== null ? ` for ${usd(order.usd)}` : "";
          if (order.filled) {
            out.push(`${moment(order.at)}: ${order.direction === "buy" ? "Bought" : "Sold"} ${amount}${money}`);
          } else {
            const verb = order.direction === "buy" ? "a buy of" : "a sell of";
            out.push(`${moment(order.at)}: Placed ${verb} ${amount}${money}, not filled`);
          }
        }
        return text(out.join("\n"));
      }),
  );

  server.registerTool(
    "draft_order",
    {
      title: "Draft a buy or sell",
      description:
        "Prepare a buy or a sell for the person to approve in Berth. Returns a link that opens Berth's order screen with the listing and amount filled in, and a plain summary. Nothing is placed, reserved or sent: the person checks it, chooses what to pay with, and signs in Berth, or closes it. Give usd_amount for a buy; for a sell give usd_amount or quantity, never more than the account holds. The person opens the link to review it in Berth.",
      inputSchema: z.object({
        listing: LISTING_ARG,
        side: z.enum(["buy", "sell"]).describe("buy to spend dollars on the listing, sell to turn some of it back into dollars."),
        usd_amount: z.number().positive().optional().describe("Dollars to spend (buy) or to receive before fees (sell)."),
        quantity: z.number().positive().optional().describe("Units of the listing to sell. Sells only."),
      }),
      annotations: {
        title: "Draft a buy or sell",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      scopeChallenge: requireScopes(SCOPE_DRAFT),
    },
    async ({ listing: query, side, usd_amount, quantity }, ctx) =>
      guarded("draft_order", ctx, async () => {
        const auth = needScope(ctx, SCOPE_DRAFT);
        if ("content" in auth) return auth;
        const listing = findTokenListing(query);
        if (!listing) return refuse(`Berth does not offer "${query}". Call list_listings for what is on the board.`);
        const prices = await liveListingPrices().catch(() => ({}) as Record<string, number>);
        let held: number | undefined;
        if (side === "sell") {
          const row = await loadAccountRow(auth.userId);
          const spoke = row ? await spokeOf(row) : null;
          if (!spoke) held = 0;
          else {
            try {
              const holdings = await readHoldings(spoke);
              held = holdings.lines.find((line) => line.listing.symbol === listing.symbol)?.quantity ?? 0;
            } catch {
              held = undefined;
            }
          }
        }
        const draft = draftOrder(
          { listing: listing.symbol, side, usd: usd_amount, quantity },
          { origin, price: prices[listing.symbol], held, mayReadHoldings: auth.scopes.includes(SCOPE_READ) },
        );
        if (!draft.ok) return refuse(draft.reason);
        const what =
          draft.side === "buy"
            ? `Buy ${usd(draft.usd)} of ${named(draft.listing)}`
            : draft.quantity !== undefined
              ? `Sell ${units(draft.quantity)} ${named(draft.listing)}${draft.approxUsd !== undefined ? `, about ${usd(draft.approxUsd)} at ${usd(prices[listing.symbol])}` : ""}`
              : `Sell ${usd(draft.usd)} of ${named(draft.listing)}`;
        return text(
          [
            `Draft: ${what}.`,
            `Open in Berth to review and sign: ${draft.url}`,
            "Nothing has happened yet. The order is only placed if the person opens this link, checks the amount and what they pay with, and signs in Berth. The price is set when they sign, and a Berth fee applies.",
          ].join("\n"),
        );
      }),
  );
}
