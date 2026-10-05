import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toCaip10 } from "@/lib/identity/caip";

/**
 * The order record's re-check of a buy delivered on Robinhood Chain
 * (lib/server/delivery recheckRobinhoodDestination): the very decision
 * /api/delivery makes, from the reporting request, and allowed only when
 * it answers Robinhood Chain to the wallet the buy went to. The account's
 * wallets are read by the real lib/server/identities over a stubbed
 * database; the chain's code reads are stubbed at fetch.
 */

const HOME = "0x00000000000000000000000000000000000000aa";
const SIGNER = "0x00000000000000000000000000000000000000bb";
const STRANGER = "0x00000000000000000000000000000000000000cc";

const linked = (address: string, isHome: boolean) => ({
  value: toCaip10("evm", address)!,
  family: "evm",
  is_home: isHome,
  proof: "siwe",
  created_at: "2026-10-01T00:00:00Z",
});
const query = vi.fn(async (): Promise<unknown[]> => []);
vi.mock("@/lib/server/db", () => ({ getSql: () => ({ query }) }));

let code: Record<string, string> = {};
let rpcDown = false;
const rpc = vi.fn(async (url: string | URL, init?: RequestInit) => {
  if (rpcDown) return new Response("busy", { status: 503 });
  const call = JSON.parse(String(init?.body)) as { id: number; method: string; params: [string, string] };
  const host = new URL(String(url)).host;
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: call.id, result: code[`${host}:${call.params[0].toLowerCase()}`] ?? "0x" }));
});

const { recheckRobinhoodDestination } = await import("./delivery");

const check = (over: Partial<Parameters<typeof recheckRobinhoodDestination>[0]> = {}) =>
  recheckRobinhoodDestination({ userId: "u1", usersWallet: HOME, signer: SIGNER, availability: undefined, country: "NL", dstAddress: SIGNER, ...over });

beforeEach(() => {
  vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "u1");
  query.mockReset();
  query.mockImplementation(async () => [linked(HOME, true), linked(SIGNER, false)]);
  code = {};
  rpcDown = false;
  vi.stubGlobal("fetch", rpc);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("recheckRobinhoodDestination", () => {
  it("allows a buy delivered to the session's own plain key, any casing", async () => {
    expect(await check()).toEqual({ verdict: "allowed" });
    expect(await check({ dstAddress: SIGNER.toUpperCase().replace("0X", "0x") })).toEqual({ verdict: "allowed" });
  });

  it("refuses an account that is not switched on, while the switch is empty above all", async () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "");
    expect(await check()).toEqual({ verdict: "refused", reason: "not_listed" });
    expect(query).not.toHaveBeenCalled();
  });

  it("refuses a restricted or unknown country, and where Berth takes no new buy", async () => {
    for (const country of ["GB", "CA", "CH", "JE", "GG", "IM"]) expect(await check({ country }), country).toEqual({ verdict: "refused", reason: "restricted_country" });
    expect(await check({ country: null })).toEqual({ verdict: "refused", reason: "unknown_country" });
    expect(await check({ availability: { available: false, reason: "united-states" } })).toEqual({ verdict: "refused", reason: "no_new_buys" });
  });

  it("refuses a delivery to any wallet but the session's own linked one", async () => {
    // To the home wallet while the session signs with another.
    expect(await check({ dstAddress: HOME })).toEqual({ verdict: "refused", reason: "other_address" });
    // A session signing with a wallet the account does not hold.
    expect(await check({ signer: STRANGER, dstAddress: STRANGER })).toEqual({ verdict: "refused", reason: "no_evm_wallet" });
  });

  it("refuses a smart account, and allows a pinned EIP-7702 delegation", async () => {
    code = { [`robinhood-rpc.publicnode.com:${SIGNER}`]: "0x6080" };
    expect(await check()).toEqual({ verdict: "refused", reason: "not_eoa" });
    code = { [`sonic-rpc.publicnode.com:${SIGNER}`]: "0xef0100d6cedde84be40893d153be9d467cd6ad37875b28" };
    expect(await check()).toEqual({ verdict: "allowed" });
  });

  it("holds nothing against the order when a read fails: the chain, or the account's wallets", async () => {
    rpcDown = true;
    expect(await check()).toEqual({ verdict: "unknown" });
    rpcDown = false;
    query.mockImplementation(async () => {
      throw new Error("db down");
    });
    expect(await check()).toEqual({ verdict: "unknown" });
  });
});
