import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { UserRow } from "@/lib/server/accounts";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const VIEWER = "22222222-2222-4222-8222-222222222222";
const PERSON = "33333333-3333-4333-8333-333333333333";

type Caller = { did: string | null; wallet: string | null } | "refused";
let caller: Caller;
const byDid = new Map<string, string>();
const byWallet = new Map<string, string>();
const accountForDid = vi.fn(async (did: string) => row(byDid.get(did)));
const accountForWallet = vi.fn(async (wallet: string) => row(byWallet.get(wallet)));

function row(id: string | undefined): UserRow | undefined {
  return id
    ? { id, privy_did: null, wallet_address: null, email: null, avatar_id: null, xp: 0, referral_code: null, referred_by: null }
    : undefined;
}

vi.mock("@/lib/server/accounts", () => ({
  accountForDid: (did: string) => accountForDid(did),
  accountForWallet: (wallet: string) => accountForWallet(wallet),
}));
vi.mock("@/lib/server/rewards-route", () => ({
  readRewardsCaller: async () =>
    caller === "refused"
      ? { ok: false, response: NextResponse.json({ error: "wallet session required" }, { status: 401 }) }
      : { ok: true, caller: { ...caller, body: {} } },
}));

import { POST } from "./route";

const ask = () => POST(new NextRequest("http://localhost/api/account/staff", { method: "POST", body: "{}" }));

describe("POST /api/account/staff", () => {
  beforeEach(() => {
    vi.stubEnv("STAFF_SESSION_SECRET", "s".repeat(40));
    vi.stubEnv("STAFF_ADMIN_IDS", ADMIN);
    vi.stubEnv("STAFF_VIEWER_IDS", VIEWER);
    byDid.clear();
    byWallet.clear();
    accountForDid.mockClear();
    accountForWallet.mockClear();
    byDid.set("did:privy:admin", ADMIN);
    byDid.set("did:privy:viewer", VIEWER);
    byDid.set("did:privy:person", PERSON);
    byWallet.set("0xadmin", ADMIN);
    byWallet.set("0xperson", PERSON);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("says staff to an admin signed in by email", async () => {
    caller = { did: "did:privy:admin", wallet: "0xembedded" };
    const response = await ask();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ staff: true });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("says staff to a viewer, without naming the role", async () => {
    caller = { did: "did:privy:viewer", wallet: null };
    expect(await (await ask()).json()).toEqual({ staff: true });
  });

  it("says staff to an admin signed in with a wallet, by account id", async () => {
    caller = { did: null, wallet: "0xadmin" };
    expect(await (await ask()).json()).toEqual({ staff: true });
    expect(accountForWallet).toHaveBeenCalledWith("0xadmin");
    expect(accountForDid).not.toHaveBeenCalled();
  });

  it("answers everyone else with an empty body, by email or by wallet", async () => {
    caller = { did: "did:privy:person", wallet: null };
    const byEmail = await ask();
    caller = { did: null, wallet: "0xperson" };
    const byWalletSession = await ask();
    caller = { did: null, wallet: "0xunknown" };
    const unknown = await ask();
    for (const response of [byEmail, byWalletSession, unknown]) {
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("{}");
    }
  });

  it("answers an admin nothing while the area is off", async () => {
    vi.stubEnv("STAFF_SESSION_SECRET", "");
    caller = { did: "did:privy:admin", wallet: null };
    expect(await (await ask()).text()).toBe("{}");
  });

  it("answers nothing when the account cannot be read", async () => {
    accountForDid.mockRejectedValueOnce(new Error("db down"));
    caller = { did: "did:privy:admin", wallet: null };
    expect(await (await ask()).text()).toBe("{}");
  });

  it("passes the caller's refusal on unchanged, before any lookup", async () => {
    caller = "refused";
    const response = await ask();
    expect(response.status).toBe(401);
    expect(accountForDid).not.toHaveBeenCalled();
    expect(accountForWallet).not.toHaveBeenCalled();
  });
});
