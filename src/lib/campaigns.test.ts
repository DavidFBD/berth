import { describe, expect, it } from "vitest";
import { activationGaps, campaignDay, campaignLine, campaignUsd, normalizeCampaignCode, type CampaignProgress } from "./campaigns";
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
    expect(campaignLine(base)).toEqual({ kind: "setUp", amountUsd: 5, stayDays: 14 });
    const eligible = "2026-10-17T12:00:00.000Z";
    expect(campaignLine({ ...base, status: "staying", eligibleAt: eligible })).toEqual({ kind: "staying", amountUsd: 5, eligible: new Date(eligible) });
    expect(campaignLine({ ...base, status: "qualified", eligibleAt: eligible })).toEqual({ kind: "qualified" });
    const deadline = "2026-11-14T12:00:00.000Z";
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
    expect(words.landingLede(campaignUsd(5), 14)).toBe(
      "Open a new Berth account through this link, set it up and still use Berth 14 days later, and $5 in USDC on Base is added to your account, while places last.",
    );
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
      words.landingTitle,
      words.landingLede("$5", 14),
      words.setUp("$5", 14),
      words.waiting("$5", 14, "14 Nov"),
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
      words.landingTitle,
      words.landingLede("$5", 14),
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
    expect(text).not.toMatch(/buys at least|market buy|keeps it for/);
  });

  it("describes no inviter reward anywhere a person or staff reads about a campaign", () => {
    const staff = COPY.campaign.staff;
    const everything = JSON.stringify(
      [
        words.landingTitle,
        words.landingLede("$5", 14),
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
        staff.systemReasons,
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

  it("formats whole dollars without cents", () => {
    expect(campaignUsd(5)).toBe("$5");
    expect(campaignUsd(5.5)).toBe("$5.50");
  });
});
