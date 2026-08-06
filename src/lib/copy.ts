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
    className: "mode-original",
    swatch: ["oklch(0.965 0.012 85)", "oklch(0.42 0.055 55)", "oklch(0.62 0.07 300)"],
    silk: { colors: "#f4eee0,#e9dcc4,#dcd2e8,#f8f2e3", glow: 0.5, opacity: 0.6 },
  },
  {
    id: "gangster",
    label: "Gangster",
    className: "mode-gangster",
    swatch: ["oklch(0.17 0.02 310)", "oklch(0.78 0.13 85)", "oklch(0.55 0.19 25)"],
    /* Velvet-wallpaper weave: plum blacks with a thread of gold. */
    silk: { colors: "#1f1727,#2b2136,#3d2e1c,#171220", glow: 0.35, opacity: 0.55 },
  },
  {
    id: "nan",
    label: "Nan's Parlour",
    className: "mode-nan",
    swatch: ["oklch(0.96 0.018 20)", "oklch(0.55 0.12 15)", "oklch(0.6 0.09 250)"],
    silk: { colors: "#f9ecec,#f3dce2,#e4ecdd,#fdf6ee", glow: 0.55, opacity: 0.6 },
  },
  {
    id: "terminal",
    label: "degen_terminal",
    className: "mode-terminal",
    swatch: ["oklch(0.15 0.02 150)", "oklch(0.8 0.19 145)", "oklch(0.75 0.15 80)"],
    silk: { colors: "#0a120c,#0e1a10,#11220f,#081008", glow: 0.25, opacity: 0.5 },
  },
  {
    id: "vaporwave",
    label: "Ｖａｐｏｒｗａｖｅ",
    className: "mode-vaporwave",
    swatch: ["oklch(0.25 0.08 290)", "oklch(0.66 0.24 340)", "oklch(0.8 0.12 195)"],
    silk: { colors: "#2a1e4f,#52276b,#1c3f63,#411f5c", glow: 0.6, opacity: 0.6 },
  },
  {
    id: "sumie",
    label: "Sumi-e",
    className: "mode-sumie",
    swatch: ["oklch(0.97 0.005 90)", "oklch(0.3 0.01 270)", "oklch(0.55 0.19 30)"],
    silk: { colors: "#f5f3ee,#e8e5de,#d5d2c9,#f0ede6", glow: 0.4, opacity: 0.5 },
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
  /**
   * Label over the year-projection stat. The VALUE under it is principal
   * plus a year of the current rate (the pot they'd have, not the
   * increment), so the label must speak in the future tense — it does the
   * "projected, not promised" work together with the "≈".
   */
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
  earnedSoFar: "Earned",
  earnedSince: (date) => `Since ${date}`,
  yearOfSteeping: "In a year",
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
  earnedSoFar: "Stacked",
  earnedSince: (date) => `Since ${date}`,
  yearOfSteeping: "A year deep",
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

/** Nan's Parlour: a doting grandmother runs the place. Everything is lovely. */
const NAN: Copy = {
  ...ORIGINAL,
  pour: "Pour a cuppa",
  pourFirst: "Your first cuppa, dear",
  pourBack: "Tip it back",
  awaitsFirstPour: "The cup's just waiting for you, love.",
  inThePot: "in the pot, love",
  earnedSoFar: "Pin money",
  earnedSince: (date) => `Since ${date}`,
  yearOfSteeping: "Next year, love",
  brewQuestion: "How's the brew, dear?",
  brewStrength: "Brew strength",
  staleFeedNote:
    "The staking number's having a little sit-down, dear; it's an estimate for now.",

  teapotTitle: "Nan's teapot",
  readyToPourTail: (assetCount) =>
    `in the pot, ready when you are${assetCount > 1 ? ` (${assetCount} lovely things)` : ""}.`,
  potEmpty: "Pot's empty, sweetheart. Shall we top it up?",
  sendAnything: "Send along anything you like, dear — it'll keep warm here.",
  signInWarms: "Come in, come in. The pot warms itself once you're through the door.",
  whatsInPot: "What's under the cosy?",
  needsFlame: "a shelf needs the stove lit",
  topUp: "Top up, dear",
  signIn: "Come in, love",
  insidePot: "Under the tea cosy",
  insidePotSub: "Everything you've got, and which shelf it's keeping warm on.",

  tagline:
    "Sit down, have a biscuit, and let your cups steep themselves lovely.",
  signInEmail: "Come in with email",
  noSeedPhrases: "No seed phrases, no extensions. Nan sorts the pantry herself.",
  preferOwnWallet: "Brought your own wallet? That's fine too, dear",
  mottoLead: "Tea is the way.",
  mottoDisplay: "There's always time for a cuppa.",

  settingsTitle: "The good cupboard",
  settingsSub: "How the parlour looks, and what the money speaks.",
};

/** Degen Terminal: lowercase, dense, permanently online. */
const TERMINAL: Copy = {
  ...ORIGINAL,
  pour: "exec pour",
  pourFirst: "exec first_pour",
  pourBack: "withdraw",
  awaitsFirstPour: "cup empty. awaiting first pour_",
  inThePot: "staked",
  earnedSoFar: "accrued",
  earnedSince: (date) => `since ${date}`,
  yearOfSteeping: "1Y proj.",
  perYear: "APY",
  brewQuestion: "show yield breakdown",
  stakingYield: "staking",
  lendingSpread: "lend spread",
  borrowCost: "borrow cost",
  leverage: "leverage",
  brewStrength: "net APY",
  staleFeedNote: "warn: lsd feed stale. displaying last-known estimate_",

  teapotTitle: "> wallet",
  readyToPourTail: (assetCount) =>
    `liquid, ready to deploy${assetCount > 1 ? ` (${assetCount} assets)` : ""}_`,
  potEmpty: "balance: 0. deposit to continue_",
  sendAnything: "accepts ~200 assets / 20 networks. funds idle here_",
  signInWarms: "auth to initialize wallet. email is the keypair_",
  whatsInPot: "ls ./pot",
  needsFlame: "gas: 0 on one chain",
  topUp: "deposit",
  signIn: "auth",
  insidePot: "./pot",
  insidePotSub: "positions by chain. gas warnings inline_",
  potTotalLabel: "total",

  tagline: "terminal-grade leveraged staking. numbers go up while you sleep_",
  signInEmail: "auth --email",
  connectWallet: "connect wallet",
  noSeedPhrases: "no seed phrase. no extension. keys provision on auth_",
  preferOwnWallet: "byo wallet? connect it",
  mottoLead: "gm. tea is the way.",
  mottoDisplay: "wagmi, one cup at a time_",

  settingsTitle: "~/.config",
  settingsSub: "skin + display currency_",
  modeSectionLabel: "skin",
  currencySectionLabel: "currency",
};

/** Vaporwave: the mall at eternal sunset. Wide letters, wide time. */
const VAPORWAVE: Copy = {
  ...ORIGINAL,
  pour: "Ｐｏｕｒ",
  pourFirst: "First pour ～",
  pourBack: "Release",
  awaitsFirstPour: "Your cup waits in the plaza.",
  inThePot: "in the fountain",
  earnedSoFar: "Bliss",
  earnedSince: (date) => `Since ${date}`,
  yearOfSteeping: "One sunset year",
  brewQuestion: "How deep is the aesthetic?",
  brewStrength: "The aesthetic",
  staleFeedNote:
    "The feed drifted out past the grid horizon; this number is a memory of it.",

  teapotTitle: "ＹＯＵＲ ＴＥＡＰＯＴ",
  readyToPourTail: (assetCount) =>
    `in the fountain, ready to flow${assetCount > 1 ? ` (${assetCount} artifacts)` : ""}.`,
  potEmpty: "The fountain is dry. Toss a coin in.",
  sendAnything: "Send anything from ~200 assets across 20 networks. Time is not real here.",
  signInWarms: "Sign in and the fountain starts to glow. Email is the password.",
  whatsInPot: "What's in the fountain?",
  topUp: "Ｔｏｐ ｕｐ",
  signIn: "Ｅｎｔｅｒ",
  insidePot: "Inside the fountain",
  insidePotSub: "Your artifacts, and which arcade they sit in.",

  tagline:
    "A calming little game in the eternal sunset. The cups steep forever.",
  signInEmail: "Enter with email",
  noSeedPhrases: "No seed phrases, no extensions. The plaza builds itself.",
  preferOwnWallet: "Your own wallet? Bring it to the plaza",
  mottoLead: "Tea is the way.",
  mottoDisplay: "ＬＳＴｅａＴｉｍｅ ４ｅｖｅｒ",

  settingsTitle: "The control room",
  settingsSub: "Reality settings. Adjust the sunset, choose the money.",
};

/** Sumi-e: ink and silence. Every word that can go, goes. */
const SUMIE: Copy = {
  ...ORIGINAL,
  pour: "Pour",
  pourFirst: "First pour",
  pourBack: "Return",
  awaitsFirstPour: "The cup waits.",
  inThePot: "steeping",
  earnedSoFar: "Grown",
  earnedSince: (date) => `Since ${date}`,
  yearOfSteeping: "One year hence",
  perYear: "a year",
  brewQuestion: "The brew, examined",
  stakingYield: "Staking",
  lendingSpread: "Lending",
  borrowCost: "Borrowing",
  leverage: "Leverage",
  brewStrength: "Strength",
  staleFeedNote: "The feed rests. The number is an estimate.",

  teapotTitle: "The pot",
  readyToPourTail: (assetCount) =>
    assetCount > 1 ? `waiting. ${assetCount} leaves.` : "waiting.",
  potEmpty: "The pot is empty.",
  sendAnything: "Send anything. It waits.",
  signInWarms: "Sign in. The pot warms.",
  whatsInPot: "Look inside",
  needsFlame: "a shelf lacks flame",
  topUp: "Add",
  signIn: "Enter",
  insidePot: "Within",
  insidePotSub: "What is held, and where.",
  potTotalLabel: "Within",

  tagline: "Cups fill. Tea steeps. Nothing more is needed.",
  signInEmail: "Enter with email",
  connectWallet: "Connect a wallet",
  noSeedPhrases: "No seed phrases. No extensions.",
  preferOwnWallet: "Your own wallet? Connect it",
  mottoLead: "Tea is the way.",
  mottoDisplay: "Stillness, steeping.",

  settingsTitle: "The alcove",
  settingsSub: "Appearance. Currency.",
};

export const COPY: Record<ModeId, Copy> = {
  original: ORIGINAL,
  gangster: GANGSTER,
  nan: NAN,
  terminal: TERMINAL,
  vaporwave: VAPORWAVE,
  sumie: SUMIE,
};
