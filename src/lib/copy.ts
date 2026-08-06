/**
 * Modes — the app's whole personality, switched at once.
 *
 * A mode is two things: a token-override class in globals.css (colors, fonts,
 * radii, shadows — the same shape as `.dark`) and a voice in this file. The
 * split is deliberate: CSS restyles every component for free, but personality
 * lives mostly in the words, so the words travel with the mode.
 *
 * Original is the single source of truth for the key set; every other mode
 * spreads it and overrides. A mode that misses a key therefore falls back to
 * Original's line rather than crashing or rendering blank.
 */

export type ModeId =
  | "original"
  | "gangster"
  | "nan"
  | "terminal"
  | "vaporwave"
  | "sumie";

export type ModeMeta = {
  id: ModeId;
  /** Name on the settings card, written in the mode's own voice. */
  label: string;
  /** One-liner under the label. */
  blurb: string;
  /** Class applied to <html>; token overrides hang off it in globals.css. */
  className: string;
  /**
   * [background, primary, accent] as literal colors, for the picker cards.
   * Hardcoded because a card must preview a mode that is NOT active, so the
   * live CSS variables are exactly the wrong source.
   */
  swatch: readonly [string, string, string];
  /**
   * The ambient silk field's palette (4 comma-joined hexes) and glow. Lives
   * here rather than CSS because it feeds a canvas shader attribute, which
   * custom properties can't reach.
   */
  silk: { colors: string; glow: number; opacity: number };
};

/**
 * Only modes that are actually built belong here — the settings drawer
 * renders this list, so an entry with no CSS block would sell a mode that
 * doesn't exist.
 */
export const MODES: readonly ModeMeta[] = [
  {
    id: "original",
    label: "Original",
    blurb: "The tea house as you know it. Calm, warm, porcelain.",
    className: "mode-original",
    swatch: ["oklch(0.965 0.012 85)", "oklch(0.42 0.055 55)", "oklch(0.62 0.07 300)"],
    silk: { colors: "#f4eee0,#e9dcc4,#dcd2e8,#f8f2e3", glow: 0.5, opacity: 0.6 },
  },
  {
    id: "gangster",
    label: "Gangster",
    blurb: "Gold, velvet and gothic letters. The pot becomes a stash.",
    className: "mode-gangster",
    swatch: ["oklch(0.17 0.02 310)", "oklch(0.78 0.13 85)", "oklch(0.55 0.19 25)"],
    /* Velvet-wallpaper weave: plum blacks with a thread of gold. */
    silk: { colors: "#1f1727,#2b2136,#3d2e1c,#171220", glow: 0.35, opacity: 0.55 },
  },
];

export const DEFAULT_MODE: ModeId = "original";

export function isModeId(value: unknown): value is ModeId {
  return MODES.some((mode) => mode.id === value);
}

/** Every line of personality the UI speaks, keyed once. */
export type Copy = {
  /* — cup card — */
  pour: string;
  pourFirst: string;
  pourBack: string;
  awaitsFirstPour: string;
  /** Follows the big money figure: "$10.17 …in the pot". */
  inThePot: string;
  earnedSoFar: string;
  earnedSince: (date: string) => string;
  yearOfSteeping: string;
  perYear: string;
  brewQuestion: string;
  stakingYield: string;
  lendingSpread: string;
  borrowCost: string;
  leverage: string;
  brewStrength: string;
  staleFeedNote: string;

  /* — teapot module — */
  teapotTitle: string;
  /** Follows the bold worth figure: "≈ $12.40 …in the pot, ready to pour." */
  readyToPourTail: (assetCount: number) => string;
  potEmpty: string;
  sendAnything: string;
  signInWarms: string;
  whatsInPot: string;
  needsFlame: string;
  topUp: string;
  signIn: string;
  insidePot: string;
  insidePotSub: string;
  potTotalLabel: string;

  /* — welcome screen & footer — */
  tagline: string;
  signInEmail: string;
  connectWallet: string;
  noSeedPhrases: string;
  preferOwnWallet: string;
  mottoLead: string;
  mottoDisplay: string;
  poweredBy: string;

  /* — settings — */
  settingsTitle: string;
  settingsSub: string;
  modeSectionLabel: string;
  currencySectionLabel: string;
};

