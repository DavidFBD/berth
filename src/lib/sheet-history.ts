/**
 * The history bookkeeping behind "back closes the sheet".
 *
 * A sheet that opens pushes one history entry whose state carries
 * `berthDepth`, its place in the stack of open sheets (1 for the first, 2 for
 * a picker over it). The browser's back button, the iOS edge swipe and the
 * Android back gesture then pop that entry, and a popstate whose depth is
 * lower than the sheets still open closes them, top first. When a sheet
 * closes any other way (the X, a swipe, the overlay, code) the entry it
 * pushed is popped for it, once, in a batch, so a parent and its picker
 * closing together cost one history.go.
 *
 * Next's App Router keeps its own data in history.state, so every push
 * spreads the current state and only adds the marker. A navigation made
 * while a sheet is open replaces the state with one that has no marker, and
 * then nothing here ever calls back: the depth is read from the state at the
 * moment of closing, never remembered, so a route change is never undone.
 *
 * A sheet that refuses to close (a signature is in flight) is asked once and,
 * if it is still open a moment later, its entry is pushed again, so the page
 * stays and the sheet stays.
 *
 * Pure: the browser arrives through `HistoryPort`, so the rules are testable
 * without a window.
 */

export type HistoryPort = {
  getState(): unknown;
  /** Push a new entry carrying `state`. */
  push(state: unknown): void;
  /** Traverse by `delta` entries (negative is back). Asynchronous in a browser. */
  go(delta: number): void;
};

type Entry = {
  id: string;
  close: () => void;
  stillOpen: () => boolean;
  closed: boolean;
};

const MARKER = "berthDepth";

function depthOf(state: unknown): number {
  if (state && typeof state === "object") {
    const depth = (state as Record<string, unknown>)[MARKER];
    if (typeof depth === "number" && depth > 0) return depth;
  }
  return 0;
}

/** The state to push: Next's own object kept whole, plus the marker. */
export function withDepth(state: unknown, depth: number): Record<string, unknown> {
  const base = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
  return { ...base, [MARKER]: depth };
}

export type SheetHistory = {
  open(id: string, close: () => void, stillOpen: () => boolean): void;
  release(id: string): void;
  popstate(): void;
};

export function createSheetHistory(
  port: HistoryPort,
  schedule: (fn: () => void, ms: number) => void,
): SheetHistory {
  const stack: Entry[] = [];
  // Depth levels a go() has been asked for and popstate has not yet confirmed.
  let inflight = 0;

  const flush = () => {
    let trimmed = 0;
    while (stack.length > 0 && stack[stack.length - 1].closed) {
      stack.pop();
      trimmed += 1;
    }
    if (trimmed === 0) return;
    // How many of our entries still sit in history above what is open now.
    // Zero when the state has no marker (a navigation replaced it) or when
    // the entries were already popped by the person.
    const owed = depthOf(port.getState()) - inflight - stack.length;
    if (owed > 0) {
      inflight += owed;
      port.go(-owed);
    }
  };

  const reassert = (entry: Entry) => {
    if (entry.closed || !stack.includes(entry)) return;
    if (!entry.stillOpen()) return;
    // It refused. Put back whatever the pop took, so the page stays put.
    for (let depth = depthOf(port.getState()) + 1; depth <= stack.length; depth += 1) {
      port.push(withDepth(port.getState(), depth));
    }
  };

  return {
    open(id, close, stillOpen) {
      stack.push({ id, close, stillOpen, closed: false });
      port.push(withDepth(port.getState(), stack.length));
    },

    release(id) {
      const entry = [...stack].reverse().find((candidate) => candidate.id === id && !candidate.closed);
      if (!entry) return;
      entry.closed = true;
      // Deferred a tick: a parent and its picker closing together, or a
      // strict-mode effect that closes and reopens, settle before any history
      // call is made.
      schedule(flush, 0);
    },

    popstate() {
      inflight = 0;
      const depth = depthOf(port.getState());
      // Entries above the new depth lost their history entry: ask the live
      // ones to close, top first.
      const asked: Entry[] = [];
      for (let index = stack.length - 1; index >= depth; index -= 1) {
        const entry = stack[index];
        if (entry.closed) continue;
        asked.push(entry);
      }
      // Entries already closed above the depth have no entry left to pop.
      for (const entry of asked) entry.close();
      for (const entry of asked) schedule(() => reassert(entry), 60);
      // Drop closed entries from the top that history no longer holds.
      while (stack.length > depth && stack[stack.length - 1].closed) stack.pop();
    },
  };
}
