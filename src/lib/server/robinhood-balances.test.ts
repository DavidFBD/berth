import { afterEach, describe, expect, it, vi } from "vitest";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { robinhoodRpcFake } from "./robinhood-rpc-fake";
import {
  BALANCES_PER_CALL,
  CALLS_PER_REQUEST,
  ROBINHOOD_LISTINGS,
  makeRobinhoodHoldingsReader,
  readRobinhoodTokenBalances,
  robinhoodTotal,
} from "./robinhood-balances";

const owner = (n: number) => `0x${String(n).padStart(40, "0")}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Robinhood Chain balances on the server", () => {
  it("reads every listing with a token there, stocks and funds only, never cash", () => {
    expect(ROBINHOOD_LISTINGS.map((listing) => listing.symbol)).toEqual(
      TOKEN_LISTINGS.filter((listing) => listing.kind === "stock" && listing.rhAddress).map((listing) => listing.symbol),
    );
    expect(ROBINHOOD_LISTINGS.length).toBeGreaterThan(20);
    expect(ROBINHOOD_LISTINGS.some((listing) => listing.symbol === "SGOV")).toBe(false);
  });

  it("reads many owners in one aggregate3 call, and reports what each holds by symbol", async () => {
    const requests = { count: 0, calls: 0 };
    vi.stubGlobal("fetch", vi.fn(robinhoodRpcFake({ balances: { [owner(1)]: { NVDA: 1.5 }, [owner(2)]: { TSLA: 2 } }, requests })));
    const read = makeRobinhoodHoldingsReader();
    const held = await read([owner(1), owner(2), owner(3), "not an address"]);
    expect(Object.fromEntries(held)).toEqual({ [owner(1)]: { NVDA: 1.5 }, [owner(2)]: { TSLA: 2 }, [owner(3)]: {} });
    // 3 owners x 23 tokens = 69 balances: one eth_call, one request.
    expect(requests).toEqual({ count: 1, calls: 1 });
  });

  it("remembers an owner, so a second ask makes no call", async () => {
    const requests = { count: 0, calls: 0 };
    vi.stubGlobal("fetch", vi.fn(robinhoodRpcFake({ balances: { [owner(1)]: { NVDA: 1 } }, requests })));
    const read = makeRobinhoodHoldingsReader();
    await read([owner(1), owner(2)]);
    await read([owner(2), owner(1)]);
    expect(requests.count).toBe(1);
    // A new owner is read alone.
    await read([owner(1), owner(3)]);
    expect(requests.count).toBe(2);
  });

  it("waits out a 429 and answers", async () => {
    const requests = { count: 0, calls: 0 };
    vi.stubGlobal("fetch", vi.fn(robinhoodRpcFake({ balances: { [owner(1)]: { AAPL: 3 } }, throttle: 1, requests })));
    const held = await makeRobinhoodHoldingsReader()([owner(1)]);
    expect(held.get(owner(1))).toEqual({ AAPL: 3 });
    expect(requests.count).toBe(2);
  });

  it("leaves an owner out when any of its balances fails, and reads it again next time", async () => {
    const requests = { count: 0, calls: 0 };
    vi.stubGlobal("fetch", vi.fn(robinhoodRpcFake({ balances: { [owner(1)]: { NVDA: 1 } }, failing: ["NVDA"], requests })));
    const read = makeRobinhoodHoldingsReader();
    expect((await read([owner(1)])).has(owner(1))).toBe(false);
    await read([owner(1)]);
    expect(requests.count).toBe(2);
    await expect(robinhoodTotal([owner(1)], read)).rejects.toThrow("unread");
  });

  it("answers null for every balance when the chain is down, never zero", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 502 })));
    const balances = await readRobinhoodTokenBalances([{ holder: owner(1), token: ROBINHOOD_LISTINGS[0].rhAddress }]);
    expect(balances).toEqual([null]);
    expect((await makeRobinhoodHoldingsReader()([owner(1)])).size).toBe(0);
  });

  it("splits a large read into aggregate3 calls and the calls into a few per request", async () => {
    const requests = { count: 0, calls: 0 };
    vi.stubGlobal("fetch", vi.fn(robinhoodRpcFake({ requests })));
    const owners = Array.from({ length: 50 }, (_, n) => owner(n + 1));
    const held = await makeRobinhoodHoldingsReader()(owners);
    expect(held.size).toBe(50);
    const calls = Math.ceil((50 * ROBINHOOD_LISTINGS.length) / BALANCES_PER_CALL);
    expect(requests.calls).toBe(calls);
    expect(requests.count).toBe(Math.ceil(calls / CALLS_PER_REQUEST));
  });

  it("adds the owners up by symbol", async () => {
    vi.stubGlobal("fetch", vi.fn(robinhoodRpcFake({ balances: { [owner(1)]: { NVDA: 1 }, [owner(2)]: { NVDA: 2, TSLA: 1 } } })));
    expect(await robinhoodTotal([owner(1), owner(2).toUpperCase().replace("0X", "0x")], makeRobinhoodHoldingsReader())).toEqual({
      NVDA: 3,
      TSLA: 1,
    });
    expect(await robinhoodTotal([], makeRobinhoodHoldingsReader())).toEqual({});
  });
});
