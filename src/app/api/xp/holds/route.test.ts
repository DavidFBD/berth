import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const pendingHolds = vi.fn();
let signedIn = true;

vi.mock("@/lib/server/holds", () => ({
  pendingHolds: (...args: unknown[]) => pendingHolds(...args),
}));
vi.mock("@/lib/server/rewards-route", () => ({
  readRewardsCaller: async () =>
    signedIn
      ? { ok: true, caller: { did: "did:privy:x", wallet: null, body: {} } }
      : {
          ok: false,
          response: NextResponse.json({ error: "wallet session required" }, { status: 401 }),
        },
  resolveRewardsUser: async () => ({ ok: true, user: { id: "u1" }, created: false }),
}));

import * as route from "./route";

const HOLD = {
  ref: "0xabc",
  pouredAt: "2026-09-01T00:00:00.000Z",
  dueAt: "2026-10-01T00:00:00.000Z",
  amount: 150,
  name: "NVIDIA",
};

const call = () =>
  route.POST(new NextRequest("http://localhost/api/xp/holds", { method: "POST", body: "{}" }));

describe("POST /api/xp/holds", () => {
  beforeEach(() => {
    signedIn = true;
    pendingHolds.mockReset();
    pendingHolds.mockResolvedValue([HOLD]);
  });

  it("answers 401 without a session and never reads the holds", async () => {
    signedIn = false;
    const response = await call();
    expect(response.status).toBe(401);
    expect(pendingHolds).not.toHaveBeenCalled();
  });

  it("answers the account's pending holds", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ holds: [HOLD] });
    expect(pendingHolds).toHaveBeenCalledWith("u1");
  });

  it("is a POST like every other rewards route, never a GET", () => {
    expect(typeof route.POST).toBe("function");
    expect("GET" in route).toBe(false);
  });
});
