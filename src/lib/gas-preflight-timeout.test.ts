import { describe, expect, it } from "vitest";
import { withinOrUnknown } from "./gas-need";

describe("withinOrUnknown", () => {
  it("passes a read through", async () => {
    expect(await withinOrUnknown(Promise.resolve(5n), 50)).toBe(5n);
  });
  it("counts a failed read as unknown", async () => {
    expect(await withinOrUnknown(Promise.reject(new Error("429")), 50)).toBeUndefined();
  });
  it("counts a read that hangs past the timeout as unknown", async () => {
    expect(await withinOrUnknown(new Promise<bigint>(() => {}), 20)).toBeUndefined();
  });
});
