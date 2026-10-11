import { describe, expect, it } from "vitest";
import {
  campaignLinkUrl,
  localDateTime,
  campaignPath,
  ACTIVE_WINDOW_DAYS,
  activationGaps,
  campaignDay,
  campaignLine,
  campaignLinePlace,
  campaignUsd,
  landingEnds,
  landingPreview,
  landingState,
  normalizeCampaignCode,
  suggestedAction,
  type CampaignProgress,
  type LandingCampaign,
} from "./campaigns";
import { COPY } from "./copy";

const base: CampaignProgress = {
  amountUsd: 5,
  stayDays: 14,
  status: "setting_up",
  eligibleAt: null,
  paidAt: null,
  deadline: null,
};

describe("normalizeCampaignCode", () => {
  it("accepts lowercase letters, digits and hyphens, 3 to 32", () => {
    expect(normalizeCampaignCode(" Autumn-5 ")).toBe("autumn-5");
    expect(normalizeCampaignCode("ab")).toBeNull();
    expect(normalizeCampaignCode("-abc")).toBeNull();
    expect(normalizeCampaignCode("a".repeat(33))).toBeNull();
    expect(normalizeCampaignCode("a_b_c")).toBeNull();
    expect(normalizeCampaignCode(null)).toBeNull();
  });
});

describe("campaignLine, the new account's own line", () => {
  it("says nothing without a claim", () => {
    expect(campaignLine(null)).toBeNull();
    expect(campaignLine(undefined)).toBeNull();
  });

  it("walks setting up, staying, qualified and paid", () => {
    expect(campaignLine(base)).toEqual({ kind: "setUp", amountUsd: 5, stayDays: 14, termsDue: false });
    expect(campaignLine({ ...base, termsDue: true })).toEqual({ kind: "setUp", amountUsd: 5, stayDays: 14, termsDue: true });
    expect(COPY.campaign.setUp("$5", 14)).toMatch(/you have accepted the terms/);
    expect(COPY.campaign.acceptTerms).toBe("Accept the terms");
    const eligible = "2026-10-17T12:00:00.000Z";
    expect(campaignLine({ ...base, status: "staying", eligibleAt: eligible })).toEqual({ kind: "staying", amountUsd: 5, eligible: new Date(eligible) });
    expect(campaignLine({ ...base, status: "qualified", eligibleAt: eligible })).toEqual({ kind: "qualified" });
    const deadline = "2026-11-14T12:00:00.000Z";
    expect(campaignLine({ ...base, status: "paused" })).toEqual({ kind: "paused" });
    expect(campaignLine({ ...base, status: "waiting", deadline })).toEqual({ kind: "waiting", amountUsd: 5, stayDays: 14, deadline: new Date(deadline) });
    const now = new Date("2026-10-20T00:00:00Z");
    expect(campaignLine({ ...base, status: "paid", paidAt: "2026-10-15T00:00:00Z" }, now)).toEqual({ kind: "paid", amountUsd: 5 });
    expect(campaignLine({ ...base, status: "paid", paidAt: "2026-09-01T00:00:00Z" }, now)).toBeNull();
  });
});

describe("activationGaps, what the confirm panel still needs", () => {
  it("names nothing once a wallet, the funding check and counsel review are all in", () => {
    expect(activationGaps({ wallet: "0xabc", fundingChecked: true, reviewed: true })).toEqual([]);
  });

  it("asks for the wallet first, before the funding check it has nothing to check", () => {
    expect(activationGaps({ wallet: null, fundingChecked: false, reviewed: true })).toEqual(["wallet"]);
    expect(activationGaps({ wallet: null, fundingChecked: true, reviewed: true })).toEqual(["wallet"]);
  });

  it("asks for the funding check once a wallet exists but it is unticked", () => {
    expect(activationGaps({ wallet: "0xabc", fundingChecked: false, reviewed: true })).toEqual(["funding"]);
  });

  it("asks for counsel review independently of the wallet and the funding check", () => {
    expect(activationGaps({ wallet: "0xabc", fundingChecked: true, reviewed: false })).toEqual(["reviewed"]);
    expect(activationGaps({ wallet: null, fundingChecked: false, reviewed: false })).toEqual(["wallet", "reviewed"]);
  });
});

