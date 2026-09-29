import { slotOf } from "@/lib/feed-refresh";

/**
 * How one slot's fetch of a feed is read, kept and, when the source fails,
 * covered for. Written against a tiny store so it can be tested without
 * Next's data cache; lib/server/x-column hands it one backed by
 * `unstable_cache`.
 *
 * The rules:
 *
 * - A slot's entry, once written, answers every request in that slot.
 * - Only a complete fetch is written under the slot. One with a failed
 *   query is held for two minutes (`HOLD_MS`), its gap filled from the last
 *   good layer, and then tried again; a slot is never stuck for half an hour
 *   with a hole in it.
 * - A fetch that failed outright is also held for two minutes, so an X
 *   outage or a 429 costs one attempt per two minutes rather than one per
 *   request, and meanwhile the last good layer (the previous slot's) is
 *   served, so the column shows the posts it had instead of going blank.
 */

export type Results<R> = (R | { error: string })[];
export type Layer<R> = { fetchedAt: number; results: Results<R> };
type Held<R> = { layer?: Layer<R>; error?: string };

export const HOLD_MS = 2 * 60 * 1000;

export interface LayerStore {
  /** What is kept under `key`, without ever fetching. */
  peek<T>(key: string[]): Promise<T | undefined>;
  /** `load`'s answer, kept under `key` for `ttlMs`; nothing is kept if it throws. */
  put<T>(key: string[], ttlMs: number, load: () => Promise<T>): Promise<T>;
}

/**
 * Concurrent misses for one key share one load, so a burst of visitors at a
 * slot's turn makes one set of calls, not one each. Per instance: across
 * instances the store's own entry does the same once written.
 */
export function dedupeStore(store: LayerStore): LayerStore {
  const running = new Map<string, Promise<unknown>>();
  return {
    peek: (key) => store.peek(key),
    put<T>(key: string[], ttlMs: number, load: () => Promise<T>): Promise<T> {
      const id = JSON.stringify(key);
      const existing = running.get(id);
      if (existing) return existing as Promise<T>;
      const promise = store.put(key, ttlMs, load).finally(() => running.delete(id));
      running.set(id, promise);
      return promise;
    },
  };
}

function failed<R>(result: R | { error: string }): result is { error: string } {
  return typeof result === "object" && result !== null && "error" in result;
}

/** Each failed query's place taken by the last good layer's answer for it, when there is one. */
export function fillFromLastGood<R>(results: Results<R>, lastGood: Results<R> | undefined): Results<R> {
  return results.map((result, index) => {
    const fallback = lastGood?.[index];
    return failed(result) && fallback !== undefined && !failed(fallback) ? fallback : result;
  });
}

/** Thrown by a load that got some answers and some failures: held, not kept. */
class PartialLayer<R> extends Error {
  constructor(readonly layer: Layer<R>) {
    super("partial layer");
  }
}

/** The first of `keys` that holds a layer, newest first. */
export async function firstKept<R>(store: LayerStore, keys: readonly string[][]): Promise<Layer<R> | undefined> {
  // In parallel: on Vercel each miss is a remote lookup, and most are misses.
  const layers = await Promise.all(keys.map((key) => store.peek<Layer<R>>(key)));
  return layers.find((layer) => layer !== undefined && layer !== null) ?? undefined;
}

export async function readLayer<R>({
  store,
  key,
  ttlMs,
  now,
  fetch,
  previous = [],
}: {
  store: LayerStore;
  key: string[];
  ttlMs: number;
  now: number;
  /** One fetch of every query. Throws when every query failed. */
  fetch: () => Promise<Layer<R>>;
  /** Earlier slots' keys, newest first, for the last good layer. */
  previous?: readonly string[][];
}): Promise<Layer<R> | { failed: string }> {
  const kept = await store.peek<Layer<R>>(key);
  if (kept) return kept;

  const holdKey = ["held", ...key, String(slotOf(now, HOLD_MS))];
  const held = await store.peek<Held<R>>(holdKey);
  if (held?.layer) return held.layer;
  if (held) return (await firstKept<R>(store, previous)) ?? { failed: held.error ?? "unavailable" };

  const hold = (value: Held<R>) => store.put(holdKey, HOLD_MS * 2, async () => value).catch(() => value);
  try {
    return await store.put(key, ttlMs, async () => {
      const layer = await fetch();
      if (layer.results.some(failed)) throw new PartialLayer(layer);
      return layer;
    });
  } catch (error) {
    const lastGood = await firstKept<R>(store, previous);
    if (error instanceof PartialLayer) {
      const partial = error.layer as Layer<R>;
      const layer = { fetchedAt: partial.fetchedAt, results: fillFromLastGood(partial.results, lastGood?.results) };
      await hold({ layer });
      return layer;
    }
    const message = error instanceof Error ? error.message : "unavailable";
    await hold({ error: message });
    return lastGood ?? { failed: message };
  }
}
