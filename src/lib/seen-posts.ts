/**
 * Which posts this browser has already been shown, so the column can mark
 * the ones that are new to the reader. Pure apart from the storage adapter,
 * which tests replace with a plain object.
 *
 * The rules, in the order they matter:
 *
 * 1. **A missing record marks nothing.** On a first visit every post is new
 *    to the reader, and a mark on all of them is noise, so `loadSeen`
 *    answers `null` and `isNew` says no to everything. The caller seeds the
 *    record with what was on screen, and the next visit has a baseline.
 * 2. **Storage that cannot be read marks nothing either.** A private window,
 *    blocked site data or a corrupt value all read as `null`, and every write
 *    fails silently. The column is exactly what it was before this existed.
 * 3. **Bounded.** At most `SEEN_CAP` ids, oldest dropped first. A post seen
 *    again moves to the back of the line, so what is still in the rotation is
 *    never the thing forgotten. One response carries about three dozen posts,
 *    so four hundred is days of history.
 *
 * When a card counts as seen (about two seconds on screen, in a visible tab)
 * is the hook's business: hooks/use-seen-posts.
 */

/** The one localStorage key. The value is a JSON array of post ids, oldest first. */
export const SEEN_KEY = "berth.seen-posts";
export const SEEN_CAP = 400;

/** The two things this needs from storage, so a test can stand in for it. */
export type SeenStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/** The browser's localStorage, or null where there is none or it refuses access. */
export function browserStorage(): SeenStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The stored ids in order, or null when there is no usable record. */
function readIds(storage: SeenStorage | null): string[] | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SEEN_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return null;
  }
}

/**
 * What this browser has been shown. `null` means there is no baseline (a
 * first visit, or storage that will not answer), which marks nothing.
 */
export function loadSeen(storage: SeenStorage | null = browserStorage()): Set<string> | null {
  const ids = readIds(storage);
  return ids === null ? null : new Set(ids);
}

/** Records `ids` as shown, keeping the newest `SEEN_CAP`. Never throws. */
export function markSeen(
  ids: readonly string[],
  storage: SeenStorage | null = browserStorage(),
): void {
  if (!storage || ids.length === 0) return;
  const adding = new Set(ids.filter(Boolean));
  const kept = (readIds(storage) ?? []).filter((id) => !adding.has(id));
  const next = [...kept, ...adding].slice(-SEEN_CAP);
  try {
    storage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch {
    // Full or blocked: nothing is marked, which is the safe failure.
  }
}

/** How much of a card must show for its time on screen to count. */
export const SEEN_THRESHOLD = 0.6;

/**
 * Whether a card is in view for the seen timer: overlapping is not enough, at
 * least `SEEN_THRESHOLD` of it must show (a sliver at the bottom edge is not
 * reading it). The small allowance absorbs the ratio rounding browsers do
 * right at the crossing.
 */
export function countsAsInView(isIntersecting: boolean, intersectionRatio: number): boolean {
  return isIntersecting && intersectionRatio >= SEEN_THRESHOLD - 0.01;
}

/** Whether a post gets the mark: only against a real baseline, and only if absent from it. */
export function isNew(id: string, seen: ReadonlySet<string> | null): boolean {
  return seen !== null && !seen.has(id);
}
