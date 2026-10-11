import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { COPY } from "@/lib/copy";
import { ogCampaignElement, ogCampaignImage } from "@/lib/og/card";
import { campaignCardMetadata, campaignImageUrl, cardAmount, FALLBACK_CARD_HEADERS, LIVE_CARD_HEADERS } from "@/lib/server/og-campaign";

/** A live campaign's link card: its own amount, big, and nothing promised for any other state. */

function texts(node: ReactNode): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  return texts((node as ReactElement<{ children?: ReactNode }>).props?.children);
}

/** Every inline style value in the tree, to look for colours. */
function styles(node: ReactNode): string[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(styles);
  const props = (node as ReactElement<{ style?: Record<string, unknown>; children?: ReactNode }>).props ?? {};
  return [...Object.values(props.style ?? {}).map(String), ...styles(props.children)];
}

const live = { state: "live", code: "launch", amountUsd: 5, stayDays: 14, endsAt: "2026-10-25T21:59:00.000Z" } as const;

describe("the campaign link card", () => {
  it.each([
    [5, "$5"],
    [10, "$10"],
    [12.5, "$12.50"],
  ])("draws the campaign's own amount, %s as %s, beside in USDC, with the callout and the fine line", async (amount, shown) => {
    const drawn = texts(await ogCampaignElement(amount));
    expect(drawn).toContain(shown);
    expect(drawn).toContain(COPY.og.campaign.inUsdc);
    expect(drawn).toContain(COPY.og.campaign.eyebrow);
    expect(drawn).toContain(COPY.og.campaign.fine);
    expect(drawn).toContain(COPY.og.domain);
  });

  it("keeps to ink and muted: no accent, no gradient", async () => {
    const all = styles(await ogCampaignElement(5)).join(" ");
    expect(all).not.toMatch(/gradient|#1F4ED8|#E3E9FB/i);
  });

  it("is a 1200 x 630 PNG", async () => {
    const bytes = new Uint8Array(await (await ogCampaignImage(10)).arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect([...bytes.slice(1, 4)].map((b) => String.fromCharCode(b)).join("")).toBe("PNG");
    expect(view.getUint32(16)).toBe(1200);
    expect(view.getUint32(20)).toBe(630);
  }, 30_000);

  it("has an amount only while live", () => {
    expect(cardAmount(live)).toBe(5);
    for (const state of ["full", "ended", "paused", "unknown"] as const) expect(cardAmount({ state })).toBeNull();
  });

  it("names the campaign card only while live, versioned by the amount, as a large card", () => {
    const meta = campaignCardMetadata(live);
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", title: COPY.og.campaign.title("$5") });
    const url = JSON.stringify(meta.openGraph);
    expect(url).toContain("/og/c/launch?v=");
    expect(campaignImageUrl("launch", 5)).not.toBe(campaignImageUrl("launch", 10));
    expect(campaignImageUrl("launch", 5)).toBe(campaignImageUrl("launch", 5));
  });

  it("falls back to the home card, with no amount, for any other state", () => {
    for (const state of ["full", "ended", "paused", "unknown"] as const) {
      const meta = campaignCardMetadata({ state });
      const all = JSON.stringify(meta);
      expect(all).toContain("/opengraph-image?v=");
      expect(all).not.toMatch(/\/og\/c\/|\$|USDC/);
      expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
    }
  });

  it("caches a live card an hour at the edge and a fallback five minutes, never in the browser", () => {
    expect(LIVE_CARD_HEADERS["Cache-Control"]).toMatch(/max-age=0, s-maxage=3600/);
    expect(FALLBACK_CARD_HEADERS["Cache-Control"]).toMatch(/max-age=0, s-maxage=300/);
  });

  it("keeps the copy rules: no dashes", () => {
    const words = COPY.og.campaign;
    const all = [words.eyebrow, words.inUsdc, words.fine, words.title("$5"), words.description, words.alt("$5")].join(" ");
    expect(all).not.toMatch(/[‒-―]| - /);
  });
});
