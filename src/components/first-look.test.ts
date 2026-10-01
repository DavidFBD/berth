import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FIRST_LOOK_QUERY_KEY } from "@/hooks/use-first-look";
import { FIRST_LOOK_SYMBOLS, type FirstLookResponse } from "@/lib/first-look";
import { STOCK_LISTINGS } from "@/lib/listings";

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

function view(props: Parameters<typeof FirstLookReadingView>[0]) {
  return renderToStaticMarkup(createElement(FirstLookReadingView, props));
}

describe("FirstLookReadingView", () => {
  it("says only that it is in today's news, with a quiet way to the news drawer", () => {
    const html = view({ listing: nvidia, look: { kind: "shown", look: { looked: true, inNews: true } }, onReadNews: noop });
    expect(html).toContain("NVIDIA is in today&#x27;s news.");
    expect(html).toContain("Read the news");
    expect(html).toContain("News to read, not advice.");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("x.com");
  });

  it("says nothing in today's news only when Jev looked, with who read and no advice note", () => {
    const html = view({ listing: nvidia, look: { kind: "shown", look: { looked: true, inNews: false } }, onReadNews: noop });
    expect(html).toContain("Nothing in today&#x27;s news about NVIDIA.");
    expect(html).toContain("Jev, a model by TypeSafe, read today&#x27;s headlines.");
    expect(html).not.toContain("Read the news");
    expect(html).not.toContain("not advice");
  });

  it("says a large move in code's numbers, with no cause and no post", () => {
    const html = view({ listing: tesla, look: { kind: "shown", look: { looked: false, inNews: false, movePct: -3.6 } }, onAsk: noop });
    expect(html).toContain("Tesla fell 3.6% on the last trading day, more than it usually moves.");
    expect(html).not.toContain("today&#x27;s news");
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

const looked = Object.fromEntries(FIRST_LOOK_SYMBOLS.map((symbol) => [symbol, { looked: true, inNews: false }]));

describe("FirstStockCard", () => {
  it("says what the stock is and the look's fixed line", () => {
    const html = card(nvidia, { key: FIRST_LOOK_QUERY_KEY, data: { judged: true, asOf: Date.now(), looks: looked } });
    expect(html).toContain("Your first stock");
    expect(html).toContain("NVIDIA is in your account as a token that tracks its share price.");
    expect(html).toContain("Nothing in today&#x27;s news about NVIDIA.");
    expect(html).toContain("Got it");
  });

  it("asks about a stock outside the examples on its own, and says nothing of it where it was not read", () => {
    const html = card(amazon, { key: [...FIRST_LOOK_QUERY_KEY, "AMZN"], data: { judged: true, asOf: Date.now(), looks: looked } });
    expect(html).toContain("Your first stock");
    expect(html).not.toContain("today&#x27;s news");
  });

  it("says nothing of the news while Jev is not configured", () => {
    const html = card(nvidia, { key: FIRST_LOOK_QUERY_KEY, data: { judged: false, asOf: Date.now(), looks: {} } });
    expect(html).not.toContain("today&#x27;s news");
  });
});
