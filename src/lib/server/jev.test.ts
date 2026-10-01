import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The cache-only scope: inside `withCachedVerdictsOnly` a verdict already
 * asked for comes back from the cache, a miss is nothing, Jev's endpoint is
 * never called, and the miss is not remembered, so the gathering that owns
 * the question still asks it later.
 */

const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock("next/cache", () => ({
  unstable_cache:
    <T>(work: () => Promise<T>, keyParts: string[]) =>
    async () => {
      const key = keyParts.join("|");
      if (store.has(key)) return store.get(key) as T;
      const value = await work();
      store.set(key, value);
      return value;
    },
}));

const { cachedVerdict, withCachedVerdictsOnly, cachedVerdictsOnly } = await import("./jev");

const QUESTIONS = { about: { type: "noul" as const, instructions: "Is it about NVIDIA?" } };
const fetchMock = vi.fn(async () => Response.json({ answers: { about: { type: "noul", noul: 0.9 } } }));

beforeEach(() => {
  store.clear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("JEV_API_KEY", "test-key");
  vi.stubEnv("JEV_DISABLED", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("withCachedVerdictsOnly", () => {
  it("answers a miss with nothing and never calls Jev", async () => {
    const answers = await withCachedVerdictsOnly(() => cachedVerdict("t-1", { text: "cold" }, QUESTIONS));
    expect(answers).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers a verdict another surface already paid for, from the cache", async () => {
    await cachedVerdict("t-1", { text: "warm" }, QUESTIONS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const answers = await withCachedVerdictsOnly(() => cachedVerdict("t-1", { text: "warm" }, QUESTIONS));
    expect(answers?.about.noul).toBe(0.9);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not remember the miss, so the owner still asks later", async () => {
    await withCachedVerdictsOnly(() => cachedVerdict("t-1", { text: "later" }, QUESTIONS));
    const answers = await cachedVerdict("t-1", { text: "later" }, QUESTIONS);
    expect(answers?.about.noul).toBe(0.9);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("holds across awaits and ends with the work", async () => {
    const seen = await withCachedVerdictsOnly(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return cachedVerdictsOnly();
    });
    expect(seen).toBe(true);
    expect(cachedVerdictsOnly()).toBe(false);
  });
});
