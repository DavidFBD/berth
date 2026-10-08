import { describe, expect, it } from "vitest";
import { COPY, LEGAL_EFFECTIVE_DATE, PRIVACY_OPERATOR, TERMS_AVAILABILITY } from "./copy";
import { FEE_PCT_LABEL } from "./sodax-config";

const all = (doc: typeof COPY.termsOfUse) =>
  [doc.title, doc.status, ...doc.intro, ...doc.sections.flatMap((s) => [s.heading, ...s.body, ...(s.list ?? []), ...(s.after ?? [])])].join("\n");

describe("the terms of use", () => {
  it("names every excluded country and the operator", () => {
    const text = all(COPY.termsOfUse);
    for (const place of [
      ...TERMS_AVAILABILITY.excluded,
      ...TERMS_AVAILABILITY.sanctionedCountries,
      ...TERMS_AVAILABILITY.sanctionedRegions,
    ]) {
      expect(text).toContain(place.name);
    }
    expect(text).toContain(PRIVACY_OPERATOR.name);
    expect(text).toContain(PRIVACY_OPERATOR.email);
  });

  it("has unique section ids", () => {
    const ids = COPY.termsOfUse.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses no dashes as punctuation", () => {
    const help = COPY.assistantsHelp;
    const helpText = [help.title, ...help.intro, help.connectBody, ...help.can, ...help.cannot, ...help.disconnect, ...help.more, help.support].join("\n");
    for (const text of [all(COPY.termsOfUse), helpText]) expect(text).not.toMatch(/ [-–—] |—|–/);
  });
});

describe("the privacy policy", () => {
  it("says everything the weekly summary carries, where it is kept and where it goes", () => {
    const text = all(COPY.privacyPolicy as typeof COPY.termsOfUse);
    const weekly = text.split("\n").find((line) => line.startsWith("The weekly summary:"));
    const resend = text.split("\n").find((line) => line.startsWith("Resend,"));
    for (const line of [weekly, resend]) {
      expect(line).toBeDefined();
      for (const part of ["friends", "Salutes", "filled"]) expect(line).toContain(part);
      // Recurring buys were retired on 2026-10-04: the summary no longer carries them.
      expect(line).not.toContain("recurring");
    }
  });

  it("describes recurring buys only as retired, with no reminder email left", () => {
    const text = all(COPY.privacyPolicy as typeof COPY.termsOfUse);
    const lines = text.split("\n").filter((line) => /recurring/i.test(line));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/4 October 2026/);
    expect(text).not.toContain("Recurring buy reminders:");
  });
});

