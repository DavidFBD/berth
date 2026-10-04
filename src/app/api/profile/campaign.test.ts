import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Availability } from "@/lib/availability";

/**
 * The profile sync makes an invite claim for an account that carries an
 * invite, only where Berth is available, passing any pocketed campaign code
 * along; and a failed attribution never fails the sync.
 * Everything behind the route is stubbed; the wiring is what is under test.
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
const attributeInvite = vi.fn(async (): Promise<string | null> => "claim-1");
vi.mock("@/lib/server/campaigns/store", () => ({ attributeInvite: (...args: unknown[]) => attributeInvite(...(args as [])) }));

import { POST } from "./route";

const sync = (body: Record<string, unknown>) =>
  POST(new NextRequest("http://localhost/api/profile", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

describe("POST /api/profile, invite campaign attribution", () => {
  beforeEach(() => {
    availability = undefined;
    user.referred_by = "inviter-1";
    attributeInvite.mockReset();
    attributeInvite.mockResolvedValue("claim-1");
  });

  it("attributes an invited account where Berth is available, with the pocketed code", async () => {
    expect((await sync({ campaignCode: "autumn-5" })).status).toBe(200);
    expect(attributeInvite).toHaveBeenCalledWith("u1", "autumn-5");
  });

  it("attributes an invited account without a campaign code too", async () => {
    await sync({});
    expect(attributeInvite).toHaveBeenCalledWith("u1", undefined);
  });

  it("never attributes where Berth is not available", async () => {
    availability = { available: false, reason: "united-states" };
    expect((await sync({ campaignCode: "autumn-5" })).status).toBe(200);
    expect(attributeInvite).not.toHaveBeenCalled();
  });

  it("asks nothing of an account nobody invited, campaign code or not", async () => {
    user.referred_by = null;
    await sync({ campaignCode: "autumn-5" });
    expect(attributeInvite).not.toHaveBeenCalled();
  });

  it("a failed attribution never fails the sync", async () => {
    attributeInvite.mockRejectedValue(new Error('relation "campaigns" does not exist'));
    expect((await sync({ campaignCode: "autumn-5" })).status).toBe(200);
  });
});
