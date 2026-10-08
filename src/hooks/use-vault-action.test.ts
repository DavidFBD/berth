import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The hook's React and wallet world stays out: dapp-kit (whose wallet
// barrel reaches browser-only wallet SDKs) and the hooks that read the
// session are stubbed, so only the pure send logic below is exercised.
vi.mock("@sodax/dapp-kit", () => ({
  useLeverageYieldDeposit: vi.fn(),
  useLeverageYieldWithdraw: vi.fn(),
  useSodaxContext: vi.fn(),
  useStatus: vi.fn(),
  useSwapApprove: vi.fn(),
}));
vi.mock("@/hooks/use-error-reporter", () => ({ useErrorReporter: vi.fn() }));
vi.mock("@/hooks/use-profile", () => ({ useAwardPour: vi.fn() }));
vi.mock("@/hooks/use-limit-orders", () => ({ useRecordLimitOrder: vi.fn() }));
vi.mock("@/hooks/use-hub-holdings", () => ({ LISTINGS_QUERY_KEY: ["listings"] }));
vi.mock("@/hooks/use-delivery", () => ({ DELIVERY_QUERY_KEY: ["delivery"] }));
vi.mock("@/lib/toast", () => ({ toast: vi.fn() }));

import { heldOrderNotice, sendUnlessStalled } from "./use-vault-action";
import {
  OUTCOME_HOLD_MS,
  SPONSORED_SEND_DEADLINE_MS,
  outcomeHoldUntil,
  resetOutcomeHold,
  subscribeSponsoredStall,
  withGasSponsor,
} from "@/lib/gas-sponsor";
import type { PourStep } from "@/lib/pour-lifecycle";

const HASH = `0x${"ef".repeat(32)}`;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetOutcomeHold();
});

describe("heldOrderNotice", () => {
  it("says an earlier order may still go through only on an idle screen under the hold", () => {
    expect(heldOrderNotice("idle", true)).toBe(true);
    expect(heldOrderNotice("idle", false)).toBe(false);
  });

  it("leaves a screen with an order in hand to show that order", () => {
    const busy: PourStep[] = ["building", "approving", "signing", "confirming", "tracking", "resting", "filled", "fillFailed", "unsettled", "error"];
    for (const step of busy) expect(heldOrderNotice(step, true)).toBe(false);
  });
});

/** A stall the test announces itself. */
function stallSwitch() {
  const listeners = new Set<() => void>();
  const subscribe = vi.fn((listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  });
  return { subscribe, fire: () => [...listeners].forEach((listener) => listener()), size: () => listeners.size };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Created = { ok: true; value: { tx: string } } | { ok: false; error: unknown };

describe("sendUnlessStalled", () => {
  it("hands back the result of a send that answers in time, and stops listening", async () => {
    const stall = stallSwitch();
    const onStalled = vi.fn();
    const onLate = vi.fn();
    const send = vi.fn(async (): Promise<Created> => ({ ok: true, value: { tx: HASH } }));
    const raced = await sendUnlessStalled(send, { label: "order", onStalled, onLate, subscribe: stall.subscribe });
    expect(raced).toEqual({ stalled: false, value: { ok: true, value: { tx: HASH } } });
    expect(send).toHaveBeenCalledOnce();
    expect(stall.size()).toBe(0);
    expect(onStalled).not.toHaveBeenCalled();
    expect(onLate).not.toHaveBeenCalled();
  });

  it("passes a throw in time to the caller, and stops listening", async () => {
    const stall = stallSwitch();
    await expect(
      sendUnlessStalled(async (): Promise<Created> => Promise.reject(new Error("boom")), {
        label: "order",
        onStalled: vi.fn(),
        onLate: vi.fn(),
        subscribe: stall.subscribe,
      }),
    ).rejects.toThrow("boom");
    expect(stall.size()).toBe(0);
  });

  it("lets the screen go at the stall, then carries a late hash on once, never sending again", async () => {
    const stall = stallSwitch();
    const privy = deferred<Created>();
    const send = vi.fn(() => privy.promise);
    const order: string[] = [];
    const onStalled = vi.fn(() => void order.push("stalled"));
    const onLate = vi.fn(async (value: { tx: string }) => void order.push(`late ${value.tx}`));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const racing = sendUnlessStalled(send, { label: "order", onStalled, onLate, subscribe: stall.subscribe });
    stall.fire();
    await expect(racing).resolves.toEqual({ stalled: true });
    expect(onStalled).toHaveBeenCalledOnce();
    expect(onLate).not.toHaveBeenCalled();
    privy.resolve({ ok: true, value: { tx: HASH } });
    await vi.waitFor(() => expect(onLate).toHaveBeenCalledOnce());
    expect(order).toEqual(["stalled", `late ${HASH}`]);
    expect(send).toHaveBeenCalledOnce();
  });

  it("tells the screen of the stall before a late answer already in hand", async () => {
    const stall = stallSwitch();
    const order: string[] = [];
    // The stall is announced, then the send answers in the very next tick.
    const send = () => {
      stall.fire();
      return Promise.resolve().then((): Created => ({ ok: true, value: { tx: HASH } }));
    };
    const raced = await sendUnlessStalled(send, {
      label: "order",
      onStalled: () => void order.push("stalled"),
      onLate: () => void order.push("late"),
      subscribe: stall.subscribe,
    });
    expect(raced.stalled).toBe(true);
    await vi.waitFor(() => expect(order).toEqual(["stalled", "late"]));
  });

  it("does nothing more when the late send did not go out, or threw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const answer of [
      (d: ReturnType<typeof deferred<Created>>) => d.resolve({ ok: false, error: new Error("refused late") }),
      (d: ReturnType<typeof deferred<Created>>) => d.reject(new Error("gone")),
    ]) {
      const stall = stallSwitch();
      const privy = deferred<Created>();
      const onLate = vi.fn();
      const racing = sendUnlessStalled(() => privy.promise, { label: "limit order", onStalled: vi.fn(), onLate, subscribe: stall.subscribe });
      stall.fire();
      await racing;
      answer(privy);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onLate).not.toHaveBeenCalled();
    }
    expect(warn).toHaveBeenCalledWith("[vault-action] late limit order did not go out", expect.any(Error));
    expect(error).toHaveBeenCalledWith("[vault-action] late limit order", expect.any(Error));
  });
});

