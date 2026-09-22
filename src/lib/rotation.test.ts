import { describe, expect, it } from "vitest";
import { nextDelayMs, startRotation, turn } from "@/lib/rotation";

describe("turn", () => {
  it("brings the next kept post in at the top and sends the bottom one back", () => {
    const after = turn(startRotation(["a", "b", "c"], ["d", "e"]));
    expect(after).toEqual({ visible: ["d", "a", "b"], queue: ["e", "c"] });
  });

  it("keeps the column the same length and loses nothing over a full cycle", () => {
    let state = startRotation(["a", "b", "c"], ["d", "e"]);
    for (let step = 0; step < 5; step += 1) {
      state = turn(state);
      expect(state.visible).toHaveLength(3);
      expect([...state.visible, ...state.queue].sort()).toEqual(["a", "b", "c", "d", "e"]);
    }
  });

  it("stands still with nothing in reserve", () => {
    const state = startRotation(["a", "b"], []);
    expect(turn(state)).toEqual(state);
  });
});

describe("nextDelayMs", () => {
  it("moves once early, then every eighteen to twenty-four seconds", () => {
    expect(nextDelayMs(0)).toBe(9_000);
    expect(nextDelayMs(3, () => 0)).toBe(18_000);
    expect(nextDelayMs(3, () => 1)).toBe(24_000);
  });
});
