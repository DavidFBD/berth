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

import { isModeId, type ModeId } from "@/lib/modes";

// The id list itself lives in lib/modes.ts so the server can validate a mode
// without pulling this whole script into its bundle.
export { isModeId, type ModeId };

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
  {
    id: "aurora",
    label: "Aurora",
    className: "mode-aurora",
    swatch: ["oklch(0.19 0.045 265)", "oklch(0.78 0.17 165)", "oklch(0.7 0.15 310)"],
    /* The night sky over a frozen lake: deep blue, then the lights. */
    silk: { colors: "#0b1630,#123a3f,#1d5c4a,#2c2050", glow: 0.65, opacity: 0.6 },
  },
  {
    id: "lsd",
    label: "LSDTime",
    className: "mode-lsd",
    swatch: ["oklch(0.24 0.09 315)", "oklch(0.85 0.26 135)", "oklch(0.68 0.26 345)"],
    /* The lava lamp at full simmer; globals.css slowly rotates its hues. */
    silk: { colors: "#3a1050,#7a1f6e,#20713d,#4d1f7a", glow: 0.85, opacity: 0.7 },
  },
];

export const DEFAULT_MODE: ModeId = "original";

/** Every line of personality the UI speaks, keyed once. */
export type Copy = {
  /* — cup card — */
  /** Under the shelf when no cup is taken down. Never counts the cups: the
   *  registry decides how many there are, and it has grown once already. */
  shelfHint: string;
  pour: string;
  pourFirst: string;
  pourBack: string;
  awaitsFirstPour: string;
  /** Follows the big money figure: "$10.17 …in the pot". */
  inThePot: string;
  earnedSoFar: string;
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
  /** Label for the dashboard's grand total: teapot plus every steeping cup. */
  onTheTable: string;
  /** Header line under the grand total: yield banked plus brewing, all cups. */
  earnedOverall: string;

  /* — welcome screen & footer — */
  tagline: string;
  signInEmail: string;
  connectWallet: string;
  noSeedPhrases: string;
  preferOwnWallet: string;
  /** Shown on the welcome screen when an invite code is waiting in the pocket. */
  inviteWaiting: string;
  mottoLead: string;
  mottoDisplay: string;
  poweredBy: string;

  /* — pour flow: deposit drawer — */
  pourIntoTitle: (teaName: string) => string;
  pourTitleFallback: string;
  pourSub: string;
  pickCupToPour: string;
  whatPouring: string;
  gasShortWarning: (chainName: string, symbol: string) => string;
  gasShortCta: (symbol: string) => string;
  /** `amount` arrives pre-formatted: "≈ €130 (142 USDC)" or "142 USDC". */
  teapotHolds: (amount: string) => string;
  peekingTeapot: string;
  maxLabel: string;
  youllSteep: string;
  atLeastOncePoured: string;
  fetchingQuote: string;
  noRouteForPair: string;
  burnerCostChecking: string;
  nothingForKettle: string;
  connectChainWallet: (chainName: string) => string;
  ctaPourHowMuch: string;
  ctaTooMuch: string;
  ctaSwitchNetwork: string;
  ctaNoRoute: string;
  ctaReadingLeaves: string;
  pourFilledTitle: string;
  pourFilledBody: string;
  pourFillFailedBody: string;
  steepingBody: (teaName: string | null) => string;

  /* — pour flow: withdraw drawer — */
  pourBackTitle: (teaName: string) => string;
  pourBackTitleFallback: string;
  pourBackSub: string;
  pickCupPourBack: string;
  /** `amount` arrives pre-formatted: "≈ €131" or "146.2 lsodaWEETH". */
  cupHolds: (amount: string) => string;
  signOnceOn: (chainName: string) => string;
  /** `part`/`total` arrive pre-formatted in money or shares. */
  splitSharesNote: (part: string, total: string, chainName: string) => string;
  whereTo: string;
  whereShouldWePour: string;
  pourToDifferentAddress: string;
  useMyWallet: string;
  tripleCheckAddress: (symbol: string, chainName: string) => string;
  cashOutLink: string;
  youllGetBack: string;
  asTokenLabel: string;
  ctaAddressLooksOff: string;
  ctaPourBackHowMuch: string;
  ctaCupNotThatFull: string;
  ctaTooSmallForBtc: string;
  pouredBackTitle: string;
  pouredBackBody: (chainName: string) => string;
  pourBackFailedBody: string;
  backInTeapotTitle: string;
  backInTeapotBody: (symbol: string, chainName: string) => string;
  backInTeapotBodyFallback: string;

  /* — pour flow: token picker — */
  pickerSelectTokenOn: (chainName: string) => string;
  pickerSelectChain: string;
  pickerSourceChainSub: string;
  pickerSourceHoldingsSub: string;
  pickerSourceGridSub: string;
  pickerDestTokenSub: string;
  /** `chains` arrives pre-joined: "Polygon, Solana". */
  pickerShelvesEmptyUnreachable: (chains: string) => string;
  pickerShelvesUnreachableNote: (chains: string, plural: boolean) => string;
  fillTeapot: string;
  pickerSearchPlaceholder: string;
  pickerNoMatches: (query: string) => string;

  /* — pour flow: stepper + steeping tracker — */
  brewing: string;
  stepBuild: string;
  stepApprove: string;
  stepSign: string;
  stepSkipped: string;
  stepMsgBuilding: string;
  stepMsgApproving: string;
  stepMsgSigning: string;
  keepThisOpen: string;
  teaSteeping: string;
  goodTeaMinute: string;
  carryingTray: string;
  lovely: string;
  kettleActingUpTitle: string;
  fillFailedScreenBody: string;
  closeLabel: string;
  kitchenTold: string;
  lettingKitchenKnow: string;
  kitchenToldNoReport: string;

  /* — pantry: key export. Agnostic on purpose, like the rewards corner:
     a private key reads the same in every parlour. — */
  exportKeysTitle: string;
  exportKeysSub: string;
  exportEvmLabel: string;
  exportSolanaLabel: string;

  /* — settings — */
  settingsTitle: string;
  settingsSub: string;
  modeSectionLabel: string;
  currencySectionLabel: string;

  /* — info drawer: the making-of story, retold in each mode's voice — */
  infoTitle: string;
  infoSub: string;
  infoAgentsStat: string;
  infoAgentsDetail: string;
  infoMcpStat: string;
  infoMcpDetail: string;
  infoTimeStat: string;
  infoTimeDetail: string;
  /** The @sodax/dapp-kit paragraph; the component bolds the package name. */
  infoPorcelain: string;
  /**
   * The quiet fee disclosure. Stays in every voice — honesty is house style.
   * Takes the live fee ("0.4%") so the words can never drift from the config.
   */
  infoHouseRules: (feePct: string) => string;
  infoBuildersCta: string;
  infoDocsCta: string;

  /* — lore page (/lore): the legend, told long-form in each voice — */
  loreLink: string;
  loreTitle: string;
  loreSub: string;
  loreFoundingTitle: string;
  loreFoundingBody: string;
  loreBlendsTitle: string;
  loreBlendsBody: string;
  loreKitchenTitle: string;
  loreKitchenBody: string;
  loreHouseTitle: string;
  loreHouseBody: string;
  loreCta: string;

  /* — rewards corner (tea service). Defined in the base voice only: ranks
       and rewards read the same in every parlour by design (CLAUDE.md), so
       no parlour overrides these today — but the seam is open, and a voice
       MAY flavour them later at the usual cost of one override. — */
  rankLine: (level: number, xp: string) => string;
  xpToNext: (xp: string, rankName: string) => string;
  pickFace: (amount: number) => string;
  newFace: string;
  addEmailTitle: string;
  addEmailSub: (amount: number) => string;
  inviteLockedTitle: (rankName: string) => string;
  inviteLockedSub: (level: number) => string;
  friendSavedSeat: string;
  inviteFirstPourPaid: (amount: number) => string;
  inviteFirstPourPending: (amount: number) => string;
  levelHost: (level: number) => string;
  claimAskTitle: string;
  claimAskSub: string;
  claimInputLabel: string;
  claimPlaceholder: string;
  claimCta: string;
  claimMissed: string;
  claimSuccessTitle: string;
  claimSuccessSub: string;
  inviteRowTitle: string;
  inviteRowCopied: string;
  inviteRowSub: (amount: number) => string;
  /** Appended to inviteRowSub once the link starts traveling; taps ≥ 1. */
  inviteTaps: (taps: number) => string;
  friendsAtTable: string;
  friendsTally: (seated: number, poured: number, taps: number) => string;
  xpBankedWord: string;
  xpSteepingWord: string;
  copyNudge: string;
  nudgeCopiedTitle: string;
  nudgeCopiedSub: string;
  nudgeMessage: (amount: number, link: string) => string;
  houseLedger: string;
  ledgerLoading: string;
  ledgerEmpty: string;
};

