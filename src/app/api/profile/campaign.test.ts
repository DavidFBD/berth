import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Availability } from "@/lib/availability";

/**
 * The profile sync carries the campaign code to attribution, only where
 * Berth is available, and a failed attribution never fails the sync.
 * Everything behind the route is stubbed; the wiring is what is under test.
 */

let availability: Availability | undefined;
const user = { id: "u1", wallet_address: null, xp: 0, referred_by: null, referral_code: "abcdefgh", email: "a@example.com" };

vi.mock("@/lib/server/rewards-route", () => ({
  readRewardsCaller: vi.fn(async (request: Request) => ({
    ok: true,
    caller: { did: "did:privy:x", wallet: null, body: await request.json(), availability },
  })),
  resolveRewardsUser: vi.fn(async () => ({ ok: true, created: true, user })),
  rewardsResponse: vi.fn(() => new Response("{}", { status: 200 })),
}));
vi.mock("@/lib/server/accounts", () => ({
  awardXp: vi.fn(async () => ({ awarded: 0, xp: 0 })),
  bindReferral: vi.fn(async () => null),
  ensureReferralCode: vi.fn(async (row: unknown) => row),
  flushUnannounced: vi.fn(async () => []),
  setEmail: vi.fn(async () => undefined),
}));
vi.mock("@/lib/server/privy", () => ({ fetchPrivyEmail: vi.fn(async () => null) }));
const attributeCampaign = vi.fn(async (): Promise<string | null> => "claim-1");
vi.mock("@/lib/server/campaigns/store", () => ({ attributeCampaign: (...args: unknown[]) => attributeCampaign(...(args as [])) }));

import { POST } from "./route";

const sync = (body: Record<string, unknown>) =>
  POST(new NextRequest("http://localhost/api/profile", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

describe("POST /api/profile, campaign attribution", () => {
  beforeEach(() => {
    availability = undefined;
    attributeCampaign.mockReset();
    attributeCampaign.mockResolvedValue("claim-1");
  });

  it("attributes the pocketed code where Berth is available", async () => {
    expect((await sync({ campaignCode: "autumn-5" })).status).toBe(200);
    expect(attributeCampaign).toHaveBeenCalledWith("u1", "autumn-5");
  });

  it("never attributes where Berth is not available", async () => {
    availability = { available: false, reason: "united-states" };
    expect((await sync({ campaignCode: "autumn-5" })).status).toBe(200);
    expect(attributeCampaign).not.toHaveBeenCalled();
  });

  it("asks nothing without a code", async () => {
    await sync({ referralCode: null, campaignCode: null });
    expect(attributeCampaign).not.toHaveBeenCalled();
  });

  it("a failed attribution never fails the sync", async () => {
    attributeCampaign.mockRejectedValue(new Error('relation "campaigns" does not exist'));
    expect((await sync({ campaignCode: "autumn-5" })).status).toBe(200);
  });
});
