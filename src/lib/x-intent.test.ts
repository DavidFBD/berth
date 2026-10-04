import { describe, expect, it } from "vitest";
import { inviteXWords, xPostIntent } from "@/lib/x-intent";
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

  it("discloses the possible reward while a campaign is live or not known, and only then", () => {
    expect(inviteXWords(COPY, false)).toBe(COPY.inviteXText);
    expect(inviteXWords(COPY, true)).toBe(`${COPY.inviteXText} Berth may pay me a small reward if you join.`);
    expect(inviteXWords(COPY, undefined)).toBe(inviteXWords(COPY, true));
    expect(COPY.inviteXDisclosure).not.toMatch(/ [-\u2013\u2014] /);
  });
});
