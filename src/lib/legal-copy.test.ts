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

  it("says what the New stocks email is, who gets it and how to stop it, and no longer says there is no marketing", () => {
    const text = all(COPY.privacyPolicy as typeof COPY.termsOfUse);
    const line = text.split("\n").find((l) => l.startsWith("New stocks:"));
    expect(line).toBeDefined();
    for (const part of ["filled an order", "30 October 2026 or later", "off for everyone else", "Settings", "turn it off", "stays off"]) expect(line).toContain(part);
    expect(text).not.toContain("We send no marketing");
    expect(text).toMatch(/legitimate interest in telling customers what else Berth lists/);
    expect(text).toMatch(/For anyone else they are off, and rest on your consent/);
  });

  it("says the same thing about who gets it in the policy, the terms' list of changes, the why line and the in-app notice", () => {
    const rule = "filled an order";
    const privacy = all(COPY.privacyPolicy as typeof COPY.termsOfUse);
    const terms = all(COPY.termsOfUse);
    for (const text of [privacy, terms, COPY.email.why.listings, COPY.policyNotice.text]) {
      expect(text).toContain(rule);
      expect(text).toContain(`${LEGAL_EFFECTIVE_DATE} or later`);
      expect(text).toContain("off for everyone else");
    }
    // The terms' list says the 30 October change is the email line and the privacy update, and that no term of use changed.
    expect(terms).toContain("On 30 October 2026 no term of use changed");
    expect(COPY.policyNotice.text).toContain("No term of use changed");
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
  });

  it("rests on legitimate interest, beside Most bought", () => {
    const basis = text.split("\n").find((l) => l.startsWith("Most bought on Berth and Most held on Berth:"));
    expect(basis).toMatch(/legitimate interest/);
  });

  it("is announced in the app with the policy's own date, and says what changed on that date", () => {
    expect(COPY.policyNotice.text).toContain(LEGAL_EFFECTIVE_DATE);
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
    for (const text of [...docs.map(all), COPY.infoPoints.wallet, COPY.infoFineCustody]) {
      expect(text).not.toMatch(/depending on your country and your wallet/i);
      expect(text).not.toMatch(/can now be delivered/i);
    }
  });

  it("says plainly that a market buy lands in your own wallet on Robinhood Chain, email accounts included, in the terms, the privacy note and the info sheet", () => {
    const terms = all(COPY.termsOfUse);
    const privacy = all(COPY.privacyPolicy as typeof COPY.termsOfUse);
    for (const text of [terms, privacy, COPY.infoPoints.wallet, COPY.infoFineCustody]) {
      expect(text).not.toMatch(/during a beta/i);
      expect(text).not.toMatch(/some accounts/i);
    }
    expect(terms).toMatch(/A stock bought at the market price lands there, where Robinhood offers its tokens/);
    expect(terms).toMatch(/the one Privy creates for you if you sign in with email/);
    expect(terms).toMatch(/Limit orders and the Treasury bill fund stay with the Berth account/);
    expect(terms).not.toMatch(/accounts that sign in with email stay with the Berth account/);
    expect(privacy).toMatch(/A stock bought at the market price can land in your own wallet on Robinhood Chain/);
    expect(COPY.infoPoints.wallet).toMatch(/What you buy at market price lands in your own wallet on Robinhood Chain/);
    expect(COPY.infoFineCustody).toMatch(/stays in your Berth account, as do limit orders/);
    for (const text of [terms, ...Object.values(COPY.infoPoints), COPY.infoFineOwn, COPY.infoFineFills, COPY.infoFineCustody, COPY.rhChain.limitBuyStaysInAccount]) expect(text).not.toMatch(/ [-–—] |—|–/);
    expect(terms).not.toMatch(/sodax.{0,40}(fault|blame)/i);
  });

  it("says the same in llms.txt", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/app/llms.txt/route.ts", "utf8");
    expect(source).not.toMatch(/Depending on their country and wallet/);
    expect(source).not.toMatch(/During a beta/);
    expect(source).toMatch(/A stock bought at the market price lands instead as the issuer's own token in the person's own wallet on Robinhood Chain/);
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

describe("How Berth works reads as Berth, with its fine print kept (2026-10-10)", () => {
  const drawer = [
    COPY.infoTitle,
    COPY.infoSub,
    ...Object.values(COPY.infoPoints),
    COPY.infoFinePrintTitle,
    COPY.infoFineOwn,
    COPY.infoFees("0.4%"),
    COPY.infoFineFills,
    COPY.infoFineCustody,
  ];

  it("names SODAX once, factually, and never calls the solvers independent", () => {
    expect(drawer.join(" ").match(/SODAX/g)).toHaveLength(1);
    expect(COPY.infoFineFills).toMatch(/^Orders are filled through SODAX/);
    for (const text of drawer) expect(text).not.toMatch(/independent/i);
  });

  it("keeps what a stock token is, the fee, when orders fill and who holds the funds", () => {
    expect(COPY.infoFineOwn).toMatch(/debt security from Robinhood Assets in Jersey/);
    expect(COPY.infoFineOwn).toMatch(/no voting rights/);
    expect(COPY.infoFineOwn).toMatch(/credit risk/);
    expect(COPY.infoFees("0.4%")).toMatch(/0\.4% fee.*Berth charges nothing else/);
    expect(COPY.infoFineFills).toMatch(/any day/);
    expect(COPY.infoFineCustody).toMatch(/Berth never holds your funds/);
  });

  it("uses no dash as punctuation", () => {
    for (const text of drawer) expect(text).not.toMatch(/ [-–—] |—|–/);
  });
});
