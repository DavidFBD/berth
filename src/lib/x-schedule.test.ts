import { describe, expect, it } from "vitest";
import {
  DEFAULT_DAILY_POST_CAP,
  MAX_RESULTS,
  POSTS_PER_DOLLAR,
  allowance,
  currentSlot,
  dailyPostCap,
  idPostedAt,
  newerId,
  usableSinceId,
  xFetchAllowedHere,
  pickQueries,
  slotStartsOn,
  slotsLeftToday,
  utcDay,
} from "@/lib/x-schedule";

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();

describe("the fetch schedule", () => {
  it("gives a trading day a pre-market slot, one every two hours of the session and one after the close", () => {
    // Wednesday 30 September 2026, New York on daylight time (UTC-4).
    expect(slotStartsOn("2026-09-30").map(iso)).toEqual([
      "2026-09-30T11:00:00.000Z", // 07:00
      "2026-09-30T13:30:00.000Z", // 09:30, the open
      "2026-09-30T15:30:00.000Z",
      "2026-09-30T17:30:00.000Z",
      "2026-09-30T19:30:00.000Z", // 15:30, across the close
      "2026-09-30T21:30:00.000Z", // 17:30, after hours
    ]);
  });

  it("stops the session slots at a half day's 13:00 close", () => {
    // The Friday after Thanksgiving, on standard time (UTC-5).
    expect(slotStartsOn("2026-11-27").map(iso)).toEqual([
      "2026-11-27T12:00:00.000Z",
      "2026-11-27T14:30:00.000Z",
      "2026-11-27T16:30:00.000Z",
      "2026-11-27T19:30:00.000Z", // 14:30, after the early close
    ]);
  });

  it("gives a weekend day and a holiday one slot, at noon", () => {
    expect(slotStartsOn("2026-10-03").map(iso)).toEqual(["2026-10-03T16:00:00.000Z"]);
    // Thanksgiving itself.
    expect(slotStartsOn("2026-11-26").map(iso)).toEqual(["2026-11-26T17:00:00.000Z"]);
  });

  it("places an instant in the latest slot that has started, overnight included", () => {
    expect(currentSlot(at("2026-09-30T14:00:00Z")).key).toBe("2026-09-30T13:30:00.000Z");
    // Two in the morning UTC is still Wednesday evening in New York.
    expect(currentSlot(at("2026-10-01T02:00:00Z")).key).toBe("2026-09-30T21:30:00.000Z");
    // Saturday morning belongs to Friday's after-hours slot until noon.
    expect(currentSlot(at("2026-10-03T10:00:00Z")).key).toBe("2026-10-02T21:30:00.000Z");
  });

  it("counts the slots still to come in the UTC day, the current one included", () => {
    expect(slotsLeftToday(at("2026-09-30T12:00:00Z"))).toBe(6);
    expect(slotsLeftToday(at("2026-09-30T22:00:00Z"))).toBe(1);
    expect(slotsLeftToday(at("2026-10-03T17:00:00Z"))).toBe(1);
    expect(slotsLeftToday(at("2026-10-03T10:00:00Z"))).toBe(2);
    expect(utcDay(at("2026-10-01T02:00:00Z"))).toBe("2026-10-01");
  });

  it("has six slots a trading day and one a weekend day, however many visit", () => {
    const starts = new Set<string>();
    for (let t = at("2026-09-28T11:00:00Z"); t < at("2026-10-05T11:00:00Z"); t += 60_000) {
      starts.add(currentSlot(t).key);
    }
    // Five trading days of six, two weekend days of one.
    expect(starts.size).toBe(5 * 6 + 2);
  });
});

