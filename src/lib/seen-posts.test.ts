import { describe, expect, it } from "vitest";
import {
  SEEN_CAP,
  SEEN_THRESHOLD,
  countsAsInView,
  SEEN_KEY,
  isNew,
  loadSeen,
  markSeen,
  type SeenStorage,
} from "./seen-posts";

function memory(initial?: Record<string, string>): SeenStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial ?? {}));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

/** Storage as a private window or blocked site data presents it. */
const refusing: SeenStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("seen posts", () => {
  it("marks nothing on a first visit, because everything being new is noise", () => {
    const storage = memory();
    const seen = loadSeen(storage);
    expect(seen).toBeNull();
    expect(isNew("1", seen)).toBe(false);
  });

  it("marks what is missing from a real baseline, and nothing else", () => {
    const storage = memory();
    markSeen(["1", "2"], storage);
    const seen = loadSeen(storage);
    expect(isNew("1", seen)).toBe(false);
    expect(isNew("3", seen)).toBe(true);
  });

  it("treats an empty but present record as a baseline", () => {
    const seen = loadSeen(memory({ [SEEN_KEY]: "[]" }));
    expect(seen).not.toBeNull();
    expect(isNew("1", seen)).toBe(true);
  });

  it("keeps the newest four hundred and drops the oldest", () => {
    const storage = memory();
    const ids = Array.from({ length: SEEN_CAP + 50 }, (_, i) => `p${i}`);
    markSeen(ids, storage);
    const stored = JSON.parse(storage.data.get(SEEN_KEY) ?? "[]") as string[];
    expect(stored).toHaveLength(SEEN_CAP);
    expect(stored[0]).toBe("p50");
    expect(stored.at(-1)).toBe(`p${SEEN_CAP + 49}`);
  });

  it("moves a post seen again to the back, so it is not the one forgotten", () => {
    const storage = memory();
    markSeen(["old", ...Array.from({ length: SEEN_CAP - 1 }, (_, i) => `p${i}`)], storage);
    markSeen(["old"], storage);
    markSeen(["fresh"], storage);
    const seen = loadSeen(storage);
    expect(seen?.has("old")).toBe(true);
    expect(seen?.has("p0")).toBe(false);
    expect(seen?.size).toBe(SEEN_CAP);
  });

  it("never stores a duplicate", () => {
    const storage = memory();
    markSeen(["1", "1", "2"], storage);
    markSeen(["2"], storage);
    expect(JSON.parse(storage.data.get(SEEN_KEY) ?? "")).toEqual(["1", "2"]);
  });

  it("degrades to marking nothing when storage refuses", () => {
    expect(() => markSeen(["1"], refusing)).not.toThrow();
    expect(loadSeen(refusing)).toBeNull();
    expect(loadSeen(null)).toBeNull();
    expect(() => markSeen(["1"], null)).not.toThrow();
  });

  it("reads a corrupt value as no baseline, and the next write repairs it", () => {
    const storage = memory({ [SEEN_KEY]: "{not json" });
    expect(loadSeen(storage)).toBeNull();
    markSeen(["1"], storage);
    expect(loadSeen(storage)?.has("1")).toBe(true);
  });

  it("ignores anything in the record that is not an id", () => {
    const seen = loadSeen(memory({ [SEEN_KEY]: JSON.stringify(["1", 2, null]) }));
    expect([...(seen ?? [])]).toEqual(["1"]);
  });
});

describe("when a card is in view", () => {
  it("needs most of the card, not any overlap", () => {
    expect(countsAsInView(true, 0.05)).toBe(false);
    expect(countsAsInView(true, 0.59)).toBe(true); // within the rounding allowance
    expect(countsAsInView(true, 0.58)).toBe(false);
    expect(countsAsInView(true, SEEN_THRESHOLD)).toBe(true);
    expect(countsAsInView(true, 1)).toBe(true);
  });

  it("is never in view when the observer says it is not intersecting", () => {
    expect(countsAsInView(false, 1)).toBe(false);
  });
});
