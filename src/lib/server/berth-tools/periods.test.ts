import { describe, expect, it } from "vitest";
import { PERIODS, periodsWithHistory } from "./account";

describe("the periods a not enough history reply offers", () => {
  it("names the periods the tool accepts, never the range ids", () => {
    expect(periodsWithHistory(["1w", "14d", "since"])).toEqual(["week", "since_first_buy"]);
    expect(periodsWithHistory(["1w", "14d", "30d", "1m", "90d", "3m", "since"])).toEqual([
      "week",
      "month",
      "three_months",
      "since_first_buy",
    ]);
    expect(periodsWithHistory([])).toEqual([]);
    for (const name of periodsWithHistory(["1w", "1m", "3m", "since"])) expect(PERIODS[name]).toBeDefined();
  });
});
