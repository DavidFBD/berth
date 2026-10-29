import { describe, expect, it } from "vitest";
import { createSheetHistory, type HistoryPort } from "./sheet-history";

/** A browser history in miniature: entries, an index, and traversals that
 * land only when the test says so, as they do in a real browser. */
function setup() {
  const entries: unknown[] = [{ __NA: true, tree: "page" }];
  let index = 0;
  let pending: number | null = null;
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const port: HistoryPort = {
    getState: () => entries[index],
    push: (state) => {
      entries.length = index + 1;
      entries.push(state);
      index += 1;
    },
    go: (delta) => {
      pending = delta;
    },
  };
  const keeper = createSheetHistory(port, (fn, ms) => timers.push({ fn, ms }));
  const run = (ms: number) => {
    for (const timer of timers.splice(0).filter((t) => t.ms === ms)) timer.fn();
  };
  return {
    keeper,
    entries,
    index: () => index,
    /** Run the microtask-sized timers (the deferred release). */
    settle: () => run(0),
    /** Let a pending go() land and fire popstate. */
    land() {
      if (pending === null) return;
      index += pending;
      pending = null;
      keeper.popstate();
    },
    /** The person presses back. */
    back(steps = 1) {
      index -= steps;
      keeper.popstate();
    },
    /** Next's router pushes a new page, replacing the state wholesale. */
    navigate() {
      entries.length = index + 1;
      entries.push({ __NA: true, tree: "elsewhere" });
      index += 1;
    },
    refire: () => run(60),
    pending: () => pending,
  };
}

function sheet(keeper: ReturnType<typeof setup>["keeper"], id: string) {
  const state = { open: true, closes: 0 };
  keeper.open(id, () => {
    state.closes += 1;
    state.open = false;
  }, () => state.open);
  return state;
}

describe("sheet history", () => {
  it("keeps Next's own state when it pushes", () => {
    const t = setup();
    sheet(t.keeper, "a");
    expect(t.entries[1]).toMatchObject({ __NA: true, tree: "page", berthDepth: 1 });
  });

  it("closes the sheet on back, and does not call go itself", () => {
    const t = setup();
    const a = sheet(t.keeper, "a");
    t.back();
    expect(a.closes).toBe(1);
    t.keeper.release("a");
    t.settle();
    expect(t.pending()).toBeNull();
    expect(t.index()).toBe(0);
  });

  it("pops its own entry once when closed another way", () => {
    const t = setup();
    const a = sheet(t.keeper, "a");
    a.open = false;
    t.keeper.release("a");
    t.settle();
    expect(t.pending()).toBe(-1);
    t.land();
    expect(a.closes).toBe(0);
    expect(t.index()).toBe(0);
  });

  it("unwinds two nested sheets one level per back", () => {
    const t = setup();
    const a = sheet(t.keeper, "a");
    const b = sheet(t.keeper, "b");
    t.back();
    expect(b.closes).toBe(1);
    expect(a.closes).toBe(0);
    t.keeper.release("b");
    t.settle();
    t.back();
    expect(a.closes).toBe(1);
    t.keeper.release("a");
    t.settle();
    expect(t.pending()).toBeNull();
    expect(t.index()).toBe(0);
  });

  it("closes both at once when two levels are popped together", () => {
    const t = setup();
    const a = sheet(t.keeper, "a");
    const b = sheet(t.keeper, "b");
    t.back(2);
    expect([a.closes, b.closes]).toEqual([1, 1]);
  });

  it("pops a parent and its picker closing together with one go", () => {
    const t = setup();
    const a = sheet(t.keeper, "a");
    const b = sheet(t.keeper, "b");
    a.open = false;
    b.open = false;
    t.keeper.release("b");
    t.keeper.release("a");
    t.settle();
    expect(t.pending()).toBe(-2);
  });

  it("does not call go when a navigation happened while the sheet was open", () => {
    const t = setup();
    const a = sheet(t.keeper, "a");
    t.navigate();
    a.open = false;
    t.keeper.release("a");
    t.settle();
    expect(t.pending()).toBeNull();
    expect(t.entries[t.index()]).toMatchObject({ tree: "elsewhere" });
  });

  it("puts the entry back when the sheet refuses to close", () => {
    const t = setup();
    const locked = { open: true, asked: 0 };
    t.keeper.open("a", () => { locked.asked += 1; }, () => locked.open);
    t.back();
    expect(locked.asked).toBe(1);
    expect(t.index()).toBe(0);
    t.refire();
    expect(t.index()).toBe(1);
    expect(t.entries[1]).toMatchObject({ berthDepth: 1 });
    // The next back asks again.
    t.back();
    expect(locked.asked).toBe(2);
  });

  it("leaves a strict-mode close and reopen with one entry to pop", () => {
    const t = setup();
    sheet(t.keeper, "a");
    t.keeper.release("a");
    const again = sheet(t.keeper, "a");
    t.settle();
    expect(t.pending()).toBeNull();
    again.open = false;
    t.keeper.release("a");
    t.settle();
    expect(t.pending()).toBe(-2);
  });
});
