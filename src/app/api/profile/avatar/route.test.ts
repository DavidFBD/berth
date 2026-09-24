import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { UserRow } from "@/lib/server/accounts";
import { RANKS } from "@/lib/xp";

const setAvatar = vi.fn();
let user: UserRow;

vi.mock("@/lib/server/accounts", () => ({
  setAvatar: (...args: unknown[]) => setAvatar(...args),
}));
vi.mock("@/lib/server/rewards-route", () => ({
  readRewardsCaller: async (request: NextRequest) => ({
    ok: true,
    caller: { did: "did:privy:x", wallet: null, body: await request.json() },
  }),
  resolveRewardsUser: async () => ({ ok: true, user, created: false }),
  awardAndRespond: async () => NextResponse.json({ ok: true }),
}));

import { POST } from "./route";

const pick = (avatarId: string) =>
  POST(
    new NextRequest("http://localhost/api/profile/avatar", {
      method: "POST",
      body: JSON.stringify({ avatarId }),
    }),
  );

const atLevel = (level: number): UserRow => ({
  id: "u1",
  privy_did: "did:privy:x",
  wallet_address: null,
  email: null,
  avatar_id: null,
  xp: RANKS[level - 1].xp,
  referral_code: null,
  referred_by: null,
});

describe("POST /api/profile/avatar", () => {
  beforeEach(() => setAvatar.mockReset());

  it("refuses a rank-gated face below its rung with 403 locked", async () => {
    user = atLevel(6);
    const response = await pick("beacon");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "locked" });
    expect(setAvatar).not.toHaveBeenCalled();
  });

  it("lets the face through once the rank is reached", async () => {
    user = atLevel(7);
    const response = await pick("beacon");
    expect(response.status).toBe(200);
    expect(setAvatar).toHaveBeenCalledWith("u1", "beacon");
  });

  it("keeps the open set open at the first rung", async () => {
    user = atLevel(1);
    expect((await pick("bollard")).status).toBe(200);
  });

  it("still answers 400 for a face that does not exist", async () => {
    user = atLevel(10);
    expect((await pick("teacup")).status).toBe(400);
  });
});
