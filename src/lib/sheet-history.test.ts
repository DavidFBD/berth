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
    /** The person lands directly on an older entry (a stale one). */
    landOn(i: number) {
      index = i;
      keeper.popstate();
    },
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
    expect(t.entries[1]).toMatchObject({ __NA: true, tree: "page", berthSheets: { depth: 1 } });
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
    expect(t.entries[1]).toMatchObject({ berthSheets: { depth: 1 } });
    // The next back asks again.
    t.back();
    expect(locked.asked).toBe(2);
  });

  it("puts a locked sheet back inside the popstate, without asking it or waiting", () => {
    const t = setup();
    const state = { open: true, asked: 0, locked: true };
    t.keeper.open("a", () => { state.asked += 1; }, () => state.open, () => state.locked);
    expect(t.keeper.anyLocked()).toBe(true);
    t.back();
    expect(state.asked).toBe(0);
    expect(t.index()).toBe(1);
    // A second press straight after is held too, with no timer in between.
    t.back();
    expect(state.asked).toBe(0);
    expect(t.index()).toBe(1);
    state.locked = false;
    expect(t.keeper.anyLocked()).toBe(false);
    t.back();
    expect(state.asked).toBe(1);
  });

  it("closes the picker over a locked sheet and keeps the locked one", () => {
    const t = setup();
    const a = { open: true, asked: 0 };
    t.keeper.open("a", () => { a.asked += 1; }, () => a.open, () => true);
    const b = sheet(t.keeper, "b");
    t.back(2);
    expect(b.closes).toBe(1);
    expect(a.asked).toBe(0);
    expect(t.index()).toBe(1);
  });

  it("ignores a stale marker left by an earlier sheet after navigating away and back", () => {
    const t = setup();
    const first = sheet(t.keeper, "a");
    const staleIndex = t.index();
    t.navigate();
    first.open = false;
    t.keeper.release("a");
    t.settle();
    // Back lands on the old entry, still carrying its marker; the sheet reopens.
    t.landOn(staleIndex);
    const again = sheet(t.keeper, "a2");
    expect(t.index()).toBe(staleIndex + 1);
    t.back();
    // One press closes the sheet; it is not eaten by the stale marker.
    expect(again.closes).toBe(1);
  });

  it("treats a marker from before a reload as the base page", () => {
    const t = setup();
    sheet(t.keeper, "a");
    // A reload: a fresh keeper over the same history, whose entry still has a marker.
    const reloaded = createSheetHistory(
      { getState: () => t.entries[t.index()], push: () => {}, go: () => {} },
      () => {},
    );
    const b = { closes: 0, open: true };
    reloaded.open("b", () => { b.closes += 1; }, () => b.open);
    // The stale marker (depth 1, old token) does not hold the new sheet open.
    reloaded.popstate();
    expect(b.closes).toBe(1);
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

  it("unwinds a sheet that closed as another opened over it in one back", () => {
    // The command palette closes and the buy drawer opens in the same commit.
    const t = setup();
    sheet(t.keeper, "palette");
    t.keeper.release("palette");
    const drawer = sheet(t.keeper, "drawer");
    t.settle();
    expect(t.pending()).toBe(null);
    expect(t.index()).toBe(2);
    t.back();
    expect(drawer.closes).toBe(1);
    t.keeper.release("drawer");
    t.settle();
    // The palette's entry goes with it: no dead back press left behind.
    expect(t.pending()).toBe(-1);
    t.land();
    expect(t.index()).toBe(0);
  });

  it("keeps a sheet that opens while its own pop is still travelling", () => {
    // The palette closes, and the chat sheet mounts a moment later, after the
    // flush asked for go(-1) but before that traversal landed.
    const t = setup();
    sheet(t.keeper, "palette");
    t.keeper.release("palette");
    t.settle();
    expect(t.pending()).toBe(-1);
    const chat = sheet(t.keeper, "chat");
    t.land();
    expect(chat.closes).toBe(0);
    expect(t.index()).toBe(1);
    expect(t.entries[1]).toMatchObject({ berthSheets: { depth: 1 } });
    // And back closes it as usual.
    t.back();
    expect(chat.closes).toBe(1);
  });

  it("drops a sheet that opened and closed while a pop was travelling", () => {
    const t = setup();
    sheet(t.keeper, "palette");
    t.keeper.release("palette");
    t.settle();
    sheet(t.keeper, "blink");
    t.keeper.release("blink");
    t.settle();
    t.land();
    expect(t.index()).toBe(0);
    expect(t.entries.length).toBe(2);
  });
});
