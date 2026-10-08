import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getAddress } from "viem";
import type { Availability } from "@/lib/availability";
import { hubDelivery } from "@/lib/delivery";
import { toCaip10 } from "@/lib/identity/caip";

/**
 * The delivery route: Robinhood Chain by default for every eligible
 * account, the hub when ROBINHOOD_DELIVERY turns it off, narrows it to
 * ROBINHOOD_DELIVERY_USERS, or ROBINHOOD_DELIVERY_DENY names the account,
 * and the hub wherever Berth takes no new buy, where Robinhood does not
 * offer its tokens, when nothing is known, and whenever a read fails. The caller is stubbed; the account's wallets are
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
const query = vi.fn(async (): Promise<unknown[]> => []);
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
  // As it ships: no switch variable set at all, whatever this shell has.
  vi.stubEnv("ROBINHOOD_DELIVERY", undefined);
  vi.stubEnv("ROBINHOOD_DELIVERY_USERS", undefined);
  vi.stubEnv("ROBINHOOD_DELIVERY_DENY", undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/delivery", () => {
  it("delivers to Robinhood Chain by default, with no switch variable set and no allow list", async () => {
    expect(await ask("NL")).toEqual(RH(SIGNER));
    vi.stubEnv("ROBINHOOD_DELIVERY", " On ");
    expect(await ask("NL")).toEqual(RH(SIGNER));
  });

  it("answers the hub for everyone when the kill switch is off, or set to anything it does not know, without reading wallets", async () => {
    for (const value of ["off", "OFF", "false", "0", "no", "of"]) {
      vi.stubEnv("ROBINHOOD_DELIVERY", value);
      expect(await ask("NL"), value).toEqual(HUB("not_listed"));
    }
    // Off wins over an allow list.
    expect(await ask("NL")).toEqual(HUB("not_listed"));
    expect(query).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps an account on the deny list on the hub, by user id, home wallet or signing wallet, in every mode", async () => {
    for (const deny of ["u1", HOME.toUpperCase().replace("0X", "0x"), SIGNER]) {
      vi.stubEnv("ROBINHOOD_DELIVERY_DENY", `someone-else, ${deny}`);
      vi.stubEnv("ROBINHOOD_DELIVERY", undefined);
      expect(await ask("NL"), deny).toEqual(HUB("not_listed"));
      vi.stubEnv("ROBINHOOD_DELIVERY", "listed");
      vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "u1");
      expect(await ask("NL"), deny).toEqual(HUB("not_listed"));
    }
    vi.stubEnv("ROBINHOOD_DELIVERY_DENY", STRANGER);
    vi.stubEnv("ROBINHOOD_DELIVERY", undefined);
    expect(await ask("NL")).toEqual(RH(SIGNER));
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("in listed mode delivers only to the accounts on ROBINHOOD_DELIVERY_USERS, by user id, home wallet or signing wallet", async () => {
    vi.stubEnv("ROBINHOOD_DELIVERY", "listed");
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "");
    expect(await ask("NL")).toEqual(HUB("not_listed"));
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", STRANGER);
    expect(await ask("NL")).toEqual(HUB("not_listed"));
    expect(query).not.toHaveBeenCalled();
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "u1");
    expect(await ask("NL")).toEqual(RH(SIGNER));
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", HOME.toUpperCase().replace("0X", "0x"));
    expect(await ask("NL")).toEqual(RH(SIGNER));
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", SIGNER);
    expect(await ask("NL")).toEqual(RH(SIGNER));
  });

  it("delivers to the wallet this session signs with, not the home wallet, when both are the account's", async () => {
    expect(await ask("NL")).toEqual(RH(SIGNER));
  });

  it("delivers to the home wallet when that is the one signing", async () => {
    wallet = HOME;
    expect(await ask("NL")).toEqual(RH(HOME));
  });

  it("answers the hub when the signing wallet is not one of the account's own EVM wallets", async () => {
    wallet = STRANGER;
    expect(await ask("NL")).toEqual(HUB("no_evm_wallet"));
    // A Solana session has nothing Robinhood Chain can pay.
    wallet = "7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs";
    expect(await ask("NL")).toEqual(HUB("no_evm_wallet"));
  });

  it("keeps an account on the hub from a restricted country, or nowhere known", async () => {
    for (const country of ["GB", "CA", "CH", "JE"]) expect(await ask(country), country).toEqual(HUB("restricted_country"));
    expect(await ask()).toEqual(HUB("unknown_country"));
    expect(await ask("XX")).toEqual(HUB("unknown_country"));
  });

  it("keeps an account on the hub where Berth takes no new buy", async () => {
    availability = { available: false, reason: "united-states" };
    expect(await ask("US")).toEqual(HUB("no_new_buys"));
  });

  it("asks both Robinhood Chain and Sonic whether the address is a plain key", async () => {
    expect(await ask("NL")).toEqual(RH(SIGNER));
    const hosts = rpc.mock.calls.map(([url]) => new URL(String(url)).host);
    expect(hosts).toContain("robinhood-rpc.publicnode.com");
    expect(hosts).toContain("sonic-rpc.publicnode.com");
  });

  it("answers the hub for a smart account, with code on Robinhood Chain or on Sonic", async () => {
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
    rpcDown = true;
    expect(await ask("NL")).toEqual(HUB("not_eoa"));
  });

  it("asks no chain unless the answer would be Robinhood Chain", async () => {
    expect(await ask("GB")).toEqual(HUB("restricted_country"));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers the hub when the account's wallets cannot be read, rather than trusting the signing wallet", async () => {
    // users.wallet_address is the signer here, so the stand-in linkedWallets
    // uses for other callers would have answered Robinhood Chain.
    usersWallet = SIGNER;
    query.mockImplementation(async () => {
      throw new Error("db down");
    });
    expect(await ask("NL")).toEqual(HUB("read_failed"));
  });
});
