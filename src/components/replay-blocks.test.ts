import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Regions a replay must not record at all (lib/analytics BLOCK_SELECTOR):
 * masking hides text, but SVG paths and attributes would still draw a
 * company's mark or the shape of an account's value.
 */
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("replay blocks", () => {
  it("block the ticker tile, so a holding's company mark is never drawn in a replay", () => {
    const tile = source("./board/holdings-list.tsx").split("export function TickerTile")[1].split("\n}\n")[0];
    expect(tile).toMatch(/<span[^>]*\n?[^>]*data-ph-block/);
  });

  it("block the portfolio chart, so the value line is never recorded", () => {
    const chart = source("./board/portfolio-chart.tsx");
    expect(chart).toMatch(/ref=\{box\}[\s\S]{0,200}data-ph-block/);
    expect(chart).not.toMatch(/ref=\{box\}\s*\n\s*data-ph-mask/);
  });

  it("cover the friends' holdings list through the tile it renders", () => {
    const friends = source("./social/social-section.tsx").split("data-friends-hold")[1].slice(0, 2_000);
    expect(friends).toContain("<TickerTile");
  });
});
