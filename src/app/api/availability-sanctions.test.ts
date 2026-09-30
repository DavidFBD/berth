import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";

/**
 * A comprehensively sanctioned place gets the public pages and nothing
 * else (decided 2026-09-30, for counsel): no sign in, and no account route
 * at all, an existing account included, refused with 451 and reason
 * "sanctions". The traveller's exception stays for the United States: a US
 * request still signs in and reaches its account.
 */

const verifyPrivyAuth = vi.fn(async () => null);
vi.mock("@/lib/server/privy", () => ({
  verifyPrivyAuth: (...args: unknown[]) => verifyPrivyAuth(...(args as [])),
  fetchPrivyWallet: vi.fn(),
}));

const { readRewardsCaller } = await import("@/lib/server/rewards-route");
const siweNonce = await import("./siwe/nonce/route");
const siweVerify = await import("./siwe/verify/route");
const mergeNonce = await import("./account/merge/nonce/route");
const merge = await import("./account/merge/route");
const mergeOffer = await import("./account/merge/offer/route");
const { NotHereCard } = await import("@/components/availability/not-here");
const { COPY } = await import("@/lib/copy");

const from = (country: string, region?: string) => ({
  "x-vercel-ip-country": country,
  ...(region && { "x-vercel-ip-country-region": region }),
});
const post = (path: string, headers: Record<string, string>, body: unknown = {}) =>
  new NextRequest(`http://localhost${path}`, { method: "POST", headers, body: JSON.stringify(body) });

async function expectSanctioned(response: Response) {
  expect(response.status).toBe(451);
  expect(await response.json()).toMatchObject({ code: "unavailable_here", reason: "sanctions" });
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-for-sanctions");
  verifyPrivyAuth.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("every account route, from a sanctioned place", () => {
  it.each([
    ["Iran", from("IR")],
    ["North Korea", from("KP")],
    ["Cuba", from("CU")],
    ["Syria", from("SY")],
    ["Crimea", from("UA", "43")],
    ["Luhansk, filed under Russia", from("RU", "LPR")],
  ])("refuses %s before anyone is looked up", async (_name, headers) => {
    const read = await readRewardsCaller(post("/api/profile", { ...headers, authorization: "Bearer token" }));
    expect(read.ok).toBe(false);
    if (!read.ok) await expectSanctioned(read.response);
    expect(verifyPrivyAuth).not.toHaveBeenCalled();
  });

  it("refuses a wallet sign in and every step of a merge", async () => {
    await expectSanctioned(await siweNonce.POST(post("/api/siwe/nonce", from("IR"))));
    await expectSanctioned(await siweVerify.POST(post("/api/siwe/verify", from("IR"), { message: "m", signature: "s", nonceToken: "t" })));
    await expectSanctioned(await mergeNonce.POST(post("/api/account/merge/nonce", from("IR"))));
    await expectSanctioned(await merge.POST(post("/api/account/merge", from("IR"))));
    await expectSanctioned(await mergeOffer.POST(post("/api/account/merge/offer", from("IR"))));
  });
});

describe("the traveller's exception stays for the United States", () => {
  it("still signs in and reaches the account routes from the US", async () => {
    const nonce = await siweNonce.POST(post("/api/siwe/nonce", from("US")));
    expect(nonce.status).toBe(200);
    const read = await readRewardsCaller(post("/api/profile", from("US")));
    // No session in this request, so the usual 401, not a country refusal.
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.response.status).toBe(401);
  });
});

describe("the card for a sanctioned place", () => {
  const SANCTIONS = { available: false, reason: "sanctions" } as const;

  it("says Berth can't serve the place and that funds stay in their own wallet, with support", () => {
    const html = renderToStaticMarkup(createElement(NotHereCard, { availability: SANCTIONS }));
    expect(html).toContain(COPY.unavailable.sanctionsTitle.replace("'", "&#x27;"));
    expect(html).toContain(COPY.unavailable.fundsStay);
    expect(html).toContain("support@berthmarkets.com");
    expect(html).not.toContain(COPY.unavailable.nothingKept);
  });

  it("offers no sign in, even if one is handed to it", () => {
    const html = renderToStaticMarkup(
      createElement(NotHereCard, { availability: SANCTIONS, signIn: createElement("button", null, "Sign in with email") }),
    );
    expect(html).not.toContain("Sign in with email");
    expect(html).not.toContain(COPY.unavailable.haveAccount);
  });
});
