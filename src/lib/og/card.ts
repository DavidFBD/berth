import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { ImageResponse } from "next/og";
import { COPY, type OgCard } from "@/lib/copy";
import { campaignUsd } from "@/lib/campaigns";
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
 * Every card is built from COPY alone, with one exception. Nothing here
 * reads the database or a URL: no price, no return, no balance can reach a
 * picture, because none is ever handed in. Signed out, Berth never says
 * whether a name exists (lib/server/social/cards), and a crawler is signed
 * out. The exception is an OgPerson, which only lib/og/people hands in:
 * a username, a face and a rank name read from the database for an owner
 * who opted in (a profile) or who shared their own invite. The person's
 * face is lit in the middle of the row (a profile) or beside the empty
 * seat (an invite).
 *
 * Plain createElement rather than JSX so the module stays a .ts file the
 * unit tests import directly. Satori wants an explicit display on every
 * box with more than one child; `box` always gives one.
 */

export { OG_CONTENT_TYPE, OG_SIZE };

export type OgKind = "home" | "invite" | "profile" | "friendLink" | "assistants" | "privacy" | "terms";

/** The one subject in the middle of the row, if the page has one. */
type Subject = { face: string } | { seat: true } | null;

/**
 * Someone a card may name, as lib/og/people read them from the database:
 * the username as stored, the face by file name (null: no avatar picked,
 * the rank's glyph stands in), and the rank. Never a number of any kind
 * beyond what a username itself may hold.
 */
export type OgPerson = { handle: string; face: FaceName | null; level: number; rank: string };

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

export type FaceName = (typeof FACES)[number];

export function isFaceName(value: string): value is FaceName {
  return (FACES as readonly string[]).includes(value);
}

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
  rank: string[];
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
    const rank = await Promise.all(
      Array.from({ length: 10 }, async (_, i) =>
        svgUri(
          (await readFile(join(process.cwd(), "public", "ranks", `rank-${String(i + 1).padStart(2, "0")}.svg`)))
            .toString()
            .replaceAll("currentColor", C.ink),
        ),
      ),
    );
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
      rank,
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
const LIFT = { marginTop: -(LIT - DISC) - 8 };

const seat = () =>
  box({
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    border: `3px solid ${C.accent}`,
    background: C.accentSoft,
  });

/** A person's face, lit; without a picked avatar, their rank's glyph on a plain disc. */
function personFace(a: Assets, person: OgPerson): ReactElement {
  if (person.face) return picture(a.face[person.face], LIT, LIFT);
  const glyph = a.rank[Math.min(Math.max(Math.round(person.level), 1), a.rank.length) - 1];
  return box(
    { width: LIT, height: LIT, borderRadius: LIT / 2, background: "#ECEAE6", justifyContent: "center", alignItems: "center", ...LIFT },
    createElement("img", { src: glyph, width: 72, height: 72, alt: "", style: { width: 72, height: 72 } }),
  );
}

function row(places: ReactElement[]): ReactElement {
  return box(
    { position: "absolute", left: 0, right: 0, bottom: -26, justifyContent: "center", alignItems: "flex-start" },
    ...places.map((place, i) => box({ marginRight: i < places.length - 1 ? GAP : 0 }, place)),
  );
}

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
        ? seat()
        : picture(a.face[subject.face], LIT, LIFT);
  return row([...left.map((n) => picture(a.locked[n], DISC)), middle, ...right.map((n) => picture(a.locked[n], DISC))]);
}

/**
 * The horizon with a person in it. A profile: their face in the middle.
 * An invite: the empty seat still in the middle, the inviter lit just
 * before it, as if keeping it.
 */
function personHorizon(a: Assets, kind: PersonalKind, person: OgPerson): ReactElement {
  const others = FACES.filter((name) => name !== person.face).slice(0, 10);
  const locked = (names: readonly string[]) => names.map((n) => picture(a.locked[n], DISC));
  if (kind === "profile") return row([...locked(others.slice(0, 5)), personFace(a, person), ...locked(others.slice(5, 10))]);
  return row([...locked(others.slice(0, 4)), personFace(a, person), seat(), ...locked(others.slice(4, 9))]);
}

export type PersonalKind = "profile" | "invite";

