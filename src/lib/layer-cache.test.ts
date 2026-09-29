import { describe, expect, it, vi } from "vitest";
import { HOLD_MS, dedupeStore, fillFromLastGood, firstKept, readLayer, type Layer, type LayerStore } from "./layer-cache";

/** Next's data cache, as far as these rules care: a map that keeps what a load returned. */
function memoryStore(): LayerStore & { entries: Map<string, unknown> } {
  const entries = new Map<string, unknown>();
  return {
    entries,
    async peek<T>(key: string[]) {
      return entries.get(JSON.stringify(key)) as T | undefined;
    },
    async put<T>(key: string[], _ttl: number, load: () => Promise<T>) {
      const value = await load();
      entries.set(JSON.stringify(key), value);
      return value;
    },
  };
}

const T = Date.UTC(2026, 8, 29, 9, 0, 0);
const good = (fetchedAt: number, ...tags: string[]): Layer<string> => ({ fetchedAt, results: tags });

describe("readLayer", () => {
  it("fetches a slot once and answers the rest of it from the store", async () => {
    const store = memoryStore();
    const fetch = vi.fn(async () => good(T, "a", "b"));
    await readLayer({ store, key: ["recent", "1"], ttlMs: 1, now: T, fetch });
    const second = await readLayer({ store, key: ["recent", "1"], ttlMs: 1, now: T + 60_000, fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(second).toEqual(good(T, "a", "b"));
  });

  it("serves the previous slot when the new slot's fetch fails, and holds the failure two minutes", async () => {
    const store = memoryStore();
    await readLayer({ store, key: ["recent", "1"], ttlMs: 1, now: T, fetch: async () => good(T, "old") });
    const down = vi.fn(async (): Promise<Layer<string>> => {
      throw new Error("X answered 429");
    });
    const read = (now: number) =>
      readLayer({ store, key: ["recent", "2"], ttlMs: 1, now, fetch: down, previous: [["recent", "1"]] });

    expect(await read(T + 30 * 60_000)).toEqual(good(T, "old"));
    expect(await read(T + 30 * 60_000 + 30_000)).toEqual(good(T, "old"));
    expect(down).toHaveBeenCalledTimes(1);
    // Two minutes on, one more try.
    await read(T + 30 * 60_000 + HOLD_MS);
    expect(down).toHaveBeenCalledTimes(2);
  });

  it("says why when there is nothing good to fall back on", async () => {
    const store = memoryStore();
    const result = await readLayer({
      store,
      key: ["recent", "2"],
      ttlMs: 1,
      now: T,
      fetch: async () => {
        throw new Error("X answered 503");
      },
    });
    expect(result).toEqual({ failed: "X answered 503" });
  });

  it("fills a failed query from the last good layer, holds it briefly, and never keeps it for the slot", async () => {
    const store = memoryStore();
    await readLayer({ store, key: ["recent", "1"], ttlMs: 1, now: T, fetch: async () => good(T, "a0", "b0") });
    const partial = vi.fn(async (): Promise<Layer<string>> => ({ fetchedAt: T + 1, results: ["a1", { error: "X timeout" }] }));
    const read = (now: number) =>
      readLayer({ store, key: ["recent", "2"], ttlMs: 1, now, fetch: partial, previous: [["recent", "1"]] });

    expect(await read(T + 30 * 60_000)).toEqual({ fetchedAt: T + 1, results: ["a1", "b0"] });
    await read(T + 30 * 60_000 + 10_000);
    expect(partial).toHaveBeenCalledTimes(1);
    expect(store.entries.has(JSON.stringify(["recent", "2"]))).toBe(false);
    await read(T + 30 * 60_000 + HOLD_MS);
    expect(partial).toHaveBeenCalledTimes(2);
  });
});

describe("fillFromLastGood", () => {
  it("leaves a failure in place when the last good layer has nothing for it", () => {
    expect(fillFromLastGood(["a", { error: "x" }], undefined)).toEqual(["a", { error: "x" }]);
    expect(fillFromLastGood([{ error: "x" }], [{ error: "y" }])).toEqual([{ error: "x" }]);
  });
});

describe("firstKept", () => {
  it("peeks newest first and never loads", async () => {
    const store = memoryStore();
    await store.put(["refresh", "3"], 1, async () => good(T, "older"));
    await store.put(["refresh", "5"], 1, async () => good(T, "newest"));
    const found = await firstKept<string>(store, [["refresh", "6"], ["refresh", "5"], ["refresh", "3"]]);
    expect(found?.results).toEqual(["newest"]);
  });
});

describe("dedupeStore", () => {
  it("shares one load among concurrent misses for the same key", async () => {
    const store = dedupeStore(memoryStore());
    let release!: () => void;
    const load = vi.fn(() => new Promise<string>((resolve) => (release = () => resolve("once"))));
    const both = Promise.all([store.put(["k"], 1, load), store.put(["k"], 1, load)]);
    release();
    expect(await both).toEqual(["once", "once"]);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
