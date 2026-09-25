import { describe, expect, it } from "vitest";
import { SolverIntentStatusCode } from "@sodax/sdk";
import {
  runSlowOrder,
  waitForRelay,
  watchFill,
  type FillStatus,
  type RelayDeps,
  type SlowOrderEvent,
} from "./slow-order";

const SOLVED = SolverIntentStatusCode.SOLVED;
const FAILED = SolverIntentStatusCode.FAILED;
const STARTED = SolverIntentStatusCode.STARTED_NOT_FINISHED;
const MIN = 60_000;
const HUB = "0x" + "c".repeat(64);

/** A virtual clock: sleeping and polling move time, nothing waits for real. */
function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const err = (code: string) => ({ ok: false as const, error: new Error(code) });
const packet = { ok: true as const, value: { dst_tx_hash: HUB } };

/**
 * A relayer scripted by time: `poll` answers from `answer(now, window)`,
 * moving the clock by however long that answer took.
 */
function relayer(
  c: ReturnType<typeof clock>,
  opts: {
    submit?: (n: number) => boolean;
    answer: (now: number, window: number) => { ok: boolean; after: number; code?: string };
  },
) {
  let submits = 0;
  let polls = 0;
  const deps: RelayDeps = {
    now: c.now,
    sleep: c.sleep,
    submit: async () => {
      submits += 1;
      return (opts.submit ?? (() => true))(submits)
        ? { ok: true, value: {} }
        : err("SUBMIT_TX_FAILED");
    },
    poll: async (window) => {
      polls += 1;
      const a = opts.answer(c.now(), window);
      c.advance(Math.min(a.after, window));
      if (a.ok && a.after <= window) return packet;
      return err(a.ok ? "RELAY_TIMEOUT" : (a.code ?? "RELAY_TIMEOUT"));
    },
  };
  return { deps, submits: () => submits, polls: () => polls };
}

describe("waitForRelay", () => {
  it("rides out relayer errors and lands when the packet does", () => {
    // A 502 two seconds in, a 429 later, then a quiet wait until the block
    // lands at minute 25: the SDK's own wait would have stopped at the 502.
    const c = clock();
    const r = relayer(c, {
      answer: (now) =>
        now < 2_000
          ? { ok: false, after: 2_000, code: "RELAY_POLLING_FAILED" }
          : now < 10 * MIN
            ? { ok: false, after: 5 * MIN, code: "RELAY_POLLING_FAILED" }
            : { ok: true, after: 25 * MIN - now },
    });
    return waitForRelay(r.deps, { budgetMs: 90 * MIN, broadcast: true }).then((outcome) => {
      expect(outcome).toEqual({ kind: "landed", hubTxHash: HUB });
      expect(r.submits()).toBe(1);
      expect(c.now()).toBeLessThan(90 * MIN);
    });
  });

  it("keeps polling through errors until the whole budget is spent", async () => {
    const c = clock();
    const r = relayer(c, {
      answer: () => ({ ok: false, after: 1_000, code: "RELAY_POLLING_FAILED" }),
    });
    const outcome = await waitForRelay(r.deps, { budgetMs: 90 * MIN, broadcast: true });
    expect(outcome).toEqual({ kind: "spent", relayError: "RELAY_POLLING_FAILED" });
    expect(c.now()).toBe(90 * MIN);
    // Backed off, not hammered: about a minute apart once warmed up.
    expect(r.polls()).toBeLessThan(120);
  });

  it("calls a quiet wait to the end of the budget a timeout", async () => {
    const c = clock();
    const r = relayer(c, { answer: () => ({ ok: true, after: Infinity }) });
    const outcome = await waitForRelay(r.deps, { budgetMs: 90 * MIN, broadcast: true });
    expect(outcome).toEqual({ kind: "spent", relayError: "RELAY_TIMEOUT" });
    expect(c.now()).toBe(90 * MIN);
  });

  it("keeps offering a broadcast payment to a relayer that will not take it", async () => {
    const c = clock();
    const r = relayer(c, {
      submit: (n) => n >= 4,
      // The packet executes at minute ten; the relayer takes the fourth submit.
      answer: (now) => ({ ok: true, after: Math.max(0, 10 * MIN - now) }),
    });
    const outcome = await waitForRelay(r.deps, { budgetMs: 90 * MIN, broadcast: true });
    expect(outcome.kind).toBe("landed");
    expect(r.submits()).toBe(4);
  });

  it("says a broadcast payment the relayer never took is spent, not failed", async () => {
    const c = clock();
    const r = relayer(c, { submit: () => false, answer: () => ({ ok: true, after: Infinity }) });
    const outcome = await waitForRelay(r.deps, { budgetMs: 90 * MIN, broadcast: true });
    expect(outcome).toEqual({ kind: "spent", relayError: "SUBMIT_TX_FAILED" });
  });

  it("gives an unbroadcast payload the relayer never took back as not accepted", async () => {
    const c = clock();
    const r = relayer(c, { submit: () => false, answer: () => ({ ok: true, after: Infinity }) });
    const outcome = await waitForRelay(r.deps, { budgetMs: 2 * MIN, broadcast: false });
    expect(outcome).toEqual({ kind: "notAccepted", relayError: "SUBMIT_TX_FAILED" });
    expect(r.submits()).toBe(3);
    expect(c.now()).toBeLessThan(MIN);
  });

  it("treats an accepted payload that never executes as spent, not as nothing moved", async () => {
    const c = clock();
    const r = relayer(c, { answer: () => ({ ok: true, after: Infinity }) });
    const outcome = await waitForRelay(r.deps, { budgetMs: 2 * MIN, broadcast: false });
    expect(outcome).toEqual({ kind: "spent", relayError: "RELAY_TIMEOUT" });
  });
});