describe("the words", () => {
  const words = COPY.campaign;

  it("say the lines exactly as agreed, with no dash as punctuation", () => {
    expect(words.landing.offer(campaignUsd(5))).toBe("$5 in USDC on Base for a new Berth account opened from this link.");
    expect(words.staying("$5", campaignDay(new Date("2026-10-17T12:00:00Z"), "UTC"))).toBe(
      "Your account is set up. If you still use Berth on 17 Oct, $5 in USDC on Base is added to your account.",
    );
    expect(words.qualified).toBe("You stayed. Your reward is usually paid within a few days.");
    expect(words.paid("$5").startsWith("Paid.")).toBe(true);
    expect(words.setUp("$5", 1)).toContain("1 day later");
    expect(words.staff.terms("$5", 14)).toBe(
      "$5 in USDC on Base to each new account opened through this campaign's link that sets up and still uses Berth 14 days later. One per person.",
    );
    const create = words.staff.create;
    const all = [
      words.landing.title,
      words.landing.offer("$5"),
      ...words.landing.rules(14, "31 Oct"),
      words.landing.sameBrowser,
      ...[words.landing.full, words.landing.ended, words.landing.paused, words.landing.unknown].flatMap((state) => [state.title, state.body]),
      words.setUp("$5", 14),
      words.waiting("$5", 14, "14 Nov"),
      words.paused,
      words.staying("$5", "17 Oct"),
      words.staff.activateConfirm("Autumn"),
      words.staff.activateCheck,
      words.staff.deleteConfirm("Autumn", "autumn"),
      words.staff.deleted("autumn"),
      words.staff.activateNeedsReviewed,
      words.staff.activateNeedsFunding,
      words.staff.lede,
      words.staff.terms("$5", 14),
      words.staff.retired,
      ...Object.values(words.staff.signals),
      ...Object.values(words.staff.refusals),
      ...Object.values(words.staff.systemReasons),
      ...Object.values(create.hints),
      create.fits("$100", 20),
      create.overBudget("$105"),
      create.submitHint,
      create.createdLine("Autumn invites"),
    ];
    for (const line of all) expect(line).not.toMatch(/ [-–—] |—|–/);
  });

  it("never promise anything for a buy: no user facing campaign line names buying, holding or trading as a condition", () => {
    const userFacing = [
      words.landing.title,
      words.landing.offer("$5"),
      ...words.landing.rules(14, "31 Oct"),
      words.setUp("$5", 14),
      words.staying("$5", "17 Oct"),
      words.qualified,
      words.paid("$5"),
      COPY.email.campaignPaid.body("$5", "Base"),
    ];
    for (const line of userFacing) expect(line).not.toMatch(/\b(buy|bought|hold|holding|keep it|trade|trading)\b/i);
    const terms = COPY.termsOfUse.sections.find((section) => section.id === "campaigns")!;
    const text = [...terms.body, ...(terms.list ?? [])].join(" ");
    expect(text).toMatch(/No campaign asks you to buy, hold or trade anything/);
    expect(text).toMatch(/your own invite link or invite code never earns money/);
    expect(text).toMatch(/same browser/);
    expect(text).toContain(`last ${ACTIVE_WINDOW_DAYS} days`);
    for (const doc of [COPY.termsOfUse, COPY.privacyPolicy]) {
      const changed = doc.sections.find((section) => section.id === "what-changed")!;
      expect((changed.list ?? []).some((line) => /own link/.test(line) && /never earns money/.test(line))).toBe(true);
    }
    expect(text).not.toMatch(/buys at least|market buy|keeps it for/);
  });

  it("describes no inviter reward anywhere a person or staff reads about a campaign", () => {
    const staff = COPY.campaign.staff;
    const everything = JSON.stringify(
      [
        words.landing,
        words.landing.rules(14, "31 Oct"),
        words.setUp("$5", 14),
        words.staying("$5", "17 Oct"),
        words.qualified,
        words.paid("$5"),
        staff.activateConfirm("Autumn"),
        staff.terms("$5", 14),
        staff.retired,
        staff.deleteConfirm("Autumn", "autumn"),
        staff.waiting(2),
        staff.labels,
        staff.signals,
        staff.refusals,
        // The retired rules' own reasons name the inviter, and say they are retired.
        Object.fromEntries(Object.entries(staff.systemReasons).filter(([, words]) => !words.endsWith("under the retired rules"))),
        staff.rejectReasons,
        staff.create,
        staff.create.hints,
        COPY.xAutopost.campaign("$5", 14, 3, "31 October"),
        COPY.xAutopost.campaignCta("$5", 14),
        COPY.email.campaignPaid.body("$5", "Base"),
        COPY.termsOfUse.sections.find((section) => section.id === "campaigns"),
      ],
      (_key, value) => (typeof value === "function" ? undefined : value),
    );
    expect(everything).not.toMatch(/inviter|a friend you invited|for each new friend|per inviter/i);
  });

  it("asks for the staff member's own reading, never a counsel review there is none of", () => {
    expect(COPY.campaign.staff.activateConfirm("Autumn")).toMatch(/read this campaign/);
    expect(COPY.campaign.staff.activateCheck).toMatch(/I have read/);
    expect(COPY.campaign.staff.activateCheck).not.toMatch(/[Cc]ounsel/);
  });

  it("names the retired rules' reject reasons in words, never as raw ids", () => {
    const reasons = COPY.campaign.staff.systemReasons;
    for (const id of ["self_invite", "inviter_cap", "inviter_gone"]) expect(reasons[id]).toMatch(/under the retired rules$/);
  });

  it("formats whole dollars without cents", () => {
    expect(campaignUsd(5)).toBe("$5");
    expect(campaignUsd(5.5)).toBe("$5.50");
  });
});

