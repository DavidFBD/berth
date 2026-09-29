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

describe("limit drafts", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const on = { origin: ORIGIN, price: 215, limitAllowed: true, now };

  it("drafts a limit buy with its price and an optional last day in the link", () => {
    const draft = draftOrder({ listing: "NVIDIA", side: "buy", usd: 50, orderType: "limit", limitPrice: 200 }, on);
    expect(draft).toMatchObject({ ok: true, side: "buy", usd: 50, limitPrice: 200 });
    if (!draft.ok) return;
    expect(draft.expires).toBeUndefined();
    expect(Object.fromEntries(new URL(draft.url).searchParams)).toEqual({ open: "NVDA", side: "buy", price: "200", usd: "50" });

    const dated = draftOrder({ listing: "NVDA", side: "buy", usd: 50, orderType: "limit", limitPrice: 199.999, expires: "2026-10-03" }, on);
    expect(dated).toMatchObject({ ok: true, limitPrice: 200, expires: "2026-10-03" });
    if (dated.ok) expect(new URL(dated.url).searchParams.get("until")).toBe("2026-10-03");
  });

  it("drafts a limit sell by quantity", () => {
    const draft = draftOrder({ listing: "NVDA", side: "sell", quantity: 0.5, orderType: "limit", limitPrice: 250 }, { ...on, held: 1 });
    expect(draft).toMatchObject({ ok: true, side: "sell", quantity: 0.5, limitPrice: 250 });
  });

  it("refuses a limit where the switch is off, on cash, or without a sane price or day", () => {
    const refuse = (input: Parameters<typeof draftOrder>[0], context = on) => {
      const draft = draftOrder(input, context);
      return draft.ok ? null : draft.reason;
    };
    const buy = { listing: "NVDA", side: "buy" as const, usd: 50, orderType: "limit" as const, limitPrice: 200 };
    expect(refuse(buy, { ...on, limitAllowed: false })).toMatch(/not open on this account/);
    expect(refuse({ ...buy, listing: "SGOV" })).toMatch(/stocks and funds/);
    expect(refuse({ ...buy, limitPrice: undefined })).toMatch(/needs limit_price/);
    expect(refuse({ ...buy, limitPrice: -1 })).toMatch(/needs limit_price/);
    expect(refuse({ ...buy, limitPrice: 0.001 })).toMatch(/at least a cent/);
    expect(refuse({ ...buy, limitPrice: 5_000_000 })).toMatch(/larger than a draft/);
    expect(refuse({ ...buy, expires: "2026-09-27" })).toMatch(/in the past/);
    expect(refuse({ ...buy, expires: "2026-02-30" })).toMatch(/not a real day/);
    expect(refuse({ ...buy, expires: "next week" })).toMatch(/YYYY-MM-DD/);
    expect(refuse({ ...buy, expires: "2028-01-01" })).toMatch(/at most a year/);
    expect(refuse({ listing: "NVDA", side: "buy", usd: 50, limitPrice: 200 })).toMatch(/order_type "limit"/);
    // Today still counts: the order waits to the end of the person's day.
    expect(refuse({ ...buy, expires: "2026-09-28" })).toBeNull();
  });

  it("reads the limit back from the link, and ignores a stray day without a price", () => {
    expect(readDraftParams(new URLSearchParams("open=NVDA&side=buy&usd=50&price=200&until=2026-10-03"))).toEqual({
      symbol: "NVDA",
      side: "buy",
      usd: 50,
      quantity: undefined,
      limitPrice: 200,
      expires: "2026-10-03",
    });
    expect(readDraftParams(new URLSearchParams("open=NVDA&side=buy&usd=50&until=2026-10-03"))).toEqual({
      symbol: "NVDA",
      side: "buy",
      usd: 50,
      quantity: undefined,
    });
    expect(readDraftParams(new URLSearchParams("open=NVDA&price=abc&until=soon"))?.limitPrice).toBeUndefined();
    expect(readDraftParams(new URLSearchParams("open=NVDA&price=200&until=soon"))).toMatchObject({ limitPrice: 200 });
    expect(readDraftParams(new URLSearchParams("open=NVDA&price=200&until=soon"))?.expires).toBeUndefined();
  });

  it("opens the drawer prefilled with the limit (lib/draft-open)", async () => {
    const { draftOpening } = await import("./draft-open");
    const buy = draftOpening({ symbol: "NVDA", side: "buy", usd: 50, limitPrice: 200, expires: "2026-10-03" }, { settled: false, heldAddresses: [] });
    expect(buy).toMatchObject({ kind: "buy", prefill: { usd: 50, limit: { price: 200, expires: "2026-10-03" } } });
    const market = draftOpening({ symbol: "NVDA", side: "buy", usd: 50 }, { settled: false, heldAddresses: [] });
    expect(market).toEqual({ kind: "buy", listing: expect.anything(), prefill: { usd: 50 } });
  });
});

describe("limit drafts need a live price", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  it("refuses a limit with no price feed, even a price of $1", () => {
    const draft = draftOrder({ listing: "NVDA", side: "buy", usd: 50, orderType: "limit", limitPrice: 1 }, { origin: ORIGIN, limitAllowed: true, now });
    expect(draft).toMatchObject({ ok: false, reason: expect.stringMatching(/no live price/) });
  });
  it("refuses a limit more than 1% through the market, both ways", () => {
    const ctx = { origin: ORIGIN, limitAllowed: true, now, price: 200, held: 1 };
    expect(draftOrder({ listing: "NVDA", side: "buy", usd: 50, orderType: "limit", limitPrice: 2000 }, ctx).ok).toBe(false);
    expect(draftOrder({ listing: "NVDA", side: "buy", usd: 50, orderType: "limit", limitPrice: 202 }, ctx).ok).toBe(true);
    expect(draftOrder({ listing: "NVDA", side: "sell", quantity: 0.1, orderType: "limit", limitPrice: 20 }, ctx).ok).toBe(false);
    expect(draftOrder({ listing: "NVDA", side: "sell", quantity: 0.1, orderType: "limit", limitPrice: 250 }, ctx).ok).toBe(true);
  });
});