describe("both legal documents", () => {
  const docs = [COPY.termsOfUse, COPY.privacyPolicy as typeof COPY.termsOfUse];

  it("carry one effective date, and say what changed on it", () => {
    for (const doc of docs) {
      expect(doc.status).toBe(`Effective ${LEGAL_EFFECTIVE_DATE}.`);
      const changed = doc.sections.find((s) => s.id === "what-changed");
      expect(changed?.heading).toContain(LEGAL_EFFECTIVE_DATE);
      expect(changed?.list?.length).toBeGreaterThan(0);
    }
  });

  it("use no dashes as punctuation", () => {
    for (const doc of docs) expect(all(doc)).not.toMatch(/ [-–—] |—|–/);
  });

  it("never call Berth a brokerage", () => {
    for (const doc of docs) expect(all(doc)).not.toMatch(/brokerage/i);
  });

  it("show no placeholder text: open questions for counsel live in the report, not on the page", () => {
    for (const doc of docs) expect(all(doc)).not.toMatch(/\[|for counsel|TODO|TBD/i);
  });

  it("name the operator and the governing law plainly", () => {
    for (const doc of docs) {
      expect(all(doc)).toContain("David, an individual based in the Netherlands");
      expect(all(doc)).toMatch(/governed by the laws of the Netherlands/);
    }
  });
});

describe("the terms of use, in substance", () => {
  const text = all(COPY.termsOfUse);

  it("state the fee the code charges", () => {
    expect(text).toContain(`a fee of ${FEE_PCT_LABEL} on every order: every buy, every sell and every withdrawal from an earlier vault position`);
  });

  it("say what Berth is not, who holds the keys, and what a token is not", () => {
    expect(text).toContain("not a broker, an exchange, an investment firm or an adviser");
    expect(text).toContain("Berth's servers hold no key that can sign for you");
    expect(text).toContain("Holding one does not make you a shareholder");
    expect(text).toContain("XP has no cash value");
  });

  it("keep the consumer carve out in Liability", () => {
    const liability = COPY.termsOfUse.sections.find((s) => s.id === "liability")!;
    expect(liability.list?.join(" ")).toMatch(/does not allow to be limited or excluded/);
    expect(liability.list?.join(" ")).toMatch(/your rights as a consumer/);
  });

  it("keep the anchors other pages link to", () => {
    expect(COPY.termsOfUse.sections.some((s) => s.id === "campaigns")).toBe(true);
    expect(COPY.privacyPolicy.sections.some((s) => s.id === "analytics")).toBe(true);
  });
});

describe("Most held on Berth in the privacy policy, and the notice", () => {
  const text = all(COPY.privacyPolicy as typeof COPY.termsOfUse);

  it("says the share, the thresholds and the first week, and the policy applies before it", () => {
    const line = text.split("\n").find((l) => l.startsWith("Most held on Berth is public too."));
    for (const part of ["rounded share", "never anything about one person", "at least 7 days old", "at least $10", "staff accounts are not counted", "at least 20 people", "fewer than 50 people", "Tuesday", "19 October 2026", "27 October 2026"])
      expect(line).toContain(part);
    expect(new Date(`${LEGAL_EFFECTIVE_DATE} UTC`).getTime()).toBeLessThan(new Date("19 October 2026 UTC").getTime());
  });

  it("rests on legitimate interest, beside Most bought", () => {
    const basis = text.split("\n").find((l) => l.startsWith("Most bought on Berth and Most held on Berth:"));
    expect(basis).toMatch(/legitimate interest/);
  });

  it("is announced in the app with the policy's own date", () => {
    expect(COPY.policyNotice.text).toContain(LEGAL_EFFECTIVE_DATE);
    expect(COPY.policyNotice.text).toContain("Most held on Berth");
    expect(COPY.policyNotice.text).not.toMatch(/ [-–—] |—|–/);
  });
});

describe("what the pages promise about reaching holdings", () => {
  it("promise no way out they cannot verify", () => {
    for (const doc of [COPY.termsOfUse, COPY.privacyPolicy as typeof COPY.termsOfUse]) {
      expect(all(doc)).not.toMatch(/other software that works with SODAX/);
      expect(all(doc)).not.toMatch(/still reach it with your own keys/);
    }
  });
});

describe("what any page says about who can move holdings", () => {
  it("states no absolute: an account your wallet controls, designed to move only on your signature", () => {
    const strings: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value === "string") strings.push(value);
      else if (typeof value === "function") return;
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(COPY);
    expect(strings.filter((text) => /only your wallet can move|only your wallet's signature can move|which only your wallet/i.test(text))).toEqual([]);
  });
});

describe("Robinhood Chain delivery, said as it is (review: copy honesty)", () => {
  const docs = [COPY.termsOfUse, COPY.privacyPolicy as typeof COPY.termsOfUse];

  it("never says it depends on the country and the wallet alone, or that every buy can now go there", () => {
    for (const text of [...docs.map(all), COPY.infoHowBody]) {
      expect(text).not.toMatch(/depending on your country and your wallet/i);
      expect(text).not.toMatch(/can now be delivered/i);
    }
  });

  it("calls it a beta for some accounts, for market buys, in the terms, the privacy note and the info sheet", () => {
    const terms = all(COPY.termsOfUse);
    expect(terms).toMatch(/During a beta, for some accounts that sign in with a wallet of their own, a market buy of a stock/);
    expect(terms).toMatch(/Limit orders, the Treasury bill fund and accounts that sign in with email stay with the Berth account/);
    expect(all(COPY.privacyPolicy as typeof COPY.termsOfUse)).toMatch(/During a beta, some accounts can have a buy delivered/);
    expect(COPY.infoHowBody).toMatch(/During a beta, some accounts that sign in with a wallet of their own can have a market buy/);
    for (const text of [COPY.infoHowBody, COPY.rhChain.limitBuyStaysInAccount]) expect(text).not.toMatch(/ [-–—] |—|–/);
  });

  it("says the same in llms.txt", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/app/llms.txt/route.ts", "utf8");
    expect(source).not.toMatch(/Depending on their country and wallet/);
    expect(source).toMatch(/During a beta, some accounts that sign in with a wallet of their own can have a market buy of a stock delivered/);
  });
});

describe("a limit on a sell from Robinhood Chain (review M2, sell)", () => {
  it("is said, calmly and without dashes, never silently turned into a market sell", async () => {
    expect(COPY.rhChain.limitSellNotHere).toMatch(/goes at the market price/);
    expect(COPY.rhChain.limitSellNotHere).not.toMatch(/ [-–—] |—|–/);
    const { readFileSync } = await import("node:fs");
    const sheet = readFileSync("src/components/flow/withdraw-drawer.tsx", "utf8");
    expect(sheet).toContain("fromRobinhood && limit.blocked");
    const home = readFileSync("src/components/home.tsx", "utf8");
    expect(home).toContain("{ limit: !!prefill?.limit }");
  });
});

describe("selling from Robinhood Chain switched off (review: the kill switch)", () => {
  it("is said calmly in place of a dead Sell", async () => {
    expect(COPY.rhChain.sellPaused).toMatch(/^Selling from Robinhood Chain is paused/);
    expect(COPY.rhChain.sellPaused).not.toMatch(/ [-–—] |—|–/);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/components/home.tsx", "utf8")).toContain("robinhoodPaused={robinhoodSellPaused(snapshot, sellFromWallet)}");
    expect(readFileSync("src/components/flow/withdraw-drawer.tsx", "utf8")).toContain("copy.rhChain.sellPaused");
  });
});
