import { describe, expect, it } from "vitest";
import { isTradingDay, marketHolidays } from "./market-calendar";

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