const ORIGINAL: Copy = {
  pour: "Pour",
  pourFirst: "Pour your first cup",
  pourBack: "Pour back",
  awaitsFirstPour: "Your cup awaits its first pour.",
  inThePot: "in the pot",
  earnedSoFar: "Earned",
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
  onTheTable: "On the table",
  earnedOverall: "Steeped up so far",

  tagline:
    "A calming little game of filling up tea cups. The cups earn while they steep.",
  signInEmail: "Sign in with email",
  connectWallet: "Connect a wallet",
  noSeedPhrases: "No seed phrases, no extensions. Your pantry sets itself up.",
  preferOwnWallet: "Prefer your own wallet? Connect it instead",
  inviteWaiting:
    "A friend saved you a seat. Your first pour treats you both.",
  mottoLead: "Tea is the way.",
  mottoDisplay: "LSTeaTime is the best time.",
  poweredBy: "Powered by SODAX · real funds, real tea",

  shelfHint: "Blends warmed and waiting. Pick a cup.",

  pourIntoTitle: (teaName) => `Pour into ${teaName}`,
  pourTitleFallback: "Pour a cup",
  pourSub: "Any asset, any network. It all becomes tea.",
  pickCupToPour: "Pick a cup to pour into.",
  whatPouring: "What are you pouring?",
  gasShortWarning: (chainName, symbol) =>
    `The ${chainName} shelf has no ${symbol} to light the burner. This pour pays its network fee in ${symbol}, so it can't start until a splash arrives.`,
  gasShortCta: (symbol) => `Send a splash of ${symbol} to your teapot address`,
  teapotHolds: (amount) => `Teapot holds ${amount}`,
  peekingTeapot: "Peeking in the teapot…",
  maxLabel: "Max",
  youllSteep: "You'll steep",
  atLeastOncePoured: "At least, once poured",
  fetchingQuote: "Fetching quote…",
  noRouteForPair: "No route for this pair",
  burnerCostChecking: "Checking what the burner costs. One moment.",
  nothingForKettle: "Not enough left over for the kettle (network fees)",
  connectChainWallet: (chainName) => `Connect a ${chainName} wallet`,
  ctaPourHowMuch: "Pour how much?",
  ctaTooMuch: "A touch more than your teapot holds",
  ctaSwitchNetwork: "Switch network",
  ctaNoRoute: "No blend path for this pair",
  ctaReadingLeaves: "Reading the leaves…",
  pourFilledTitle: "Your cup is poured.",
  pourFilledBody: "The steam does the rest.",
  pourFillFailedBody: "The pour couldn't be filled. Nothing was lost, try again.",
  steepingBody: (teaName) =>
    teaName
      ? `${teaName} is steeping. The steam does the rest.`
      : "Your tea is steeping.",

  pourBackTitle: (teaName) => `Pour back from ${teaName}`,
  pourBackTitleFallback: "Pour back",
  pourBackSub: "Back to any asset, on any network. The tea keeps its warmth.",
  pickCupPourBack: "Pick a cup to pour back from.",
  cupHolds: (amount) => `Your cup holds ${amount}`,
  signOnceOn: (chainName) =>
    `You'll sign once on ${chainName}, the chain you deposited from.`,
  splitSharesNote: (part, total, chainName) =>
    `${part} of your ${total} total sits under ${chainName}. The rest were deposited via other chains and become withdrawable in a follow-up pass.`,
  whereTo: "Where to?",
  whereShouldWePour: "Where should we pour it?",
  pourToDifferentAddress: "Pouring to a different address",
  useMyWallet: "Use my wallet",
  tripleCheckAddress: (symbol, chainName) =>
    `Triple-check this. Tea poured to the wrong address is gone for good, and the receiving side (your exchange) must accept ${symbol} on ${chainName}.`,
  cashOutLink: "Cash out? Pour to an exchange address instead →",
  youllGetBack: "You'll get back",
  asTokenLabel: "As",
  ctaAddressLooksOff: "That address looks off",
  ctaPourBackHowMuch: "Pour back how much?",
  ctaCupNotThatFull: "Your cup isn't quite that full",
  ctaTooSmallForBtc: "Too small a sip for Bitcoin",
  pouredBackTitle: "Poured back.",
  pouredBackBody: (chainName) => `Funds delivered on ${chainName}.`,
  pourBackFailedBody: "Your cup is untouched. Please try again.",
  backInTeapotTitle: "Back in your teapot.",
  backInTeapotBody: (symbol, chainName) =>
    `${symbol} is on its way to you on ${chainName}, ready when you are.`,
  backInTeapotBodyFallback: "Ready when you are.",

  pickerSelectTokenOn: (chainName) => `Select token on ${chainName}`,
  pickerSelectChain: "Select chain",
  pickerSourceChainSub: "Anything in the pot can become tea.",
  pickerSourceHoldingsSub: "Pour straight from what you hold.",
  pickerSourceGridSub: "Where's your tea coming from?",
  pickerDestTokenSub: "Pick what it arrives as.",
  pickerShelvesEmptyUnreachable: (chains) =>
    `Nothing on the shelves we could reach, but ${chains} won't open just now. Still trying.`,
  pickerShelvesUnreachableNote: (chains, plural) =>
    `The ${chains} ${plural ? "shelves" : "shelf"} won't open just now, so anything there is missing from this list. Still trying.`,
  fillTeapot: "Fill the teapot",
  pickerSearchPlaceholder: "Search by name or symbol",
  pickerNoMatches: (query) => `No tokens match "${query}"`,

  brewing: "Brewing…",
  stepBuild: "Build",
  stepApprove: "Approve",
  stepSign: "Sign",
  stepSkipped: "skipped",
  stepMsgBuilding: "Measuring the leaves…",
  stepMsgApproving: "Warming the pot. Approve in your wallet…",
  stepMsgSigning: "One gentle stir. Confirm in your wallet…",
  keepThisOpen: "Keep this open, good tea takes a minute.",
  teaSteeping: "Your tea is steeping…",
  goodTeaMinute: "Good tea takes a minute, usually less.",
  carryingTray: "Carrying the tray over to the solver network.",
  lovely: "Lovely",
  kettleActingUpTitle: "The kettle's acting up.",
  fillFailedScreenBody:
    "Nothing was lost and your funds are safe. If they don't reappear shortly, keep the fill hash handy for support.",
  closeLabel: "Close",
  kitchenTold: "The kitchen has been told, so someone can look into it.",
  lettingKitchenKnow: "Letting the kitchen know…",
  kitchenToldNoReport:
    "The kitchen has been told, so someone can look into it. No need to report it.",

  exportKeysTitle: "Take your keys",
  exportKeysSub:
    "Export a private key and move your funds with any wallet. Privy shows it in its own window, so the app never sees it.",
  exportEvmLabel: "EVM key",
  exportSolanaLabel: "Solana key",

  settingsTitle: "The back room",
  settingsSub: "How the tea house looks, and what the money speaks.",
  modeSectionLabel: "Mode",
  currencySectionLabel: "Currency",

  infoTitle: "How this was made",
  infoSub: "Vibed together over many cups.",
  infoAgentsStat: "25+ AI agents",
  infoAgentsDetail:
    "One measured the leaves, one warmed the pot, several argued about steam. Researchers, builders, and reviewers, all orchestrated by one Claude session.",
  infoMcpStat: "1 MCP server",
  infoMcpDetail:
    "The SODAX Builders MCP poured live protocol data (chains, tokens, vaults, docs) straight into the agents' cups while they worked.",
  infoTimeStat: "~1 afternoon",
  infoTimeDetail:
    "From an empty folder to a reviewed, cross-chain tea service: scaffolded, brewed, tasted adversarially, and refined. No crypto jargon survived the tasting.",
  infoPorcelain:
    "turns every pour into an intent-based cross-chain swap. Any asset on any of 20 networks in, leveraged staked-yield tea on Sonic out, one signature.",
  infoHouseRules: (feePct) =>
    `House rules: every pour includes a ${feePct} service charge. It keeps the tea warm and the flavours curated.`,
  infoBuildersCta: "See how it's brewed at SODAX Builders",
  infoDocsCta: "SODAX developer docs",

  loreLink: "Read the whole legend",
  loreTitle: "The Legend of LSTeaTime",
  loreSub: "How a tea house came to pour across twenty networks.",
  loreFoundingTitle: "The founding",
  loreFoundingBody:
    "One afternoon, an empty folder was warmed until it became a tea house. A parliament of AI agents measured, brewed, and argued about steam until the porcelain rang true. No crypto jargon survived the tasting; only tea remained.",
  loreBlendsTitle: "The blends",
  loreBlendsBody:
    "Every cup on the shelf is a quiet machine: staked yield, folded and refolded until the leaves earn more than they would alone. Some are strong, one is calm as a dollar. Pick by flavour. The cups do the arithmetic.",
  loreKitchenTitle: "The teapot and the kitchen",
  loreKitchenBody:
    "Send anything from ~200 assets across 20 networks and it waits in your teapot. When you pour, the kitchen (a network of solvers) carries the tray: one signature, any asset in, steeping tea out. The porcelain underneath is SODAX.",
  loreHouseTitle: "House rules",
  loreHouseBody:
    "The house pays you to play: pours, first tastes of every voice, and friends who join the table all earn XP, from New Leaf all the way to Tea Sage. And the house keeps one small rule, written by the door:",
  loreCta: "Take a seat",

  rankLine: (level, xp) => `Level ${level} · ${xp} XP`,
  xpToNext: (xp, rankName) => `${xp} XP to ${rankName}`,
  pickFace: (amount) => `Pick a face · +${amount} XP`,
  newFace: "New face",
  addEmailTitle: "Add an email to your table",
  addEmailSub: (amount) => `Keeps your seat saved. +${amount} XP`,
  inviteLockedTitle: (rankName) => `Invites unlock at ${rankName}`,
  inviteLockedSub: (level) =>
    `Reach level ${level} and you can set places at the table too.`,
  friendSavedSeat: "A friend saved your seat",
  inviteFirstPourPaid: (amount) =>
    `Your first pour paid you both +${amount} XP. Lovely.`,
  inviteFirstPourPending: (amount) =>
    `Pour your first cup and +${amount} XP lands for you both.`,
  levelHost: (level) => `Level ${level} host`,
  claimAskTitle: "Arrived on a friend's invite?",
  claimAskSub: "Enter their code and your first pour pays you both.",
  claimInputLabel: "Your friend's invite code",
  claimPlaceholder: "eight letters",
  claimCta: "Claim",
  claimMissed:
    "That code didn't take. Check it with your friend, codes never use the letters i, l, o or the digits 0 and 1.",
  claimSuccessTitle: "Invite claimed",
  claimSuccessSub: "Your first pour pays you both.",
  inviteRowTitle: "Set another place at the table",
  inviteRowCopied: "Link copied, off it goes",
  inviteRowSub: (amount) =>
    `+${amount} XP for you both when a friend pours their first cup.`,
  inviteTaps: (taps) =>
    taps === 1 ? "Your link's been tapped once." : `Your link's been tapped ${taps} times.`,
  friendsAtTable: "Friends at the table",
  friendsTally: (seated, poured, taps) =>
    `${seated} seated · ${poured} poured${taps > 0 ? ` · ${taps} link taps` : ""}`,
  xpBankedWord: "banked",
  xpSteepingWord: "steeping",
  copyNudge: "Copy a gentle nudge",
  nudgeCopiedTitle: "Nudge copied",
  nudgeCopiedSub: "Pass it along however you like.",
  nudgeMessage: (amount, link) =>
    `A seat's still warm for you at LSTeaTime. One pour and we both earn ${amount} XP: ${link}`,
  houseLedger: "House ledger",
  ledgerLoading: "Fetching the book…",
  ledgerEmpty: "Nothing written yet. Pour something.",
};

