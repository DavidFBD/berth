import { describe, expect, it } from "vitest";
import { HOLDINGS_X_NAMED, X_LINK_WEIGHT, X_POST_LIMIT, holdingsXWords, inviteXWords, xPostIntent, xWeight } from "@/lib/x-intent";
import { STOCK_LISTINGS, rowName } from "@/lib/listings";
import { COPY } from "@/lib/copy";

describe("xPostIntent", () => {
  it("fills X's composer with the words and the link, both encoded", () => {
    const href = xPostIntent("Come aboard, & see.", "https://www.berthmarkets.com/r/abcdefgh");
    expect(href).toBe(
      "https://x.com/intent/post?text=Come%20aboard%2C%20%26%20see.&url=https%3A%2F%2Fwww.berthmarkets.com%2Fr%2Fabcdefgh",
    );
    const parsed = new URL(href);
    expect(parsed.searchParams.get("text")).toBe("Come aboard, & see.");
    expect(parsed.searchParams.get("url")).toBe("https://www.berthmarkets.com/r/abcdefgh");
  });

  it("the invite words stay calm: no buy, no reward, no dash, no emoji", () => {
    const text = COPY.inviteXText;
    expect(text).not.toMatch(/\bbuy\b/i);
    expect(text).not.toMatch(/XP|USDC|\$|earn|reward|return/i);
    expect(text).not.toMatch(/ [-–—] /);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("is the one calm line and nothing more: a personal invite never earns money, so there is no reward to disclose", () => {
    expect(inviteXWords(COPY)).toBe(COPY.inviteXText);
    expect(inviteXWords(COPY)).not.toMatch(/reward|pay/i);
  });
});

describe("holdingsXWords", () => {
  const ALL = STOCK_LISTINGS.map(rowName);
  /** The words with every listing name taken out: what Berth itself wrote. */
  const ownWords = (text: string) => [...ALL].sort((a, b) => b.length - a.length).reduce((rest, name) => rest.split(name).join(""), text);
  const fits = (text: string) => xWeight(text) + 1 + X_LINK_WEIGHT <= X_POST_LIMIT;

  it("names one, two and three holdings in plain English", () => {
    expect(holdingsXWords(COPY, ["NVIDIA"])).toBe("I hold NVIDIA on Berth, as a token that tracks the shares.");
    expect(holdingsXWords(COPY, ["NVIDIA", "Apple"])).toBe("I hold NVIDIA and Apple on Berth, as tokens that track the shares.");
    expect(holdingsXWords(COPY, ["NVIDIA", "Apple", "S&P 500 ETF"])).toBe(
      "I hold NVIDIA, Apple and S&P 500 ETF on Berth, as tokens that track the shares.",
    );
  });

  it("spells out five names and counts the rest in words", () => {
    const names = ["NVIDIA", "Apple", "Tesla", "Microsoft", "Amazon", "Meta", "Netflix", "AMD"];
    expect(holdingsXWords(COPY, names)).toBe(
      "I hold NVIDIA, Apple, Tesla, Microsoft, Amazon and three more on Berth, as tokens that track the shares.",
    );
    expect(HOLDINGS_X_NAMED).toBe(5);
  });

  it("is empty when nothing is chosen", () => {
    expect(holdingsXWords(COPY, [])).toBe("");
  });

  it("discloses no reward: sharing earns nothing", () => {
    expect(holdingsXWords(COPY, ["NVIDIA"])).not.toMatch(/reward|pay/i);
  });

  it("every listing alone and every listing together fits X with the link, and carries no figure", () => {
    {
      const texts = [...ALL.map((name) => holdingsXWords(COPY, [name])), holdingsXWords(COPY, ALL)];
      for (const text of texts) {
        expect(fits(text)).toBe(true);
        const own = ownWords(text);
        expect(own).not.toMatch(/[0-9%$€£]/);
        expect(own).not.toMatch(/\b(buy|price|value|return|gain|loss|up|down|worth)\b/i);
        expect(own).not.toMatch(/ [-\u2013\u2014] /);
        expect(own).not.toMatch(/\p{Extended_Pictographic}/u);
        expect(own).not.toMatch(/own wallet/i);
      }
    }
  });

  it("shortens the name list, never the sentence, when long names would pass the limit", () => {
    const long = Array.from({ length: 9 }, (_, i) => `${"Harbourmaster Holdings Incorporated International".slice(0, 46 + (i % 3))} ${"ABCDEFGHI"[i]}`);
    const text = holdingsXWords(COPY, long);
    expect(fits(text)).toBe(true);
    expect(text.startsWith("I hold ")).toBe(true);
    expect(text).toContain(" more on Berth, as tokens that track the shares.");
    // Fewer than five named: the list gave way.
    expect(long.filter((name) => text.includes(name)).length).toBeLessThan(HOLDINGS_X_NAMED);
  });

  it("weighs non Latin characters double, as X does", () => {
    expect(xWeight("Apple")).toBe(5);
    expect(xWeight("株式")).toBe(4);
  });
});
