import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FIRST_LOOK_QUERY_KEY } from "@/hooks/use-first-look";
import { FIRST_LOOK_SYMBOLS, type FirstLookResponse } from "@/lib/first-look";
import { STOCK_LISTINGS } from "@/lib/listings";
import type { StoryCard } from "@/lib/news-stories";

// The tile's module reaches the wallet SDKs, which do not load under node.
vi.mock("@/components/board/holdings-list", () => ({ TickerTile: () => null }));
const { FirstLookReadingView, FirstStockCard } = await import("./first-look");

/**
 * The first look, as markup: only Berth's fixed lines, never a headline,
 * a post, a source or an X link; "nothing in today's news" only when Jev
 * looked; no box when there is nothing true to say; a held place while
 * loading; the news note only where news is linked.
 */

const nvidia = STOCK_LISTINGS.find((listing) => listing.symbol === "NVDA")!;
const tesla = STOCK_LISTINGS.find((listing) => listing.symbol === "TSLA")!;
const amazon = STOCK_LISTINGS.find((listing) => listing.symbol === "AMZN")!;
const noop = () => {};

/** The drawer's card a look attaches (lib/news-stories). */
function storyAbout(symbol: string, over: Partial<StoryCard> = {}): StoryCard {
  return {
    id: `s-${symbol}`,
    storyId: symbol.length,
    kind: "article",
    title: "Nvidia agrees to supply chips for OpenAI's new data centres",
    url: "https://example.com/a",
    publisher: "Reuters",
    publishedAt: Date.now() - 2 * 60 * 60 * 1000,
    symbol,
    name: symbol,
    symbols: [symbol],
    verdict: "fact",
    about: 0.92,
    readings: {},
    alsoReportedBy: [],
    alsoOnX: [],
    ...over,
  };
}

function view(props: Parameters<typeof FirstLookReadingView>[0]) {
  return renderToStaticMarkup(createElement(FirstLookReadingView, props));
}