/**
 * Gangster: 90s hip-hop by way of a velvet-wallpaper tea lounge. The register
 * is stack/grind/re-up — confident and fond, never a caricature.
 */
const GANGSTER: Partial<Copy> = {
  ...ORIGINAL,
  pour: "Pour up",
  pourFirst: "Pour ya first cup",
  pourBack: "Cash out",
  awaitsFirstPour: "Cup's bone dry. Handle that.",
  inThePot: "in the stash",
  earnedSoFar: "Stacked",
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
  onTheTable: "The whole spread",
  earnedOverall: "Stacked so far",

  tagline:
    "Fill your cups, let them steep, watch the stash grow. Real recognize tea.",
  signInEmail: "Roll in with email",
  connectWallet: "Connect a wallet",
  noSeedPhrases: "No seed phrases, no extensions. The crib sets itself up.",
  preferOwnWallet: "Got your own wallet? Bring it through",
  inviteWaiting: "Your people saved you a seat. First pour pays you both.",
  mottoLead: "Tea is the way.",
  mottoDisplay: "Sip game immaculate.",
  poweredBy: "Powered by SODAX · real funds, real tea",

  pourIntoTitle: (teaName) => `Pour up: ${teaName}`,
  pourTitleFallback: "Pour up",
  pourSub: "Any asset, any network. It all becomes tea.",
  pickCupToPour: "Pick a cup to pour up.",
  whatPouring: "What you pouring?",
  gasShortWarning: (chainName, symbol) =>
    `The ${chainName} shelf's got no ${symbol} to spark the burner. This pour pays its network fee in ${symbol}, so it's parked till a splash lands.`,
  gasShortCta: (symbol) => `Send a splash of ${symbol} to the stash`,
  teapotHolds: (amount) => `Stash holds ${amount}`,
  peekingTeapot: "Checking the stash…",
  youllSteep: "You'll be steeping",
  atLeastOncePoured: "Floor price, once poured",
  fetchingQuote: "Getting a number…",
  noRouteForPair: "No route for this pair",
  burnerCostChecking: "Pricing the burner. Hold tight.",
  nothingForKettle: "Nothing left over for the kettle (network fees)",
  connectChainWallet: (chainName) => `Connect a ${chainName} wallet`,
  ctaPourHowMuch: "Pour up how much?",
  ctaTooMuch: "That's more than the stash holds",
  ctaSwitchNetwork: "Switch network",
  ctaNoRoute: "No blend path for this pair",
  ctaReadingLeaves: "Reading the leaves…",
  pourFilledTitle: "Cup's poured.",
  pourFilledBody: "The steam handles the rest.",
  pourFillFailedBody: "The pour didn't fill. Nothing lost, run it back.",
  steepingBody: (teaName) =>
    teaName ? `${teaName}'s steeping. The steam handles the rest.` : "Tea's steeping.",

  pourBackTitle: (teaName) => `Cash out: ${teaName}`,
  pourBackTitleFallback: "Cash out",
  pourBackSub: "Back to anything, on any network. The tea keeps its warmth.",
  pickCupPourBack: "Pick a cup to cash out.",
  cupHolds: (amount) => `Your cup's holding ${amount}`,
  signOnceOn: (chainName) =>
    `One signature on ${chainName}, the chain you rolled in from.`,
  splitSharesNote: (part, total, chainName) =>
    `${part} of your ${total} total rides under ${chainName}. The rest came in through other chains and cash out in a follow-up pass.`,
  whereTo: "Where's it going?",
  whereShouldWePour: "Where should we send it?",
  pourToDifferentAddress: "Sending to a different address",
  useMyWallet: "Use my wallet",
  tripleCheckAddress: (symbol, chainName) =>
    `Triple-check this. Tea sent to the wrong address is gone for good, and the receiving side (your exchange) has to take ${symbol} on ${chainName}.`,
  cashOutLink: "Cashing out? Send it to an exchange address →",
  youllGetBack: "You're getting back",
  asTokenLabel: "As",
  ctaAddressLooksOff: "That address looks off",
  ctaPourBackHowMuch: "Cash out how much?",
  ctaCupNotThatFull: "Cup's not that deep",
  ctaTooSmallForBtc: "Too small a sip for Bitcoin",
  pouredBackTitle: "Cashed out.",
  pouredBackBody: (chainName) => `Funds landed on ${chainName}.`,
  pourBackFailedBody: "Your cup's untouched. Run it back.",
  backInTeapotTitle: "Back in the stash.",
  backInTeapotBody: (symbol, chainName) =>
    `${symbol} is en route on ${chainName}, ready when you are.`,
  backInTeapotBodyFallback: "Ready when you are.",

  pickerSelectTokenOn: (chainName) => `Pick your token on ${chainName}`,
  pickerSelectChain: "Pick a network",
  pickerSourceChainSub: "Anything in the stash can become tea.",
  pickerSourceHoldingsSub: "Pour straight from what you're holding.",
  pickerSourceGridSub: "Where's the tea coming from?",
  pickerDestTokenSub: "Pick what it lands as.",
  pickerShelvesEmptyUnreachable: (chains) =>
    `Nothing on the shelves we could reach, but ${chains} won't open right now. Still working it.`,
  pickerShelvesUnreachableNote: (chains, plural) =>
    `The ${chains} ${plural ? "shelves" : "shelf"} won't open right now, so anything there is missing from this list. Still working it.`,
  fillTeapot: "Re-up the stash",
  pickerSearchPlaceholder: "Search by name or symbol",
  pickerNoMatches: (query) => `Nothing matching "${query}"`,

  brewing: "Brewing…",
  stepMsgBuilding: "Measuring the leaves…",
  stepMsgApproving: "Warming the pot. Approve in your wallet…",
  stepMsgSigning: "One smooth stir. Confirm in your wallet…",
  keepThisOpen: "Keep this open. Good tea takes a minute.",
  teaSteeping: "Tea's steeping…",
  goodTeaMinute: "Good tea takes a minute, usually less.",
  carryingTray: "Tray's on its way to the solver network.",
  lovely: "Smooth",
  kettleActingUpTitle: "Kettle's acting up.",
  fillFailedScreenBody:
    "Nothing was lost and your funds are safe. If they don't show shortly, keep the fill hash handy for support.",
  kitchenTold: "The kitchen's been told. Someone's on it.",
  lettingKitchenKnow: "Putting the kitchen on notice…",
  kitchenToldNoReport: "The kitchen's been told. Someone's on it, no need to report.",

  settingsTitle: "The back office",
  settingsSub: "How the lounge looks, and what the money talks.",

  infoTitle: "How this got built",
  infoSub: "Vibed together over many cups. Straight up.",
  infoAgentsStat: "25+ AI agents",
  infoAgentsDetail:
    "One measured the leaves, one warmed the pot, a couple argued about steam. A whole crew of researchers, builders, and reviewers, all answering to one Claude running the table.",
  infoMcpStat: "1 MCP server",
  infoMcpDetail:
    "The SODAX Builders MCP kept the crew fed with live protocol intel the whole time: chains, tokens, vaults, docs. No guesswork on this block.",
  infoTimeStat: "~1 afternoon",
  infoTimeDetail:
    "Empty folder to a cross-chain tea lounge in one sitting. Scaffolded, brewed, stress-tested, polished. Jargon didn't make the cut.",
  infoPorcelain:
    "flips every pour into an intent-based cross-chain swap. Anything on 20 networks in, leveraged staked-yield tea on Sonic out, one signature. Smooth.",
  infoHouseRules: (feePct) =>
    `House rules: every pour carries a ${feePct} service charge. Keeps the tea hot and the menu hand-picked.`,
  infoBuildersCta: "Peep the kitchen at SODAX Builders",
  infoDocsCta: "SODAX developer docs",

  loreLink: "The whole saga",
  loreTitle: "How This House Was Built",
  loreSub: "From an empty lot to pouring across twenty blocks.",
  loreFoundingTitle: "The come-up",
  loreFoundingBody:
    "One afternoon, an empty folder got put on. A crew of agents measured, brewed, and beefed about steam until the porcelain rang. No jargon made it out alive.",
  loreBlendsTitle: "The blends",
  loreBlendsBody:
    "Every cup on the shelf is a quiet hustle: staked yield folded until the leaves work double shifts. Some run hot, one keeps its head. Pick your flavour. The cups run the numbers.",
  loreKitchenTitle: "The stash and the kitchen",
  loreKitchenBody:
    "Send anything from any block and it waits in your stash. Pour, and the kitchen walks the tray over: one signature, tea on the other side. The porcelain underneath is SODAX.",
  loreHouseTitle: "House rules",
  loreHouseBody:
    "The house pays you to play: pours, first tastes, and people you bring to the table, New Leaf up to Tea Sage. And one small rule, posted by the door:",
  loreCta: "Pull up a chair",
};

