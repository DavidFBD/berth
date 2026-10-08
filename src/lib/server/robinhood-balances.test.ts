import { afterEach, describe, expect, it, vi } from "vitest";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { robinhoodRpcFake } from "./robinhood-rpc-fake";
import {
  BALANCES_PER_CALL,
  CALLS_PER_REQUEST,
  ROBINHOOD_LISTINGS,
  makeRobinhoodHoldingsReader,
  safeError,
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

  it("reads afresh every time with no memory, for reads a sell may have just changed (rh-server m5)", async () => {
    const requests = { count: 0, calls: 0 };
    vi.stubGlobal("fetch", vi.fn(robinhoodRpcFake({ balances: { [owner(1)]: { NVDA: 1 } }, requests })));
    const fresh = makeRobinhoodHoldingsReader(undefined, 0);
    await fresh([owner(1)]);
    await fresh([owner(1)]);
    expect(requests.count).toBe(2);
  });

  it("waits out a 429 and answers", async () => {
    const requests = { count: 0, calls: 0 };
    vi.stubGlobal("fetch", vi.fn(robinhoodRpcFake({ balances: { [owner(1)]: { AAPL: 3 } }, throttle: 1, requests })));
    const held = await makeRobinhoodHoldingsReader()([owner(1)]);
    expect(held.get(owner(1))).toEqual({ AAPL: 3 });
    expect(requests.count).toBe(2);
  });

  it("leaves out a token whose balanceOf reverts, logs it, and keeps every wallet and every other token (rh-server m1)", async () => {
    const requests = { count: 0, calls: 0 };
    vi.stubGlobal("fetch", vi.fn(robinhoodRpcFake({ balances: { [owner(1)]: { NVDA: 1, TSLA: 2 }, [owner(2)]: { TSLA: 3 } }, failing: ["NVDA"], requests })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const read = makeRobinhoodHoldingsReader();
    const held = await read([owner(1), owner(2)]);
    expect(Object.fromEntries(held)).toEqual({ [owner(1)]: { TSLA: 2 }, [owner(2)]: { TSLA: 3 } });
    expect(await robinhoodTotal([owner(1), owner(2)], read)).toEqual({ TSLA: 5 });
    expect(warn.mock.calls.flat().join(" ")).toContain("NVDA");
    const nvda = ROBINHOOD_LISTINGS.find((listing) => listing.symbol === "NVDA")!;
    expect(await readRobinhoodTokenBalances([{ holder: owner(1), token: nvda.rhAddress }])).toEqual(["reverted"]);
    warn.mockRestore();
  });

  it("leaves an owner out when the chain does not answer for it, and reads it again next time", async () => {
    const requests = { count: 0, calls: 0 };
    const fake = robinhoodRpcFake({ balances: { [owner(1)]: { NVDA: 1 } }, requests });
    let down = true;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => (down ? new Response("down", { status: 502 }) : fake(url, init))));
    const read = makeRobinhoodHoldingsReader();
    expect((await read([owner(1)])).has(owner(1))).toBe(false);
    await expect(robinhoodTotal([owner(1)], read)).rejects.toThrow("unread");
    down = false;
    expect((await read([owner(1)])).get(owner(1))).toEqual({ NVDA: 1 });
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

  it("logs an error without call data, RPC URLs or length (rh-ux-sec m4)", () => {
    const line = safeError(
      new Error(`HTTP request failed. URL: https://rpc.mainnet.chain.robinhood.com/?key=secret Request body: {"data":"0x82ad56cb${"00".repeat(40)}"}\nmore`),
    );
    expect(line).not.toContain("robinhood.com");
    expect(line).not.toContain("82ad56cb");
    expect(line.length).toBeLessThanOrEqual(90);
    expect(line.startsWith("Error: HTTP request failed.")).toBe(true);
    expect(safeError("plain")).toBe("string: plain");
  });
});
