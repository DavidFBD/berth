import { describe, expect, it } from "vitest";
import { DEFAULT_CAPS, dailyCap, marketauxFetches, marketauxMode, newsIngestAllowedHere, newsVariesByReader } from "@/lib/news-schedule";

describe("daily caps", () => {
  it("read each source's own variable, and fall back on anything not a sane number", () => {
    expect(dailyCap("nasdaq", {})).toBe(DEFAULT_CAPS.nasdaq);
    expect(dailyCap("nasdaq", { NASDAQ_DAILY_CALL_CAP: "12" })).toBe(12);
    expect(dailyCap("jev", { JEV_DAILY_TOKEN_CAP: "-3" })).toBe(DEFAULT_CAPS.jev);
    expect(dailyCap("edgar", { EDGAR_DAILY_CALL_CAP: "zero" })).toBe(DEFAULT_CAPS.edgar);
    expect(dailyCap("edgar", { EDGAR_DAILY_CALL_CAP: "0" })).toBe(0);
  });
});

describe("Marketaux", () => {
  it("is off by default and without a key", () => {
    expect(marketauxMode({ MARKETAU_API_KEY: "k" })).toBe("off");
    expect(marketauxMode({ NEWS_MARKETAUX: "everyone" })).toBe("off");
    expect(marketauxFetches({ MARKETAU_API_KEY: "k" })).toBe(false);
  });

  it("is asked in staff and everyone modes, and only staff mode makes the answer depend on the reader", () => {
    expect(marketauxFetches({ MARKETAU_API_KEY: "k", NEWS_MARKETAUX: "staff" })).toBe(true);
    expect(marketauxFetches({ MARKETAU_API_KEY: "k", NEWS_MARKETAUX: "everyone" })).toBe(true);
    expect(newsVariesByReader({ MARKETAU_API_KEY: "k", NEWS_MARKETAUX: "staff" })).toBe(true);
    expect(newsVariesByReader({ MARKETAU_API_KEY: "k", NEWS_MARKETAUX: "everyone" })).toBe(false);
    expect(marketauxMode({ MARKETAU_API_KEY: "k", NEWS_MARKETAUX: "1" })).toBe("off");
  });
});

describe("on-demand ingest", () => {
  it("runs in production on Vercel, or where a machine says so, never in a dev server by default", () => {
    expect(newsIngestAllowedHere({ NODE_ENV: "production", VERCEL_ENV: "production" })).toBe(true);
    expect(newsIngestAllowedHere({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe(false);
    expect(newsIngestAllowedHere({ NODE_ENV: "development" })).toBe(false);
    expect(newsIngestAllowedHere({ NEWS_INGEST_LOCAL: "1" })).toBe(true);
  });
});