/** Nan's Parlour: a doting grandmother runs the place. Everything is lovely. */
const NAN: Partial<Copy> = {
  ...ORIGINAL,
  pour: "Pour a cuppa",
  pourFirst: "Your first cuppa, dear",
  pourBack: "Tip it back",
  awaitsFirstPour: "The cup's just waiting for you, love.",
  inThePot: "in the pot, love",
  earnedSoFar: "Pin money",
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
  onTheTable: "All told, dear",
  earnedOverall: "Made for us so far, dear",

  tagline:
    "Sit down, have a biscuit, and let your cups steep themselves lovely.",
  signInEmail: "Come in with email",
  noSeedPhrases: "No seed phrases, no extensions. Nan sorts the pantry herself.",
  preferOwnWallet: "Brought your own wallet? That's fine too, dear",
  inviteWaiting:
    "A friend's kept you a chair, love. Your first cuppa treats the both of you.",
  mottoLead: "Tea is the way.",
  mottoDisplay: "There's always time for a cuppa.",

  pourIntoTitle: (teaName) => `A pour of ${teaName}, dear?`,
  pourTitleFallback: "Pour a cuppa",
  pourSub: "Anything you like, from anywhere. It all becomes tea, love.",
  pickCupToPour: "Pick a cup to pour into, dear.",
  whatPouring: "What are we pouring, love?",
  gasShortWarning: (chainName, symbol) =>
    `The ${chainName} shelf hasn't a drop of ${symbol} for the stove, love. This pour pays its little network fee in ${symbol}, so it'll wait until a splash arrives.`,
  gasShortCta: (symbol) => `Send a splash of ${symbol} over to your teapot, dear`,
  teapotHolds: (amount) => `The pot's holding ${amount}`,
  peekingTeapot: "Just peeking in the pot…",
  youllSteep: "You'll be steeping",
  atLeastOncePoured: "At the very least, once poured",
  fetchingQuote: "Asking the kitchen…",
  noRouteForPair: "That pairing won't take, dear",
  burnerCostChecking: "Just checking what the stove costs, love. One moment.",
  nothingForKettle: "Not enough left for the kettle, I'm afraid (network fees)",
  connectChainWallet: (chainName) => `Connect a ${chainName} wallet, dear`,
  ctaPourHowMuch: "How much shall we pour?",
  ctaTooMuch: "A touch more than the pot holds, love",
  ctaSwitchNetwork: "Switch over, dear",
  ctaNoRoute: "No blend path for that pair, I'm afraid",
  ctaReadingLeaves: "Reading the leaves…",
  pourFilledTitle: "There we are, poured.",
  pourFilledBody: "The steam does the rest, love.",
  pourFillFailedBody: "The pour didn't take, I'm afraid. Nothing lost. Try again, dear.",
  steepingBody: (teaName) =>
    teaName
      ? `${teaName} is steeping nicely. The steam does the rest.`
      : "Your tea is steeping nicely.",

  pourBackTitle: (teaName) => `Tip back your ${teaName}, dear?`,
  pourBackTitleFallback: "Tip it back",
  pourBackSub: "Back to whatever you like, wherever you like. The tea keeps its warmth.",
  pickCupPourBack: "Pick a cup to tip back, dear.",
  cupHolds: (amount) => `Your cup's holding ${amount}`,
  signOnceOn: (chainName) =>
    `Just the one signature on ${chainName}, love, the chain you came in on.`,
  splitSharesNote: (part, total, chainName) =>
    `${part} of your ${total} sits under ${chainName}, dear. The rest came in by other doors and can be tipped back in another little pass.`,
  whereTo: "Where to, love?",
  whereShouldWePour: "Where shall we pour it, dear?",
  pourToDifferentAddress: "Pouring to a different address",
  useMyWallet: "Back to my wallet, please",
  tripleCheckAddress: (symbol, chainName) =>
    `Do triple-check this, love. Tea poured to a wrong address is gone for good, and the receiving side (your exchange) must take ${symbol} on ${chainName}.`,
  cashOutLink: "Cashing out? Pour it to an exchange address instead →",
  youllGetBack: "You'll get back",
  asTokenLabel: "As",
  ctaAddressLooksOff: "That address looks a bit off, dear",
  ctaPourBackHowMuch: "How much shall we tip back?",
  ctaCupNotThatFull: "The cup isn't quite that full, love",
  ctaTooSmallForBtc: "Too small a sip for Bitcoin, I'm afraid",
  pouredBackTitle: "Tipped back, dear.",
  pouredBackBody: (chainName) => `All delivered on ${chainName}, love.`,
  pourBackFailedBody: "Your cup's untouched, dear. Do try again.",
  backInTeapotTitle: "Back in your teapot, love.",
  backInTeapotBody: (symbol, chainName) =>
    `Your ${symbol} is on its way over on ${chainName}. Ready when you are, dear.`,
  backInTeapotBodyFallback: "Ready when you are, dear.",

  pickerSelectTokenOn: (chainName) => `Choose your token on ${chainName}, dear`,
  pickerSelectChain: "Choose a network, love",
  pickerSourceChainSub: "Anything in the pot can become tea, dear.",
  pickerSourceHoldingsSub: "Pour straight from what you've got, love.",
  pickerSourceGridSub: "Where's your tea coming from, dear?",
  pickerDestTokenSub: "Pick what it arrives as, love.",
  pickerShelvesEmptyUnreachable: (chains) =>
    `Nothing on the shelves we could reach, dear, and ${chains} won't open just now. We'll keep trying.`,
  pickerShelvesUnreachableNote: (chains, plural) =>
    `The ${chains} ${plural ? "shelves" : "shelf"} won't open just now, love, so anything there is missing from this list. We'll keep trying.`,
  fillTeapot: "Top up the pot, dear",
  pickerSearchPlaceholder: "Search by name or symbol, dear",
  pickerNoMatches: (query) => `Nothing matching "${query}", I'm afraid`,

  brewing: "Brewing, dear…",
  stepMsgBuilding: "Measuring the leaves…",
  stepMsgApproving: "Warming the pot. Say yes in your wallet, love…",
  stepMsgSigning: "One gentle stir. Confirm in your wallet, dear…",
  keepThisOpen: "Keep this open, love. Good tea takes a minute.",
  teaSteeping: "Your tea is steeping…",
  goodTeaMinute: "Good tea takes a minute, usually less.",
  carryingTray: "Carrying the tray over now, dear.",
  lovely: "Lovely",
  kettleActingUpTitle: "The kettle's playing up, dear.",
  fillFailedScreenBody:
    "Nothing was lost and your funds are quite safe, love. If they don't reappear shortly, keep the fill hash handy for support.",
  closeLabel: "Close",
  kitchenTold: "The kitchen's been told, dear. Someone will see to it.",
  lettingKitchenKnow: "Just letting the kitchen know…",
  kitchenToldNoReport:
    "The kitchen's been told, dear. Someone will see to it, no need to report.",

  settingsTitle: "The good cupboard",
  settingsSub: "How the parlour looks, and what the money speaks.",

  infoTitle: "How it all came together, dear",
  infoSub: "Many hands and even more cuppas.",
  infoAgentsStat: "25+ AI helpers",
  infoAgentsDetail:
    "One measured the leaves, one warmed the pot, and a few had a lovely little squabble about the steam. All kept in line by one very patient Claude.",
  infoMcpStat: "1 MCP server",
  infoMcpDetail:
    "The SODAX Builders MCP passed fresh ingredients through the hatch the whole while: chains, tokens, vaults, docs. Nothing out of a packet in this house.",
  infoTimeStat: "About an afternoon",
  infoTimeDetail:
    "From a bare cupboard to a proper tea service in an afternoon, would you believe. Everything tasted twice before it went out, of course.",
  infoPorcelain:
    "turns every pour into one of those clever cross-chain swaps. Anything from 20 networks in, lovely steeping tea on Sonic out, one little signature.",
  infoHouseRules: (feePct) =>
    `House rules, love: each pour includes a small ${feePct} service charge. It keeps the tea warm and the good flavours in stock.`,
  infoBuildersCta: "See how it's done at SODAX Builders, dear",
  infoDocsCta: "The developer docs, if you're curious",

  loreLink: "The whole story, if you've a minute",
  loreTitle: "The Story of Our Little Tea House",
  loreSub: "How it all came to be, dear.",
  loreFoundingTitle: "How it began",
  loreFoundingBody:
    "One afternoon, love, an empty folder was warmed through until it became a tea house. A gaggle of helpful agents measured and brewed and had words about the steam. Only tea survived, which is as it should be.",
  loreBlendsTitle: "The blends",
  loreBlendsBody:
    "Every cup on the shelf is clever as anything: staked yield folded over and over so the leaves earn their keep. There's a calm one now, too, for when you fancy something gentle. Pick whichever takes your fancy. The cups do the sums.",
  loreKitchenTitle: "The teapot and the kitchen",
  loreKitchenBody:
    "Send along whatever you've got and it waits in the pot. When you pour, the kitchen carries the tray over: one signature and it's steeping. The porcelain underneath is SODAX. Lovely stuff.",
  loreHouseTitle: "House rules",
  loreHouseBody:
    "We do like to spoil you: pours, first tastes, and friends you bring round all earn a little something, from New Leaf to Tea Sage. And one small rule, dear, by the door:",
  loreCta: "Come in, love",
};