describe("the daily budget", () => {
  it("defaults to about a quarter a day", () => {
    expect(dailyPostCap(undefined)).toBe(DEFAULT_DAILY_POST_CAP);
    expect(dailyPostCap("")).toBe(DEFAULT_DAILY_POST_CAP);
    expect(dailyPostCap("lots")).toBe(DEFAULT_DAILY_POST_CAP);
    expect(dailyPostCap("-5")).toBe(DEFAULT_DAILY_POST_CAP);
    expect(dailyPostCap("120")).toBe(120);
    expect(dailyPostCap("0")).toBe(0);
    expect(DEFAULT_DAILY_POST_CAP / POSTS_PER_DOLLAR).toBeLessThanOrEqual(0.25);
  });

  it("shares what is left over the slots to come, never below one request while one fits", () => {
    expect(allowance({ cap: 50, spent: 0, slotsLeft: 6 })).toBe(MAX_RESULTS);
    expect(allowance({ cap: 120, spent: 0, slotsLeft: 6 })).toBe(20);
    expect(allowance({ cap: 50, spent: 0, slotsLeft: 1 })).toBe(50);
    expect(allowance({ cap: 50, spent: 41, slotsLeft: 1 })).toBe(0);
    expect(allowance({ cap: 50, spent: 40, slotsLeft: 3 })).toBe(10);
    expect(allowance({ cap: 0, spent: 0, slotsLeft: 6 })).toBe(0);
  });

  it("never lets a day's fetches reserve past the cap, whatever the order of slots", () => {
    for (const cap of [0, 9, 10, 50, 120, 333]) {
      let spent = 0;
      for (let slotsLeft = 6; slotsLeft >= 1; slotsLeft -= 1) {
        // Every query returns the most it can: the worst case for the bill.
        spent += pickQueries([{}, {}, {}], allowance({ cap, spent, slotsLeft })).length * MAX_RESULTS;
      }
      // And the refresh button pressed in every slot besides.
      for (let press = 0; press < 6; press += 1) {
        spent += pickQueries([{}], allowance({ cap, spent, slotsLeft: 1 })).length * MAX_RESULTS;
      }
      expect(spent).toBeLessThanOrEqual(cap);
    }
  });
});

describe("pickQueries", () => {
  const queries = [
    { key: "company", fetchedAt: 300 },
    { key: "press-0", fetchedAt: 100 },
    { key: "press-1" },
  ];

  it("runs the longest-waiting first, never-fetched before all", () => {
    expect(pickQueries(queries, 20).map((query) => query.key)).toEqual(["press-1", "press-0"]);
    expect(pickQueries(queries, 100).map((query) => query.key)).toEqual(["press-1", "press-0", "company"]);
    expect(pickQueries(queries, 9)).toEqual([]);
    expect(pickQueries(queries, 100, 1).map((query) => query.key)).toEqual(["press-1"]);
  });
});

describe("newerId", () => {
  it("compares ids as the big numbers they are", () => {
    expect(newerId("1973000000000000001", "1973000000000000002")).toBe("1973000000000000002");
    expect(newerId("999999999999999999", "1000000000000000000")).toBe("1000000000000000000");
    expect(newerId(undefined, "5")).toBe("5");
    expect(newerId("5", undefined)).toBe("5");
  });
});

describe("since_id's age", () => {
  // A real id from 2026-09-30, posted at 01:27:56 UTC.
  const ID = "2105107345852522585";
  const POSTED = Date.parse("2026-09-30T01:27:56Z");

  it("reads when a post was made from its id", () => {
    expect(Math.abs(idPostedAt(ID)! - POSTED)).toBeLessThan(1000);
    expect(idPostedAt("not-an-id")).toBeUndefined();
  });

  it("drops a since_id once its post is six and a half days old, however recently we asked", () => {
    const day = 24 * 60 * 60 * 1000;
    expect(usableSinceId(ID, POSTED + 6 * day)).toBe(ID);
    expect(usableSinceId(ID, POSTED + 6.6 * day)).toBeUndefined();
    expect(usableSinceId(undefined, POSTED)).toBeUndefined();
    expect(usableSinceId("garbage", POSTED)).toBeUndefined();
  });
});

describe("xFetchAllowedHere", () => {
  it("lets only production on Vercel go to X, unless a machine asks explicitly", () => {
    expect(xFetchAllowedHere({ NODE_ENV: "production", VERCEL_ENV: "production" })).toBe(true);
    expect(xFetchAllowedHere({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe(false);
    expect(xFetchAllowedHere({ NODE_ENV: "production" })).toBe(false);
    expect(xFetchAllowedHere({ NODE_ENV: "development", VERCEL_ENV: "production" })).toBe(false);
    expect(xFetchAllowedHere({ NODE_ENV: "development" })).toBe(false);
    expect(xFetchAllowedHere({ NODE_ENV: "development", X_FETCH_LOCAL: "1" })).toBe(true);
    expect(xFetchAllowedHere({ NODE_ENV: "development", X_FETCH_LOCAL: "true" })).toBe(false);
  });
});
