import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DISPLAY_GC_MS, MONEY_PATH_HOOK_FILES } from "./query-freshness";

describe("query freshness", () => {
  it("keeps display answers longer than any refresh window", () => {
    expect(DISPLAY_GC_MS).toBeGreaterThanOrEqual(10 * 60_000);
  });

  it.each(MONEY_PATH_HOOK_FILES)("%s never shows cached money data as current", (file) => {
    const source = readFileSync(join(__dirname, "../hooks", file), "utf8");
    expect(source).not.toMatch(/placeholderData|keepPreviousData|DISPLAY_GC_MS|gcTime/);
  });
});
