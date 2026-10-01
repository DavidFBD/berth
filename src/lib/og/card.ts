import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { ImageResponse } from "next/og";
import { COPY, type OgCard } from "@/lib/copy";
import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/size";

/**
 * Berth's link preview cards, one system for every page ("the harbour",
 * reports/og-directions.md): the lockup and the domain along the top, a
 * plain topic line, the headline in Inter Tight 400, one sentence, and the
 * eleven harbour creatures along the foot of the card as silhouettes, heads
 * above the waterline. The page's subject stands in the middle of the row:
 * a lit face (the seal for the front door, the cormorant for the AI page),
 * or for an invite the one empty place, ringed in Berth blue. A page about
 * a person we cannot name (a profile, a friend link) lights nobody.
 *
 * Every card is built from COPY alone. Nothing here reads the database or
 * a URL: no username, no face of a real account, no price, no return, no
 * balance can reach a picture, because none is ever handed in. Signed out,
 * Berth never says whether a name exists (lib/server/social/cards), and a
 * crawler is signed out.
 *
 * Plain createElement rather than JSX so the module stays a .ts file the
 * unit tests import directly. Satori wants an explicit display on every
 * box with more than one child; `box` always gives one.
 */

export { OG_CONTENT_TYPE, OG_SIZE };

export type OgKind = "home" | "invite" | "profile" | "friendLink" | "assistants" | "privacy" | "terms";

/** The one subject in the middle of the row, if the page has one. */
type Subject = { face: string } | { seat: true } | null;

const SUBJECT: Record<OgKind, Subject> = {
  home: { face: "seal" },
  invite: { seat: true },
  profile: null,
  friendLink: null,
  assistants: { face: "cormorant" },
  privacy: null,
  terms: null,
};

/** The shelf order of src/lib/avatars.ts, by file name. */
const FACES = [
  "seal",
  "gull",
  "otter",
  "puffin",
  "starfish",
  "moon-jelly",
  "heron",
  "cormorant",
  "blue-crab",
  "porpoise",
  "blue-lobster",
] as const;

/** Brand sheet, light. The card is always light, like the locked disc. */
const C = {
  canvas: "#F7F6F4",
  ink: "#1C1917",
  muted: "#6F6964",
  accent: "#1F4ED8",
  accentSoft: "#E3E9FB",
} as const;

const svgUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

type Assets = {
  fonts: { name: string; data: Buffer; weight: 400 | 500; style: "normal" }[];
  lockup: string;
  face: Record<string, string>;
  locked: Record<string, string>;
};

let assets: Promise<Assets> | null = null;

/**
 * Fonts and pictures from the repo itself, never the network: the woff
 * files beside the woff2 that next/font serves (Satori reads woff, not
 * woff2), and the avatars as drawn by `pnpm avatars:build`.
 */
function loadAssets(): Promise<Assets> {
  assets ??= (async () => {
    // Each path starts from a fixed folder so the build traces that folder
    // only, not the whole project.
    const font = (family: string, weight: 400 | 500) =>
      readFile(join(process.cwd(), "src", "app", "fonts", family, `${family}-latin-${weight}-normal.woff`));
    const [tight, inter, inter500, mono, lockupSvg] = await Promise.all([
      font("inter-tight", 400),
      font("inter", 400),
      font("inter", 500),
      font("ibm-plex-mono", 400),
      readFile(join(process.cwd(), "public", "berth-brand", "mark", "berth-lockup-horizontal.svg")),
    ]);
    const face: Record<string, string> = {};
    const locked: Record<string, string> = {};
    await Promise.all(
      FACES.map(async (name) => {
        face[name] = svgUri((await readFile(join(process.cwd(), "public", "avatars", `${name}.svg`))).toString());
        locked[name] = svgUri((await readFile(join(process.cwd(), "public", "avatars", "locked", `${name}.svg`))).toString());
      }),
    );
    return {
      fonts: [
        { name: "Inter Tight", data: tight, weight: 400, style: "normal" },
        { name: "Inter", data: inter, weight: 400, style: "normal" },
        { name: "Inter", data: inter500, weight: 500, style: "normal" },
        { name: "IBM Plex Mono", data: mono, weight: 400, style: "normal" },
      ],
      // The lockup file still carries the pre-Seline ink; the card uses today's.
      lockup: svgUri(lockupSvg.toString().replaceAll("#151B1A", C.ink)),
      face,
      locked,
    };
  })();
  return assets;
}