/** Degen Terminal: lowercase, dense, permanently online. */
const TERMINAL: Partial<Copy> = {
  ...ORIGINAL,
  pour: "exec pour",
  pourFirst: "exec first_pour",
  pourBack: "withdraw",
  awaitsFirstPour: "cup empty. awaiting first pour_",
  inThePot: "staked",
  earnedSoFar: "accrued",
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
  onTheTable: "sum(everything)",
  earnedOverall: "yield_to_date",

  tagline: "terminal-grade leveraged staking. numbers go up while you sleep_",
  signInEmail: "auth --email",
  connectWallet: "connect wallet",
  noSeedPhrases: "no seed phrase. no extension. keys provision on auth_",
  preferOwnWallet: "byo wallet? connect it",
  inviteWaiting: "referral detected. first pour pays both parties_",
  mottoLead: "gm. tea is the way.",
  mottoDisplay: "wagmi, one cup at a time_",

  pourIntoTitle: (teaName) => `pour > ${teaName.toLowerCase()}`,
  pourTitleFallback: "pour",
  pourSub: "any asset, any network. compiles to tea_",
  pickCupToPour: "select target cup_",
  whatPouring: "select input asset_",
  gasShortWarning: (chainName, symbol) =>
    `err: ${chainName.toLowerCase()} gas = 0. pour pays fees in ${symbol.toLowerCase()}. blocked until funded_`,
  gasShortCta: (symbol) => `fund ${symbol.toLowerCase()} → wallet address`,
  teapotHolds: (amount) => `balance: ${amount}`,
  peekingTeapot: "reading balance…",
  maxLabel: "max",
  youllSteep: "output (est.)",
  atLeastOncePoured: "min output",
  fetchingQuote: "fetching quote…",
  noRouteForPair: "err: no route for pair_",
  burnerCostChecking: "estimating gas. hold_",
  nothingForKettle: "err: balance ≤ gas reserve_",
  connectChainWallet: (chainName) => `connect ${chainName.toLowerCase()} wallet`,
  ctaPourHowMuch: "enter amount_",
  ctaTooMuch: "err: amount > balance",
  ctaSwitchNetwork: "switch network",
  ctaNoRoute: "err: no route",
  ctaReadingLeaves: "quoting…",
  pourFilledTitle: "pour filled.",
  pourFilledBody: "position live. steam handles the rest_",
  pourFillFailedBody: "fill failed. no funds lost. retry_",
  steepingBody: (teaName) =>
    teaName
      ? `${teaName.toLowerCase()} steeping. position updates on fill_`
      : "steeping. position updates on fill_",

  pourBackTitle: (teaName) => `withdraw > ${teaName.toLowerCase()}`,
  pourBackTitleFallback: "withdraw",
  pourBackSub: "exit to any asset on any network. warmth persists_",
  pickCupPourBack: "select source cup_",
  cupHolds: (amount) => `position: ${amount}`,
  signOnceOn: (chainName) =>
    `1 signature on ${chainName.toLowerCase()} (deposit origin)_`,
  splitSharesNote: (part, total, chainName) =>
    `${part} of ${total} total mapped to ${chainName.toLowerCase()}. remainder exits via follow-up pass_`,
  whereTo: "select destination_",
  whereShouldWePour: "select output asset_",
  pourToDifferentAddress: "custom destination address",
  useMyWallet: "use own wallet",
  tripleCheckAddress: (symbol, chainName) =>
    `verify twice, send once. wrong address = unrecoverable. receiving side must accept ${symbol.toLowerCase()} on ${chainName.toLowerCase()}_`,
  cashOutLink: "cash out? route to exchange address →",
  youllGetBack: "output (est.)",
  asTokenLabel: "as",
  ctaAddressLooksOff: "err: address malformed",
  ctaPourBackHowMuch: "enter amount_",
  ctaCupNotThatFull: "err: amount > position",
  ctaTooSmallForBtc: "err: below btc dust limit",
  pouredBackTitle: "withdrawn.",
  pouredBackBody: (chainName) => `funds delivered on ${chainName.toLowerCase()}_`,
  pourBackFailedBody: "fill failed. position untouched. retry_",
  backInTeapotTitle: "exit complete.",
  backInTeapotBody: (symbol, chainName) =>
    `${symbol.toLowerCase()} inbound on ${chainName.toLowerCase()}_`,
  backInTeapotBodyFallback: "inbound_",

  pickerSelectTokenOn: (chainName) => `select token @ ${chainName.toLowerCase()}`,
  pickerSelectChain: "select network",
  pickerSourceChainSub: "any asset compiles to tea_",
  pickerSourceHoldingsSub: "deploy directly from holdings_",
  pickerSourceGridSub: "select source network_",
  pickerDestTokenSub: "select output asset_",
  pickerShelvesEmptyUnreachable: (chains) =>
    `no readable balances. warn: ${chains.toLowerCase()} rpc unreachable. retrying_`,
  pickerShelvesUnreachableNote: (chains) =>
    `warn: ${chains.toLowerCase()} rpc unreachable. balances there not listed. retrying_`,
  fillTeapot: "deposit",
  pickerSearchPlaceholder: "grep name|symbol",
  pickerNoMatches: (query) => `0 results for "${query}"_`,

  brewing: "executing…",
  stepBuild: "build",
  stepApprove: "approve",
  stepSign: "sign",
  stepSkipped: "skipped",
  stepMsgBuilding: "building intent…",
  stepMsgApproving: "awaiting approval sig…",
  stepMsgSigning: "awaiting sig…",
  keepThisOpen: "keep tab open. ~1 min_",
  teaSteeping: "steeping…",
  goodTeaMinute: "eta < 1 min_",
  carryingTray: "relaying to solver network…",
  lovely: "ack",
  kettleActingUpTitle: "err: solver fill failed.",
  fillFailedScreenBody:
    "no funds lost. if balance doesn't update shortly, keep the fill hash for support_",
  closeLabel: "close",
  kitchenTold: "issue filed. team notified_",
  lettingKitchenKnow: "filing issue…",
  kitchenToldNoReport: "issue filed. team notified. no action needed_",

  settingsTitle: "~/.config",
  settingsSub: "skin + display currency_",
  modeSectionLabel: "skin",
  currencySectionLabel: "currency",

  infoTitle: "> build_log",
  infoSub: "compiled from vibes. reviewed anyway_",
  infoAgentsStat: "25+ agents",
  infoAgentsDetail:
    "researchers, builders, reviewers spawned in parallel. one claude session as orchestrator. zero meetings_",
  infoMcpStat: "1 mcp server",
  infoMcpDetail:
    "sodax builders mcp streamed live protocol state into the pipeline: chains, tokens, vaults, docs. cache warm, data fresh_",
  infoTimeStat: "~1 afternoon",
  infoTimeDetail:
    "empty dir to cross-chain app in one session. scaffold, build, adversarial review, ship. jargon stripped at lint_",
  infoPorcelain:
    "compiles each pour to an intent-based cross-chain swap. ~200 assets / 20 networks in, leveraged lst yield on sonic out. 1 sig_",
  infoHouseRules: (feePct) => `fee schedule: ${feePct} per pour. keeps the tea warm + the flavors curated_`,
  infoBuildersCta: "src: builders.sodax.com",
  infoDocsCta: "docs: docs.sodax.com",

  loreLink: "cat lore.md",
  loreTitle: "readme.lore",
  loreSub: "git log of a tea house_",
  loreFoundingTitle: "init",
  loreFoundingBody:
    "one afternoon: mkdir, then a tea house. n agents measured, brewed, argued about steam. jargon: zero survivors.",
  loreBlendsTitle: "the blends",
  loreBlendsBody:
    "n cups, n = len(shelf). each = staked yield, looped. leaves earn more than leaves idle. one runs flat by design. pick flavour; cups do math.",
  loreKitchenTitle: "pot + kitchen",
  loreKitchenBody:
    "send anything from 20 chains. it waits in the pot. pour = 1 signature; solver network carries the tray. base layer: SODAX.",
  loreHouseTitle: "house rules",
  loreHouseBody:
    "xp for playing: pours, first tastes, referrals. new_leaf → tea_sage. one rule by the door:",
  loreCta: "cd ~/table",
};