describe("the landing", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const row: LandingCampaign = {
    code: "fez",
    kind: "signup",
    amountUsd: 5,
    budgetUsd: 90,
    maxClaims: 18,
    stayDays: 14,
    active: true,
    activatedAt: new Date("2026-10-08T12:00:00Z"),
    startsAt: new Date("2026-10-08T12:00:00Z"),
    endsAt: new Date("2026-10-31T23:00:00Z"),
    taken: 0,
  };

  it("states a live signup campaign's offer", () => {
    expect(landingState(row, now)).toEqual({ state: "live", code: "fez", amountUsd: 5, stayDays: 14, endsAt: "2026-10-31T23:00:00.000Z" });
  });

  it("says the end as a day at midnight UTC, and with its time in the reader's zone otherwise", () => {
    expect(landingEnds(new Date("2026-11-01T00:00:00Z"))).toEqual({ day: "31 Oct", time: null });
    expect(landingEnds(new Date("2026-10-31T17:00:00Z"), "Europe/Amsterdam")).toEqual({ day: "31 Oct", time: "18:00" });
    expect(landingEnds(new Date("2026-10-31T23:30:00Z"), "Europe/Amsterdam")).toEqual({ day: "1 Nov", time: "00:30" });
    expect(COPY.campaign.landing.endsAt("31 Oct", "18:00")).toBe("31 Oct at 18:00, your time");
  });

  it("stops promising once every place is taken or the budget is spent", () => {
    expect(landingState({ ...row, taken: 17 }, now)).toMatchObject({ state: "live" });
    expect(landingState({ ...row, taken: 18 }, now)).toEqual({ state: "full" });
    expect(landingState({ ...row, maxClaims: 30, budgetUsd: 50, taken: 10 }, now)).toEqual({ state: "full" });
  });

  it("promises nothing for an unknown, draft, unopened, paused, ended or retired campaign", () => {
    expect(landingState(null, now)).toEqual({ state: "unknown" });
    expect(landingState({ ...row, active: false, activatedAt: null }, now)).toEqual({ state: "unknown" });
    expect(landingState({ ...row, startsAt: new Date("2026-10-12T00:00:00Z") }, now)).toEqual({ state: "unknown" });
    expect(landingState({ ...row, active: false }, now)).toEqual({ state: "paused" });
    expect(landingState({ ...row, endsAt: new Date("2026-10-09T00:00:00Z") }, now)).toEqual({ state: "ended" });
    expect(landingState({ ...row, kind: "buy" }, now)).toEqual({ state: "ended" });
  });

  it("previews a state from a fixture only when asked for one", () => {
    expect(landingPreview("Fez", "live")).toMatchObject({ state: "live", code: "fez" });
    expect(landingPreview("fez", "full")).toEqual({ state: "full" });
    expect(landingPreview("fez", null)).toBeNull();
    expect(landingPreview("fez", "anything")).toBeNull();
  });

  it("states the offer and the short rules plainly, with the rules link and Start", () => {
    const words = COPY.campaign.landing;
    const rules = words.rules(14, "31 Oct").join(" ");
    expect(rules).toMatch(/in this browser from this link/);
    expect(rules).toMatch(/until 31 Oct/);
    expect(rules).toMatch(/verified email, a username and a wallet with an address on Base, and the terms accepted/);
    expect(rules).toMatch(/14 days after you set it up/);
    expect(rules).toMatch(/Places are limited/);
    expect(rules).toMatch(/United States/);
    expect(rules).toMatch(/One per person/);
    expect(rules).toMatch(/reviews every reward/);
    expect(rules).toMatch(/Paid by hand, usually within a few days/);
    for (const state of [words.full, words.ended, words.paused, words.unknown]) {
      expect(state.body).toMatch(/You can still open a Berth account/);
      expect(state.body).not.toMatch(/\$|USDC/);
    }
  });
});

