import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { COPY } from "@/lib/copy";
import { ogElement, ogPersonalElement, ogPersonalImage, titleSize, type OgKind } from "@/lib/og/card";
import { ogImageRef } from "@/lib/og/metadata";
import { inviteCardMetadata } from "@/lib/invite-card";
import * as home from "@/app/opengraph-image";
import * as homeX from "@/app/twitter-image";
import * as invite from "@/app/r/opengraph-image";
import * as inviteX from "@/app/r/twitter-image";
import * as profile from "@/app/u/opengraph-image";
import * as profileX from "@/app/u/twitter-image";
import * as friendLink from "@/app/f/opengraph-image";
import * as friendLinkX from "@/app/f/twitter-image";
import * as assistants from "@/app/assistants/opengraph-image";
import * as assistantsX from "@/app/assistants/twitter-image";
import * as privacy from "@/app/privacy/opengraph-image";
import * as privacyX from "@/app/privacy/twitter-image";
import * as terms from "@/app/terms/opengraph-image";
import * as termsX from "@/app/terms/twitter-image";

type ImageModule = { default: () => Promise<Response>; size: { width: number; height: number }; contentType: string; alt: string };

const ROUTES: [string, OgKind, ImageModule][] = [
  ["app/opengraph-image", "home", home],
  ["app/twitter-image", "home", homeX],
  ["app/r/opengraph-image", "invite", invite],
  ["app/r/twitter-image", "invite", inviteX],
  ["app/u/opengraph-image", "profile", profile],
  ["app/u/twitter-image", "profile", profileX],
  ["app/f/opengraph-image", "friendLink", friendLink],
  ["app/f/twitter-image", "friendLink", friendLinkX],
  ["app/assistants/opengraph-image", "assistants", assistants],
  ["app/assistants/twitter-image", "assistants", assistantsX],
  ["app/privacy/opengraph-image", "privacy", privacy],
  ["app/privacy/twitter-image", "privacy", privacyX],
  ["app/terms/opengraph-image", "terms", terms],
  ["app/terms/twitter-image", "terms", termsX],
];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Every string the element tree would draw. */
function texts(node: ReactNode): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  const element = node as ReactElement<{ children?: ReactNode }>;
  return texts(element.props?.children);
}

describe("link preview cards", () => {
  it.each(ROUTES)("%s answers a 1200 x 630 PNG under 1 MB", async (_name, _kind, mod) => {
    expect(mod.size).toEqual({ width: 1200, height: 630 });
    expect(mod.contentType).toBe("image/png");
    expect(mod.alt.length).toBeGreaterThan(10);
    const bytes = new Uint8Array(await (await mod.default()).arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual(PNG_SIGNATURE);
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    // IHDR is the first chunk: width and height at bytes 16 and 20.
    expect(view.getUint32(16)).toBe(1200);
    expect(view.getUint32(20)).toBe(630);
    expect(bytes.byteLength).toBeLessThan(1024 * 1024);
  }, 30_000);

  it.each(ROUTES)("%s draws its own page's words", async (_name, kind) => {
    const drawn = texts(await ogElement(kind));
    expect(drawn).toContain(COPY.og[kind].title);
    expect(drawn).toContain(COPY.og[kind].line);
  });

  it.each(["profile", "friendLink"] as const)("the %s card never carries a name, a balance or a number", async (kind) => {
    const drawn = texts(await ogElement(kind)).join(" ");
    expect(drawn).not.toMatch(/\d|\$|usd|balance|holding|return|@/i);
    // Only the card's own words and the domain, nothing from an account.
    const allowed = new Set([COPY.og[kind].eyebrow, COPY.og[kind].title, COPY.og[kind].line, COPY.og.domain]);
    for (const text of texts(await ogElement(kind))) expect(allowed).toContain(text);
  });

  it("the renderer and the profile images read nothing but the repo's own files", () => {
    const sources = ["src/lib/og/card.ts", "src/app/u/opengraph-image.tsx", "src/app/u/twitter-image.tsx", "src/app/f/opengraph-image.tsx", "src/app/f/twitter-image.tsx"].map((p) =>
      readFileSync(join(process.cwd(), p), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""),
    );
    for (const source of sources) {
      expect(source).not.toMatch(/@\/lib\/server|getSql|fetch\(|params|portfolio|balance/);
    }
    // The profile image takes no parameters: it cannot see whose page it is on.
    expect(profile.default.length).toBe(0);
    expect(friendLink.default.length).toBe(0);
  });

  it("every card's words keep the copy rules: no dashes, no tickers", () => {
    const sample = "harbour_kit";
    const personal = [
      COPY.og.inviteFrom.title(sample),
      COPY.og.inviteFrom.eyebrow(sample),
      COPY.og.inviteFrom.alt(sample),
      COPY.og.profileOwner.title(sample),
      COPY.og.profileOwner.eyebrow,
      COPY.og.profileOwner.line("Harbour Master"),
      COPY.og.profileOwner.alt(sample, "Harbour Master"),
    ].join(" ");
    expect(personal).not.toMatch(/[‒-―]| - |\d|\$/);
    for (const [key, card] of Object.entries(COPY.og)) {
      if (key === "inviteFrom" || key === "profileOwner" || typeof card === "function") continue;
      if (typeof card !== "string" && !("line" in card)) continue;
      const words = typeof card === "string" ? card : [card.eyebrow ?? "", card.title, card.line, card.alt].join(" ");
      expect(words).not.toMatch(/[‒-―]| - /);
      expect(words).not.toMatch(/\b(AAPL|NVDA|TSLA|USDC)\b/);
    }
  });

  it("pages below a card's segment name it by address, versioned", () => {
    const ref = ogImageRef("/u", "alt");
    expect(ref.og.url).toMatch(/^\/u\/opengraph-image\?v=[0-9a-f]{12}$/);
    expect(ref.twitter.url).toMatch(/^\/u\/twitter-image\?v=[0-9a-f]{12}$/);
    const invite = inviteCardMetadata();
    expect(JSON.stringify(invite.openGraph)).toContain("/r/opengraph-image?v=");
    expect(JSON.stringify(invite.twitter)).toContain("/r/twitter-image?v=");
  });

  it("fits a long username on one line: smaller first, then an ellipsis, never past the edge", async () => {
    expect(titleSize("harbour_kit")).toBe(76);
    const wide = "w".repeat(20);
    const size = titleSize(wide);
    expect(size).toBeLessThan(76);
    expect(size).toBeGreaterThanOrEqual(48);
    const element = await ogPersonalElement("profile", { handle: wide, face: "otter", level: 1, rank: "First Line" });
    const style = findStyle(element, wide);
    expect(style).toMatchObject({ fontSize: size, width: 1040, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
    const bytes = new Uint8Array(await (await ogPersonalImage("profile", { handle: wide, face: null, level: 7, rank: "Pier" })).arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual(PNG_SIGNATURE);
  }, 30_000);
});

/** The style of the box whose own text is `text`. */
function findStyle(node: ReactNode, text: string): Record<string, unknown> | null {
  if (node === null || node === undefined || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findStyle(child, text);
      if (found) return found;
    }
    return null;
  }
  const props = (node as ReactElement<{ children?: ReactNode; style?: Record<string, unknown> }>).props;
  if (props?.children === text) return props.style ?? {};
  return findStyle(props?.children, text);
}
