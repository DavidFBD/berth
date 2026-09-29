import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * The route owns HTTP and auth only: a request with no proof may open a
 * card as a visitor, a request with a proof goes through the rewards
 * prologue (and a bad proof is refused, never downgraded to a visitor),
 * and the body never names the account.
 */

const runSocialOp = vi.fn(async () => ({ status: 200, body: { found: false } }));
const readRewardsCaller = vi.fn();
const resolveRewardsUser = vi.fn();

vi.mock("@/lib/server/social/ops", () => ({ PUBLIC_OPS: new Set(["card", "link-card"]), runSocialOp }));
vi.mock("@/lib/server/rewards-route", () => ({ readRewardsCaller, resolveRewardsUser }));

const { POST } = await import("./route");

const call = (op: string, body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest(`http://localhost/api/social/${op}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "10.1.1.1", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ op }) },
  );

beforeEach(() => vi.clearAllMocks());

describe("/api/social/[op]", () => {
  it("opens a card for a visitor without touching auth", async () => {
    const response = await call("card", { handle: "mira" });
    expect(response.status).toBe(200);
    expect(readRewardsCaller).not.toHaveBeenCalled();
    expect(runSocialOp).toHaveBeenCalledWith("card", { handle: "mira" }, { viewer: null, anonKey: "10.1.1.1" });
  });

  it("refuses a bad proof instead of treating it as a visitor", async () => {
    readRewardsCaller.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "invalid token" }, { status: 401 }) });
    const response = await call("card", { handle: "mira" }, { authorization: "Bearer junk" });
    expect(response.status).toBe(401);
    expect(runSocialOp).not.toHaveBeenCalled();
  });

  it("takes the account from the prologue, never the body", async () => {
    readRewardsCaller.mockResolvedValue({ ok: true, caller: { did: "did:x", wallet: null, body: { handle: "mira", on: true, userId: "someone-else" } } });
    resolveRewardsUser.mockResolvedValue({ ok: true, created: false, user: { id: "u1", email: "a@b.c", xp: 0 } });
    await call("salute", { handle: "mira", on: true, userId: "someone-else" }, { authorization: "Bearer good" });
    expect(runSocialOp).toHaveBeenCalledWith("salute", expect.objectContaining({ handle: "mira" }), { viewer: { id: "u1", email: "a@b.c" }, anonKey: "10.1.1.1" });
  });

  it("sends a signed out write through the prologue, which refuses it", async () => {
    readRewardsCaller.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "wallet session required" }, { status: 401 }) });
    expect((await call("salute", { handle: "mira", on: true })).status).toBe(401);
    expect(runSocialOp).not.toHaveBeenCalled();
  });
});
