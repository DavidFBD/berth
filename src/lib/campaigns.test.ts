import { describe, expect, it } from "vitest";
import { campaignDay, campaignLine, campaignUsd, normalizeCampaignCode, type CampaignProgress } from "./campaigns";
import { COPY } from "./copy";

const base: CampaignProgress = { state: "buying", amountUsd: 5, minBuyUsd: 10, holdDays: 7, holdingSince: null, eligibleAt: null, paidAt: null };

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

describe("campaignLine", () => {
  it("says nothing to an account that came through no campaign", () => {
    expect(campaignLine(null)).toBeNull();
    expect(campaignLine(undefined)).toBeNull();
  });

  it("walks the rules, the dates, qualified and paid", () => {
    expect(campaignLine({ ...base, state: "attributed" })).toMatchObject({ kind: "rules", needsEmail: true });
    expect(campaignLine(base)).toMatchObject({ kind: "rules", needsEmail: false, minBuyUsd: 10, holdDays: 7, amountUsd: 5 });
    const since = "2026-10-03T12:00:00.000Z";
    const eligible = "2026-10-10T12:00:00.000Z";
    expect(campaignLine({ ...base, state: "holding", holdingSince: since, eligibleAt: eligible })).toEqual({
      kind: "holding",
      since: new Date(since),
      eligible: new Date(eligible),
    });
    expect(campaignLine({ ...base, waitlisted: true })).toEqual({ kind: "waiting" });
    expect(campaignLine({ ...base, state: "qualified" })).toEqual({ kind: "qualified" });
    expect(campaignLine({ ...base, state: "approved" })).toEqual({ kind: "qualified" });
    const now = new Date("2026-10-20T00:00:00Z");
    expect(campaignLine({ ...base, state: "paid", paidAt: "2026-10-15T00:00:00Z" }, now)).toEqual({ kind: "paid", amountUsd: 5 });
    expect(campaignLine({ ...base, state: "paid", paidAt: "2026-09-01T00:00:00Z" }, now)).toBeNull();
    expect(campaignLine({ ...base, state: "rejected" })).toEqual({ kind: "closed" });
    expect(campaignLine({ ...base, state: "expired" })).toEqual({ kind: "closed" });
    expect(campaignLine({ ...base, state: "rejected", closedAt: "2026-09-01T00:00:00Z" }, now)).toBeNull();
  });
});

describe("the words", () => {
  it("say the line exactly as agreed, with no dash as punctuation", () => {
    const words = COPY.campaign;
    expect(words.rules(campaignUsd(10), 7, campaignUsd(5))).toBe("Buy at least $10 and keep it 7 days, and $5 in USDC is added, while places last.");
    expect(words.holding(campaignDay(new Date("2026-10-03T12:00:00Z"), "UTC"), campaignDay(new Date("2026-10-10T12:00:00Z"), "UTC"))).toBe(
      "Holding since 3 Oct. Eligible on 10 Oct.",
    );
    expect(words.qualified).toBe("Qualified. Usually paid within a few days.");
    expect(words.paid("$5").startsWith("Paid.")).toBe(true);
    expect(words.rules("$10", 1, "$5")).toContain("1 day,");
    const all = [
      words.landingTitle,
      words.landingLede("$10", 7, "$5"),
      words.rules("$10", 7, "$5"),
      words.rulesNeedsEmail("$10", 7, "$5"),
      words.closed,
      words.waiting,
      words.staff.activateConfirm("Autumn"),
      words.staff.activateCheck,
      words.staff.lede,
      ...Object.values(words.staff.signals),
      ...Object.values(words.staff.refusals),
    ];
    for (const line of all) expect(line).not.toMatch(/ [-–—] |—|–/);
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
