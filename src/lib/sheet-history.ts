/**
 * The history bookkeeping behind "back closes the sheet".
 *
 * A sheet that opens pushes one history entry whose state carries
 * `berthSheets`, its place in the stack of open sheets (1 for the first, 2 for
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
 * A sheet that says it is locked (a signature is being prepared or in
 * flight) is not asked: its entry is pushed again inside the popstate handler
 * itself, so the page stays and a second press within a moment cannot leave.
 * A sheet that refuses without saying so is asked once and, if it is still
 * open a moment later, its entry is pushed again.
 *
 * Markers carry a token minted when the stack goes from empty to one sheet.
 * An entry with another token (left behind by a navigation and a back, or by
 * a reload) counts as the base page, so a stale marker never matches the
 * depth of a sheet opened since.
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
  /** True while the sheet refuses to close (a signature is being prepared or in flight). */
  locked: () => boolean;
  closed: boolean;
  /** False for a sheet opened while our own go() was still travelling: its entry waits for the popstate. */
  pushed: boolean;
};

const MARKER = "berthSheets";

type Marker = { token: string; depth: number };

function markerOf(state: unknown): Marker | null {
  if (state && typeof state === "object") {
    const marker = (state as Record<string, unknown>)[MARKER];
    if (marker && typeof marker === "object") {
      const { token, depth } = marker as Record<string, unknown>;
      if (typeof token === "string" && typeof depth === "number" && depth > 0) return { token, depth };
    }
  }
  return null;
}

/** The state to push: Next's own object kept whole, plus the marker. */
export function withDepth(state: unknown, token: string, depth: number): Record<string, unknown> {
  const base = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
  return { ...base, [MARKER]: { token, depth } };
}

let tokenCount = 0;
function mintToken(): string {
  tokenCount += 1;
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${tokenCount}`;
}

export type SheetHistory = {
  open(id: string, close: () => void, stillOpen: () => boolean, locked?: () => boolean): void;
  release(id: string): void;
  popstate(): void;
  /** Whether any open sheet refuses to close right now (for a beforeunload guard). */
  anyLocked(): boolean;
};

export function createSheetHistory(
  port: HistoryPort,
  schedule: (fn: () => void, ms: number) => void,
): SheetHistory {
  const stack: Entry[] = [];
  // Minted when the stack goes from empty to one sheet. A marker from another
  // token (an entry left by an earlier session of sheets, or by a reload) is a
  // stale one and counts as depth 0, the base page.
  let token: string | null = null;
  const depthOf = (state: unknown): number => {
    const marker = markerOf(state);
    return marker && marker.token === token ? marker.depth : 0;
  };
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
    const owed = depthOf(port.getState()) - inflight - stack.filter((entry) => entry.pushed).length;
    if (stack.length === 0) token = null;
    if (owed > 0) {
      inflight += owed;
      port.go(-owed);
    }
  };

  /** Push entries until history holds `target` levels again. */
  const restore = (target: number) => {
    if (token === null) return;
    for (let depth = depthOf(port.getState()) + 1; depth <= target; depth += 1) {
      port.push(withDepth(port.getState(), token, depth));
    }
  };

  /**
   * Give the sheets opened while a go() travelled their entries now it has
   * landed. Pushed before it landed, the traversal would have come down on a
   * stale entry and closed them the moment they opened.
   */
  const pushWaiting = () => {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (!stack[index].pushed && stack[index].closed) stack.splice(index, 1);
    }
    stack.forEach((entry, index) => {
      if (entry.pushed || token === null) return;
      entry.pushed = true;
      port.push(withDepth(port.getState(), token, index + 1));
    });
  };

  const reassert = (entry: Entry) => {
    if (entry.closed || !stack.includes(entry)) return;
    if (!entry.stillOpen()) return;
    // It refused without saying so up front. Put back whatever the pop took,
    // for the sheets that hold entries; any still waiting get theirs on landing.
    restore(stack.filter((candidate) => candidate.pushed).length);
  };

  return {
    open(id, close, stillOpen, locked = () => false) {
      if (stack.length === 0 || token === null) token = mintToken();
      const pushed = inflight === 0;
      stack.push({ id, close, stillOpen, locked, closed: false, pushed });
      if (pushed) port.push(withDepth(port.getState(), token, stack.length));
    },

    anyLocked() {
      return stack.some((entry) => !entry.closed && entry.locked());
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
      // A locked sheet (known up front, so no wait and no user activation
      // needed) is put back at once, and nothing under it is asked either.
      let lockedAt = -1;
      for (let index = stack.length - 1; index >= depth; index -= 1) {
        if (stack[index].pushed && !stack[index].closed && stack[index].locked()) {
          lockedAt = index;
          break;
        }
      }
      // Entries above the new depth lost their history entry: ask the live
      // ones above any locked sheet to close, top first.
      const asked: Entry[] = [];
      for (let index = stack.length - 1; index > lockedAt && index >= depth; index -= 1) {
        const entry = stack[index];
        if (entry.closed || !entry.pushed) continue;
        asked.push(entry);
      }
      if (lockedAt >= 0) {
        // Entries above it close; its own and those below keep their places.
        for (const entry of asked) entry.close();
        for (const entry of asked) schedule(() => reassert(entry), 60);
        restore(lockedAt + 1);
        pushWaiting();
        return;
      }
      // Entries already closed above the depth have no entry left to pop.
      for (const entry of asked) entry.close();
      for (const entry of asked) schedule(() => reassert(entry), 60);
      // Drop closed entries from the top that history no longer holds.
      while (stack.length > depth && stack[stack.length - 1].closed) stack.pop();
      pushWaiting();
    },
  };
}

/**
 * The state to hand to history.replaceState when only the address changes:
 * everything kept (our marker included) except Next's two keys, so Next's
 * patched replaceState re-adds them from the current entry and also syncs its
 * own URL (usePathname and useSearchParams). Passing them through would make
 * Next treat the call as its own and skip the sync.
 */
export function stateForUrlReplace(state: unknown): Record<string, unknown> {
  const base = state && typeof state === "object" ? { ...(state as Record<string, unknown>) } : {};
  delete base.__NA;
  delete base.__PRIVATE_NEXTJS_INTERNALS_TREE;
  return base;
}
