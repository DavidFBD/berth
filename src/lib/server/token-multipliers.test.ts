import { afterEach, describe, expect, it, vi } from "vitest";
import { ROBINHOOD_CHAIN_ADDRESS_BY_SYMBOL } from "@/lib/market-ids";
import { robinhoodRpcFake } from "@/lib/server/robinhood-rpc-fake";
import { readMultiplierHistories, toTokenPrices, type MultiplierReader } from "@/lib/server/token-multipliers";

const s = (iso: string) => Date.parse(iso) / 1000;
const SPY_CHANGE = { from: 1, to: 1.001717991, effectiveAt: s("2026-09-18T00:10:33Z") };

describe("reading the multipliers from Robinhood Chain", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads each token's multiplier now and its changes, walking back until the window is covered", async () => {
    const fetchMock = vi.fn(
      robinhoodRpcFake({
        multipliers: { SGOV: 1.00510177, SPY: 1.001717991 },
        changes: { SPY: [SPY_CHANGE], SGOV: [{ from: 1.002981519, to: 1.00510177, effectiveAt: s("2026-09-01T00:00:26Z") }] },
        genesisSeconds: s("2026-06-10T00:00:00Z"),
        latestBlock: s("2026-09-29T12:00:00Z") - s("2026-06-10T00:00:00Z"),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const read = await readMultiplierHistories(["SGOV", "SPY", "BTC"], Date.parse("2026-08-25T00:00:00Z"));
    expect(read.failures).toEqual([]);
    expect(Object.keys(read.histories).sort()).toEqual(["SGOV", "SPY"]);
    expect(read.histories.SGOV.current).toBeCloseTo(1.00510177, 8);
    expect(read.histories.SPY.changes).toEqual([{ from: 1, to: expect.closeTo(1.001717991, 8), effectiveAt: SPY_CHANGE.effectiveAt }]);
    expect(read.histories.SGOV.changes).toHaveLength(1);
    // One head batch and one batch per ten million blocks reached back.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reads every listing in batches of at most twelve tokens, and no events for a multiplier of exactly one", async () => {
    const symbols = Object.keys(ROBINHOOD_CHAIN_ADDRESS_BY_SYMBOL);
    const fake = robinhoodRpcFake({
      multipliers: { SGOV: 1.00510177, SPY: 1.001717991, GOOGL: 1.000193924 },
      changes: { SPY: [SPY_CHANGE] },
      genesisSeconds: s("2026-06-10T00:00:00Z"),
      latestBlock: s("2026-09-29T12:00:00Z") - s("2026-06-10T00:00:00Z"),
    });
    const sizes: number[] = [];
    const logsAsked = new Set<string>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const calls = JSON.parse(String(init?.body)) as { method: string; params: [{ address?: string }] }[];
        sizes.push(calls.length);
        for (const call of calls) if (call.method === "eth_getLogs") logsAsked.add(String(call.params[0].address).toLowerCase());
        return fake(url, init);
      }),
    );
    const read = await readMultiplierHistories(symbols, Date.parse("2026-08-25T00:00:00Z"));
    expect(read.failures).toEqual([]);
    expect(Object.keys(read.histories)).toHaveLength(symbols.length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(13);
    expect([...logsAsked].sort()).toEqual(
      ["SGOV", "SPY", "GOOGL"].map((symbol) => ROBINHOOD_CHAIN_ADDRESS_BY_SYMBOL[symbol].toLowerCase()).sort(),
    );
    expect(read.histories.AMZN).toEqual({ current: 1, changes: [] });
    expect(read.histories.SPY.changes).toHaveLength(1);
  });

  it("waits and asks again when the public RPC answers 429", async () => {
    const rpc = robinhoodRpcFake({ multipliers: { SGOV: 1.00510177 }, latestBlock: 1_000 });
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => (++calls === 1 ? new Response("slow down", { status: 429 }) : rpc(url, init))),
    );
    const read = await readMultiplierHistories(["SGOV"], 0);
    expect(read.histories.SGOV.current).toBeCloseTo(1.00510177, 8);
    expect(calls).toBe(3);
  });

  it("asks nothing for symbols that are not Robinhood tokens", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await readMultiplierHistories(["BTC", "PAXG"], 0)).toEqual({ histories: {}, failures: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("DefiLlama prices as token prices", () => {
  const reader =
    (histories: Awaited<ReturnType<MultiplierReader>>["histories"]): MultiplierReader =>
    async () => ({ histories, failures: [] });

  it("multiplies share quotes, keeps the token prints before the switch, and passes other coins through", async () => {
    const { prices, unread } = await toTokenPrices(
      {
        SGOV: [
          { timestamp: s("2026-09-01T21:30:00Z"), price: 100.95459352 },
          { timestamp: s("2026-09-28T21:30:00Z"), price: 100.665 },
        ],
        SPY: [
          { timestamp: s("2026-09-17T21:30:00Z"), price: 760 },
          { timestamp: s("2026-09-18T21:30:00Z"), price: 764.98 },
        ],
        BTC: [{ timestamp: s("2026-09-28T21:30:00Z"), price: 90000 }],
      },
      reader({ SGOV: { current: 1.00510177, changes: [] }, SPY: { current: 1.001717991, changes: [SPY_CHANGE] } }),
    );
    expect(unread).toEqual([]);
    expect(prices.SGOV.map((point) => point.price)).toEqual([100.95459352, expect.closeTo(101.17856, 4)]);
    expect(prices.SPY.map((point) => point.price)).toEqual([760, expect.closeTo(766.2941, 3)]);
    expect(prices.BTC[0].price).toBe(90000);
  });

  it("leaves out a token whose multiplier could not be read, and says so", async () => {
    const failing: MultiplierReader = async () => {
      throw new Error("down");
    };
    const { prices, unread } = await toTokenPrices(
      { SGOV: [{ timestamp: s("2026-09-28T21:30:00Z"), price: 100.665 }], PAXG: [{ timestamp: s("2026-09-28T21:30:00Z"), price: 4000 }] },
      failing,
    );
    expect(unread).toEqual(["SGOV"]);
    expect(Object.keys(prices)).toEqual(["PAXG"]);
  });

  it("does not read the chain for prices that all predate the switch", async () => {
    const read = vi.fn<MultiplierReader>();
    const { prices } = await toTokenPrices({ SGOV: [{ timestamp: s("2026-08-20T21:30:00Z"), price: 100.88 }] }, read);
    expect(read).not.toHaveBeenCalled();
    expect(prices.SGOV[0].price).toBe(100.88);
  });
});
