import { describe, expect, it } from "vitest";
import {
  addDays,
  closeUtcMinutes,
  markAsOf,
  markStartSeconds,
  newYorkDay,
  onTheMark,
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

describe("the New York date", () => {
  it("is still Monday in New York between midnight UTC and midnight there", () => {
    expect(newYorkDay(new Date("2026-09-22T02:00:00Z"))).toBe("2026-09-21");
    expect(newYorkDay(new Date("2026-09-22T04:30:00Z"))).toBe("2026-09-22");
    // Winter: five hours behind.
    expect(newYorkDay(new Date("2026-12-15T04:30:00Z"))).toBe("2026-12-14");
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

describe("onTheMark", () => {
  it("keeps points after the New York close and no later than 22:00 UTC", () => {
    const points = [
      { timestamp: at("2026-09-22", "21:28:51"), price: 1 },
      { timestamp: at("2026-09-23", "22:05:00"), price: 2 },
      { timestamp: at("2026-09-24", "12:13:17"), price: 3 },
      { timestamp: at("2026-07-06", "20:55:26"), price: 4 },
      { timestamp: at("2026-12-07", "20:55:00"), price: 5 },
    ];
    // Summer closes at 20:00 UTC, so 20:55 in July is after it; December
    // closes at 21:00 UTC, so 20:55 is still the session.
    expect(onTheMark(points).map((point) => point.price)).toEqual([1, 4]);
  });

  it("knows when New York is on daylight time", () => {
    expect(closeUtcMinutes("2026-03-06")).toBe(21 * 60);
    expect(closeUtcMinutes("2026-03-09")).toBe(20 * 60);
    expect(closeUtcMinutes("2026-10-30")).toBe(20 * 60);
    expect(closeUtcMinutes("2026-11-02")).toBe(21 * 60);
  });
});
