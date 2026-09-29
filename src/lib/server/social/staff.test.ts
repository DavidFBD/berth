import { describe, expect, it } from "vitest";
import { isStaff } from "@/lib/server/social/handles";

describe("isStaff", () => {
  it("is a verified @sodax.com email only", () => {
    expect(isStaff({ id: "a", email: "david@sodax.com" })).toBe(true);
    expect(isStaff({ id: "a", email: " David@SODAX.com " })).toBe(true);
    expect(isStaff({ id: "a", email: "david@sodax.com.evil.example" })).toBe(false);
    expect(isStaff({ id: "a", email: "sodax.com@evil.example" })).toBe(false);
    expect(isStaff({ id: "a", email: null })).toBe(false);
  });
});
