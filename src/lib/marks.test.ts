import { describe, expect, it } from "vitest";
import {
  addDays,
  markAsOf,
  markStartSeconds,
  settleMarks,
  subtractMonths,
} from "@/lib/marks";

const at = (day: string, time = "21:30:00") => Date.parse(`${day}T${time}Z`) / 1000;

describe("mark time", () => {
  it("takes a stored mark at 21:30 UTC, after the New York close in either season", () => {
    expect(markAsOf("2026-09-24")).toBe("2026-09-24T21:30:00.000Z");
    expect(markStartSeconds("2026-09-24")).toBe(at("2026-09-24"));
  });
});

describe("calendar arithmetic", () => {
  it("adds days across a month end", () => {
    expect(addDays("2026-09-29", 3)).toBe("2026-10-02");
    expect(addDays("2026-09-25", -7)).toBe("2026-09-18");
  });

  it("subtracts months, clamping to a shorter month", () => {
    expect(subtractMonths("2026-09-25", 1)).toBe("2026-08-25");
    expect(subtractMonths("2026-03-31", 1)).toBe("2026-02-28");
    expect(subtractMonths("2026-01-15", 3)).toBe("2025-10-15");
    expect(subtractMonths("2026-09-25", 12)).toBe("2025-09-25");
  });
});

describe("settleMarks", () => {
  it("keeps market days only, from writeFrom on", () => {
    const points = [
      { timestamp: at("2026-09-17"), price: 100 },
      { timestamp: at("2026-09-18"), price: 101 },
      { timestamp: at("2026-09-19"), price: 150 }, // Saturday
      { timestamp: at("2026-09-21"), price: 102 },
      { timestamp: at("2026-09-22"), price: 103 },
    ];
    const { keep, drop } = settleMarks(points, "2026-09-18");
    expect(keep).toEqual([
      { day: "2026-09-18", close: 101 },
      { day: "2026-09-21", close: 102 },
      { day: "2026-09-22", close: 103 },
    ]);
    expect(drop).toEqual([]);
  });

  it("names a spike inside the window so it can be taken out, and never writes context days", () => {
    const points = [
      { timestamp: at("2026-09-16"), price: 100 },
      { timestamp: at("2026-09-17"), price: 100 },
      { timestamp: at("2026-09-18"), price: 400 },
      { timestamp: at("2026-09-21"), price: 101 },
    ];
    const { keep, drop } = settleMarks(points, "2026-09-17");
    expect(keep.map((mark) => mark.day)).toEqual(["2026-09-17", "2026-09-21"]);
    expect(drop).toEqual(["2026-09-18"]);
  });
});
