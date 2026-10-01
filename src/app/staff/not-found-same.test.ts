import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * The staff area's 404 against a real unknown address, over HTTP
 * (scripts/staff-404-check.mjs), when a server is named: STAFF_404_BASE_URL
 * (a `pnpm start` build or a preview deploy). Skipped otherwise; the unit
 * proxy tests hold the rule without a server.
 */
const base = process.env.STAFF_404_BASE_URL;

describe.skipIf(!base)("a stranger cannot tell the staff area is there", () => {
  it("answers byte for byte as an unknown address, every method", () => {
    const out = execFileSync("node", ["scripts/staff-404-check.mjs", base!], { encoding: "utf8", timeout: 120_000 });
    expect(out).toContain("Same as an unknown address");
  }, 150_000);
});
