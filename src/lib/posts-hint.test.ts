import { describe, expect, it } from "vitest";
import { COPY } from "@/lib/copy";

describe("the Posts hint", () => {
  it("says how often new posts come in, as lib/x-schedule does it, in plain sentences", () => {
    const hint = COPY.postsHint;
    expect(hint).toContain("most often while the US market is open. You can also ask for them.");
    expect(hint).not.toMatch(/half hour|every \d+ minutes/);
    expect(hint).not.toMatch(/ [-–—] /);
  });
});