describe("watchFill", () => {
  const opts = { releaseMs: 90_000, budgetMs: 30 * MIN, intervalMs: 3_000, lateIntervalMs: 10_000 };

  function solver(answers: (now: number) => FillStatus) {
    const c = clock();
    const released: FillStatus[] = [];
    return {
      c,
      released,
      deps: {
        status: async () => answers(c.now()),
        sleep: c.sleep,
        now: c.now,
        onRelease: (last: FillStatus) => released.push(last),
      },
    };
  }

  it("fills without a release when the solver answers inside the wait", async () => {
    const s = solver((now) => ({ code: now > 20_000 ? SOLVED : STARTED, fillTxHash: "0xf" }));
    expect(await watchFill(s.deps, opts)).toEqual({ kind: "filled", fillTxHash: "0xf", released: false });
    expect(s.released).toEqual([]);
  });

  it("releases once, keeping the last real status past an erroring poll, then lets a late fill through", async () => {
    const s = solver((now) =>
      now < 30_000 ? { code: STARTED } : now < 5 * MIN ? { error: "503" } : { code: SOLVED },
    );
    const ended = await watchFill(s.deps, opts);
    expect(ended).toMatchObject({ kind: "filled", released: true });
    expect(s.released).toHaveLength(1);
    expect(s.released[0]).toMatchObject({ code: STARTED, error: "503" });
  });

  it("reports a failed fill as failed", async () => {
    const s = solver(() => ({ code: FAILED }));
    expect((await watchFill(s.deps, opts)).kind).toBe("fillFailed");
  });

  it("gives up after its budget, released exactly once", async () => {
    const s = solver(() => ({ code: STARTED }));
    expect(await watchFill(s.deps, opts)).toEqual({ kind: "gaveUp" });
    expect(s.released).toHaveLength(1);
  });
});

describe("runSlowOrder", () => {
  const fill = { releaseMs: 90_000, budgetMs: 30 * MIN, intervalMs: 3_000, lateIntervalMs: 10_000 };

  async function play(opts: {
    relay: Awaited<ReturnType<RelayDeps["poll"]>> | { kind: "notAccepted" | "spent"; relayError: string };
    notifyOk?: (n: number) => boolean;
    status?: (now: number) => FillStatus;
  }) {
    const c = clock();
    const events: SlowOrderEvent[] = [];
    let notifies = 0;
    await runSlowOrder(
      {
        relay: async () =>
          "kind" in opts.relay
            ? opts.relay
            : { kind: "landed", hubTxHash: HUB },
        notify: async (hub) => {
          expect(hub).toBe(HUB);
          notifies += 1;
          return (opts.notifyOk ?? (() => true))(notifies)
            ? { ok: true, intentHash: "0xi" }
            : { ok: false, error: "Error: 503" };
        },
        status: async () => (opts.status ?? (() => ({ code: SOLVED })))(c.now()),
        sleep: c.sleep,
        now: c.now,
        emit: (event) => events.push(event),
      },
      fill,
    );
    const count = (type: SlowOrderEvent["type"]) =>
      events.filter((event) => event.type === type).length;
    return { events, count, notifies };
  }

  it("tells the solver once the packet lands, then fills exactly once", async () => {
    const { events, count, notifies } = await play({ relay: packet });
    expect(notifies).toBe(1);
    expect(events[0]).toEqual({ type: "onHub", hubTxHash: HUB, intentHash: "0xi", notifyError: undefined });
    expect(count("filled")).toBe(1);
    expect(count("released")).toBe(0);
    expect(count("fillFailed")).toBe(0);
  });

  it("tries the solver three times, says so if it never answers, and still watches", async () => {
    const { events, count, notifies } = await play({ relay: packet, notifyOk: () => false });
    expect(notifies).toBe(3);
    expect(events[0]).toMatchObject({ type: "onHub", notifyError: "Error: 503" });
    expect(count("filled")).toBe(1);
  });

  it("stops at the second try when the solver answers it", async () => {
    const { notifies, events } = await play({ relay: packet, notifyOk: (n) => n >= 2 });
    expect(notifies).toBe(2);
    expect(events[0]).toMatchObject({ type: "onHub", notifyError: undefined });
  });

  it("releases once and ends once for a solver that is slow and then fails", async () => {
    const { count, events } = await play({
      relay: packet,
      status: (now) => ({ code: now > 3 * MIN ? FAILED : STARTED }),
    });
    expect(count("released")).toBe(1);
    expect(count("fillFailed")).toBe(1);
    expect(events.at(-1)).toMatchObject({ type: "fillFailed", released: true });
  });

  it("releases once and gives up quietly when the solver never ends", async () => {
    const { count } = await play({ relay: packet, status: () => ({ code: STARTED }) });
    expect(count("released")).toBe(1);
    expect(count("gaveUp")).toBe(1);
    expect(count("filled") + count("fillFailed")).toBe(0);
  });

  it("never tells the solver about a payment that did not reach the hub", async () => {
    const stalled = await play({ relay: { kind: "spent", relayError: "RELAY_TIMEOUT" } });
    expect(stalled.events).toEqual([
      { type: "stalled", relayError: "RELAY_TIMEOUT", trackedMs: 0 },
    ]);
    expect(stalled.notifies).toBe(0);

    const refused = await play({ relay: { kind: "notAccepted", relayError: "SUBMIT_TX_FAILED" } });
    expect(refused.events).toEqual([{ type: "notAccepted", relayError: "SUBMIT_TX_FAILED" }]);
    expect(refused.notifies).toBe(0);
  });
});
