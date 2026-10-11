import { describe, expect, it } from "vitest";
import { campaignStats, campaignStatus, needsYou } from "./campaign-stats";
import type { ClaimState } from "./campaigns";

/** The staff card's numbers, from the meter alone. */

const counts = (over: Partial<Record<ClaimState, number>>): Record<ClaimState, number> => ({
  attributed: 0,
  buying: 0,
  holding: 0,
  qualified: 0,
  approved: 0,
  paid: 0,
  rejected: 0,
  expired: 0,
  ...over,
});

const launch = { amountUsd: 5, budgetUsd: 200, maxClaims: 40 };

describe("campaignStats", () => {
  it("is all zeros and every place free for a campaign nobody opened yet", () => {
    expect(campaignStats({ ...launch, counts: counts({}), reservedUsd: 0, paidUsd: 0, opens: 0, setUp: 0 })).toEqual({
      opens: 0,
      signedUp: 0,
      setUp: 0,
      staying: 0,
      qualified: 0,
      approved: 0,
      paid: 0,
      placesLeft: 40,
      budgetLeftUsd: 200,
    });
  });

  it("counts every claim as a sign up, and frees nothing a held place still holds", () => {
    const stats = campaignStats({
      ...launch,
      counts: counts({ attributed: 6, holding: 4, qualified: 3, approved: 1, paid: 2, rejected: 1, expired: 1 }),
      reservedUsd: 40,
      paidUsd: 10,
      opens: 57,
      setUp: 11,
    });
    expect(stats).toEqual({ opens: 57, signedUp: 18, setUp: 11, staying: 4, qualified: 3, approved: 1, paid: 2, placesLeft: 30, budgetLeftUsd: 150 });
  });

  it("is bound by the budget when it runs out before the places", () => {
    const stats = campaignStats({ amountUsd: 5, budgetUsd: 20, maxClaims: 40, counts: counts({ holding: 3 }), reservedUsd: 15, paidUsd: 0, opens: 0, setUp: 3 });
    expect(stats.placesLeft).toBe(1);
    expect(stats.budgetLeftUsd).toBe(5);
  });
});

describe("needsYou", () => {
  it("is empty when nothing waits on staff", () => {
    expect(needsYou({ qualified: 0, approved: 0 })).toEqual([]);
  });

  it("lists what to approve first, then what to pay", () => {
    expect(needsYou({ qualified: 3, approved: 1 })).toEqual([
      { kind: "approve", count: 3 },
      { kind: "pay", count: 1 },
    ]);
  });
});

describe("campaignStatus", () => {
  const base = { kind: "signup", active: true, draft: false, startsAt: "2026-10-11T00:00:00Z", endsAt: "2026-10-25T23:59:00Z" };
  const at = (iso: string) => new Date(iso);

  it("is live when switched on inside its dates, scheduled before them", () => {
    expect(campaignStatus(base, at("2026-10-12T09:00:00Z"))).toBe("live");
    expect(campaignStatus(base, at("2026-10-10T09:00:00Z"))).toBe("scheduled");
  });

  it("is ended past its end, switched on or not", () => {
    expect(campaignStatus(base, at("2026-10-26T00:00:00Z"))).toBe("ended");
    expect(campaignStatus({ ...base, active: false }, at("2026-10-26T00:00:00Z"))).toBe("ended");
  });

  it("tells a draft from a paused campaign, and a retired one from both", () => {
    expect(campaignStatus({ ...base, active: false, draft: true }, at("2026-10-12T09:00:00Z"))).toBe("draft");
    expect(campaignStatus({ ...base, active: false }, at("2026-10-12T09:00:00Z"))).toBe("paused");
    expect(campaignStatus({ ...base, kind: "buy", active: false }, at("2026-10-12T09:00:00Z"))).toBe("retired");
  });
});