/** Vaporwave: the mall at eternal sunset. Wide letters, wide time. */
const VAPORWAVE: Partial<Copy> = {
  ...ORIGINAL,
  pour: "Ｐｏｕｒ",
  pourFirst: "First pour ～",
  pourBack: "Release",
  awaitsFirstPour: "Your cup waits in the plaza.",
  inThePot: "in the fountain",
  earnedSoFar: "Bliss",
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
  onTheTable: "Ｎｅｔ　ｗｏｒｔｈ",
  earnedOverall: "Ｅａｒｎｅｄ　so far",

  tagline:
    "A calming little game in the eternal sunset. The cups steep forever.",
  signInEmail: "Enter with email",
  noSeedPhrases: "No seed phrases, no extensions. The plaza builds itself.",
  preferOwnWallet: "Your own wallet? Bring it to the plaza",
  inviteWaiting:
    "A seat glows for you in the plaza. Your first pour rewards you both.",
  mottoLead: "Tea is the way.",
  mottoDisplay: "ＬＳＴｅａＴｉｍｅ ４ｅｖｅｒ",

  pourIntoTitle: (teaName) => `Ｐｏｕｒ ～ ${teaName}`,
  pourTitleFallback: "Ｐｏｕｒ",
  pourSub: "Any artifact, any network. It all becomes tea in the fountain.",
  pickCupToPour: "Choose a cup in the plaza.",
  whatPouring: "What flows in?",
  gasShortWarning: (chainName, symbol) =>
    `The ${chainName} arcade holds no ${symbol} to light the neon. This pour pays its network fee in ${symbol}, so it waits until a splash arrives.`,
  gasShortCta: (symbol) => `Send a splash of ${symbol} to your fountain`,
  teapotHolds: (amount) => `The fountain holds ${amount}`,
  peekingTeapot: "Gazing into the fountain…",
  youllSteep: "You'll steep",
  atLeastOncePoured: "At least, once poured",
  fetchingQuote: "Asking the sunset…",
  noRouteForPair: "No path through the grid for this pair",
  burnerCostChecking: "Pricing the neon. One moment in eternity.",
  nothingForKettle: "Nothing left for the neon (network fees)",
  connectChainWallet: (chainName) => `Connect a ${chainName} wallet`,
  ctaPourHowMuch: "How much flows?",
  ctaTooMuch: "More than the fountain holds",
  ctaSwitchNetwork: "Switch network",
  ctaNoRoute: "No blend path through the grid",
  ctaReadingLeaves: "Reading the horizon…",
  pourFilledTitle: "Poured into forever.",
  pourFilledBody: "The steam does the rest.",
  pourFillFailedBody: "The pour dissolved before filling. Nothing was lost. Flow again.",
  steepingBody: (teaName) =>
    teaName
      ? `${teaName} steeps in the eternal sunset. The steam does the rest.`
      : "Your tea steeps in the eternal sunset.",

  pourBackTitle: (teaName) => `Ｒｅｌｅａｓｅ ～ ${teaName}`,
  pourBackTitleFallback: "Ｒｅｌｅａｓｅ",
  pourBackSub: "Back to any artifact, on any network. The warmth never leaves the plaza.",
  pickCupPourBack: "Choose a cup to release.",
  cupHolds: (amount) => `Your cup holds ${amount}`,
  signOnceOn: (chainName) =>
    `One signature on ${chainName}, the arcade you first entered through.`,
  splitSharesNote: (part, total, chainName) =>
    `${part} of your ${total} rests under ${chainName}. The rest entered through other arcades and release in a later wave.`,
  whereTo: "Where does it flow?",
  whereShouldWePour: "Where should it flow?",
  pourToDifferentAddress: "Flowing to a different address",
  useMyWallet: "Back to my wallet",
  tripleCheckAddress: (symbol, chainName) =>
    `Triple-check this. Tea that flows to a wrong address is gone beyond the grid, and the receiving side (your exchange) must accept ${symbol} on ${chainName}.`,
  cashOutLink: "Leaving the plaza? Flow to an exchange address →",
  youllGetBack: "Returning to you",
  asTokenLabel: "As",
  ctaAddressLooksOff: "That address shimmers wrong",
  ctaPourBackHowMuch: "Release how much?",
  ctaCupNotThatFull: "The cup holds less than that",
  ctaTooSmallForBtc: "Too small a sip for Bitcoin",
  pouredBackTitle: "Released.",
  pouredBackBody: (chainName) => `Delivered on ${chainName}, under the same sunset.`,
  pourBackFailedBody: "Your cup is untouched. Flow again.",
  backInTeapotTitle: "Back in your fountain.",
  backInTeapotBody: (symbol, chainName) =>
    `${symbol} drifts toward you on ${chainName}, ready when you are.`,
  backInTeapotBodyFallback: "Ready when you are.",

  pickerSelectTokenOn: (chainName) => `Choose an artifact on ${chainName}`,
  pickerSelectChain: "Choose an arcade",
  pickerSourceChainSub: "Any artifact becomes tea in the fountain.",
  pickerSourceHoldingsSub: "Pour straight from what floats in your fountain.",
  pickerSourceGridSub: "Which arcade does your tea come from?",
  pickerDestTokenSub: "Choose what it returns as.",
  pickerShelvesEmptyUnreachable: (chains) =>
    `Nothing on the shelves we could reach, and ${chains} drifted past the grid horizon. Still calling out to it.`,
  pickerShelvesUnreachableNote: (chains, plural) =>
    `The ${chains} ${plural ? "arcades have" : "arcade has"} drifted past the grid horizon, so anything there is missing from this list. Still calling.`,
  fillTeapot: "Ｔｏｐ ｕｐ",
  pickerSearchPlaceholder: "Search the plaza",
  pickerNoMatches: (query) => `Nothing in the plaza matches "${query}"`,

  brewing: "Ｂｒｅｗｉｎｇ…",
  stepMsgBuilding: "Measuring the leaves…",
  stepMsgApproving: "Warming the pot. Approve in your wallet…",
  stepMsgSigning: "One slow stir. Confirm in your wallet…",
  keepThisOpen: "Stay in the plaza. Good tea takes a minute, and minutes are long here.",
  teaSteeping: "Your tea is steeping…",
  goodTeaMinute: "Good tea takes a minute. Time is generous here.",
  carryingTray: "The tray glides across the grid to the solvers.",
  lovely: "Ｌｏｖｅｌｙ",
  kettleActingUpTitle: "The kettle flickers.",
  fillFailedScreenBody:
    "Nothing was lost and your funds are safe. If they don't reappear shortly, keep the fill hash handy for support.",
  closeLabel: "Close",
  kitchenTold: "The control room has been told. Someone is looking into it.",
  lettingKitchenKnow: "Signalling the control room…",
  kitchenToldNoReport:
    "The control room has been told. Someone is looking into it, no need to report.",

  settingsTitle: "The control room",
  settingsSub: "Reality settings. Adjust the sunset, choose the money.",

  infoTitle: "ＨＯＷ ＩＴ ＷＡＳ ＭＡＤＥ",
  infoSub: "Dreamt into the plaza over one long sunset.",
  infoAgentsStat: "25+ AI agents",
  infoAgentsDetail:
    "One measured the leaves, one warmed the pot, several debated the steam until the mall lights hummed. All conducted by a single Claude, somewhere beyond the grid.",
  infoMcpStat: "1 MCP server",
  infoMcpDetail:
    "The SODAX Builders MCP piped live protocol data into the plaza: chains, tokens, vaults, docs, flowing like fountain water.",
  infoTimeStat: "One sunset",
  infoTimeDetail:
    "An empty folder became this arcade before the sun finished setting. The sun is always finishing setting.",
  infoPorcelain:
    "renders every pour as an intent-based cross-chain swap. Any artifact from 20 networks in, leveraged staked-yield tea on Sonic out, one signature.",
  infoHouseRules: (feePct) =>
    `Plaza rules: every pour includes a ${feePct} service charge. It keeps the tea warm and the flavors curated, forever.`,
  infoBuildersCta: "Visit the atrium: SODAX Builders",
  infoDocsCta: "The archive: developer docs",

  loreLink: "Ｔｈｅ ｌｅｇｅｎｄ",
  loreTitle: "Ｔｈｅ Ｌｅｇｅｎｄ",
  loreSub: "A tea house at the edge of the mall sunset.",
  loreFoundingTitle: "Genesis",
  loreFoundingBody:
    "One eternal afternoon, an empty folder dissolved into a tea house. A choir of agents measured, brewed, and argued about steam until the marble hummed. Only aesthetics survived.",
  loreBlendsTitle: "The artifacts",
  loreBlendsBody:
    "Every cup on the shelf is a quiet machine: staked yield folded like light in pool water. One of them holds perfectly still. Choose your artifact. The cups compute.",
  loreKitchenTitle: "The fountain and the kitchen",
  loreKitchenBody:
    "Send anything across twenty networks; it shimmers in the fountain. Pour once, sign once, and the kitchen glides the tray through the arcade. Beneath the marble: SODAX.",
  loreHouseTitle: "House rules",
  loreHouseBody:
    "The mall rewards its visitors: pours, first tastes, invited friends, New Leaf to Tea Sage. One rule, etched by the door:",
  loreCta: "Ｅｎｔｅｒ",
};