/**
 * The order's real path with the wallet and the SDK mocked: the SDK's
 * createVaultIntent sends through the embedded wallet wrapped in
 * withGasSponsor, whose sponsored send is Privy's, held in the test's hand.
 */
function orderRig(privy: () => Promise<{ hash: string }>) {
  const paid = vi.fn(async () => "0xpaid");
  const sendSponsored = vi.fn(privy);
  const wallet = withGasSponsor({ request: paid }, { chainId: 8453, address: "0xa", active: () => true, sendSponsored });
  const createVaultIntent = vi.fn(async (): Promise<Created> => {
    try {
      const tx = (await wallet.request({ method: "eth_sendTransaction", params: [{ from: "0xa", to: "0xb", data: "0x12" }] })) as string;
      return { ok: true, value: { tx } };
    } catch (error) {
      return { ok: false, error: { code: "INTENT_CREATION_FAILED", cause: error } };
    }
  });
  const onStalled = vi.fn();
  const onLate = vi.fn();
  const run = () => sendUnlessStalled(createVaultIntent, { label: "order", onStalled, onLate, subscribe: subscribeSponsoredStall });
  return { paid, sendSponsored, createVaultIntent, onStalled, onLate, run };
}

describe("an order sent with gas sponsored", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("holds the buttons while Privy is asked and frees them with the hash", async () => {
    const privy = deferred<{ hash: string }>();
    const rig = orderRig(() => privy.promise);
    const racing = rig.run();
    await vi.waitFor(() => expect(rig.sendSponsored).toHaveBeenCalledOnce());
    expect(outcomeHoldUntil()).toBeGreaterThan(Date.now());
    privy.resolve({ hash: HASH });
    await expect(racing).resolves.toEqual({ stalled: false, value: { ok: true, value: { tx: HASH } } });
    expect(outcomeHoldUntil()).toBe(0);
    expect(rig.onStalled).not.toHaveBeenCalled();
  });

  it("a reload while Privy is asked comes back with Buy held and the calm note", async () => {
    const items = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
        removeItem: (key: string) => void items.delete(key),
      },
    });
    const rig = orderRig(() => new Promise(() => {}));
    void rig.run();
    await vi.waitFor(() => expect(rig.sendSponsored).toHaveBeenCalledOnce());
    // The page goes; a fresh one reads the hold from storage on load.
    vi.resetModules();
    const fresh = await import("@/lib/gas-sponsor");
    expect(fresh.outcomeHoldUntil()).toBeGreaterThan(Date.now());
    expect(heldOrderNotice("idle", fresh.outcomeHoldUntil() > Date.now())).toBe(true);
  });

  it("past the deadline: lets the screen go held, then a late hash carries on once", async () => {
    vi.useFakeTimers();
    const privy = deferred<{ hash: string }>();
    const rig = orderRig(() => privy.promise);
    const racing = rig.run();
    await vi.advanceTimersByTimeAsync(SPONSORED_SEND_DEADLINE_MS);
    await expect(racing).resolves.toEqual({ stalled: true });
    expect(rig.onStalled).toHaveBeenCalledOnce();
    // The screen is reset to idle by now; the note shows while Privy is silent.
    await vi.advanceTimersByTimeAsync(3 * OUTCOME_HOLD_MS);
    expect(heldOrderNotice("idle", outcomeHoldUntil() > Date.now())).toBe(true);
    privy.resolve({ hash: HASH });
    await vi.advanceTimersByTimeAsync(0);
    expect(rig.onLate).toHaveBeenCalledOnce();
    expect(rig.onLate).toHaveBeenCalledWith({ tx: HASH });
    expect(rig.sendSponsored).toHaveBeenCalledOnce();
    expect(rig.createVaultIntent).toHaveBeenCalledOnce();
    expect(rig.paid).not.toHaveBeenCalled();
    // A fresh minute from the late answer, then free.
    expect(outcomeHoldUntil()).toBe(Date.now() + OUTCOME_HOLD_MS);
    await vi.advanceTimersByTimeAsync(OUTCOME_HOLD_MS + 1);
    expect(heldOrderNotice("idle", outcomeHoldUntil() > Date.now())).toBe(false);
  });

  it("past the deadline: a late refusal goes no further and frees the buttons", async () => {
    vi.useFakeTimers();
    const privy = deferred<{ hash: string }>();
    const rig = orderRig(() => privy.promise);
    const racing = rig.run();
    await vi.advanceTimersByTimeAsync(SPONSORED_SEND_DEADLINE_MS + 10_000);
    await racing;
    privy.reject(Object.assign(new Error("Insufficient balance for gas sponsorship"), { status: 402 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(rig.onLate).not.toHaveBeenCalled();
    expect(rig.paid).not.toHaveBeenCalled();
    expect(rig.sendSponsored).toHaveBeenCalledOnce();
    expect(outcomeHoldUntil()).toBe(0);
  });
});
