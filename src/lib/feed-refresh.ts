/**
 * When the news column goes back to its sources, as pure arithmetic so the
 * budget can be tested without a clock or a network.
 *
 * Every fetch is keyed on a slot of wall-clock time, not on how old a cache
 * entry is. That difference is the fix for a quiet night: a cache that
 * revalidates after N minutes serves whatever it last had to the first
 * visitor of the morning and only then fetches, so the column opened on
 * yesterday's posts. A new slot is a new key, a miss, and a fetch the visitor
 * waits a second for. It also makes the ceiling exact: one fetch per slot,
 * however many visitors, because every instance reads the same data cache.
 *
 * Three windows:
 *
 * - The week layer (X relevancy, the week's best) every six hours: it barely
 *   moves, and it is what keeps a strong post from yesterday in reach.
 * - The recent layer (X recency, the newest) every half hour: what makes the
 *   column this morning's.
 * - A refresh (the button) at most once per five minutes, globally. Pressed
 *   inside a slot someone already refreshed, it costs nothing and returns
 *   the same answer. It only asks X for what arrived since the recent layer,
 *   so it is cheap in posts as well as requests.
 *
 * Headlines (Nasdaq RSS) take a quarter hour, and the same five minutes on a
 * refresh.
 */

export const WEEK_WINDOW_MS = 6 * 60 * 60 * 1000;
export const RECENT_WINDOW_MS = 30 * 60 * 1000;
export const REFRESH_WINDOW_MS = 5 * 60 * 1000;
export const HEADLINES_WINDOW_MS = 15 * 60 * 1000;

/** Which slot `now` falls in, for a window of `windowMs`. */
export function slotOf(now: number, windowMs: number): number {
  return Math.floor(now / windowMs);
}

/**
 * Whether a refresh should ask X for anything, and under which slot. Nothing
 * when it was not asked for, and nothing when the recent layer is itself
 * younger than the refresh window: that answer is as fresh as a refresh
 * would be allowed to make it.
 */
export function refreshSlot({
  now,
  fresh,
  recentFetchedAt,
}: {
  now: number;
  fresh: boolean;
  recentFetchedAt: number | undefined;
}): number | undefined {
  if (!fresh) return undefined;
  if (recentFetchedAt !== undefined && now - recentFetchedAt < REFRESH_WINDOW_MS) return undefined;
  return slotOf(now, REFRESH_WINDOW_MS);
}

/**
 * Every refresh slot inside the recent slot `now` falls in, newest first:
 * where to look for the latest refresh anyone made, so every reader (the
 * column's poll, the nudge, the MCP tools) sees it, not only the one who
 * pressed.
 */
export function refreshSlotsSoFar(now: number): number[] {
  const first = slotOf(now, RECENT_WINDOW_MS) * (RECENT_WINDOW_MS / REFRESH_WINDOW_MS);
  const slots: number[] = [];
  for (let slot = slotOf(now, REFRESH_WINDOW_MS); slot >= first; slot -= 1) slots.push(slot);
  return slots;
}

/**
 * One list from several fetches of the same kind of thing. A later layer's
 * copy wins, because it was fetched later and its counts are newer; the
 * first-seen order is kept.
 */
export function mergeById<T extends { id: string }>(layers: readonly (readonly T[])[]): T[] {
  const byId = new Map<string, T>();
  for (const layer of layers) {
    for (const item of layer) byId.set(item.id, item);
  }
  return [...byId.values()];
}

/**
 * The most X requests and posts one day can cost, from the windows above
 * and the number of queries a fetch makes. A ceiling, reached only if
 * someone opens the column in every slot of the day; the refresh posts are
 * bounded by how much the accounts post, not by the button.
 */
export function dailyCeiling(queries: number, maxResults: number): {
  weekRequests: number;
  recentRequests: number;
  refreshRequests: number;
  /** Week and recent layers only: a refresh returns only what is new. */
  layerPosts: number;
} {
  const day = 24 * 60 * 60 * 1000;
  const weekRequests = (day / WEEK_WINDOW_MS) * queries;
  const recentRequests = (day / RECENT_WINDOW_MS) * queries;
  const refreshRequests = (day / REFRESH_WINDOW_MS) * queries;
  return {
    weekRequests,
    recentRequests,
    refreshRequests,
    layerPosts: (weekRequests + recentRequests) * maxResults,
  };
}