const ORIGINAL: Copy = {
  pour: "Pour",
  pourFirst: "Pour your first cup",
  pourBack: "Pour back",
  awaitsFirstPour: "Your cup awaits its first pour.",
  inThePot: "in the pot",
  earnedSoFar: "Earned so far",
  earnedSince: (date) => `Earned since ${date}`,
  yearOfSteeping: "A year of steeping",
  perYear: "per year",
  brewQuestion: "How strong is this brew?",
  stakingYield: "Staking yield",
  lendingSpread: "Lending spread",
  borrowCost: "Borrow cost",
  leverage: "Leverage",
  brewStrength: "Brew strength",
  staleFeedNote:
    "The staking number is an estimate right now; the live feed is having a lie-down.",

  teapotTitle: "Your teapot",
  readyToPourTail: (assetCount) =>
    `in the pot, ready to pour${assetCount > 1 ? ` (${assetCount} assets)` : ""}.`,
  potEmpty: "The pot is empty. Top it up and the tea can flow.",
  sendAnything:
    "Send anything from ~200 assets across 20 networks. It waits here.",
  signInWarms: "Sign in and the pot warms itself. Email is all it takes.",
  whatsInPot: "What's in the pot?",
  needsFlame: "a shelf needs a flame",
  topUp: "Top up",
  signIn: "Sign in",
  insidePot: "Inside the pot",
  insidePotSub: "What you hold, and which shelf it sits on.",
  potTotalLabel: "In the pot",

  tagline:
    "A calming little game of filling up tea cups. The cups earn while they steep.",
  signInEmail: "Sign in with email",
  connectWallet: "Connect a wallet",
  noSeedPhrases: "No seed phrases, no extensions. Your pantry sets itself up.",
  preferOwnWallet: "Prefer your own wallet? Connect it instead",
  mottoLead: "Tea is the way.",
  mottoDisplay: "LSTeaTime is the best time.",
  poweredBy: "Powered by SODAX · real funds, real tea, no testnet",

  settingsTitle: "The back room",
  settingsSub: "How the tea house looks, and what the money speaks.",
  modeSectionLabel: "Mode",
  currencySectionLabel: "Currency",
};

/**
 * Gangster: 90s hip-hop by way of a velvet-wallpaper tea lounge. The register
 * is stack/grind/re-up — confident and fond, never a caricature.
 */
const GANGSTER: Copy = {
  ...ORIGINAL,
  pour: "Pour up",
  pourFirst: "Pour ya first cup",
  pourBack: "Cash out",
  awaitsFirstPour: "Cup's bone dry. Handle that.",
  inThePot: "in the stash",
  earnedSoFar: "Stacked so far",
  earnedSince: (date) => `Stacked since ${date}`,
  yearOfSteeping: "A year on the grind",
  brewQuestion: "How hard does this brew go?",
  stakingYield: "The honest hustle",
  lendingSpread: "The spread",
  borrowCost: "What the bank takes",
  leverage: "Boost",
  brewStrength: "Proof",
  staleFeedNote:
    "The yield feed's laying low right now — number's an estimate till it resurfaces.",

  teapotTitle: "The stash pot",
  readyToPourTail: (assetCount) =>
    `in the stash, ready to pour up${assetCount > 1 ? ` (${assetCount} assets deep)` : ""}.`,
  potEmpty: "Stash is empty. Re-up and get the tea flowing.",
  sendAnything: "Send anything — ~200 assets, 20 networks. It sits tight here.",
  signInWarms: "Sign in and the pot starts simmering. Email gets you in.",
  whatsInPot: "What's in the stash?",
  needsFlame: "a shelf needs a light",
  topUp: "Re-up",
  signIn: "Roll in",
  insidePot: "Inside the stash",
  insidePotSub: "What you're holding, and which shelf it rides on.",
  potTotalLabel: "In the stash",

  tagline:
    "Fill your cups, let them steep, watch the stash grow. Real recognize tea.",
  signInEmail: "Roll in with email",
  connectWallet: "Connect a wallet",
  noSeedPhrases: "No seed phrases, no extensions. The crib sets itself up.",
  preferOwnWallet: "Got your own wallet? Bring it through",
  mottoLead: "Tea is the way.",
  mottoDisplay: "Sip game immaculate.",
  poweredBy: "Powered by SODAX · real funds, real tea, no testnet",

  settingsTitle: "The back office",
  settingsSub: "How the lounge looks, and what the money talks.",
};

export const COPY: Record<ModeId, Copy> = {
  original: ORIGINAL,
  gangster: GANGSTER,
  // Until each mode's voice is written, it speaks Original — never blank.
  nan: ORIGINAL,
  terminal: ORIGINAL,
  vaporwave: ORIGINAL,
  sumie: ORIGINAL,
};
