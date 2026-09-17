import { describe, expect, it } from "vitest";
import {
  APPEARANCE_IDS,
  DEFAULT_APPEARANCE,
  isAppearanceId,
} from "./appearance";

describe("isAppearanceId", () => {
  it("accepts exactly the three appearances", () => {
    for (const id of APPEARANCE_IDS) expect(isAppearanceId(id)).toBe(true);
    expect(APPEARANCE_IDS).toEqual(["system", "light", "dark"]);
  });

  it("rejects the old parlour ids and anything that is not a string", () => {
    for (const old of ["original", "gangster", "aurora", "lsd", "", "casino"]) {
      expect(isAppearanceId(old)).toBe(false);
    }
    expect(isAppearanceId(undefined)).toBe(false);
    expect(isAppearanceId(3)).toBe(false);
  });

  it("defaults to following the device", () => {
    expect(DEFAULT_APPEARANCE).toBe("system");
  });
});
