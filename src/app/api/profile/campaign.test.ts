import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Availability } from "@/lib/availability";

/**
 * The profile sync asks for a campaign claim only when the sync carries a
 * campaign code (the /c/<code> pocket), only where Berth is available, and
 * never because of a personal invite; a failed attribution never fails the
 * sync. Everything behind the route is stubbed; the wiring is what is
 * under test.
 */

let availability: Availability | undefined;
const user: Record<string, unknown> = { id: "u1", wallet_address: null, xp: 0, referred_by: "inviter-1", referral_code: "abcdefgh", email: "a@example.com" };

vi.mock("@/lib/server/rewards-route", () => ({
  readRewardsCaller: vi.fn(async (request: Request) => ({
    ok: true,
    caller: { did: "did:privy:x", wallet: null, body: await request.json(), availability },
  })),
  resolveRewardsUser: vi.fn(async () => ({ ok: true, created: true, user: { ...user } })),
  rewardsResponse: vi.fn(() => new Response("{}", { status: 200 })),
}));
vi.mock("@/lib/server/accounts", () => ({
  awardXp: vi.fn(async () => ({ awarded: 0, xp: 0 })),
  bindReferral: vi.fn(async () => null),
  ensureReferralCode: vi.fn(async (row: unknown) => row),
  flushUnannounced: vi.fn(async () => []),
  setEmail: vi.fn(async () => undefined),
  touchLastSeen: vi.fn(async () => undefined),
}));
vi.mock("@/lib/server/privy", () => ({ fetchPrivyEmail: vi.fn(async () => null) }));
const attributeSignup = vi.fn(async (): Promise<string | null> => "claim-1");
vi.mock("@/lib/server/campaigns/store", () => ({ attributeSignup: (...args: unknown[]) => attributeSignup(...(args as [])) }));

import { POST } from "./route";

const sync = (body: Record<string, unknown>) =>
  POST(new NextRequest("http://localhost/api/profile", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

describe("POST /api/profile, campaign attribution", () => {
  beforeEach(() => {
    availability = undefined;
    user.referred_by = "inviter-1";
    attributeSignup.mockReset();
    attributeSignup.mockResolvedValue("claim-1");
  });

  it("attributes with the pocketed code where Berth is available, normalised", async () => {
    expect((await sync({ campaignCode: " Autumn-5 " })).status).toBe(200);
    expect(attributeSignup).toHaveBeenCalledWith("u1", "autumn-5");
  });

  it("asks nothing for a personal invite without a campaign code", async () => {
    await sync({ referralCode: "abcdefgh" });
    expect(attributeSignup).not.toHaveBeenCalled();
  });

  it("asks nothing for a code that is not a campaign code", async () => {
    await sync({ campaignCode: "x" });
    expect(attributeSignup).not.toHaveBeenCalled();
  });

  it("never attributes where Berth is not available", async () => {
    availability = { available: false, reason: "united-states" };
    expect((await sync({ campaignCode: "autumn-5" })).status).toBe(200);
    expect(attributeSignup).not.toHaveBeenCalled();
  });

  it("attributes an account nobody invited: the campaign link alone counts", async () => {
    user.referred_by = null;
    await sync({ campaignCode: "autumn-5" });
    expect(attributeSignup).toHaveBeenCalledWith("u1", "autumn-5");
  });

  it("a failed attribution never fails the sync", async () => {
    attributeSignup.mockRejectedValue(new Error('relation "campaigns" does not exist'));
    expect((await sync({ campaignCode: "autumn-5" })).status).toBe(200);
  });
});