describe("where the home shows the campaign line", () => {
  it("shows it from the start while the guided path is on screen, away from the path and its Buy", () => {
    expect(campaignLinePlace({ pathOnScreen: true, stageKnown: false, holdingsSettled: false })).toBe("aside");
    expect(campaignLinePlace({ pathOnScreen: true, stageKnown: true, holdingsSettled: true })).toBe("aside");
  });

  it("is the last strip once the path is done or skipped, and only once the home is settled", () => {
    expect(campaignLinePlace({ pathOnScreen: false, stageKnown: true, holdingsSettled: true })).toBe("strips");
    expect(campaignLinePlace({ pathOnScreen: false, stageKnown: false, holdingsSettled: true })).toBeNull();
    expect(campaignLinePlace({ pathOnScreen: false, stageKnown: true, holdingsSettled: false })).toBeNull();
  });
});

describe("the full line", () => {
  it("says every place is taken, with the line a set up account waits in, and no dash", () => {
    const line = campaignLine({ ...base, status: "full", deadline: "2026-11-14T12:00:00.000Z" });
    expect(line).toMatchObject({ kind: "full", amountUsd: 5, stayDays: 14, termsDue: false });
    expect(campaignLine({ ...base, status: "full", deadline: "2026-11-14T12:00:00.000Z", termsDue: true })).toMatchObject({ kind: "full", termsDue: true });
    const words = COPY.campaign.full("$5", 14, "14 Nov");
    expect(words).toMatch(/^Every place in the Berth offer you joined through is taken for now\./);
    expect(words).toMatch(/accept the terms to wait in line/);
    expect(words).not.toMatch(/ [-–—] |—|–/);
    expect(words).not.toMatch(/\b(buy|bought|hold|holding|trade|trading)\b/i);
    expect(campaignLine({ ...base, status: "full", deadline: null })).toBeNull();
  });
});

describe("the privacy page on the campaign country signal", () => {
  it("says only a yes or no is kept, as a reviewer's signal, never the country, and lists it as a change", () => {
    const text = JSON.stringify(COPY.privacyPolicy.sections);
    expect(text).toMatch(/we keep only a yes or no for whether the country could not be told, used as a signal for the reviewer, never the country itself/);
    expect(text).toMatch(/whether the country your connection came from at sign up could not be told/);
    const changed = COPY.privacyPolicy.sections.find((section) => section.id === "what-changed")!;
    expect((changed.list ?? [])[0]).toMatch(/could not be told/);
  });
});

describe("the queue's suggestion for a country that could not be told", () => {
  it("suggests a reject while a decision is open, and never decides it", () => {
    expect(suggestedAction({ state: "qualified", signals: ["unknown_country"] })).toBe("reject");
    expect(suggestedAction({ state: "holding", signals: ["close_signup", "unknown_country"] })).toBe("reject");
    expect(suggestedAction({ state: "qualified", signals: ["close_signup"] })).toBeNull();
    expect(suggestedAction({ state: "approved", signals: ["unknown_country"] })).toBeNull();
    expect(COPY.campaign.staff.suggestRejectUnknownCountry).toMatch(/^Suggested: reject, unless/);
    expect(COPY.campaign.staff.suggestRejectUnknownCountry).toMatch(/Nothing is rejected on its own/);
  });
});

describe("campaignLinkUrl", () => {
  it("is the full production link staff hand out", () => {
    expect(campaignLinkUrl("launch")).toBe("https://www.berthmarkets.com/c/launch");
  });
});

describe("campaignPath", () => {
  it("carries the query over, so UTM tags survive a changed link", () => {
    expect(campaignPath("launch-campaign")).toBe("/c/launch-campaign");
    expect(campaignPath("launch-campaign", { utm_source: "x", utm_campaign: "launch week", tag: ["a", "b"], gone: undefined })).toBe(
      "/c/launch-campaign?utm_source=x&utm_campaign=launch+week&tag=a&tag=b",
    );
  });
});

describe("localDateTime", () => {
  it("names each date's own zone, so a summer time change between them reads right", () => {
    expect(localDateTime("2026-10-10T22:00:00.000Z", "Europe/Amsterdam")).toBe("11 Oct at 00:00 CEST");
    expect(localDateTime("2026-10-25T21:59:00.000Z", "Europe/Amsterdam")).toBe("25 Oct at 22:59 CET");
  });
});
