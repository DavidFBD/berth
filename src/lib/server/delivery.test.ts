import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import { hubDelivery } from "@/lib/delivery";
import { KNOWN_7702_DELEGATES, confirmPlainKey, isPlainKey, robinhoodDeliveryMode, robinhoodDeliveryOn } from "./delivery";

afterEach(() => vi.unstubAllEnvs());

const ME = ["9f3b1c2e-0000-4000-8000-000000000001", "0xbe59d5bf40ac4a349bd748e0d7c19ef27ad3ca23"];

describe("robinhoodDeliveryMode", () => {
  it("is on when ROBINHOOD_DELIVERY is unset, empty or on, as it ships", () => {
    for (const raw of [undefined, null, "", "  ", "on", " ON "]) expect(robinhoodDeliveryMode(raw), String(raw)).toBe("on");
  });

  it("is listed only when it says listed", () => {
    expect(robinhoodDeliveryMode("listed")).toBe("listed");
    expect(robinhoodDeliveryMode(" Listed ")).toBe("listed");
  });

  it("is off when it says off, and when it says anything it does not know, so a typo never widens delivery", () => {
    for (const raw of ["off", "OFF", "false", "0", "no", "true", "1", "of", "list"]) expect(robinhoodDeliveryMode(raw), raw).toBe("off");
  });
});

describe("robinhoodDeliveryOn", () => {
  beforeEach(() => {
    vi.stubEnv("ROBINHOOD_DELIVERY", undefined);
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", undefined);
    vi.stubEnv("ROBINHOOD_DELIVERY_DENY", undefined);
  });

  it("switches every account on while nothing is set, as it ships", () => {
    expect(robinhoodDeliveryOn(ME)).toBe(true);
    expect(robinhoodDeliveryOn(["someone", null])).toBe(true);
  });

  it("switches everyone off with the kill switch, an allow list notwithstanding", () => {
    vi.stubEnv("ROBINHOOD_DELIVERY", "off");
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", ME.join(","));
    expect(robinhoodDeliveryOn(ME)).toBe(false);
  });

  it("keeps an account on the deny list off, by its user id or any of its wallets, ignoring case, in every mode", () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_DENY", "someone-else, 0xBE59D5BF40AC4A349BD748E0D7C19EF27AD3CA23");
    expect(robinhoodDeliveryOn([null, ME[1]])).toBe(false);
    expect(robinhoodDeliveryOn(["someone", "0x0000000000000000000000000000000000000001"])).toBe(true);
    vi.stubEnv("ROBINHOOD_DELIVERY", "listed");
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", ME.join(","));
    expect(robinhoodDeliveryOn(ME)).toBe(false);
    vi.stubEnv("ROBINHOOD_DELIVERY_DENY", " , ");
    expect(robinhoodDeliveryOn(ME)).toBe(true);
  });

  it("in listed mode switches on only an account on ROBINHOOD_DELIVERY_USERS, by its user id or any of its wallets, ignoring case", () => {
    vi.stubEnv("ROBINHOOD_DELIVERY", "listed");
    expect(robinhoodDeliveryOn(ME)).toBe(false);
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", " , ");
    expect(robinhoodDeliveryOn(ME)).toBe(false);
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "9F3B1C2E-0000-4000-8000-000000000001");
    expect(robinhoodDeliveryOn([ME[0], null])).toBe(true);
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "someone-else, 0xBE59D5BF40AC4A349BD748E0D7C19EF27AD3CA23");
    expect(robinhoodDeliveryOn([null, ME[1]])).toBe(true);
    expect(robinhoodDeliveryOn(["someone", "0x0000000000000000000000000000000000000001"])).toBe(false);
  });

  it("is its own switch, not the limit orders one", () => {
    vi.stubEnv("ROBINHOOD_DELIVERY", "listed");
    vi.stubEnv("LIMIT_ORDERS_USERS", ME.join(","));
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

  it("counts an EIP-7702 designator to a pinned delegate as plain, on both chains", async () => {
    const delegate = [...KNOWN_7702_DELEGATES][0].slice(2);
    const fetcher = answering(`0xef0100${delegate}`);
    expect(await isPlainKey(ADDRESS, { fetcher })).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await isPlainKey(ADDRESS, { fetcher: answering(`0xEF0100${delegate.toUpperCase()}`) })).toBe(true);
  });

  it("is not, for a designator to an unknown delegate", async () => {
    expect(await isPlainKey(ADDRESS, { fetcher: answering(`0xef0100${"11".repeat(20)}`) })).toBe(false);
  });

  it("is not, for a designator of the wrong length or prefix", async () => {
    const delegate = [...KNOWN_7702_DELEGATES][0].slice(2);
    expect(await isPlainKey(ADDRESS, { fetcher: answering(`0xef0100${delegate}00`) })).toBe(false);
    expect(await isPlainKey(ADDRESS, { fetcher: answering(`0xef0100${delegate.slice(0, 38)}`) })).toBe(false);
    expect(await isPlainKey(ADDRESS, { fetcher: answering(`0xef0101${delegate}`) })).toBe(false);
    expect(await isPlainKey(ADDRESS, { fetcher: answering(`0x00ef0100${delegate}`) })).toBe(false);
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
