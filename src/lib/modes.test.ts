import { describe, expect, it } from "vitest";
import { isModeId, MODE_IDS } from "./modes";
import { MODES } from "./copy";

describe("isModeId", () => {
  it("accepts every shipped mode id", () => {
    for (const id of MODE_IDS) expect(isModeId(id)).toBe(true);
  });

  it("rejects unknown ids and non-strings", () => {
    expect(isModeId("casino")).toBe(false);
    expect(isModeId("")).toBe(false);
    expect(isModeId(undefined)).toBe(false);
    expect(isModeId(3)).toBe(false);
  });
});

describe("MODE_IDS as the one source of truth", () => {
  it("matches the built modes in copy.ts exactly", () => {
    expect(MODES.map((mode) => mode.id)).toEqual([...MODE_IDS]);
  });
});
