import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getAddress } from "viem";
import type { Availability } from "@/lib/availability";
import { hubDelivery } from "@/lib/delivery";

/**
 * The delivery route behind ROBINHOOD_DELIVERY_USERS: off for everyone
 * unless listed, and even then the hub wherever Berth takes no new buy,
 * where Robinhood does not offer its tokens, or when nothing is known.
 * Identity and wallets are stubbed; the switch and the answer are under test.
 */

const HOME = "0x00000000000000000000000000000000000000aa";
const SIGNER = "0x00000000000000000000000000000000000000bb";
let availability: Availability | undefined;
let wallet: string | null = SIGNER;

vi.mock("@/lib/server/rewards-route", () => ({
  readRewardsCaller: vi.fn(async () => ({ ok: true, caller: { did: "did:privy:x", wallet, body: {}, availability } })),
  resolveRewardsUser: vi.fn(async () => ({ ok: true, created: false, user: { id: "u1", wallet_address: wallet, xp: 0 } })),
}));
const accountEvmAddresses = vi.fn(async (): Promise<{ home: string | null; all: string[] }> => ({ home: HOME, all: [HOME] }));
vi.mock("@/lib/server/identities", () => ({ accountEvmAddresses: () => accountEvmAddresses() }));

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
  accountEvmAddresses.mockClear();
  accountEvmAddresses.mockImplementation(async () => ({ home: HOME, all: [HOME] }));
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/delivery", () => {
  it("answers the hub for everyone while the switch is empty, without reading wallets", async () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "");
    expect(await ask("NL")).toEqual(HUB("not_listed"));
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "someone-else");
    expect(await ask("NL")).toEqual(HUB("not_listed"));
    expect(accountEvmAddresses).not.toHaveBeenCalled();
  });

  it("delivers a switched account to its home EVM wallet on Robinhood Chain", async () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "u1");
    expect(await ask("NL")).toEqual(RH(HOME));
  });

  it("switches on by a wallet as well as by user id", async () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", SIGNER.toUpperCase().replace("0X", "0x"));
    expect(await ask("NL")).toEqual(RH(HOME));
  });

  it("falls back to the signing wallet when the account has no home EVM wallet", async () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "u1");
    accountEvmAddresses.mockImplementation(async () => ({ home: null, all: [] }));
    expect(await ask("NL")).toEqual(RH(SIGNER));
    // A Solana-only account has nothing Robinhood Chain can pay.
    wallet = "7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs";
    expect(await ask("NL")).toEqual(HUB("no_evm_wallet"));
  });

  it("keeps a switched account on the hub from a restricted country, or nowhere known", async () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "u1");
    for (const country of ["GB", "CA", "CH", "JE"]) expect(await ask(country), country).toEqual(HUB("restricted_country"));
    expect(await ask()).toEqual(HUB("unknown_country"));
  });

  it("keeps a switched account on the hub where Berth takes no new buy", async () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "u1");
    availability = { available: false, reason: "united-states" };
    expect(await ask("US")).toEqual(HUB("no_new_buys"));
  });

  it("answers the hub when the account's wallets cannot be read", async () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "u1");
    accountEvmAddresses.mockImplementation(async () => {
      throw new Error("db down");
    });
    expect(await ask("NL")).toEqual(HUB("read_failed"));
  });
});
