import { describe, expect, it } from "vitest";
import { campaignDay, campaignLine, campaignUsd, normalizeCampaignCode, type CampaignProgress } from "./campaigns";
import { COPY } from "./copy";

const base: CampaignProgress = {
  amountUsd: 5,
  stayDays: 14,
  perInviter: 3,
  open: true,
  invited: 0,
  staying: 0,
  nextEligibleAt: null,
  qualified: 0,
  paidUsd: 0,
  paidAt: null,
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

describe("campaignLine, the inviter's line", () => {
  it("says nothing when there is nothing to say", () => {
    expect(campaignLine(null)).toBeNull();
    expect(campaignLine(undefined)).toBeNull();
    expect(campaignLine({ ...base, open: false })).toBeNull();
  });

  it("walks the rules, a friend invited, a friend staying, qualified and paid, the furthest along first", () => {
    expect(campaignLine(base)).toEqual({ kind: "rules", amountUsd: 5, stayDays: 14, perInviter: 3 });
    expect(campaignLine({ ...base, invited: 1 })).toEqual({ kind: "invited", amountUsd: 5, stayDays: 14 });
    const eligible = "2026-10-17T12:00:00.000Z";
    expect(campaignLine({ ...base, invited: 1, staying: 1, nextEligibleAt: eligible })).toEqual({ kind: "staying", amountUsd: 5, eligible: new Date(eligible) });
    expect(campaignLine({ ...base, staying: 1, nextEligibleAt: eligible, qualified: 1 })).toEqual({ kind: "qualified" });
    const now = new Date("2026-10-20T00:00:00Z");
    expect(campaignLine({ ...base, qualified: 1, paidUsd: 10, paidAt: "2026-10-15T00:00:00Z" }, now)).toEqual({ kind: "paid", amountUsd: 10 });
    expect(campaignLine({ ...base, paidUsd: 5, paidAt: "2026-09-01T00:00:00Z" }, now)).toEqual({ kind: "rules", amountUsd: 5, stayDays: 14, perInviter: 3 });
  });
});

describe("the words", () => {
  const words = COPY.campaign;

  it("say the lines exactly as agreed, with no dash as punctuation", () => {
    expect(words.rules(campaignUsd(5), 14, 3)).toBe(
      "Invite a friend who is new to Berth. If they set up their account and still use Berth 14 days later, $5 in USDC is added to your account, for up to 3 friends, while places last.",
    );
    expect(words.staying("$5", campaignDay(new Date("2026-10-17T12:00:00Z"), "UTC"))).toBe(
      "A friend you invited is set up. If they still use Berth on 17 Oct, $5 in USDC is added to your account.",
    );
    expect(words.qualified).toBe("A friend you invited stayed. Usually paid within a few days.");
    expect(words.paid("$5").startsWith("Paid.")).toBe(true);
    expect(words.rules("$5", 1, 1)).toContain("1 day later");
    expect(words.rules("$5", 7, 1)).toContain("up to 1 friend,");
    const create = words.staff.create;
    const all = [
      words.landingTitle,
      words.landingLede("$5", 14, 3),
      words.rules("$5", 14, 3),
      words.invited("$5", 14),
      words.staying("$5", "17 Oct"),
      words.staff.activateConfirm("Autumn"),
      words.staff.activateCheck,
      words.staff.lede,
      words.staff.terms("$5", 14, 3),
      words.staff.retired,
      ...Object.values(words.staff.signals),
      ...Object.values(words.staff.refusals),
      ...Object.values(words.staff.systemReasons),
      ...Object.values(create.hints),
      create.fits("$100", 20),
      create.overBudget("$105"),
    ];
    for (const line of all) expect(line).not.toMatch(/ [-–—] |—|–/);
  });

  it("never promise anything for a buy: no user facing campaign line names buying, holding or trading as a condition", () => {
    const userFacing = [
      words.landingTitle,
      words.landingLede("$5", 14, 3),
      words.rules("$5", 14, 3),
      words.invited("$5", 14),
      words.staying("$5", "17 Oct"),
      words.qualified,
      words.paid("$5"),
      COPY.email.campaignPaid.body("$5", "Base"),
    ];
    for (const line of userFacing) expect(line).not.toMatch(/\b(buy|bought|hold|holding|keep it|trade|trading)\b/i);
    const terms = COPY.termsOfUse.sections.find((section) => section.id === "campaigns")!;
    const text = [...terms.body, ...(terms.list ?? [])].join(" ");
    expect(text).toMatch(/No campaign asks you or your friend to buy, hold or trade anything/);
    expect(text).not.toMatch(/buys at least|market buy|keeps it for/);
  });

  it("names counsel review in the activation confirmation", () => {
    expect(COPY.campaign.staff.activateConfirm("Autumn")).toMatch(/counsel/);
    expect(COPY.campaign.staff.activateCheck).toMatch(/[Cc]ounsel/);
  });

  it("formats whole dollars without cents", () => {
    expect(campaignUsd(5)).toBe("$5");
    expect(campaignUsd(5.5)).toBe("$5.50");
  });
});
