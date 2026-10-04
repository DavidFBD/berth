import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Availability } from "@/lib/availability";

/** The home's campaign line is never offered where Berth is not available, even for a claim made elsewhere. */

let availability: Availability | undefined;
vi.mock("@/lib/server/rewards-route", () => ({
  readRewardsCaller: vi.fn(async () => ({ ok: true, caller: { did: "did:privy:x", wallet: null, body: {}, availability } })),
  resolveRewardsUser: vi.fn(async () => ({ ok: true, created: false, user: { id: "u1" } })),
}));
const campaignProgress = vi.fn(async () => ({
  amountUsd: 5,
  stayDays: 14,
  perInviter: 3,
  open: true,
  invited: 1,
  staying: 0,
  nextEligibleAt: null,
  qualified: 0,
  paidUsd: 0,
  paidAt: null,
}));
vi.mock("@/lib/server/campaigns/eligibility", () => ({ campaignProgress: () => campaignProgress() }));

import { POST } from "./route";

const ask = () => POST(new NextRequest("http://localhost/api/campaign", { method: "POST", body: "{}" }));

describe("POST /api/campaign", () => {
  beforeEach(() => {
    availability = undefined;
    campaignProgress.mockClear();
  });

  it("answers the claim where Berth is available", async () => {
    expect(((await (await ask()).json()) as { campaign: { invited: number } }).campaign.invited).toBe(1);
  });

  it("answers nothing, and advances nothing, where it is not", async () => {
    availability = { available: false, reason: "united-states" };
    expect(await (await ask()).json()).toEqual({ campaign: null });
    expect(campaignProgress).not.toHaveBeenCalled();
  });
});
