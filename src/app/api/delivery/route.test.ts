import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getAddress } from "viem";
import type { Availability } from "@/lib/availability";
import { hubDelivery } from "@/lib/delivery";
import { toCaip10 } from "@/lib/identity/caip";

/**
 * The delivery route behind ROBINHOOD_DELIVERY_USERS: off for everyone
 * unless listed, and even then the hub wherever Berth takes no new buy,
 * where Robinhood does not offer its tokens, when nothing is known, and
 * whenever a read fails. The caller is stubbed; the account's wallets are
 * read by the real lib/server/identities over a stubbed database, so a
 * failure is thrown where the real one would be.
 */

/** users.wallet_address: the account's home. */
const HOME = "0x00000000000000000000000000000000000000aa";
/** The wallet this session signs with: a different, also linked, wallet. */
const SIGNER = "0x00000000000000000000000000000000000000bb";
const STRANGER = "0x00000000000000000000000000000000000000cc";
let availability: Availability | undefined;
let wallet: string | null = SIGNER;
let usersWallet: string | null = HOME;

vi.mock("@/lib/server/rewards-route", () => ({
  readRewardsCaller: vi.fn(async () => ({ ok: true, caller: { did: "did:privy:x", wallet, body: {}, availability } })),
  resolveRewardsUser: vi.fn(async () => ({ ok: true, created: false, user: { id: "u1", wallet_address: usersWallet, xp: 0 } })),
}));

type IdentityRow = { value: string; family: string; is_home: boolean; proof: string; created_at: string };
const linked = (address: string, isHome: boolean): IdentityRow => ({
  value: toCaip10("evm", address)!,
  family: "evm",
  is_home: isHome,
  proof: "siwe",
  created_at: "2026-10-01T00:00:00Z",
});
const query = vi.fn(async (_text: string, _params?: unknown[]): Promise<unknown[]> => []);
vi.mock("@/lib/server/db", () => ({ getSql: () => ({ query }) }));

/** Contract code by lowercase address, per RPC host; anything else is a plain key. */
let code: Record<string, string> = {};
let rpcDown = false;
const rpc = vi.fn(async (url: string | URL, init?: RequestInit) => {
  if (rpcDown) return new Response("busy", { status: 503 });
  const call = JSON.parse(String(init?.body)) as { id: number; method: string; params: [string, string] };
  const host = new URL(String(url)).host;
  const result = call.method === "eth_getCode" ? (code[`${host}:${call.params[0].toLowerCase()}`] ?? "0x") : null;
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: call.id, result }));
});

const { POST } = await import("./route");

const ask = async (country?: string) =>
  (await POST(
    new NextRequest("https://www.berthmarkets.com/api/delivery", {
      method: "POST",
      headers: country ? { "x-vercel-ip-country": country } : {},
    }),
  )).json();

const HUB = hubDelivery;
const RH = (address: string) => ({ chainKey: "robinhood", address: getAddress(address), reason: "switched_on" });

beforeEach(() => {
  availability = undefined;
  wallet = SIGNER;
  usersWallet = HOME;
  query.mockReset();
  query.mockImplementation(async () => [linked(HOME, true), linked(SIGNER, false)]);
  code = {};
  rpcDown = false;
  rpc.mockClear();
  vi.stubGlobal("fetch", rpc);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/delivery", () => {
  it("answers the hub for everyone while the switch is empty, without reading wallets", async () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "");
    expect(await ask("NL")).toEqual(HUB("not_listed"));
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "someone-else");
    expect(await ask("NL")).toEqual(HUB("not_listed"));
    expect(query).not.toHaveBeenCalled();
  });

  it("delivers to the wallet this session signs with, not the home wallet, when both are the account's", async () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "u1");
    expect(await ask("NL")).toEqual(RH(SIGNER));
  });

  it("switches on by the account's home wallet or by the signing wallet, and delivers to the signer either way", async () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", HOME.toUpperCase().replace("0X", "0x"));
    expect(await ask("NL")).toEqual(RH(SIGNER));
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", SIGNER);
    expect(await ask("NL")).toEqual(RH(SIGNER));
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", STRANGER);
    expect(await ask("NL")).toEqual(HUB("not_listed"));
  });

  it("delivers to the home wallet when that is the one signing", async () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "u1");
    wallet = HOME;
    expect(await ask("NL")).toEqual(RH(HOME));
  });

  it("answers the hub when the signing wallet is not one of the account's own EVM wallets", async () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "u1");
    wallet = STRANGER;
    expect(await ask("NL")).toEqual(HUB("no_evm_wallet"));
    // A Solana session has nothing Robinhood Chain can pay.
    wallet = "7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs";
    expect(await ask("NL")).toEqual(HUB("no_evm_wallet"));
  });

  it("keeps a switched account on the hub from a restricted country, or nowhere known", async () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "u1");
    for (const country of ["GB", "CA", "CH", "JE"]) expect(await ask(country), country).toEqual(HUB("restricted_country"));
    expect(await ask()).toEqual(HUB("unknown_country"));
    expect(await ask("XX")).toEqual(HUB("unknown_country"));
  });

  it("keeps a switched account on the hub where Berth takes no new buy", async () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "u1");
    availability = { available: false, reason: "united-states" };
    expect(await ask("US")).toEqual(HUB("no_new_buys"));
  });

  it("asks both Robinhood Chain and Sonic whether the address is a plain key", async () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "u1");
    expect(await ask("NL")).toEqual(RH(SIGNER));
    const hosts = rpc.mock.calls.map(([url]) => new URL(String(url)).host);
    expect(hosts).toContain("robinhood-rpc.publicnode.com");
    expect(hosts).toContain("sonic-rpc.publicnode.com");
  });

  it("answers the hub for a smart account, with code on Robinhood Chain or on Sonic", async () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "u1");
    code = { [`robinhood-rpc.publicnode.com:${SIGNER}`]: "0x6080" };
    expect(await ask("NL")).toEqual(HUB("not_eoa"));
    // A Safe on Sonic, nothing at the address on Robinhood Chain: nobody's there.
    code = { [`sonic-rpc.publicnode.com:${SIGNER}`]: "0x6080" };
    expect(await ask("NL")).toEqual(HUB("not_eoa"));
    // An EIP-7702 delegation is code too.
    code = { [`robinhood-rpc.publicnode.com:${SIGNER}`]: `0xef0100${"11".repeat(20)}` };
    expect(await ask("NL")).toEqual(HUB("not_eoa"));
  });

  it("answers the hub when the chain cannot be asked", async () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "u1");
    rpcDown = true;
    expect(await ask("NL")).toEqual(HUB("not_eoa"));
  });

  it("asks no chain unless the answer would be Robinhood Chain", async () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "u1");
    expect(await ask("GB")).toEqual(HUB("restricted_country"));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers the hub when the account's wallets cannot be read, rather than trusting the signing wallet", async () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "u1");
    // users.wallet_address is the signer here, so the stand-in linkedWallets
    // uses for other callers would have answered Robinhood Chain.
    usersWallet = SIGNER;
    query.mockImplementation(async () => {
      throw new Error("db down");
    });
    expect(await ask("NL")).toEqual(HUB("read_failed"));
  });
});
