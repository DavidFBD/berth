import { describe, expect, it } from "vitest";
import { SEC_CIK_BY_SYMBOL, STOCK_LISTINGS } from "@/lib/listings";
import { DEFAULT_CAPS, MARKETAUX_PER_MINUTE, MARKETAUX_REQUESTS_PER_RUN, dailyCap, marketauxFetches, marketauxMode, newsIngestAllowedHere, newsVariesByReader } from "@/lib/news-schedule";

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
  it("is for everyone by default once the key is set, off without a key or when said", () => {
    expect(marketauxMode({ MARKETAU_API_KEY: "k" })).toBe("everyone");
    expect(marketauxMode({ MARKETAU_API_KEY: "k", NEWS_MARKETAUX: " " })).toBe("everyone");
    expect(marketauxMode({ NEWS_MARKETAUX: "everyone" })).toBe("off");
    expect(marketauxMode({ MARKETAUX_API_KEY: "k" })).toBe("everyone");
    expect(marketauxMode({ MARKETAU_API_KEY: "k", NEWS_MARKETAUX: "off" })).toBe("off");
    expect(marketauxFetches({ MARKETAU_API_KEY: "k" })).toBe(true);
    expect(marketauxFetches({ MARKETAU_API_KEY: "k", NEWS_MARKETAUX: "off" })).toBe(false);
  });

  it("caps its requests at 2,000 a day unless told otherwise", () => {
    expect(dailyCap("marketaux", {})).toBe(2000);
    expect(dailyCap("marketaux", { MARKETAUX_DAILY_CAP: "50" })).toBe(50);
    // The first round's name still reads, under the current one.
    expect(dailyCap("marketaux", { MARKETAUX_DAILY_REQUEST_CAP: "70" })).toBe(70);
    expect(dailyCap("marketaux", { MARKETAUX_DAILY_CAP: "50", MARKETAUX_DAILY_REQUEST_CAP: "70" })).toBe(50);
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

describe("the default caps against every listing", () => {
  const RUNS_A_DAY = 10;
  it("let ten runs a day finish, since Nasdaq and EDGAR are reserved a listing at a time, all or nothing", () => {
    expect(DEFAULT_CAPS.nasdaq).toBeGreaterThanOrEqual(STOCK_LISTINGS.length * RUNS_A_DAY);
    expect(DEFAULT_CAPS.edgar).toBeGreaterThanOrEqual(Object.keys(SEC_CIK_BY_SYMBOL).length * RUNS_A_DAY);
  });

  it("let a Marketaux run ask every listing once and page back, inside its minute", () => {
    expect(MARKETAUX_REQUESTS_PER_RUN).toBeGreaterThanOrEqual(Math.ceil(STOCK_LISTINGS.length / 4) * 2);
    expect(MARKETAUX_REQUESTS_PER_RUN).toBeLessThanOrEqual(MARKETAUX_PER_MINUTE);
    expect(DEFAULT_CAPS.marketaux).toBeGreaterThanOrEqual(MARKETAUX_REQUESTS_PER_RUN * RUNS_A_DAY);
  });
});
