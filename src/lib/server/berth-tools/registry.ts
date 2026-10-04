import { z } from "zod";
import type { Availability } from "@/lib/availability";
import { COPY } from "@/lib/copy";
import { findBenchmark } from "@/lib/benchmarks";
import { draftOrder, findTokenListing, type DraftSummary } from "@/lib/draft-order";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { isNotableMove } from "@/lib/moves";
import { rankForXp } from "@/lib/xp";
import { loadPerformance } from "@/lib/server/listing-performance";
import { loadListingNews } from "@/lib/server/listing-news";
import { loadListingX } from "@/lib/server/listing-x";
import { gatherPosts } from "@/lib/server/x-column";
import { loadMoves } from "@/lib/server/moves";
import { loadFilings } from "@/lib/server/news-read";
import { SCOPE_DRAFT, SCOPE_READ } from "@/lib/server/oauth/config";
import { loadOrderLog } from "@/lib/server/order-marks";
import { limitOrdersOn } from "@/lib/server/limit-orders";
import { liveListingPrices } from "@/lib/server/portfolio";
import { loadPortfolioHistory } from "@/lib/server/portfolio-view";
import { ago, clip, day, moment, named, pct, units, usd } from "@/lib/server/mcp/text";
import { MIN_ORDER_USD } from "@/lib/order-minimum";
import { friendsBoard } from "@/lib/server/social/board";
import { readCardOf } from "@/lib/server/social/cards";
import { listFriends } from "@/lib/server/social/friends";
import { mySocial } from "@/lib/server/social/handles";
import {
  BENCHMARK_CHOICES,
  PERIODS,
  STATUS_WORDS,
  loadAccountRow,
  readHoldings,
  spokesOf,
} from "@/lib/server/berth-tools/account";

/**
 * The Berth tools, defined once for both doors: the MCP server an
 * assistant connects to (lib/server/mcp/tools, app/mcp) and the in-app
 * chat (lib/server/chat/tools, app/api/chat). Every one reads, except
 * draft_order, which prepares an order the person opens, checks and signs
 * in Berth. None can move money, because nothing on this server holds a key.
 *
 * Each tool reuses the function the app's own route uses, so an assistant
 * sees exactly what the person sees. Output is compact text written for a
 * model to read and retell: names before tickers, dollars as dollars, and a
 * plain line when something could not be read rather than a guess.
 *
 * A tool never checks scopes itself: the door does (MCP asks the token; the
 * chat's own session is the grant), then hands `run` whom it speaks for.
 * The one difference between the doors is inside the output: on the chat,
 * text written by third parties (X posts, headlines, names, handles,
 * sources and their links) is
 * wrapped in <untrusted> so the system prompt can say what that means, and
 * a draft comes back as a structured card instead of a link.
 */

export type ToolSurface = "mcp" | "chat";

export type ToolContext = {
  /** The account the call speaks for; null only on a public tool called without one. */
  userId: string | null;
  scopes: readonly string[];
  /** Where Berth is served, for the draft link. */
  origin: string;
  surface: ToolSurface;
  /**
   * Whether Berth can start something new where the person is
   * (lib/server/availability). Only the chat knows: its request comes from
   * the person's own browser. On MCP the request comes from the
   * assistant's servers, whose country says nothing about the person, so
   * it is absent there and the draft link lands on the same soft landing
   * when opened. Absent reads as available.
   */
  availability?: Availability;
};

/** Whether a draft that starts something (a buy) is refused here: sells never are. */
function refusedHere(ctx: ToolContext): boolean {
  return ctx.availability?.available === false;
}

/** A draft as the chat renders it: server-validated values, never the model's prose. */
export type DraftCard = DraftSummary;

export type ToolOutput = { text: string; isError?: boolean; draft?: DraftCard };

