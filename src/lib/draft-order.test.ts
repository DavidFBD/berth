import { describe, expect, it } from "vitest";
import { draftOrder, findTokenListing, readDraftParams } from "./draft-order";

const ORIGIN = "https://www.berthmarkets.com";

describe("findTokenListing", () => {
  it("finds by ticker or name, any case", () => {
    expect(findTokenListing("nvda")?.symbol).toBe("NVDA");
    expect(findTokenListing("NVIDIA")?.symbol).toBe("NVDA");
    expect(findTokenListing("spacex")?.symbol).toBe("SPCX");
    expect(findTokenListing("nothing like it")).toBeUndefined();
    expect(findTokenListing("")).toBeUndefined();
  });
});

describe("draftOrder", () => {
  it("drafts a buy in dollars as a Berth link", () => {
    const draft = draftOrder({ listing: "NVIDIA", side: "buy", usd: 50 }, { origin: ORIGIN, price: 180 });
    expect(draft).toMatchObject({ ok: true, side: "buy", usd: 50 });
    if (!draft.ok) return;
    const url = new URL(draft.url);
    expect(url.origin).toBe(ORIGIN);
    expect(Object.fromEntries(url.searchParams)).toEqual({ open: "NVDA", side: "buy", usd: "50" });
  });

  it("refuses an unknown listing, a tiny or huge amount, and a buy by quantity", () => {
    expect(draftOrder({ listing: "Pets.com", side: "buy", usd: 50 }, { origin: ORIGIN }).ok).toBe(false);
    expect(draftOrder({ listing: "NVDA", side: "buy", usd: 0.5 }, { origin: ORIGIN }).ok).toBe(false);
    expect(draftOrder({ listing: "NVDA", side: "buy", usd: 5_000_000 }, { origin: ORIGIN }).ok).toBe(false);
    expect(draftOrder({ listing: "NVDA", side: "buy", usd: Number.NaN }, { origin: ORIGIN }).ok).toBe(false);
    expect(draftOrder({ listing: "NVDA", side: "buy", quantity: 1 }, { origin: ORIGIN }).ok).toBe(false);
    expect(draftOrder({ listing: "NVDA", side: "buy" }, { origin: ORIGIN }).ok).toBe(false);
    expect(draftOrder({ listing: "NVDA", side: "sell", usd: 10, quantity: 1 }, { origin: ORIGIN, held: 2 }).ok).toBe(false);
  });

  it("never drafts a sell larger than the holding", () => {
    expect(draftOrder({ listing: "NVDA", side: "sell", quantity: 0.5 }, { origin: ORIGIN, held: 1, price: 100 })).toMatchObject({ ok: true, quantity: 0.5, approxUsd: 50 });
    expect(draftOrder({ listing: "NVDA", side: "sell", quantity: 1.5 }, { origin: ORIGIN, held: 1, price: 100 }).ok).toBe(false);
    expect(draftOrder({ listing: "NVDA", side: "sell", usd: 90 }, { origin: ORIGIN, held: 1, price: 100 }).ok).toBe(true);
    expect(draftOrder({ listing: "NVDA", side: "sell", usd: 150 }, { origin: ORIGIN, held: 1, price: 100 }).ok).toBe(false);
    expect(draftOrder({ listing: "NVDA", side: "sell", usd: 50 }, { origin: ORIGIN, held: 1 }).ok).toBe(false);
    expect(draftOrder({ listing: "NVDA", side: "sell", quantity: 1 }, { origin: ORIGIN, held: 0 }).ok).toBe(false);
    expect(draftOrder({ listing: "NVDA", side: "sell", quantity: 1 }, { origin: ORIGIN }).ok).toBe(false);
    expect(draftOrder({ listing: "NVDA", side: "sell", quantity: 0.001 }, { origin: ORIGIN, held: 1, price: 100 }).ok).toBe(false);
  });

  it("round trips through the app's reader", () => {
    const sell = draftOrder({ listing: "SGOV", side: "sell", quantity: 0.25 }, { origin: ORIGIN, held: 1, price: 100 });
    if (!sell.ok) throw new Error(sell.reason);
    expect(readDraftParams(new URL(sell.url).searchParams)).toEqual({ symbol: "SGOV", side: "sell", quantity: 0.25, usd: undefined });
    const buy = draftOrder({ listing: "nvda", side: "buy", usd: 12.345 }, { origin: ORIGIN });
    if (!buy.ok) throw new Error(buy.reason);
    expect(readDraftParams(new URL(buy.url).searchParams)).toEqual({ symbol: "NVDA", side: "buy", usd: 12.35, quantity: undefined });
  });
});

describe("readDraftParams", () => {
  it("reads nothing without open, and ignores nonsense amounts", () => {
    expect(readDraftParams(new URLSearchParams(""))).toBeNull();
    expect(readDraftParams(new URLSearchParams("open=nvda&usd=abc"))).toEqual({ symbol: "NVDA", side: "buy", usd: undefined, quantity: undefined });
    expect(readDraftParams(new URLSearchParams("open=nvda&side=buy&qty=3"))).toMatchObject({ quantity: undefined });
    expect(readDraftParams(new URLSearchParams("open=nvda&usd=-5"))).toMatchObject({ usd: undefined });
  });

  it("tells a draft only caller a sell is too large without saying what is held", () => {
    const blind = { origin: "https://www.berthmarkets.com", price: 100, held: 2, mayReadHoldings: false };
    for (const result of [
      draftOrder({ listing: "NVDA", side: "sell", quantity: 3 }, blind),
      draftOrder({ listing: "NVDA", side: "sell", usd: 500 }, blind),
      draftOrder({ listing: "NVDA", side: "sell", quantity: 1 }, { ...blind, held: 0 }),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).not.toMatch(/\d/);
    }
    expect(draftOrder({ listing: "NVDA", side: "sell", quantity: 1 }, blind).ok).toBe(true);
  });
});

describe("findTokenListing", () => {
  it("prefers an exact ticker or name, then only a unique prefix of three or more", () => {
    expect(findTokenListing("nvda")?.symbol).toBe("NVDA");
    expect(findTokenListing("Apple")?.symbol).toBe("AAPL");
    expect(findTokenListing("nvi")?.symbol).toBe("NVDA");
    expect(findTokenListing("s&p")?.symbol).toBe("SPY");
    expect(findTokenListing("n")).toBeUndefined();
    expect(findTokenListing("sa")).toBeUndefined();
    expect(findTokenListing("sp")).toBeUndefined();
    expect(findTokenListing("")).toBeUndefined();
  });
});
