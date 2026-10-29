import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { ChainKeys } from "@sodax/sdk";

const OWN = "0x" + "b".repeat(40);
let signedIn = true;
let owned: string[] = [OWN];
let allowed = true;
const forward = vi.fn(async () => ({ status: 200, body: { ok: true, result: "inserted" } }));

vi.mock("@/lib/server/rewards-route", () => ({
  readRewardsCaller: vi.fn(async (request: Request) =>
    signedIn
      ? { ok: true, caller: { did: "did:privy:x", wallet: OWN, body: await request.json().catch(() => ({})) } }
      : { ok: false, response: NextResponse.json({ error: "wallet session required" }, { status: 401 }) },
  ),
  resolveRewardsUser: vi.fn(async () => ({ ok: true, created: false, user: { id: "u1", wallet_address: OWN } })),
}));
vi.mock("@/lib/server/identities", () => ({
  linkedWallets: vi.fn(async () => owned.map((address) => ({ address, family: "evm", isHome: true }))),
}));
vi.mock("@/lib/server/oauth/rate-limit", () => ({ takeRatePlace: vi.fn(async () => allowed) }));
vi.mock("@/lib/server/sodax-submit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/sodax-submit")>()),
  forwardSubmit: () => forward(),
}));

import { POST } from "./route";

const intent = {
  intentId: "1",
  creator: "0xabc",
  inputToken: "0x1",
  outputToken: "0x2",
  inputAmount: "5",
  minOutputAmount: "4",
  deadline: "0",
  allowPartialFill: false,
  srcChain: "23",
  dstChain: "146",
  srcAddress: "0xaa",
  dstAddress: "0xbb",
  solver: "0x0",
  data: "0x",
};
const body = {
  txHash: "0x" + "a".repeat(64),
  srcChainKey: Object.values(ChainKeys)[0],
  walletAddress: OWN,
  intent,
  relayData: "0xdeadbeef",
  operation: "deposit",
};

function call(init: { origin?: string | null; type?: string; payload?: unknown } = {}) {
  const headers: Record<string, string> = {
    "content-type": init.type ?? "application/json",
    host: "www.berthmarkets.com",
  };
  if (init.origin !== null) headers.origin = init.origin ?? "https://www.berthmarkets.com";
  return POST(
    new NextRequest("https://www.berthmarkets.com/api/sodax/submit-tx", {
      method: "POST",
      headers,
      body: JSON.stringify(init.payload ?? body),
    }),
  );
}

beforeEach(() => {
  signedIn = true;
  owned = [OWN];
  allowed = true;
  forward.mockClear();
});

describe("POST /api/sodax/submit-tx", () => {
  it("forwards a signed in person's own order", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("answers 401 without auth", async () => {
    signedIn = false;
    expect((await call()).status).toBe(401);
    expect(forward).not.toHaveBeenCalled();
  });

  it("refuses a wallet the person does not own", async () => {
    owned = ["0x" + "c".repeat(40)];
    expect((await call()).status).toBe(403);
    expect(forward).not.toHaveBeenCalled();
  });

  it("refuses a cross site or missing origin", async () => {
    expect((await call({ origin: "https://evil.example" })).status).toBe(403);
    expect((await call({ origin: null })).status).toBe(403);
    expect(forward).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON", async () => {
    expect((await call({ type: "text/plain" })).status).toBe(415);
    expect(forward).not.toHaveBeenCalled();
  });

  it("refuses past the rate limit and a malformed body", async () => {
    allowed = false;
    expect((await call()).status).toBe(429);
    allowed = true;
    expect((await call({ payload: { ...body, operation: "x" } })).status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });
});
