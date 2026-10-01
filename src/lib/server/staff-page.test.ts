import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueStaffPagePass, staffPagePass } from "./staff-page";

/** The staff pages' pass: only a live one, for an account still on STAFF_ADMIN_IDS, opens a page. */

const ID = "0f0e0d0c-0000-4000-8000-000000000001";

describe("staffPagePass", () => {
  beforeEach(() => vi.stubEnv("SESSION_SECRET", "test-secret-for-the-staff-page-pass"));
  afterEach(() => vi.unstubAllEnvs());

  it("opens for a pass issued to an account on the list, and for nothing else", async () => {
    const pass = await issueStaffPagePass(ID);
    expect(await staffPagePass(pass, { STAFF_ADMIN_IDS: ID })).toBe(true);
    expect(await staffPagePass(pass, { STAFF_ADMIN_IDS: "" })).toBe(false);
    expect(await staffPagePass(undefined, { STAFF_ADMIN_IDS: ID })).toBe(false);
    expect(await staffPagePass(`${pass}x`, { STAFF_ADMIN_IDS: ID })).toBe(false);
  });
});