/** Sumi-e: ink and silence. Every word that can go, goes. */
const SUMIE: Partial<Copy> = {
  ...ORIGINAL,
  pour: "Pour",
  pourFirst: "First pour",
  pourBack: "Return",
  awaitsFirstPour: "The cup waits.",
  inThePot: "steeping",
  earnedSoFar: "Grown",
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
  onTheTable: "All, together",
  earnedOverall: "Quietly earned",

  tagline: "Cups fill. Tea steeps. Nothing more is needed.",
  signInEmail: "Enter with email",
  connectWallet: "Connect a wallet",
  noSeedPhrases: "No seed phrases. No extensions.",
  preferOwnWallet: "Your own wallet? Connect it",
  inviteWaiting: "A seat waits. One pour rewards two.",
  mottoLead: "Tea is the way.",
  mottoDisplay: "Stillness, steeping.",

  pourIntoTitle: (teaName) => `Pour. ${teaName}.`,
  pourTitleFallback: "Pour",
  pourSub: "Any asset. Any network. Tea.",
  pickCupToPour: "Choose a cup.",
  whatPouring: "What is poured?",
  gasShortWarning: (chainName, symbol) =>
    `${chainName} holds no ${symbol} for the flame. The fee is paid in ${symbol}. The pour waits.`,
  gasShortCta: (symbol) => `Send ${symbol} to the pot`,
  teapotHolds: (amount) => `The pot holds ${amount}`,
  peekingTeapot: "Looking…",
  youllSteep: "Becomes",
  atLeastOncePoured: "At least",
  fetchingQuote: "Asking…",
  noRouteForPair: "No path for this pair",
  burnerCostChecking: "Weighing the flame. A moment.",
  nothingForKettle: "Nothing spare for the flame (network fees)",
  connectChainWallet: (chainName) => `Connect a ${chainName} wallet`,
  ctaPourHowMuch: "How much?",
  ctaTooMuch: "More than the pot holds",
  ctaSwitchNetwork: "Switch network",
  ctaNoRoute: "No path",
  ctaReadingLeaves: "Reading…",
  pourFilledTitle: "Poured.",
  pourFilledBody: "The steam does the rest.",
  pourFillFailedBody: "Unfilled. Nothing lost. Pour again.",
  steepingBody: (teaName) => (teaName ? `${teaName} steeps.` : "It steeps."),

  pourBackTitle: (teaName) => `Return. ${teaName}.`,
  pourBackTitleFallback: "Return",
  pourBackSub: "Back to any asset, any network. The warmth remains.",
  pickCupPourBack: "Choose a cup to return.",
  cupHolds: (amount) => `The cup holds ${amount}`,
  signOnceOn: (chainName) => `One signature, on ${chainName}. Where you entered.`,
  splitSharesNote: (part, total, chainName) =>
    `${part} of ${total} rests under ${chainName}. The rest returns in another pass.`,
  whereTo: "Where?",
  whereShouldWePour: "Where to?",
  pourToDifferentAddress: "Another address",
  useMyWallet: "My wallet",
  tripleCheckAddress: (symbol, chainName) =>
    `Look three times. A wrong address does not return. The receiver must accept ${symbol} on ${chainName}.`,
  cashOutLink: "To an exchange address instead →",
  youllGetBack: "Returns as",
  asTokenLabel: "As",
  ctaAddressLooksOff: "The address is wrong",
  ctaPourBackHowMuch: "How much?",
  ctaCupNotThatFull: "The cup holds less",
  ctaTooSmallForBtc: "Too small for Bitcoin",
  pouredBackTitle: "Returned.",
  pouredBackBody: (chainName) => `Delivered. ${chainName}.`,
  pourBackFailedBody: "The cup is untouched. Pour again.",
  backInTeapotTitle: "Returned to the pot.",
  backInTeapotBody: (symbol, chainName) => `${symbol} arrives on ${chainName}.`,
  backInTeapotBodyFallback: "It arrives.",

  pickerSelectTokenOn: (chainName) => `A token, on ${chainName}`,
  pickerSelectChain: "A network",
  pickerSourceChainSub: "Anything becomes tea.",
  pickerSourceHoldingsSub: "Pour from what is held.",
  pickerSourceGridSub: "From where?",
  pickerDestTokenSub: "It arrives as…",
  pickerShelvesEmptyUnreachable: (chains) =>
    `The reachable shelves are bare. ${chains} does not answer. We try again.`,
  pickerShelvesUnreachableNote: (chains) =>
    `${chains} does not answer. What rests there is not listed. We try again.`,
  fillTeapot: "Add to the pot",
  pickerSearchPlaceholder: "Search",
  pickerNoMatches: (query) => `Nothing matches "${query}"`,

  brewing: "Brewing.",
  stepMsgBuilding: "Measuring.",
  stepMsgApproving: "Warming. Approve in your wallet.",
  stepMsgSigning: "One stir. Confirm in your wallet.",
  keepThisOpen: "Stay. Good tea takes a minute.",
  teaSteeping: "It steeps.",
  goodTeaMinute: "A minute. Often less.",
  carryingTray: "The tray is carried.",
  lovely: "Well",
  kettleActingUpTitle: "The kettle falters.",
  fillFailedScreenBody:
    "Nothing was lost. Your funds are safe. If they do not reappear, keep the fill hash for support.",
  closeLabel: "Close",
  kitchenTold: "The kitchen knows.",
  lettingKitchenKnow: "Telling the kitchen.",
  kitchenToldNoReport: "The kitchen knows. Nothing more is needed.",

  settingsTitle: "The alcove",
  settingsSub: "Appearance. Currency.",

  infoTitle: "Its making",
  infoSub: "Many hands. One afternoon.",
  infoAgentsStat: "25+ agents",
  infoAgentsDetail: "Some measured. Some built. Some doubted. One session held the brush.",
  infoMcpStat: "1 server",
  infoMcpDetail: "Live protocol data, poured as needed. Chains, tokens, vaults, docs.",
  infoTimeStat: "One afternoon",
  infoTimeDetail: "An empty folder, then this. Each stroke examined before the ink dried.",
  infoPorcelain:
    "beneath. Each pour, one intent, one swap. Twenty networks in, steeping yield out, one signature.",
  infoHouseRules: (feePct) => `Each pour carries a ${feePct} charge. The tea stays warm. The flavours, chosen.`,
  infoBuildersCta: "SODAX Builders",
  infoDocsCta: "Developer docs",

  loreLink: "The legend, whole",
  loreTitle: "The Legend",
  loreSub: "A tea house, in few strokes.",
  loreFoundingTitle: "Origin",
  loreFoundingBody:
    "An afternoon. An empty folder, warmed. Many hands measured; some doubted. Tea remained.",
  loreBlendsTitle: "The blends",
  loreBlendsBody:
    "Cups on a shelf. Each folds yield upon yield, quietly. One is quieter still. Choose. The cups count.",
  loreKitchenTitle: "Pot and kitchen",
  loreKitchenBody:
    "Send anything. It waits. One signature; the tray is carried. Beneath: SODAX.",
  loreHouseTitle: "House rules",
  loreHouseBody:
    "Play is rewarded. Pours, first tastes, companions. New Leaf, then Tea Sage. One rule, by the door:",
  loreCta: "Enter",
};

/**
 * Aurora: a Finnish winter night. Sauna warmth against arctic dark, dry
 * northern understatement, and the revontulet, the fox fires: old Finland
 * says a fox sweeps its tail across the snow and sparks the sky alight.
 * The register is quiet and warm; the cold does the contrast work.
 */
const AURORA: Partial<Copy> = {
  ...ORIGINAL,
  pour: "Pour",
  pourFirst: "Pour your first cup",
  pourBack: "Pour back",
  awaitsFirstPour: "Your cup waits under the northern sky.",
  inThePot: "in the pot",
  earnedSoFar: "Gathered",
  yearOfSteeping: "One winter from now",
  perYear: "per year",
  brewQuestion: "What warms this cup?",
  stakingYield: "Staking yield",
  lendingSpread: "Lending spread",
  borrowCost: "Borrow cost",
  leverage: "Leverage",
  brewStrength: "Brew strength",
  staleFeedNote:
    "The staking number is an estimate right now; the live feed stepped out to the sauna.",

  teapotTitle: "Your teapot",
  readyToPourTail: (assetCount) =>
    `in the pot, kept warm${assetCount > 1 ? ` (${assetCount} assets)` : ""}.`,
  potEmpty: "The pot is empty. The night is long enough to fill it.",
  sendAnything:
    "Send anything from ~200 assets across 20 networks. It keeps well in the cold.",
  signInWarms: "Sign in and the pot warms itself. Email is all it takes.",
  whatsInPot: "What's in the pot?",
  needsFlame: "a shelf needs firewood",
  topUp: "Top up",
  signIn: "Step inside",
  insidePot: "Inside the pot",
  insidePotSub: "What you hold, and which shelf it rests on.",
  potTotalLabel: "In the pot",
  onTheTable: "The whole table",
  earnedOverall: "Earned under the lights",

  tagline:
    "A calm little game of filling tea cups under the northern lights. The cups earn while they steep.",
  signInEmail: "Sign in with email",
  connectWallet: "Connect a wallet",
  noSeedPhrases: "No seed phrases, no extensions. Your cabin sets itself up.",
  preferOwnWallet: "Prefer your own wallet? Connect it instead",
  inviteWaiting:
    "A friend warmed a seat for you by the stove. Your first pour treats you both.",
  mottoLead: "Tea is the way.",
  mottoDisplay: "Steam rises. Lights dance.",

  pourIntoTitle: (teaName) => `Pour into ${teaName}`,
  pourTitleFallback: "Pour a cup",
  pourSub: "Any asset, any network. It all becomes tea under the same sky.",
  pickCupToPour: "Pick a cup to pour into.",
  whatPouring: "What are you pouring?",
  gasShortWarning: (chainName, symbol) =>
    `The ${chainName} shelf has no ${symbol} for the stove. This pour pays its network fee in ${symbol}, so nothing warms until a splash arrives.`,
  gasShortCta: (symbol) => `Send a splash of ${symbol} to your teapot address`,
  teapotHolds: (amount) => `Teapot holds ${amount}`,
  peekingTeapot: "Peeking in the teapot…",
  youllSteep: "You'll steep",
  fetchingQuote: "Reading the sky…",
  noRouteForPair: "No path through the snow for this pair",
  burnerCostChecking: "Asking what the stove wants. A moment.",
  nothingForKettle: "Not enough left over for the stove (network fees)",
  ctaPourHowMuch: "Pour how much?",
  ctaTooMuch: "A touch more than your teapot holds",
  ctaNoRoute: "No path through the snow",
  ctaReadingLeaves: "Reading the lights…",
  pourFilledTitle: "Your cup is poured.",
  pourFilledBody:
    "The steam does the rest. Somewhere north, a fox sweeps its tail across the sky.",
  pourFillFailedBody: "The pour couldn't be filled. Nothing was lost, try again.",
  steepingBody: (teaName) =>
    teaName
      ? `${teaName} is steeping, warm under the lights.`
      : "Your tea is steeping, warm under the lights.",

  pourBackTitle: (teaName) => `Pour back from ${teaName}`,
  pourBackTitleFallback: "Pour back",
  pourBackSub: "Back to any asset, on any network. The warmth travels well.",
  pickCupPourBack: "Pick a cup to pour back from.",
  cupHolds: (amount) => `Your cup holds ${amount}`,
  signOnceOn: (chainName) =>
    `You'll sign once on ${chainName}, the chain you arrived from.`,
  whereTo: "Where to?",
  whereShouldWePour: "Where should we pour it?",
  useMyWallet: "Use my wallet",
  tripleCheckAddress: (symbol, chainName) =>
    `Check this three times. Tea poured to the wrong address is gone for good, and the receiving side (your exchange) must accept ${symbol} on ${chainName}.`,
  cashOutLink: "Cash out? Pour to an exchange address instead →",
  youllGetBack: "You'll get back",
  ctaAddressLooksOff: "That address looks off",
  ctaPourBackHowMuch: "Pour back how much?",
  ctaCupNotThatFull: "Your cup isn't quite that full",
  ctaTooSmallForBtc: "Too small a sip for Bitcoin",
  pouredBackTitle: "Poured back.",
  pouredBackBody: (chainName) => `Delivered on ${chainName}, still warm.`,
  pourBackFailedBody: "Your cup is untouched. Please try again.",
  backInTeapotTitle: "Back in your teapot.",
  backInTeapotBody: (symbol, chainName) =>
    `${symbol} is crossing the ice to you on ${chainName}, ready when you are.`,
  backInTeapotBodyFallback: "Ready when you are.",

  pickerSelectTokenOn: (chainName) => `Select token on ${chainName}`,
  pickerSelectChain: "Select chain",
  pickerSourceChainSub: "Anything in the pot can become tea.",
  pickerSourceHoldingsSub: "Pour straight from what you hold.",
  pickerSourceGridSub: "From which shore is your tea coming?",
  pickerDestTokenSub: "Pick what it arrives as.",
  fillTeapot: "Fill the teapot",

  brewing: "Brewing…",
  stepMsgBuilding: "Splitting the firewood…",
  stepMsgApproving: "Warming the stove. Approve in your wallet…",
  stepMsgSigning: "One gentle stir. Confirm in your wallet…",
  keepThisOpen: "Stay a while, good tea takes a minute.",
  teaSteeping: "Your tea is steeping…",
  goodTeaMinute: "Good tea takes a minute, usually less.",
  carryingTray: "Carrying the tray across the snow to the solver network.",
  lovely: "No niin",
  kettleActingUpTitle: "The kettle's sulking.",
  fillFailedScreenBody:
    "Nothing was lost and your funds are safe. If they don't reappear shortly, keep the fill hash handy for support.",
  kitchenTold: "The kitchen has been told, so someone can look into it.",
  lettingKitchenKnow: "Letting the kitchen know…",
  kitchenToldNoReport:
    "The kitchen has been told, so someone can look into it. No need to report it.",

  settingsTitle: "The porch",
  settingsSub: "How the cabin looks, and what the money speaks.",

  infoTitle: "How this was made",
  infoSub: "Vibed together through one long polar night.",
  infoAgentsStat: "25+ AI agents",
  infoAgentsDetail:
    "One split the firewood, one tended the stove, several argued about steam. Researchers, builders, and reviewers, all led by one Claude session.",
  infoMcpStat: "1 MCP server",
  infoMcpDetail:
    "The SODAX Builders MCP poured live protocol data (chains, tokens, vaults, docs) straight into the agents' cups while they worked.",
  infoTimeStat: "~1 afternoon",
  infoTimeDetail:
    "From an empty folder to a reviewed, cross-chain tea service, quick as a sauna heats. No crypto jargon survived the cold plunge.",
  infoPorcelain:
    "turns every pour into an intent-based cross-chain swap. Any asset on any of 20 networks in, leveraged staked-yield tea on Sonic out, one signature, quiet as snowfall.",
  infoHouseRules: (feePct) =>
    `House rules: every pour includes a ${feePct} service charge. It keeps the stove lit and the flavours curated.`,
  infoBuildersCta: "See how it's brewed at SODAX Builders",
  infoDocsCta: "SODAX developer docs",

  loreLink: "The whole legend, by the fire",
  loreTitle: "The Legend of the Northern Tea House",
  loreSub: "Told on a long polar night.",
  loreFoundingTitle: "The first fire",
  loreFoundingBody:
    "One long night, an empty folder was fed to the stove until a tea house stood in the snow. Agents split firewood, tended the steam, argued gently. Only warmth survived.",
  loreBlendsTitle: "The blends",
  loreBlendsBody:
    "The cups glow on the shelf, each a small aurora: staked yield folded like light over a frozen lake. One burns steady, the way a stove does. Pick your colour. The cups keep count.",
  loreKitchenTitle: "The pot and the kitchen",
  loreKitchenBody:
    "Send anything across twenty shores; it keeps well in the cold. Pour, sign once, and the kitchen carries the tray across the ice. Under the snow: SODAX.",
  loreHouseTitle: "House rules",
  loreHouseBody:
    "The house pays you to stay warm: pours, first tastes, friends at the table, New Leaf to Tea Sage. One rule, carved by the door:",
  loreCta: "Step inside",
};