/** The words of a card with a person in it. Only the username and the rank name come from the person. */
function personalCard(kind: PersonalKind, person: OgPerson): OgCard {
  if (kind === "profile") {
    const words = COPY.og.profileOwner;
    return { eyebrow: words.eyebrow, title: person.handle, line: words.line(person.rank), alt: words.alt(person.handle, person.rank) };
  }
  return { ...COPY.og.invite, eyebrow: COPY.og.inviteFrom.eyebrow(person.handle), alt: COPY.og.inviteFrom.alt(person.handle) };
}

/** The card as an element tree, for ImageResponse and for the tests. */
export async function ogElement(kind: OgKind): Promise<ReactElement> {
  const a = await loadAssets();
  return frame(a, COPY.og[kind], horizon(a, SUBJECT[kind]));
}

/** A card with a person in it (lib/og/people decides who may be), as an element tree. */
export async function ogPersonalElement(kind: PersonalKind, person: OgPerson): Promise<ReactElement> {
  const a = await loadAssets();
  // A profile's title is a username: one line, fitted.
  return frame(a, personalCard(kind, person), personHorizon(a, kind, person), kind === "profile");
}

/** The PNG of a card with a person in it, 1200 x 630. */
export async function ogPersonalImage(kind: PersonalKind, person: OgPerson, init: ResponseInit = {}): Promise<ImageResponse> {
  const [element, a] = await Promise.all([ogPersonalElement(kind, person), loadAssets()]);
  return new ImageResponse(element, { ...OG_SIZE, fonts: a.fonts, ...init });
}

export function ogPersonalAlt(kind: PersonalKind, person: OgPerson): string {
  return personalCard(kind, person).alt;
}

const TITLE_SIZE = 76;
const TITLE_MIN = 48;
const TITLE_WIDTH = 1040;

