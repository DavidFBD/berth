import { describe, expect, it } from "vitest";
import { HEADLINES_WINDOW_MS, REFRESH_WINDOW_MS, slotOf } from "@/lib/feed-refresh";

const MINUTE = 60 * 1000;
const T = Date.UTC(2026, 8, 29, 12, 0, 0);

describe("slotOf", () => {
  it("keeps one slot for a whole window and turns exactly at its end", () => {
    expect(slotOf(T, HEADLINES_WINDOW_MS)).toBe(slotOf(T + 14 * MINUTE, HEADLINES_WINDOW_MS));
    expect(slotOf(T + 15 * MINUTE, HEADLINES_WINDOW_MS)).toBe(slotOf(T, HEADLINES_WINDOW_MS) + 1);
    expect(slotOf(T + 5 * MINUTE, REFRESH_WINDOW_MS)).toBe(slotOf(T, REFRESH_WINDOW_MS) + 1);
  });
});