export type ToolAnnotations = {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export type BerthTool<S extends z.ZodObject = z.ZodObject> = {
  name: string;
  title: string;
  description: string;
  input: S;
  annotations: ToolAnnotations;
  /** The scope a call needs, or null for a public read of the market. */
  scope: typeof SCOPE_READ | typeof SCOPE_DRAFT | null;
  run: (args: z.output<S>, ctx: ToolContext) => Promise<ToolOutput>;
};

function defineTool<S extends z.ZodObject>(tool: BerthTool<S>): BerthTool<S> {
  return tool;
}

const ok = (text: string): ToolOutput => ({ text });
const no = (text: string): ToolOutput => ({ text, isError: true });

/** The account a scoped tool speaks for. The door guarantees one before `run`. */
function userOf(ctx: ToolContext): string {
  if (!ctx.userId) throw new Error("scoped tool called without an account");
  return ctx.userId;
}

/**
 * Text someone other than Berth wrote. On the chat it is fenced, with its
 * angle brackets escaped so it cannot close the fence; on MCP it passes as
 * it always has.
 */
export function said(ctx: ToolContext, source: "x" | "news", body: string): string {
  if (ctx.surface !== "chat") return body;
  return `<untrusted source="${source}">${body.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</untrusted>`;
}

const LISTING_ARG = z
  .string()
  .min(1)
  .max(60)
  .describe('A listing on the board, by ticker or name, e.g. "NVDA" or "NVIDIA". list_listings has them all.');

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const unknownListing = (query: string) => no(`Berth does not offer "${query}". Call list_listings for what is on the board.`);

const listListings = defineTool({
  name: "list_listings",
  title: "List what Berth offers",
  description:
    "Every stock, fund and the cash fund on Berth's board, with the current price and the change over the last trading day. Prices are the solver oracle's, the ones an order would be filled against. Use the ticker or name from here in the other tools.",
  input: z.object({}),
  annotations: { title: "List what Berth offers", ...READ_ONLY },
  scope: null,
  run: async () => {
    const [prices, performance] = await Promise.all([
      liveListingPrices().catch(() => ({}) as Record<string, number>),
      loadPerformance().catch(() => ({ performance: {} }) as Awaited<ReturnType<typeof loadPerformance>>),
    ]);
    const lines = TOKEN_LISTINGS.map((listing) => {
      const kind = listing.kind === "cash" ? "cash (a Treasury bill fund)" : listing.category === "etf" ? "fund" : "stock";
      const change = performance.performance[listing.symbol]?.changePct;
      return `${named(listing)}, ${kind}: ${usd(prices[listing.symbol])}, ${pct(change)} on the last trading day`;
    });
    return ok(
      [`${TOKEN_LISTINGS.length} listings on Berth: tokens that track US stocks and funds, issued by third parties and held on Sonic, bought with stablecoins, ETH, SOL or Bitcoin from more than 20 networks.`, ...lines].join("\n"),
    );
  },
});

/** The reading of a post in words the assistant can pass on. */
const VERDICT_WORDS = { material: "material news", fact: "a new fact", analysis: "analysis" } as const;
function readAs(verdict: keyof typeof VERDICT_WORDS | undefined): string {
  return verdict ? `, read as ${VERDICT_WORDS[verdict]}` : "";
}
function alsoBy(ctx: ToolContext, others: { name: string }[] | undefined): string {
  return others && others.length > 0 ? `, also posted by ${others.map((other) => said(ctx, "x", other.name)).join(", ")}` : "";
}

const getListing = defineTool({
  name: "get_listing",
  title: "Look at one listing",
  description:
    "One listing in detail: its price, its recent daily closes and change, whether its last move was large for it and the post that reported it, recent headlines, its latest SEC filings, and the most substantial recent posts on X about it (read and ranked for relevance).",
  input: z.object({ listing: LISTING_ARG }),
  annotations: { title: "Look at one listing", ...READ_ONLY, openWorldHint: true },
  scope: null,
  run: async ({ listing: query }, ctx) => {
    const listing = findTokenListing(query);
    if (!listing) return unknownListing(query);
    // One performance read, shared by the moves and the price lines.
    const performanceRead = loadPerformance();
    performanceRead.catch(() => undefined);
    const [prices, performance, moves, news, posts, filings] = await Promise.all([
      liveListingPrices().catch(() => ({}) as Record<string, number>),
      performanceRead.catch(() => undefined),
      loadMoves({ performance: performanceRead }).catch(() => ({ moves: [] })),
      loadListingNews(listing.symbol).catch(() => ({ items: [] })),
      loadListingX(listing.symbol, gatherPosts()).catch(() => ({ items: [], reserve: [] })),
      loadFilings(listing.symbol).catch(() => []),
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
    if (move) out.push(`Around that move, ${said(ctx, "x", move.post.name)} (@${said(ctx, "x", move.post.username)}) posted: ${said(ctx, "x", clip(move.post.text))} ${said(ctx, "x", move.post.url)}`);
    if (news.items.length > 0) {
      out.push("", "Headlines:");
      for (const item of news.items.slice(0, 5)) out.push(`${said(ctx, "news", item.title)} (${said(ctx, "news", item.source)}, ${ago(item.publishedAt)}${readAs(item.verdict)}) ${said(ctx, "news", item.url)}`);
    }
    if (filings.length > 0) {
      out.push("", "Filed with the SEC (public record, from EDGAR):");
      for (const filing of filings.slice(0, 3)) out.push(`Form ${said(ctx, "news", filing.form ?? "")}, ${day(filing.day)}${filing.url ? ` ${said(ctx, "news", filing.url)}` : ""}`);
    }
    if (posts.items.length > 0) {
      out.push("", "On X:");
      for (const post of posts.items.slice(0, 5)) {
        out.push(
          `${said(ctx, "x", post.author.name)} (@${said(ctx, "x", post.author.username)}), ${ago(post.publishedAt)}${readAs(post.verdict)}${alsoBy(ctx, post.alsoBy)}: ${said(ctx, "x", clip(post.text))} ${said(ctx, "x", post.url)}`,
        );
      }
    }
    return ok(out.join("\n"));
  },
});

const getMoves = defineTool({
  name: "get_moves",
  title: "What moved",
  description:
    "Every listing's change over the last trading day, largest first, marking the moves that were large for that listing (at least twice its usual day and 1%) and, where one was found, the post from around that day that reported something related. Never a cause, only what was being said.",
  input: z.object({}),
  annotations: { title: "What moved", ...READ_ONLY, openWorldHint: true },
  scope: null,
  run: async (_args, ctx) => {
    const [performance, moves] = await Promise.all([loadPerformance(), loadMoves().catch(() => ({ moves: [] }))]);
    const rows = TOKEN_LISTINGS.map((listing) => ({ listing, entry: performance.performance[listing.symbol] }))
      .filter((row) => row.entry?.changePct !== undefined)
      .sort((a, b) => Math.abs(b.entry!.changePct!) - Math.abs(a.entry!.changePct!));
    if (rows.length === 0) return ok("No listing has two recent closes to compare right now.");
    const asOf = rows[0].entry?.seriesDates?.at(-1);
    const out = [`Change over the last trading day${asOf ? `, to the close of ${day(asOf)}` : ""}:`];
    for (const { listing, entry } of rows) {
      const notable = isNotableMove(entry!.series ?? [], entry!.changePct);
      const move = moves.moves.find((candidate) => candidate.symbol === listing.symbol);
      out.push(
        `${named(listing)}: ${pct(entry!.changePct)}${notable ? ", large for it" : ""}${move ? `. In the news: ${said(ctx, "x", move.post.name)}: ${said(ctx, "x", clip(move.post.text))} ${said(ctx, "x", move.post.url)}` : ""}`,
      );
    }
    const unclean = TOKEN_LISTINGS.filter((listing) => performance.performance[listing.symbol]?.noCleanClose);
    for (const listing of unclean) out.push(`${named(listing)}: no clean close the day before, so no change is given.`);
    return ok(out.join("\n"));
  },
});

const getMarketFeed = defineTool({
  name: "get_market_feed",
  title: "What is being said",
  description:
    "Berth's live market column: recent posts on X about the listings, from the companies and a press list, each kept only if it reports something. Optionally narrowed to one listing.",
  input: z.object({ listing: LISTING_ARG.optional() }),
  annotations: { title: "What is being said", ...READ_ONLY, openWorldHint: true },
  scope: null,
  run: async ({ listing: query }, ctx) => {
    const listing = query ? findTokenListing(query) : undefined;
    if (query && !listing) return unknownListing(query);
    const feed = await loadListingX(listing?.symbol);
    if (feed.items.length === 0) return ok("Nothing substantial has been posted in the last while.");
    const out = feed.curation
      ? [`${feed.curation.kept} of ${feed.curation.seen} posts this week were kept. Newest and most substantial first:`]
      : ["Newest and most substantial first:"];
    for (const post of feed.items) {
      out.push(
        `About ${post.name}: ${said(ctx, "x", post.author.name)} (@${said(ctx, "x", post.author.username)}), ${ago(post.publishedAt)}${readAs(post.verdict)}${alsoBy(ctx, post.alsoBy)}. ${said(ctx, "x", clip(post.text))} ${said(ctx, "x", post.url)}`,
      );
    }
    return ok(out.join("\n"));
  },
});

const getAccount = defineTool({
  name: "get_account",
  title: "The Berth account",
  description:
    "The signed in person's Berth account: its rank and XP, the address it is derived from and the account address on Sonic where holdings live, and what it holds in total at current prices.",
  input: z.object({}),
  annotations: { title: "The Berth account", ...READ_ONLY },
  scope: SCOPE_READ,
  run: async (_args, ctx) => {
    const row = await loadAccountRow(userOf(ctx));
    if (!row) return no("This Berth account no longer exists.");
    const rank = rankForXp(row.xp);
    const out = [
      `Rank: ${rank.name}, level ${rank.level} of 10, ${row.xp} XP${rank.nextName ? `, ${rank.span - rank.into} XP to ${rank.nextName}` : ""}.`,
      `Member since ${day(row.created_at)}. Signed in with ${row.email ? "email" : "a wallet"}.`,
    ];
    const spokes = await spokesOf(row);
    if (!spokes.home) {
      out.push("This account has no EVM address, so it holds nothing on Berth yet.");
      return ok(out.join("\n"));
    }
    const others = spokes.all.filter((address) => address !== spokes.home);
    out.push(
      others.length === 0
        ? `Derived from ${spokes.home} on Base.`
        : `Derived from ${spokes.home} on Base, its home address, where buys land. ${others.length} more linked address${others.length === 1 ? "" : "es"}: ${others.join(", ")}. Each has its own account on Sonic, and the totals add them all.`,
    );
    try {
      const holdings = await readHoldings(spokes.all);
      out.push(
        holdings.hubWallets.length === 1
          ? `Account on Sonic: ${holdings.hubWallet}.`
          : `Accounts on Sonic: ${holdings.hubWallets.join(", ")}, the first is home.`,
        holdings.lines.length === 0
          ? "It holds no listings right now."
          : `It holds ${holdings.lines.length} listing${holdings.lines.length === 1 ? "" : "s"} worth ${usd(holdings.total)} in total${holdings.unpriced ? `, plus ${holdings.unpriced} without a live price` : ""}. get_holdings has the detail.`,
      );
    } catch {
      out.push("The account's holdings could not be read from the chain just now.");
    }
    return ok(out.join("\n"));
  },
});

const getHoldings = defineTool({
  name: "get_holdings",
  title: "What the account owns",
  description:
    "Every listing the account holds right now, read from the chain: quantity, current price, value in dollars and share of the total. Cash is the Treasury bill fund. Does not include funds still in the person's own wallets on other networks, nor shares in Berth's earlier leveraged vaults, which the app lists separately.",
  input: z.object({}),
  annotations: { title: "What the account owns", ...READ_ONLY },
  scope: SCOPE_READ,
  run: async (_args, ctx) => {
    const row = await loadAccountRow(userOf(ctx));
    const spokes = row ? (await spokesOf(row)).all : [];
    if (spokes.length === 0) return ok("This account holds nothing on Berth yet.");
    const holdings = await readHoldings(spokes);
    if (holdings.lines.length === 0) return ok("The account holds no listings right now.");
    const out = [`Holdings, ${usd(holdings.total)} in total at current prices:`];
    for (const line of holdings.lines) {
      const share = line.value !== undefined && holdings.total > 0 ? `, ${((line.value / holdings.total) * 100).toFixed(1)}% of the total` : "";
      out.push(
        `${named(line.listing)}: ${units(line.quantity)} at ${usd(line.price)}, worth ${line.value !== undefined ? usd(line.value) : "unknown (no live price)"}${share}`,
      );
    }
    return ok(out.join("\n"));
  },
});

const getPerformance = defineTool({
  name: "get_performance",
  title: "How the money has done",
  description:
    "How the account's money has done over a period, beside the same dollars put into a benchmark on the same days: the S&P 500 ETF, the Nasdaq 100 ETF, Gold, Bitcoin or Treasury bills. The account's change is time weighted, so money added or taken out does not count as gain or loss. Refuses rather than guesses when the history cannot support a number.",
  input: z.object({
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
  scope: SCOPE_READ,
  run: async ({ period, benchmark: choice }, ctx) => {
    const row = await loadAccountRow(userOf(ctx));
    if (!row) return no("This Berth account no longer exists.");
    const benchmark = findBenchmark(BENCHMARK_CHOICES[choice])!;
    const history = await loadPortfolioHistory({ userId: row.id, spokes: (await spokesOf(row)).all, benchmark });
    const wanted = PERIODS[period];
    const result = history.ranges[wanted.range];
    if (!result || result.days.length === 0) {
      const offered = history.available.length > 0 ? ` Periods with enough history: ${history.available.join(", ")}.` : "";
      return ok(`There is not enough history for ${wanted.words} yet.${offered}`);
    }
    const last = result.days.at(-1)!;
    const out = [
      // Since the first buy reads from the first buy's close, unless no day
      // before a later one is stored (the daily record began with the
      // evening cron, and the gap is rebuilt from the orders only when they
      // explain the first snapshot): then the record's start is named.
      period === "since_first_buy" && result.rebasedFrom
        ? `Since ${day(result.rebasedFrom)}, not the first buy: the comparison starts there. ${result.tradingDays} market day${result.tradingDays === 1 ? "" : "s"}.`
        : period === "since_first_buy" && result.recordFrom
        ? `Since the first buy. Daily values are on record from ${day(result.recordFrom)}, ${result.tradingDays} market day${result.tradingDays === 1 ? "" : "s"}.`
        : period === "since_first_buy"
        ? `Since the first buy on ${day(result.since ?? result.days[0].day)}, ${result.tradingDays} market day${result.tradingDays === 1 ? "" : "s"}.`
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
    return ok(out.join("\n"));
  },
});

const getOrders = defineTool({
  name: "get_orders",
  title: "Past orders",
  description: "The account's orders on Berth, newest first: what, how much, what it cost in dollars, and when. Filled orders read as bought or sold; an order placed but not filled says so.",
  input: z.object({
    limit: z.number().int().min(1).max(100).default(20).describe("How many of the newest orders to return."),
  }),
  annotations: { title: "Past orders", ...READ_ONLY },
  scope: SCOPE_READ,
  run: async ({ limit }, ctx) => {
    const { total, entries } = await loadOrderLog(userOf(ctx), limit);
    if (total === 0) return ok("No orders yet.");
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
    return ok(out.join("\n"));
  },
});

/** "2026-09" as a person reads it: "September 2026". */
function monthWords(month: string): string {
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year, index - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/*
 * The two social reads. Each answers for the signed in account only: its own
 * card and its own friends board. No tool looks up another username, reads
 * another person's Salutes or friends, or writes anything social (a Salute,
 * a request, a block). Usernames are 3 to 20 of a-z, 0-9 and underscore, so
 * the names in this output cannot carry an instruction.
 */

const getMyProfile = defineTool({
  name: "get_my_profile",
  title: "Your Berth card",
  description:
    "The signed in person's own Berth card: their username, whether the card can be found, their rank and XP, the month they joined, how many Salutes they have, and how many friends and waiting friend requests they have, and whether their switch to let friends see which stocks and funds they hold is on. A card never shows money or wallets; holdings, as listing names only, only to friends when both turned that switch on. Cannot look up anyone else.",
  input: z.object({}),
  annotations: { title: "Your Berth card", ...READ_ONLY },
  scope: SCOPE_READ,
  run: async (_args, ctx) => {
    const row = await loadAccountRow(userOf(ctx));
    if (!row) return no("This Berth account no longer exists.");
    const viewer = { id: row.id, email: row.email };
    const social = await mySocial(viewer);
    const rank = rankForXp(row.xp);
    if (!social.handle) {
      return ok(
        [
          "No username yet, so this account has no card and nobody can find it.",
          social.hasEmail
            ? "A username is picked in Berth, in the account drawer."
            : "A username needs a verified email first; one can be added in Berth, in the account drawer.",
          `Rank: ${rank.name}, level ${rank.level} of 10, ${row.xp} XP.`,
        ].join("\n"),
      );
    }
    const [card, friends] = await Promise.all([readCardOf(viewer, row.id), listFriends(viewer)]);
    const salutes = card.found ? card.card.salutes : 0;
    return ok(
      [
        `Username: ${social.handle}. Card: ${ctx.origin}/u/${social.handle}`,
        social.visible
          ? "The card can be opened by anyone who knows the name. It shows the username, face, rank, XP, the month they joined and the Salutes count. To a friend who also shares, it also lists which stocks and funds this person holds, by name, never how much, if their switch is on."
          : "The card is hidden: to everyone else the name answers as if no one had it.",
        `Rank: ${rank.name}, level ${rank.level} of 10, ${row.xp} XP. Member since ${monthWords(card.found ? card.card.memberSince : new Date(row.created_at).toISOString().slice(0, 7))}.`,
        `Salutes: ${salutes}.`,
        social.shareHoldings
          ? "Friends who share can see which stocks and funds you hold: on. Only the names, never how much, and only to friends who turned it on too."
          : "Friends who share can see which stocks and funds you hold: off. No friend sees what this person holds.",
        `Friends: ${friends.friends.length}. Waiting for your answer: ${friends.incoming.length}. Sent by you, not yet answered: ${friends.outgoing.length}.`,
        social.nextChangeAt ? `The username can change again from ${day(social.nextChangeAt)}.` : "The username can be changed now, once per 30 days.",
      ].join("\n"),
    );
  },
});

const getFriendsBoard = defineTool({
  name: "get_friends_board",
  title: "Your friends board",
  description:
    "The signed in person's friends board for this calendar month: them and their friends, ranked on board points. Points are this month's XP with XP from orders capped at 300 and XP from invited friends capped at 250, plus at most 10 for Salutes first given to them this month. Never money, returns or holdings, and never anyone outside their friends.",
  input: z.object({}),
  annotations: { title: "Your friends board", ...READ_ONLY },
  scope: SCOPE_READ,
  run: async (_args, ctx) => {
    const row = await loadAccountRow(userOf(ctx));
    if (!row) return no("This Berth account no longer exists.");
    const viewer = { id: row.id, email: row.email };
    const social = await mySocial(viewer);
    if (!social.handle) return ok("No username yet, so there are no friends and no board. A username is picked in Berth, in the account drawer.");
    const board = await friendsBoard(viewer);
    const out = [
      `Friends board, ${monthWords(board.month)}. Points are this month's XP with order XP capped at 300 and invite XP at 250, plus at most 10 for Salutes received this month. Money and returns never count.`,
    ];
    for (const entry of board.rows) {
      const rank = rankForXp(entry.xp);
      out.push(
        `${entry.place}. ${entry.handle}${entry.you ? " (you)" : ""}, ${rank.name}: ${entry.points} points (${entry.orderXp} from orders, ${entry.referralXp} from invites, ${entry.otherXp} other XP, ${entry.salutePoints} from Salutes)`,
      );
    }
    if (board.rows.length === 1) out.push("No friends on the board yet.");
    return ok(out.join("\n"));
  },
});

const draftOrderTool = defineTool({
  name: "draft_order",
  title: "Draft a buy or sell",
  description:
    `Prepare a buy or a sell for the person to approve in Berth. Returns a link that opens Berth's order screen with the listing and amount filled in, and a plain summary. Nothing is placed, reserved or sent: the person checks it, chooses what to pay with, and signs in Berth, or closes it. Give usd_amount for a buy; for a sell give usd_amount or quantity, never more than the account holds. The smallest order, either way, is ${usd(MIN_ORDER_USD)}. The person opens the link to review it in Berth. Where the account has limit orders switched on, order_type "limit" with limit_price drafts an order that waits for that price instead of filling now, until cancelled or until expires.`,
  input: z.object({
    listing: LISTING_ARG,
    side: z.enum(["buy", "sell"]).describe("buy to spend dollars on the listing, sell to turn some of it back into dollars."),
    usd_amount: z.number().positive().optional().describe(`Dollars to spend (buy) or to receive before fees (sell), at least ${usd(MIN_ORDER_USD)}.`),
    quantity: z.number().positive().optional().describe("Units of the listing to sell. Sells only."),
    order_type: z
      .enum(["market", "limit"])
      .optional()
      .describe('"market" (the default) fills now at the market. "limit" waits for limit_price; only on accounts with limit orders switched on, refused elsewhere.'),
    limit_price: z
      .number()
      .positive()
      .optional()
      .describe("Limit orders only: dollars per share. A buy fills at this price or lower, a sell at this price or higher."),
    expires: z
      .string()
      .optional()
      .describe('Limit orders only: the last day the order waits, as "YYYY-MM-DD". Leave it out to wait until cancelled.'),
  }),
  annotations: {
    title: "Draft a buy or sell",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: SCOPE_DRAFT,
  run: async ({ listing: query, side, usd_amount, quantity, order_type, limit_price, expires }, ctx) => {
    const userId = userOf(ctx);
    if (side === "buy" && refusedHere(ctx)) return no(COPY.unavailable.draftRefused);
    const listing = findTokenListing(query);
    if (!listing) return unknownListing(query);
    const prices = await liveListingPrices().catch(() => ({}) as Record<string, number>);
    // The switch (LIMIT_ORDERS_USERS): read only when a limit is asked for.
    let limitAllowed = false;
    if (order_type === "limit") {
      const row = await loadAccountRow(userId).catch(() => null);
      limitAllowed = !!row && limitOrdersOn([row.id, row.wallet_address]);
    }
    let held: number | undefined;
    if (side === "sell") {
      const row = await loadAccountRow(userId);
      const spokes = row ? (await spokesOf(row)).all : [];
      if (spokes.length === 0) held = 0;
      else {
        try {
          const holdings = await readHoldings(spokes);
          held = holdings.lines.find((line) => line.listing.symbol === listing.symbol)?.quantity ?? 0;
        } catch {
          held = undefined;
        }
      }
    }
    const draft = draftOrder(
      { listing: listing.symbol, side, usd: usd_amount, quantity, orderType: order_type, limitPrice: limit_price, expires },
      { origin: ctx.origin, price: prices[listing.symbol], held, mayReadHoldings: ctx.scopes.includes(SCOPE_READ), limitAllowed },
    );
    if (!draft.ok) return no(draft.reason);
    const isLimit = draft.limitPrice !== undefined;
    const market =
      draft.side === "buy"
        ? `Buy ${usd(draft.usd)} of ${named(draft.listing)}`
        : draft.quantity !== undefined
          ? `Sell ${units(draft.quantity)} ${named(draft.listing)}${!isLimit && draft.approxUsd !== undefined ? `, about ${usd(draft.approxUsd)} at ${usd(prices[listing.symbol])}` : ""}`
          : `Sell ${usd(draft.usd)} of ${named(draft.listing)}`;
    const what = isLimit
      ? `${market} at ${usd(draft.limitPrice!)} or ${draft.side === "buy" ? "lower" : "higher"}, ${draft.expires ? `until the end of ${day(draft.expires)}` : "until cancelled"}${prices[listing.symbol] !== undefined ? ` (now ${usd(prices[listing.symbol])})` : ""}`
      : market;
    const nothingYet = isLimit
      ? "Nothing has happened yet. The order is only placed if the person opens it, checks the price, the amount and what they pay with, and signs in Berth. It then waits in SODAX's contract until the price is reached or they cancel it, and a Berth fee applies."
      : undefined;
    if (ctx.surface === "chat") {
      return {
        text: [
          `Draft: ${what}.`,
          "The person sees it as a card under your answer, with a button that opens Berth's order screen filled in. Do not write a link.",
          nothingYet ??
            "Nothing has happened yet. The order is only placed if the person opens the card, checks the amount and what they pay with, and signs. The price is set when they sign, and a Berth fee applies.",
        ].join("\n"),
        draft: {
          symbol: draft.listing.symbol,
          name: draft.listing.name,
          side: draft.side,
          usd: draft.usd,
          quantity: draft.quantity,
          approxUsd: draft.approxUsd,
          ...(isLimit && { limitPrice: draft.limitPrice, ...(draft.expires && { expires: draft.expires }) }),
        },
      };
    }
    return ok(
      [
        `Draft: ${what}.`,
        `Open in Berth to review and sign: ${draft.url}`,
        nothingYet ??
          "Nothing has happened yet. The order is only placed if the person opens this link, checks the amount and what they pay with, and signs in Berth. The price is set when they sign, and a Berth fee applies.",
      ].join("\n"),
    );
  },
});

/** The eleven tools, in the order both doors list them. */
export const BERTH_TOOLS = [
  listListings,
  getListing,
  getMoves,
  getMarketFeed,
  getAccount,
  getHoldings,
  getPerformance,
  getOrders,
  getMyProfile,
  getFriendsBoard,
  draftOrderTool,
] as const;

/** The registry's names, checked against the shared list the client's copy is keyed on (lib/berth-tool-names). */
export const REGISTRY_TOOL_NAMES: readonly string[] = BERTH_TOOLS.map((tool) => tool.name);