/** Inter Tight advance widths in em, roughly, by glyph class: wide errs wide so a fit never overflows. */
function emWidth(text: string): number {
  let em = 0;
  for (const ch of text) {
    if (/[mwMW]/.test(ch)) em += 0.86;
    else if (/[ijl.,'!|]/.test(ch)) em += 0.28;
    else if (/[frt]/.test(ch)) em += 0.4;
    else if (/[A-Z]/.test(ch)) em += 0.7;
    else if (ch === " ") em += 0.26;
    else em += 0.6;
  }
  return em;
}

/**
 * The title's size: the house size when the words fit the line, smaller
 * for a long username (only a person's card has one line that must fit),
 * never under TITLE_MIN; past that the line ends in an ellipsis.
 */
export function titleSize(text: string): number {
  const fit = Math.floor(TITLE_WIDTH / (emWidth(text) + 0.05));
  return Math.max(TITLE_MIN, Math.min(TITLE_SIZE, fit));
}

function frame(a: Assets, card: OgCard, foot: ReactElement, oneLine = false): ReactElement {
  const lines: ReactNode[] = [];
  if (card.eyebrow) lines.push(box({ fontSize: 24, fontWeight: 500, color: C.muted, marginBottom: 18 }, card.eyebrow));
  const title = { fontFamily: "Inter Tight", lineHeight: 1.04, color: C.ink } as const;
  if (oneLine) {
    const size = titleSize(card.title);
    lines.push(
      createElement(
        "div",
        {
          style: {
            ...title,
            display: "block",
            fontSize: size,
            letterSpacing: -size * 0.03,
            width: TITLE_WIDTH,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          },
        },
        card.title,
      ),
    );
  } else {
    lines.push(box({ ...title, fontSize: TITLE_SIZE, letterSpacing: -2.28 }, card.title));
  }
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
    foot,
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

/**
 * The USDC mark, Circle's own drawing (the official usdc.svg, 2000 x 2000:
 * the disc, the dollar sign, the two arcs), in ink on the canvas like every
 * other third party mark Berth shows: never in its brand blue.
 */
const USDC_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 2000"><path fill="${C.ink}" d="M1000 2000c554.17 0 1000-445.83 1000-1000S1554.17 0 1000 0 0 445.83 0 1000s445.83 1000 1000 1000z"/><path fill="${C.canvas}" d="M1275 1158.33c0-145.83-87.5-195.83-262.5-216.66-125-16.67-150-50-150-108.34s41.67-95.83 125-95.83c75 0 116.67 25 137.5 87.5 4.17 12.5 16.67 20.83 29.17 20.83h66.66c16.67 0 29.17-12.5 29.17-29.16v-4.17c-16.67-91.67-91.67-162.5-187.5-170.83v-100c0-16.67-12.5-29.17-33.33-33.34h-62.5c-16.67 0-29.17 12.5-33.34 33.34v95.83c-125 16.67-204.16 100-204.16 204.17 0 137.5 83.33 191.66 258.33 212.5 116.67 20.83 154.17 45.83 154.17 112.5s-58.34 112.5-137.5 112.5c-108.34 0-145.84-45.84-158.34-108.34-4.16-16.66-16.66-25-29.16-25h-70.84c-16.66 0-29.16 12.5-29.16 29.17v4.17c16.66 104.16 83.33 179.16 220.83 200v100c0 16.66 12.5 29.16 33.33 33.33h62.5c16.67 0 29.17-12.5 33.34-33.33v-100c125-20.84 208.33-108.34 208.33-220.84z"/><path fill="${C.canvas}" d="M787.5 1595.83c-325-116.66-491.67-479.16-370.83-800 62.5-175 200-308.33 370.83-370.83 16.67-8.33 25-20.83 25-41.67V325c0-16.67-8.33-29.17-25-33.33-4.17 0-12.5 0-16.67 4.16-395.83 125-612.5 545.84-487.5 941.67 75 233.33 254.17 412.5 487.5 487.5 16.67 8.33 33.34 0 37.5-16.67 4.17-4.16 4.17-8.33 4.17-16.66v-58.34c0-12.5-12.5-29.16-25-37.5zM1229.17 295.83c-16.67-8.33-33.34 0-37.5 16.67-4.17 4.17-4.17 8.33-4.17 16.67v58.33c0 16.67 12.5 33.33 25 41.67 325 116.66 491.67 479.16 370.83 800-62.5 175-200 308.33-370.83 370.83-16.67 8.33-25 20.83-25 41.67V1700c0 16.67 8.33 29.17 25 33.33 4.17 0 12.5 0 16.67-4.16 395.83-125 612.5-545.84 487.5-941.67-75-237.5-258.34-416.67-487.5-491.67z"/></svg>`;

const AMOUNT_SIZE = 200;
/** The room the amount has: the card's 1040 less the mark and "in USDC". */
const AMOUNT_WIDTH = 634;

/**
 * A live campaign's card: the lockup and the domain along the top as on
 * every card, the calm callout, then the campaign's own amount, big, with
 * the USDC mark before it and "in USDC" after, and the fine line under it.
 * The amount is the one thing read from the database (by
 * lib/server/og-campaign, for a live campaign only); it is formatted here,
 * so $5, $10 and $12.50 all read cleanly. No accent: ink and muted only.
 */
export async function ogCampaignElement(amountUsd: number): Promise<ReactElement> {
  const a = await loadAssets();
  const words = COPY.og.campaign;
  const amount = campaignUsd(amountUsd);
  // Big, but never past the edge: a long amount ($999.99) is drawn a little smaller.
  const size = Math.min(AMOUNT_SIZE, Math.floor(AMOUNT_WIDTH / (emWidth(amount) * 0.92)));
  const mark = 136;
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
    box(
      { position: "absolute", left: 80, top: 168, width: 1040, flexDirection: "column" },
      box({ fontSize: 30, fontWeight: 500, color: C.muted }, words.eyebrow),
      box(
        { alignItems: "center", marginTop: 34 },
        createElement("img", { src: svgUri(USDC_MARK), width: mark, height: mark, alt: "", style: { width: mark, height: mark, marginRight: 40 } }),
        box(
          { alignItems: "flex-end" },
          box({ fontFamily: "Inter Tight", fontSize: size, lineHeight: 1, letterSpacing: -size * 0.04, color: C.ink }, amount),
          box({ fontFamily: "Inter Tight", fontSize: 56, lineHeight: 1, color: C.ink, marginLeft: 28, marginBottom: 22 }, words.inUsdc),
        ),
      ),
    ),
    box(
      { position: "absolute", left: 80, right: 80, bottom: 64, justifyContent: "space-between", alignItems: "flex-end" },
      box({ fontSize: 26, color: C.muted }, words.fine),
    ),
  );
}

/** The PNG of a live campaign's card, 1200 x 630. */
export async function ogCampaignImage(amountUsd: number, init: ResponseInit = {}): Promise<ImageResponse> {
  const [element, a] = await Promise.all([ogCampaignElement(amountUsd), loadAssets()]);
  return new ImageResponse(element, { ...OG_SIZE, fonts: a.fonts, ...init });
}
