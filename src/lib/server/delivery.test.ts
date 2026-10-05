import { afterEach, describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import { hubDelivery } from "@/lib/delivery";
import { confirmPlainKey, isPlainKey, robinhoodDeliveryOn } from "./delivery";

afterEach(() => vi.unstubAllEnvs());

const ME = ["9f3b1c2e-0000-4000-8000-000000000001", "0xbe59d5bf40ac4a349bd748e0d7c19ef27ad3ca23"];

describe("robinhoodDeliveryOn", () => {
  it("switches nobody on while ROBINHOOD_DELIVERY_USERS is unset or empty, as it ships", () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", undefined);
    expect(robinhoodDeliveryOn(ME)).toBe(false);
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "");
    expect(robinhoodDeliveryOn(ME)).toBe(false);
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", " , ");
    expect(robinhoodDeliveryOn(ME)).toBe(false);
  });

  it("switches on an account by its user id or any of its wallets, ignoring case", () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "9F3B1C2E-0000-4000-8000-000000000001");
    expect(robinhoodDeliveryOn([ME[0], null])).toBe(true);
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "someone-else, 0xBE59D5BF40AC4A349BD748E0D7C19EF27AD3CA23");
    expect(robinhoodDeliveryOn([null, ME[1]])).toBe(true);
    expect(robinhoodDeliveryOn(["someone", "0x0000000000000000000000000000000000000001"])).toBe(false);
  });

  it("is its own switch, not the limit orders one", () => {
    vi.stubEnv("LIMIT_ORDERS_USERS", ME.join(","));
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "");
    expect(robinhoodDeliveryOn(ME)).toBe(false);
  });
});

describe("isPlainKey", () => {
  const ADDRESS = "0xbe59d5bf40ac4a349bd748e0d7c19ef27ad3ca23";
  const answering = (result: unknown) =>
    vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result })));

  it("is a plain key only when both chains answer with no code", async () => {
    expect(await isPlainKey(ADDRESS, { fetcher: answering("0x") })).toBe(true);
    expect(await isPlainKey(ADDRESS, { fetcher: answering("0x6080") })).toBe(false);
  });

  it("is not, when a chain answers nothing usable or fails", async () => {
    expect(await isPlainKey(ADDRESS, { fetcher: answering(null) })).toBe(false);
    expect(await isPlainKey(ADDRESS, { fetcher: vi.fn(async () => new Response("busy", { status: 503 })) })).toBe(false);
    expect(await isPlainKey(ADDRESS, { fetcher: vi.fn(async () => Promise.reject(new Error("offline"))) })).toBe(false);
  });

  it("passes a hub answer through without asking any chain", async () => {
    const fetcher = answering("0x");
    expect(await confirmPlainKey(hubDelivery("not_listed"), { fetcher })).toEqual(hubDelivery("not_listed"));
    expect(fetcher).not.toHaveBeenCalled();
    const robinhood = { chainKey: "robinhood", address: getAddress(ADDRESS), reason: "switched_on" } as const;
    expect(await confirmPlainKey(robinhood, { fetcher: answering("0x6080") })).toEqual(hubDelivery("not_eoa"));
  });
});
