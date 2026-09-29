import { describe, expect, it } from "vitest";
import {
  RECENT_WINDOW_MS,
  REFRESH_WINDOW_MS,
  dailyCeiling,
  mergeById,
  refreshSlot,
  refreshSlotsSoFar,
  slotOf,
} from "./feed-refresh";

const MINUTE = 60_000;
const T = Date.UTC(2026, 8, 29, 9, 0, 0);

describe("slots", () => {
  it("gives every moment inside one window the same key", () => {
    expect(slotOf(T, RECENT_WINDOW_MS)).toBe(slotOf(T + 29 * MINUTE, RECENT_WINDOW_MS));
    expect(slotOf(T + 30 * MINUTE, RECENT_WINDOW_MS)).toBe(slotOf(T, RECENT_WINDOW_MS) + 1);
  });
});

describe("the refresh throttle", () => {
  it("asks for nothing unless a refresh was asked for", () => {
    expect(refreshSlot({ now: T, fresh: false, recentFetchedAt: T - 20 * MINUTE })).toBeUndefined();
  });

  it("asks for nothing when the recent layer is younger than five minutes", () => {
    expect(refreshSlot({ now: T, fresh: true, recentFetchedAt: T - 4 * MINUTE })).toBeUndefined();
  });

  it("shares one fetch among every press inside the same five minutes", () => {
    const recentFetchedAt = T - 20 * MINUTE;
    const presses = [0, 1, 2, 3, 4.9].map((minutes) =>
      refreshSlot({ now: T + minutes * MINUTE, fresh: true, recentFetchedAt }),
    );
    expect(new Set(presses).size).toBe(1);
    expect(presses[0]).toBeDefined();
  });

  it("allows at most twelve refresh fetches an hour, however often it is pressed", () => {
    const slots = new Set<number>();
    for (let second = 0; second < 3600; second += 1) {
      const slot = refreshSlot({ now: T + second * 1000, fresh: true, recentFetchedAt: T - 60 * MINUTE });
      if (slot !== undefined) slots.add(slot);
    }
    expect(slots.size).toBe(60 / (REFRESH_WINDOW_MS / MINUTE));
  });

  it("still refreshes when the recent layer failed and has no time", () => {
    expect(refreshSlot({ now: T, fresh: true, recentFetchedAt: undefined })).toBe(
      slotOf(T, REFRESH_WINDOW_MS),
    );
  });
});

describe("refreshSlotsSoFar", () => {
  it("lists this half hour's refresh slots so far, newest first", () => {
    const now = T + 17 * MINUTE;
    const slots = refreshSlotsSoFar(now);
    expect(slots).toHaveLength(4);
    expect(slots[0]).toBe(slotOf(now, REFRESH_WINDOW_MS));
    expect(slots[3]).toBe(slotOf(T, REFRESH_WINDOW_MS));
    expect(refreshSlotsSoFar(T)).toEqual([slotOf(T, REFRESH_WINDOW_MS)]);
  });
});

describe("mergeById", () => {
  it("keeps one of each, the later fetch's copy, in first-seen order", () => {
    const merged = mergeById([
      [
        { id: "a", likes: 1 },
        { id: "b", likes: 1 },
      ],
      [
        { id: "b", likes: 9 },
        { id: "c", likes: 1 },
      ],
    ]);
    expect(merged).toEqual([
      { id: "a", likes: 1 },
      { id: "b", likes: 9 },
      { id: "c", likes: 1 },
    ]);
  });
});

describe("the daily ceiling", () => {
  it("stays well inside X's three million posts a month for four queries", () => {
    const ceiling = dailyCeiling(4, 100);
    expect(ceiling.weekRequests).toBe(16);
    expect(ceiling.recentRequests).toBe(192);
    expect(ceiling.refreshRequests).toBe(1152);
    // Under a quarter of the monthly cap, before a refresh adds only new posts.
    expect(ceiling.layerPosts * 31).toBeLessThan(3_000_000 / 4);
  });
});
