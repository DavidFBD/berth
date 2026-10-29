import { describe, expect, it } from "vitest";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { defaultWords, draftProblems, wordsProblem } from "@/lib/new-listings-draft";

const stock = TOKEN_LISTINGS.find((listing) => listing.kind === "stock") as (typeof TOKEN_LISTINGS)[number];

describe("the staff words rules", () => {
  it("accepts the default words for any count of stocks", () => {
    for (const count of [1, 2, 3, 21, 22]) {
      expect(draftProblems(defaultWords(count), count)).toEqual([]);
    }
  });

  it("refuses a call to action in any field, whole words and any case", () => {
    for (const text of [
      "Buy Berth's new stocks",
      "Time to INVEST",
      "Trade them today",
      "Get them on Berth",
      "Grab yours",
      "Act now",
      "Don't miss it",
      "Do not miss out",
      "Today only",
      "Own a slice of it",
      "Purchase from Berth",
      "Start trading",
      "Sign up now",
    ]) {
      expect(wordsProblem("extra", text), text).toMatch(/asks for something/);
    }
    // Words that only contain them are fine.
    for (const text of ["Budget notes", "A target for the quarter", "Together again", "Tradeoffs are plain"]) {
      expect(wordsProblem("extra", text), text).toBeNull();
    }
  });

  it("refuses every dash used as punctuation, and allows a hyphen inside a word", () => {
    for (const text of ["Three stocks - and more", "Three stocks -", "- Three stocks", "Three stocks -and more", "Three -- stocks", "Three – stocks", "Three — stocks", "Three ‒ stocks", "Three ― stocks", "Three—stocks"]) {
      expect(wordsProblem("extra", text), JSON.stringify(text)).toMatch(/dash/);
    }
    for (const text of ["A well-known name", "Coca-Cola is a name", "Down 1.2% and a loss of −1.4%"]) {
      expect(wordsProblem("extra", text), text).toBeNull();
    }
  });

  it("keeps a listing's name and ticker out of the subject and the preview line, but not the intro or the extra paragraph", () => {
    expect(wordsProblem("subject", `${stock.name} is now on Berth`)).toMatch(/names a stock/);
    expect(wordsProblem("subject", `${stock.name.toUpperCase()} is now on Berth`)).toMatch(/names a stock/);
    expect(wordsProblem("preview", `${stock.symbol} arrives, and what to know`)).toMatch(/names a stock/);
    expect(wordsProblem("preview", "AAPL, NVDA and TSLA now on Berth")).toMatch(/names a stock/);
    expect(wordsProblem("subject", "Berth lists 3 more stocks")).toBeNull();
    expect(wordsProblem("intro", `Berth now lists ${stock.name}`)).toBeNull();
    expect(wordsProblem("extra", `${stock.name} and ${stock.symbol}`)).toBeNull();
  });

  it("still refuses empty, long, exclamation, emoji and link words", () => {
    expect(wordsProblem("subject", "  ")).toMatch(/empty/);
    expect(wordsProblem("subject", "x".repeat(71))).toMatch(/longer/);
    expect(wordsProblem("intro", "Hello!")).toMatch(/exclamation/);
    expect(wordsProblem("intro", "A \u{1F680} launch")).toMatch(/emoji/);
    expect(wordsProblem("extra", "see https://example.com")).toMatch(/link/);
  });
});
