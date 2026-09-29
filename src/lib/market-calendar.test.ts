import { describe, expect, it } from "vitest";
import {
  earlyCloses,
  isOpen,
  isTradingDay,
  lastClose,
  marketHolidays,
  marketStatus,
  nextOpen,
  opensAt,
  sessionOn,
} from "./market-calendar";

describe("marketHolidays", () => {
  it("computes the ten closures of 2026", () => {
    expect([...marketHolidays(2026)].sort()).toEqual([
      "2026-01-01", // New Year's Day, a Thursday
      "2026-01-19", // Martin Luther King Jr. Day, 3rd Monday
      "2026-02-16", // Washington's Birthday, 3rd Monday
      "2026-04-03", // Good Friday, Easter falling on 5 April
      "2026-05-25", // Memorial Day, last Monday
      "2026-06-19", // Juneteenth, a Friday
      "2026-07-03", // Independence Day observed, the 4th is a Saturday
      "2026-09-07", // Labor Day, 1st Monday
      "2026-11-26", // Thanksgiving, 4th Thursday
      "2026-12-25", // Christmas, a Friday
    ]);
  });

  it("moves a Sunday holiday to the Monday", () => {
    // 2027-12-25 is a Saturday, so Christmas is observed on the Friday;
    // 2027-07-04 is a Sunday, so Independence Day moves to the Monday.
    expect(marketHolidays(2027).has("2027-12-24")).toBe(true);
    expect(marketHolidays(2027).has("2027-07-05")).toBe(true);
  });

  it("keeps the last session of the year when New Year falls on a Saturday", () => {
    // 2028-01-01 is a Saturday: the market does not close on 2027-12-31.
    expect(marketHolidays(2027).has("2027-12-31")).toBe(false);
    expect(marketHolidays(2028).has("2028-01-01")).toBe(true);
  });
});

describe("isTradingDay", () => {
  it("rejects the weekend and the holiday behind the bad GameStop marks", () => {
    expect(isTradingDay("2026-09-05")).toBe(false); // Saturday
    expect(isTradingDay("2026-09-06")).toBe(false); // Sunday
    expect(isTradingDay("2026-09-07")).toBe(false); // Labor Day
    expect(isTradingDay("2026-09-08")).toBe(true); // the Tuesday after
  });

  it("rejects the Sunday that printed Strategy at twice its price", () => {
    expect(isTradingDay("2026-08-30")).toBe(false);
    expect(isTradingDay("2026-08-28")).toBe(true);
  });

  it("accepts an ordinary weekday", () => {
    expect(isTradingDay("2026-09-16")).toBe(true);
  });

  it("refuses to guess at nonsense", () => {
    expect(isTradingDay("")).toBe(false);
    expect(isTradingDay("not-a-date")).toBe(false);
  });
});

describe("marketHolidays, against the published NYSE calendar", () => {
  it("computes the ten closures of 2027", () => {
    expect([...marketHolidays(2027)].sort()).toEqual([
      "2027-01-01",
      "2027-01-18",
      "2027-02-15",
      "2027-03-26", // Good Friday, Easter on 28 March
      "2027-05-31",
      "2027-06-18", // Juneteenth on a Saturday, observed the Friday
      "2027-07-05",
      "2027-09-06",
      "2027-11-25",
      "2027-12-24",
    ]);
  });
});

describe("earlyCloses", () => {
  it("has the two half days of 2026", () => {
    // 3 July 2026 is the observed Independence Day itself, so no half day.
    expect([...earlyCloses(2026)].sort()).toEqual(["2026-11-27", "2026-12-24"]);
  });

  it("has only the Friday after Thanksgiving in 2027", () => {
    // 3 July is a Saturday and 24 December is the observed Christmas.
    expect([...earlyCloses(2027)].sort()).toEqual(["2027-11-26"]);
  });

  it("shortens 3 July when it falls midweek", () => {
    expect(earlyCloses(2025).has("2025-07-03")).toBe(true); // a Thursday
    expect(earlyCloses(2025).has("2025-12-24")).toBe(true); // a Wednesday
  });
});

describe("sessionOn", () => {
  it("opens at 09:30 and closes at 16:00 New York time in summer", () => {
    const session = sessionOn("2026-09-29")!;
    expect(session.open.toISOString()).toBe("2026-09-29T13:30:00.000Z");
    expect(session.close.toISOString()).toBe("2026-09-29T20:00:00.000Z");
    expect(session.early).toBe(false);
  });

  it("moves an hour in UTC once New York leaves daylight saving", () => {
    // Clocks go back on 1 November 2026.
    expect(sessionOn("2026-10-30")!.open.toISOString()).toBe("2026-10-30T13:30:00.000Z");
    expect(sessionOn("2026-11-02")!.open.toISOString()).toBe("2026-11-02T14:30:00.000Z");
    // And forward again on 14 March 2027.
    expect(sessionOn("2027-03-12")!.open.toISOString()).toBe("2027-03-12T14:30:00.000Z");
    expect(sessionOn("2027-03-15")!.open.toISOString()).toBe("2027-03-15T13:30:00.000Z");
  });

  it("closes at 13:00 on a half day", () => {
    const session = sessionOn("2026-11-27")!;
    expect(session.close.toISOString()).toBe("2026-11-27T18:00:00.000Z");
    expect(session.early).toBe(true);
  });

  it("has no session on a weekend or holiday", () => {
    expect(sessionOn("2026-10-03")).toBeNull();
    expect(sessionOn("2026-11-26")).toBeNull();
  });
});

