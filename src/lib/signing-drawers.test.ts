import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Every drawer where an order is signed carries data-order-drawer, so the
 * level-up takeover (lib/level-up) waits until it closes and never covers a
 * signature. A component signs when it draws the order stepper or cancels
 * a waiting order; each of its DrawerContents must be marked. The list is
 * pinned, so a new signing surface is a decision, not an accident.
 */

const ROOT = join(process.cwd(), "src");
const SIGNS = /\bActionStepper\b|\buseCancelWaitingOrder\b|\buseRecordLimitOrder\b/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "dev" ? [] : walk(path);
    return path.endsWith(".tsx") && !path.endsWith(".test.tsx") ? [path] : [];
  });
}

const signing = walk(join(ROOT, "components"))
  .concat(walk(join(ROOT, "app")))
  .filter((path) => !path.endsWith("action-stepper.tsx"))
  .map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, "utf8") }))
  .filter(({ text }) => SIGNS.test(text) && text.includes("<DrawerContent"));

describe("signing drawers", () => {
  it("are exactly the buy, sell and limit cancel drawers", () => {
    expect(signing.map(({ path }) => path).sort()).toEqual([
      "components/board/waiting-orders.tsx",
      "components/flow/deposit-drawer.tsx",
      "components/flow/withdraw-drawer.tsx",
    ]);
  });

  it("mark every DrawerContent they draw, so the takeover waits", () => {
    for (const { path, text } of signing) {
      const contents = text.match(/<DrawerContent\b[^>]*>/g) ?? [];
      expect(contents.length, path).toBeGreaterThan(0);
      for (const tag of contents) expect(tag, path).toContain("data-order-drawer");
    }
  });
});