function box(style: CSSProperties, ...children: ReactNode[]): ReactElement {
  return createElement("div", { style: { display: "flex", ...style } }, ...children);
}

function picture(src: string, size: number, style: CSSProperties = {}): ReactElement {
  return createElement("img", {
    src,
    width: size,
    height: size,
    alt: "",
    style: { width: size, height: size, borderRadius: size / 2, ...style },
  });
}

const DISC = 96;
const LIT = 136;
const GAP = 12;

/** The horizon: eleven places, the subject (if any) always in the middle so a centre crop keeps it. */
function horizon(a: Assets, subject: Subject): ReactElement {
  const litFace = subject && "face" in subject ? subject.face : null;
  const others = FACES.filter((name) => name !== litFace);
  const left = others.slice(0, 5);
  const right = others.slice(5, 10);
  const middle =
    subject === null
      ? picture(a.locked[others[10] ?? "seal"], DISC)
      : "seat" in subject
        ? box({
            width: DISC,
            height: DISC,
            borderRadius: DISC / 2,
            border: `3px solid ${C.accent}`,
            background: C.accentSoft,
          })
        : picture(a.face[subject.face], LIT, { marginTop: -(LIT - DISC) - 8 });
  const places = [...left.map((n) => picture(a.locked[n], DISC)), middle, ...right.map((n) => picture(a.locked[n], DISC))];
  return box(
    { position: "absolute", left: 0, right: 0, bottom: -26, justifyContent: "center", alignItems: "flex-start" },
    ...places.map((place, i) => box({ marginRight: i < places.length - 1 ? GAP : 0 }, place)),
  );
}

/** The card as an element tree, for ImageResponse and for the tests. */
export async function ogElement(kind: OgKind): Promise<ReactElement> {
  const a = await loadAssets();
  const card: OgCard = COPY.og[kind];
  const lines: ReactNode[] = [];
  if (card.eyebrow) lines.push(box({ fontSize: 24, fontWeight: 500, color: C.muted, marginBottom: 18 }, card.eyebrow));
  lines.push(
    box(
      { fontFamily: "Inter Tight", fontSize: 76, letterSpacing: -2.28, lineHeight: 1.04, color: C.ink },
      card.title,
    ),
  );
  lines.push(box({ fontSize: 29, lineHeight: 1.35, color: C.muted, marginTop: 22, maxWidth: 900 }, card.line));
  return box(
    {
      width: OG_SIZE.width,
      height: OG_SIZE.height,
      position: "relative",
      flexDirection: "column",
      background: C.canvas,
      color: C.ink,
      fontFamily: "Inter",
    },
    box(
      { position: "absolute", left: 80, top: 64, right: 80, justifyContent: "space-between", alignItems: "center" },
      createElement("img", { src: a.lockup, width: 166, height: 32, alt: "", style: { width: 166, height: 32 } }),
      box({ fontFamily: "IBM Plex Mono", fontSize: 22, color: C.muted }, COPY.og.domain),
    ),
    box({ position: "absolute", left: 80, top: 168, width: 1040, flexDirection: "column" }, ...lines),
    horizon(a, SUBJECT[kind]),
  );
}

/** The PNG for one page, 1200 x 630. */
export async function ogImage(kind: OgKind): Promise<ImageResponse> {
  const [element, a] = await Promise.all([ogElement(kind), loadAssets()]);
  return new ImageResponse(element, { ...OG_SIZE, fonts: a.fonts });
}

export function ogAlt(kind: OgKind): string {
  return COPY.og[kind].alt;
}