/**
 * LSD: the eighties acid trip the app was secretly named after — LSD as in
 * liquid staking derivatives, obviously. Lava lamps, kaleidoscopes, walls
 * that breathe a little. The trip stays warm and benign; safety copy
 * (addresses, failures) inherits Original's sober lines untouched.
 */
const LSD: Partial<Copy> = {
  ...ORIGINAL,
  awaitsFirstPour: "The cup shimmers, waiting.",
  earnedSoFar: "Manifested",
  yearOfSteeping: "One orbit from now",
  perYear: "per orbit",
  brewQuestion: "How deep does this brew go?",
  staleFeedNote:
    "The staking number is an estimate right now; the live feed is off chasing fractals.",

  readyToPourTail: (assetCount) =>
    `in the pot, gently vibrating${assetCount > 1 ? ` (${assetCount} assets)` : ""}.`,
  potEmpty: "The pot is empty. Or is emptiness just a fuller kind of full?",
  sendAnything:
    "Send anything from ~200 assets across 20 networks. It all dissolves into the same light.",
  whatsInPot: "What's swirling in the pot?",
  signIn: "Tune in",
  insidePotSub: "What you hold, and which shelf it melts on.",
  onTheTable: "The whole trip",
  earnedOverall: "Earned on the spiral",

  tagline:
    "A kaleidoscopic little game of filling tea cups. The cups earn while they steep. The walls breathe a bit.",
  noSeedPhrases:
    "No seed phrases, no extensions. Your pantry assembles itself from pure colour.",
  inviteWaiting:
    "A friend saved you a seat on the spiral. Your first pour pays you both, in stereo.",
  mottoLead: "Tea is the way.",
  mottoDisplay: "The tea drinks you back.",

  pourSub: "Any asset, any network. It all melts into tea.",
  whatPouring: "What are you pouring, cosmically speaking?",
  peekingTeapot: "Gazing into the teapot…",
  fetchingQuote: "Consulting the kaleidoscope…",
  noRouteForPair: "No tunnel between these colours",
  burnerCostChecking: "Asking the lava lamp what it wants. One moment.",
  ctaNoRoute: "No tunnel between these colours",
  ctaReadingLeaves: "Reading the fractals…",
  pourFilledTitle: "Your cup is poured.",
  pourFilledBody: "The steam spirals. So does everything else, if you watch long enough.",
  steepingBody: (teaName) =>
    teaName
      ? `${teaName} is steeping. The colours are steeping too.`
      : "Your tea is steeping. The colours are steeping too.",

  pourBackSub: "Back to any asset, on any network. The warmth stays in the pattern.",
  pouredBackBody: (chainName) => `Rematerialised on ${chainName}.`,

  pickerSourceChainSub: "Anything in the pot can become tea.",
  pickerSourceGridSub: "Which dimension is your tea coming from?",
  pickerDestTokenSub: "Pick what it condenses into.",

  brewing: "Melting…",
  stepMsgBuilding: "Arranging the fractals…",
  stepMsgApproving: "Warming the lava lamp. Approve in your wallet…",
  stepMsgSigning: "One cosmic stir. Confirm in your wallet…",
  keepThisOpen: "Stay in the groove, good tea takes a minute.",
  goodTeaMinute: "Time is soup in here, but a minute, usually less.",
  carryingTray: "Floating the tray over to the solver network.",
  lovely: "Far out",
  kettleActingUpTitle: "The kettle is having visions.",

  settingsTitle: "The chill-out room",
  settingsSub: "How deep the colours go, and what the money speaks.",

  infoTitle: "How this was made",
  infoSub: "Vibed together. Literally.",
  infoAgentsDetail:
    "One measured the leaves, one stared at the steam until it made sense. Researchers, builders, and reviewers, all orchestrated by one Claude session.",
  infoTimeDetail:
    "From an empty folder to a reviewed, cross-chain tea service in one afternoon. In here that could be a lifetime, it's fine.",
  infoPorcelain:
    "turns every pour into an intent-based cross-chain swap. Any asset on any of 20 networks in, leveraged staked-yield tea on Sonic out, one signature. LSD stands for liquid staking derivatives, obviously.",
  infoHouseRules: (feePct) =>
    `House rules: every pour includes a ${feePct} service charge. It keeps the lava lamp lit and the flavours curated.`,

  loreLink: "The full trip report",
  loreTitle: "The Trip Report",
  loreSub: "How the tea house dreamed itself.",
  loreFoundingTitle: "The awakening",
  loreFoundingBody:
    "One afternoon that may still be happening, an empty folder blinked and became a tea house. Agents measured, brewed, and stared at the steam until it made sense. The jargon dissolved first.",
  loreBlendsTitle: "The blends",
  loreBlendsBody:
    "The cups breathe on the shelf, each a small perpetual pattern: staked yield folded into itself like a fractal. One of them refuses to shimmer at all. Pick a colour. The cups do the math so you can watch the walls.",
  loreKitchenTitle: "The pot and the kitchen",
  loreKitchenBody:
    "Send anything from any dimension; it hums in the pot. Pour, sign once, and the kitchen floats the tray across. Underneath the pattern: SODAX.",
  loreHouseTitle: "House rules",
  loreHouseBody:
    "The house pays you to play: pours, first tastes, fellow travellers, New Leaf to Tea Sage. One rule, painted on the door:",
  loreCta: "Come through",
};

/**
 * Original is the BASE VOICE: it alone must define every key. The other
 * parlours are Partial overrides layered on top, so a brand-new line costs
 * one edit (write it in the base) and each voice flavours it only when it
 * has something to say. Before this, every key cost 8 edits — and the
 * referral round proved the toll steers prose out of the seam entirely.
 */
export const COPY: Record<ModeId, Copy> = {
  original: ORIGINAL,
  gangster: { ...ORIGINAL, ...GANGSTER },
  nan: { ...ORIGINAL, ...NAN },
  terminal: { ...ORIGINAL, ...TERMINAL },
  vaporwave: { ...ORIGINAL, ...VAPORWAVE },
  sumie: { ...ORIGINAL, ...SUMIE },
  aurora: { ...ORIGINAL, ...AURORA },
  lsd: { ...ORIGINAL, ...LSD },
};
