import { describe, expect, it } from "vitest";
import { COPY } from "@/lib/copy";

describe("the Posts hint", () => {
  it("says how often new posts come in, as lib/x-schedule does it, in plain sentences", () => {
    const hint = COPY.postsHint;
    expect(hint).toContain("New posts come in a few times a day. You can also ask for them.");
    // Berth does not talk about market hours (2026-10-01).
    expect(hint).not.toMatch(/market is open|market is closed|opens at/i);
    expect(hint).not.toMatch(/half hour|every \d+ minutes/);
    expect(hint).not.toMatch(/ [-–—] /);
  });
});
