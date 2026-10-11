import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { celebrationFor } from "@/lib/level-up";

// The home's step cards reach the wallet SDKs, which do not load under node; only their button class is borrowed.
vi.mock("@/components/home-next-step", () => ({ PRIMARY: "h-11 w-full rounded-full" }));
vi.mock("@/hooks/use-profile", () => ({ useAccountHeaders: () => ({ key: null, headers: async () => null }) }));
const reduced = { value: false };
vi.mock("motion/react", async (original) => ({ ...(await original<typeof import("motion/react")>()), useReducedMotion: () => reduced.value }));
const { LevelUpTakeoverView } = await import("./level-up-takeover");

function render(level: number, xp: number, kind: "friends_all_on" | "pour_in" = "friends_all_on") {
  const celebration = celebrationFor([{ kind, amount: 100 }], xp)!;
  expect(celebration.level).toBe(level);
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: new QueryClient() }, createElement(LevelUpTakeoverView, { celebration, avatarId: "buoy", onClose: () => {} })),
  );
}

describe("the level-up takeover", () => {
  it("is a labelled dialog with the rank, the XP, its reason and one Nice", () => {
    const html = render(3, 300);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-labelledby="[^"]+"/);
    expect(html).toContain("You reached Berth Holder");
    expect(html).toContain("for turning on friend features");
    expect(html).toContain(">Nice<");
    // The tap outside closes it too, and says so to assistive tech.
    expect(html).toContain('aria-label="Close"');
  });

  it("says what the rung opened, with the creature's own face", () => {
    const html = render(7, 2420, "pour_in");
    expect(html).toContain("You reached Pier");
    expect(html).toContain("avatar is now in your avatar picker");
    expect(html).toMatch(/crab/i);
  });

  it("draws the ink rings from the rank glyph, and none under reduced motion", () => {
    reduced.value = false;
    const moving = render(3, 300);
    const glyphs = (html: string) => html.match(/rank-03\.svg/g)?.length ?? 0;
    reduced.value = true;
    const still = render(3, 300);
    // The two rings are gone, the face keeps its mark, and nothing starts hidden.
    expect(glyphs(still)).toBeGreaterThan(0);
    expect(glyphs(moving)).toBeGreaterThan(glyphs(still));
    expect(moving).toContain("opacity:0");
    expect(still).not.toContain("opacity:0");
    reduced.value = false;
  });

  it("is a flat card with one hairline: no shadow, gradient, glow or brand colour beyond the one action", () => {
    const html = render(3, 300);
    expect(html).not.toMatch(/gradient|blur|glow|\bshadow(?:-(?:sm|md|lg|xl|2xl))?\b(?!_)|text-primary(?!-foreground)/);
  });
});
