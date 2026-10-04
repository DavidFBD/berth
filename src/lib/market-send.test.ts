import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NOTIFY_ATTEMPTS,
  RENOTIFY_GAP_MS,
  RENOTIFY_MAX,
  SOLVER_NOTIFY_DEADLINE_MS,
  STATUS_NOT_FOUND,
  notifyWithRetries,
  notifyWithin,
  reachHub,
  renotifyDue,
  unlessStalled,
  type ReachHubDeps,
} from "./market-send";

const TX = `0x${"1".repeat(64)}`;
const HUB = `0x${"2".repeat(64)}`;

function deps(over: Partial<ReachHubDeps<{ intentId: bigint }>> = {}) {
  const base = {
    created: { ok: true as const, value: { tx: TX, intent: { intentId: 7n }, relayData: "0xdata" as unknown } },
    verify: vi.fn(async () => ({ ok: true as const, value: true })),
    relay: vi.fn(async () => ({ ok: true as const, value: { dst_tx_hash: HUB } })),
    mapVerifyError: (error: unknown) => ({ code: "TX_VERIFICATION_FAILED", cause: error }),
    mapRelayError: (error: unknown) => ({ code: "RELAY_TIMEOUT", cause: error }),
  };
  return { ...base, ...over } as typeof base;
}

afterEach(() => vi.useRealTimers());

describe("notifyWithin", () => {
  it("gives the solver about twenty seconds a try", () => {
    expect(SOLVER_NOTIFY_DEADLINE_MS).toBe(20_000);
  });

  it("answers no answer once the deadline passes, without throwing", async () => {
    vi.useFakeTimers();
    const told = notifyWithin(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(SOLVER_NOTIFY_DEADLINE_MS);
    await expect(told).resolves.toEqual({ ok: false, error: "no answer from the solver within 20s" });
  });

  it("turns a throw into an error answer", async () => {
    await expect(notifyWithin(async () => Promise.reject(new Error("fetch failed")))).resolves.toEqual({ ok: false, error: "fetch failed" });
  });
});

describe("notifyWithRetries", () => {
  it("tries three times, 2 s then 4 s apart, each try bounded", async () => {
    vi.useFakeTimers();
    const notify = vi.fn(() => new Promise<never>(() => {}));
    const sleep = vi.fn((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const told = notifyWithRetries(notify, { sleep });
    await vi.advanceTimersByTimeAsync(3 * SOLVER_NOTIFY_DEADLINE_MS + 6_000);
    await expect(told).resolves.toMatchObject({ ok: false });
    expect(notify).toHaveBeenCalledTimes(NOTIFY_ATTEMPTS);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2_000, 4_000]);
  });

  it("stops at the first yes", async () => {
    const notify = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "EXTERNAL_API_ERROR" })
      .mockResolvedValueOnce({ ok: true, intentHash: "0xintent" });
    await expect(notifyWithRetries(notify, { sleep: async () => {} })).resolves.toEqual({ ok: true, intentHash: "0xintent" });
    expect(notify).toHaveBeenCalledTimes(2);
  });
});

describe("renotifyDue", () => {
  const state = { hubTxHash: HUB, busy: false, renotifies: 0, lastAt: 0 };

  it("tells the solver again only while the fill watch reads NOT_FOUND", () => {
    expect(STATUS_NOT_FOUND).toBe(-1);
    expect(renotifyDue(-1, state, RENOTIFY_GAP_MS)).toBe(true);
    for (const code of [undefined, 0, 1, 2, 3, 4]) expect(renotifyDue(code, state, RENOTIFY_GAP_MS)).toBe(false);
  });

  it("never while a notify is out, never too soon, and a few times at most", () => {
    expect(renotifyDue(-1, { ...state, busy: true }, RENOTIFY_GAP_MS)).toBe(false);
    expect(renotifyDue(-1, { ...state, lastAt: 1_000 }, 1_000 + RENOTIFY_GAP_MS - 1)).toBe(false);
    expect(renotifyDue(-1, { ...state, renotifies: RENOTIFY_MAX }, 10 * RENOTIFY_GAP_MS)).toBe(false);
    expect(RENOTIFY_MAX).toBe(3);
  });
});

describe("reachHub", () => {
  it("verifies and relays once each and returns the order on the hub", async () => {
    const d = deps();
    await expect(reachHub(d)).resolves.toEqual({ ok: true, intent: { intentId: 7n }, spokeTxHash: TX, hubTxHash: HUB });
    expect(d.verify).toHaveBeenCalledOnce();
    expect(d.relay).toHaveBeenCalledOnce();
    expect(d.relay).toHaveBeenCalledWith(TX, "0xdata");
  });

  it("nothing sent: fails, and nothing after runs", async () => {
    const d = deps({ created: { ok: false, error: { code: "CREATE_INTENT_FAILED" } } });
    await expect(reachHub(d)).resolves.toEqual({ ok: false, error: { code: "CREATE_INTENT_FAILED" } });
    expect(d.verify).not.toHaveBeenCalled();
    expect(d.relay).not.toHaveBeenCalled();
  });

  it("a relay failure fails as vaultSwap did, and is never relayed again", async () => {
    const d = deps({ relay: vi.fn(async () => ({ ok: false as const, error: "timeout" })) });
    await expect(reachHub(d)).resolves.toEqual({ ok: false, error: { code: "RELAY_TIMEOUT", cause: "timeout" } });
    expect(d.relay).toHaveBeenCalledOnce();
  });

  it("from the hub itself there is no relay: the spoke tx is the hub tx", async () => {
    await expect(reachHub(deps({ relay: undefined }))).resolves.toMatchObject({ ok: true, hubTxHash: TX });
  });
});

describe("unlessStalled", () => {
  it("hands back the work when it ends first", async () => {
    await expect(unlessStalled(Promise.resolve(5), new Promise(() => {}))).resolves.toEqual({ stalled: false, value: 5 });
  });

  it("lets go at the stall and hands back the same work, still running", async () => {
    let finish!: (value: number) => void;
    const work = new Promise<number>((resolve) => (finish = resolve));
    const raced = await unlessStalled(work, Promise.resolve());
    expect(raced.stalled).toBe(true);
    finish(9);
    if (raced.stalled) await expect(raced.later).resolves.toBe(9);
  });

  it("a failure before the stall is the work's own failure", async () => {
    await expect(unlessStalled(Promise.reject(new Error("no")), new Promise(() => {}))).rejects.toThrow("no");
  });
});