describe("FirstLookReadingView", () => {
  it("shows today's line with its one headline inline, and a way to more news in the drawer", () => {
    const html = view({ listing: nvidia, look: { kind: "shown", look: { looked: true, inNews: true, story: storyAbout("NVDA") } }, onReadNews: noop });
    expect(html).toContain("NVIDIA is in today&#x27;s news.");
    expect(html).toContain("Nvidia agrees to supply chips for OpenAI&#x27;s new data centres");
    expect(html).toContain("Reuters, 2 hours ago");
    expect(html).toContain("More news about NVIDIA");
    expect(html).toContain("News to read, not advice.");
    // The headline and "more" open a panel in Berth: buttons that say so, never a link out.
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("example.com");
    expect(html).not.toContain("x.com");
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(2);
    expect(html).toContain("Opens the news panel in Berth");
  });

  it("marks the headline as news, with its source and time and the not advice line straight under it, before any move", () => {
    const html = view({ listing: nvidia, look: { kind: "shown", look: { looked: true, inNews: true, movePct: 4, story: storyAbout("NVDA") } }, onReadNews: noop });
    const at = (text: string) => html.indexOf(text);
    expect(html).toMatch(/>News<\/span>/);
    expect(at(">News</span>")).toBeLessThan(at("Nvidia agrees to supply chips"));
    expect(at("Nvidia agrees to supply chips")).toBeLessThan(at("Reuters, 2 hours ago"));
    expect(at("Reuters, 2 hours ago")).toBeLessThan(at("News to read, not advice."));
    expect(at("News to read, not advice.")).toBeLessThan(at("NVIDIA rose 4.0%"));
    // Without a drawer the headline is plain text, and still labelled.
    const plain = view({ listing: nvidia, look: { kind: "shown", look: { looked: true, inNews: true, story: storyAbout("NVDA") } } });
    expect(plain).toMatch(/>News<\/span>/);
    expect(plain).toContain("News to read, not advice.");
  });

  it("says the week's news, never today, when what passed is older than today", () => {
    const html = view({
      listing: nvidia,
      look: { kind: "shown", look: { looked: false, inNews: false, inNewsWeek: true, story: storyAbout("NVDA") } },
      onReadNews: noop,
    });
    expect(html).toContain("NVIDIA was in the news this past week.");
    expect(html).not.toContain("today");
    expect(html).toContain("More news about NVIDIA");
  });

  it("claims no news it has no headline for", () => {
    const html = view({ listing: nvidia, look: { kind: "shown", look: { looked: true, inNews: true, inNewsWeek: true, movePct: 4 } }, onReadNews: noop });
    expect(html).not.toContain("news");
    expect(html).not.toContain("not advice");
    expect(html).toContain("NVIDIA rose 4.0%");
  });

  it("never says nothing in the news, with no credit and no advice note", () => {
    const html = view({ listing: nvidia, look: { kind: "shown", look: { looked: false, inNews: false, movePct: 1 } }, onReadNews: noop });
    expect(html).not.toContain("Nothing");
    expect(html).not.toContain("news about");
    expect(html).not.toContain("Jev");
    expect(html).not.toContain("TypeSafe");
    expect(html).not.toContain("More news");
    expect(html).not.toContain("not advice");
  });

  it("says a large move in code's numbers, with no cause and no post", () => {
    const html = view({ listing: tesla, look: { kind: "shown", look: { looked: false, inNews: false, movePct: -3.6 } }, onAsk: noop });
    expect(html).toContain("Tesla fell 3.6% on the last trading day, more than it usually moves.");
    expect(html).not.toContain("news about");
    expect(html).not.toContain("Jev");
    expect(html).toContain("Ask about Tesla");
  });

  it("shows nothing at all when there is nothing true to say", () => {
    expect(view({ listing: nvidia, look: { kind: "hidden" } })).toBe("");
  });

  it("holds the place while the answer comes, without words", () => {
    const html = view({ listing: nvidia, look: { kind: "loading" } });
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("NVIDIA");
  });

  it("never uses a dash as punctuation", () => {
    const html = view({ listing: nvidia, look: { kind: "shown", look: { looked: true, inNews: true, movePct: 2 } }, onReadNews: noop });
    expect(html).not.toMatch(/ [-\u2013\u2014] /);
  });
});

function card(listing: typeof nvidia, seed?: { key: readonly unknown[]; data: FirstLookResponse }) {
  const client = new QueryClient();
  if (seed) client.setQueryData(seed.key, seed.data);
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(FirstStockCard, { listing, onDismiss: noop, onReadNews: noop })),
  );
}

const looked = Object.fromEntries(
  FIRST_LOOK_SYMBOLS.map((symbol) => [symbol, { looked: true, inNews: true, inNewsWeek: true, story: storyAbout(symbol) }]),
);

describe("FirstStockCard", () => {
  it("says what the stock is and the look's fixed line", () => {
    const html = card(nvidia, { key: FIRST_LOOK_QUERY_KEY, data: { judged: true, asOf: Date.now(), looks: looked } });
    expect(html).toContain("Your first stock");
    expect(html).toContain("NVIDIA is in your account as a token that tracks its share price.");
    expect(html).toContain("NVIDIA is in today&#x27;s news.");
    expect(html).toContain("Got it");
  });

  it("asks about a stock outside the examples on its own, and says nothing of it where it was not read", () => {
    const html = card(amazon, { key: [...FIRST_LOOK_QUERY_KEY, "AMZN"], data: { judged: true, asOf: Date.now(), looks: looked } });
    expect(html).toContain("Your first stock");
    expect(html).not.toContain("news about");
  });

  it("says nothing of the news while Jev is not configured", () => {
    const html = card(nvidia, { key: FIRST_LOOK_QUERY_KEY, data: { judged: false, asOf: Date.now(), looks: {} } });
    expect(html).not.toContain("news about");
  });
});
