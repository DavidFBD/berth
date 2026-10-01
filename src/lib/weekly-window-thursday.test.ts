import { describe, expect, it } from "vitest";
import { weeklyRefCurrent, weeklyWindow } from "./weekly-window";

describe("the weekly summary's window", () => {
  it("is tried Monday to Thursday, so a Wednesday with no time left still reaches people", () => {
    const monday = weeklyWindow(new Date("2026-10-05T06:00:00Z"))!;
    expect(weeklyWindow(new Date("2026-10-08T06:00:00Z"))?.key).toBe(monday.key); // Thursday
    expect(weeklyWindow(new Date("2026-10-09T06:00:00Z"))).toBeNull(); // Friday
    expect(weeklyRefCurrent(`${monday.key}:u`, new Date("2026-10-08T06:30:00Z"))).toBe(true);
    expect(weeklyRefCurrent(`${monday.key}:u`, new Date("2026-10-09T06:30:00Z"))).toBe(false);
  });
});