describe("isOpen", () => {
  it("is open inside the session and closed at its edges", () => {
    expect(isOpen(new Date("2026-09-29T13:29:59Z"))).toBe(false);
    expect(isOpen(new Date("2026-09-29T13:30:00Z"))).toBe(true);
    expect(isOpen(new Date("2026-09-29T19:59:59Z"))).toBe(true);
    expect(isOpen(new Date("2026-09-29T20:00:00Z"))).toBe(false);
  });

  it("is closed at 03:00 New York time and all weekend", () => {
    expect(isOpen(new Date("2026-09-30T07:00:00Z"))).toBe(false);
    expect(isOpen(new Date("2026-10-03T16:00:00Z"))).toBe(false);
  });

  it("shuts at 13:00 on Christmas Eve", () => {
    expect(isOpen(new Date("2026-12-24T17:59:00Z"))).toBe(true);
    expect(isOpen(new Date("2026-12-24T18:00:00Z"))).toBe(false);
  });
});

describe("nextOpen and lastClose", () => {
  it("points a Saturday at Monday's open and Friday's close", () => {
    const saturday = new Date("2026-10-03T12:00:00Z");
    expect(nextOpen(saturday).toISOString()).toBe("2026-10-05T13:30:00.000Z");
    expect(lastClose(saturday).toISOString()).toBe("2026-10-02T20:00:00.000Z");
  });

  it("skips a Monday holiday", () => {
    // Labor Day weekend 2026: next open is Tuesday 8 September.
    expect(nextOpen(new Date("2026-09-05T12:00:00Z")).toISOString()).toBe(
      "2026-09-08T13:30:00.000Z",
    );
  });

  it("before the bell opens today, after it opens tomorrow", () => {
    expect(nextOpen(new Date("2026-09-29T11:00:00Z")).toISOString()).toBe("2026-09-29T13:30:00.000Z");
    expect(nextOpen(new Date("2026-09-29T15:00:00Z")).toISOString()).toBe("2026-09-30T13:30:00.000Z");
    expect(lastClose(new Date("2026-09-29T11:00:00Z")).toISOString()).toBe("2026-09-28T20:00:00.000Z");
  });

  it("reaches over a year end with New Year on a Friday", () => {
    // 1 January 2027 is a Friday holiday; the next open is Monday the 4th.
    expect(nextOpen(new Date("2026-12-31T22:00:00Z")).toISOString()).toBe("2027-01-04T14:30:00.000Z");
    expect(lastClose(new Date("2027-01-02T12:00:00Z")).toISOString()).toBe("2026-12-31T21:00:00.000Z");
  });

  it("counts a half day close as the last close", () => {
    expect(lastClose(new Date("2026-11-28T12:00:00Z")).toISOString()).toBe("2026-11-27T18:00:00.000Z");
  });
});

describe("marketStatus", () => {
  it("names the three states", () => {
    expect(marketStatus(new Date("2026-09-29T15:00:00Z")).state).toBe("open");
    expect(marketStatus(new Date("2026-11-27T15:00:00Z")).state).toBe("early_close");
    expect(marketStatus(new Date("2026-10-03T12:00:00Z")).state).toBe("closed");
  });
});

describe("opensAt", () => {
  const monday = new Date("2026-10-05T13:30:00Z");

  it("reads Monday 15:30 in Amsterdam from a Saturday", () => {
    expect(opensAt(monday, new Date("2026-10-03T12:00:00Z"), "Europe/Amsterdam", false)).toEqual({
      day: "Monday",
      time: "15:30",
    });
  });

  it("reads 9:30 AM in New York on a twelve hour clock", () => {
    expect(opensAt(monday, new Date("2026-10-03T12:00:00Z"), "America/New_York", true)).toEqual({
      day: "Monday",
      time: "9:30 AM",
    });
  });

  it("says tomorrow and today when they are", () => {
    expect(opensAt(monday, new Date("2026-10-04T12:00:00Z"), "Europe/Amsterdam", false).day).toBe("tomorrow");
    expect(opensAt(monday, new Date("2026-10-05T06:00:00Z"), "Europe/Amsterdam", false).day).toBe("today");
  });

  it("follows the viewer's day, not New York's", () => {
    // Sunday 23:00 in Los Angeles is already Monday afternoon in Tokyo,
    // where the open lands at 22:30 that same Monday.
    const now = new Date("2026-10-05T06:00:00Z");
    expect(opensAt(monday, now, "Asia/Tokyo", false)).toEqual({ day: "today", time: "22:30" });
    expect(opensAt(monday, now, "America/Los_Angeles", false)).toEqual({ day: "tomorrow", time: "06:30" });
  });
});
