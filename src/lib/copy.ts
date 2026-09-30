/**
 * Every word the app says, in one voice.
 *
 * Berth speaks plainly: exact, calm, adult, unhurried, never clever about
 * money. Components read lines from here and never carry literals, so a
 * sentence is changed in one place and the whole app follows. The
 * `useCopy()` seam (components/settings-provider) stays so a second voice
 * could return one day at the cost of a `Partial<Copy>` override; today
 * there is exactly one.
 *
 * House rules for these lines: commas and periods, never dashes as
 * punctuation; no emoji; names, not tickers, wherever a person is reading.
 */

import type { Unlock } from "@/lib/unlocks";
import type { BerthToolName } from "@/lib/berth-tool-names";
import { REWARD_REASONS } from "@/lib/xp";
import type { ConsentParty } from "@/lib/assistant-party";
import type { HandleRefusal } from "@/lib/handle";
import type { Relation, ReportReason } from "@/lib/social-types";

export type Copy = {
  /* — brand and shell — */
  brand: string;
  tagline: string;
  /** The welcome screen's one paragraph under the tagline. */
  welcomeLede: string;
  signInEmail: string;
  connectWallet: string;
  noSeedPhrases: string;
  /** Above the detected-wallet buttons; shown only when a wallet is installed. */
  walletDetectedLead: string;
  /** `name` is the wallet's own name: "Continue with Phantom". */
  continueWithWallet: (name: string) => string;
  walletConnecting: (name: string) => string;
  walletConnectFailed: string;

  /* — labels only a screen reader hears, which are copy like any other — */
  infoOpenLabel: string;
  /** The sell drawer's free-text address field. */
  withdrawCustomAddressLabel: string;
  /** `face` is the avatar's own name. */
  avatarChooseLabel: (face: string) => string;
  inviteCopyLabel: string;
  rewardsChipLabel: string;
  /** The rank chip's compact form: "Lv 3". */
  rankLevelShort: (level: number) => string;
  /** The rank chip's desktop form, before the rank's name: "Level 3". */
  rankLevelLong: (level: number) => string;
  /** What the chip reads out in full: "Harbour Master, level 9". */
  rankAriaLabel: (name: string, level: number) => string;

  /* — the account drawer: who you are, where to send funds, the way out — */
  accountSignedInAs: (email: string) => string;
  accountSignedInEmail: string;
  accountSignOut: string;
  /** A receive row names the family it is for, because sending the wrong
   *  asset to the right-looking address is how people lose money. */
  receiveEvmTitle: string;
  receiveEvmBody: string;
  receiveEvmToast: string;
  receiveSolanaTitle: string;
  receiveSolanaBody: string;
  receiveSolanaToast: string;
  /** `what` is the row's own title: "Copy Solana address". */
  receiveShowQr: (what: string) => string;
  receiveCopyLabel: (what: string) => string;
  receiveCopied: string;
  topUpSub: string;

  /* — the wallet drawer: connecting one wallet per chain family — */
  walletsTitle: string;
  walletsSub: string;
  /** `family` is the chain family's own name: "Connect Solana". */
  walletConnectTitle: (family: string) => string;
  walletConnectSub: string;
  walletBack: string;
  /** `name` is the wallet's own name, for the icon-only disconnect button. */
  walletDisconnectLabel: (name: string) => string;
  /** On a wallet this browser does not have: a link to go and install it. */
  walletGet: string;
  walletWaitingTitle: (name: string) => string;
  walletWaitingBody: string;
  /** WalletConnect shows a code rather than taking the browser over. */
  walletScanTitle: string;
  walletScanBody: string;
  walletCancel: string;
  walletConnectedTitle: string;
  walletNoneTitle: string;
  walletNoneBody: string;
  walletChooseAnother: string;
  walletTryAgain: string;
  /** The two ways connecting ends badly, told apart by the wallet's message. */
  walletCancelledTitle: string;
  walletCancelledBody: string;
  walletFailedTitle: string;
  walletFailedBody: string;
  /** Shown on the welcome screen when an invite code is waiting in the pocket. */
  inviteWaiting: string;
  /** The live board beside the sign-in: what is on offer, priced now. */
  welcomePreviewTitle: string;
  welcomePreviewHint: string;
  /** Footer line under "powered by": the one honest sentence about risk. */
  footerNote: string;
  /** The welcome page around the way in (components/welcome): hero, preview, features in features.md order, what is coming. */
  welcomePage: {
    navLabel: string;
    nav: { how: string; assistant: string; ai: string };
    eyebrow: string;
    /** The positioning line, split where the highlighted phrase starts. */
    headlineLead: string;
    headlineMark: string;
    emailCta: string;
    previewLabel: string;
    previewExample: string;
    /** "on Base": a coin's network, under its name. */
    onNetwork: (network: string) => string;
    /** The one block under the preview: what Berth is, in a headline, a paragraph and four points. */
    value: {
      title: string;
      body: string;
      fine: string;
      points: Record<"pay" | "custody" | "email" | "cash", { title: string; body: string }>;
    };
    features: {
      compare: { title: string; body: string[] };
      assistant: { title: string; body: string[]; fine: string; ask: string; answer: string; askBuy: string; draft: string; buy: string; amount: string; payWith: string };
      ai: { title: string; body: string[]; reads: string; sign: string };
      news: { title: string; body: string[] };
      /** Weekday nights only: weekends are unproven (reports/weekend-checks.md). */
      night: { title: string; body: string[]; fine: string; clock: string; open: string; filled: (seconds: number) => string };
      friends: { title: string; body: string[] };
      wallets: { title: string; body: string[]; home: string; linked: string; evm: string; solana: string; bitcoin: string };
      email: { title: string; body: string[]; from: string; always: string; switches: string };
      ranks: { title: string; body: string[]; xp: string; now: (rank: string, level: number) => string };
    };
    comingTitle: string;
    coming: { name: string; line: string }[];
    legal: string;
  };

  /* — account total: funds plus holdings plus cash, one figure — */
  accountTotalLabel: string;
  accountTotalSub: string;
  /* — the signed-in board's own words (components/home, components/board) — */
  /** The first of the three figures under the total: stocks and funds held, not cash. */
  accountSplitHoldings: string;
  /** Under the comparison chart, beside the range: what the two lines are. */
  portfolioSameDays: string;
  /** Over the holding rows: what the pair of figures on each row is. */
  holdingsSubline: string;
  /** Under "What you own": what its figure counts. Must match lib/server/portfolio. The first only while cash is parked. */
  holdingsCashIncluded: string;
  holdingsWalletsNote: string;
  /** Disclosures: closed, then open. */
  holdingsAll: (count: number) => string;
  disclosureFewer: string;
  /** Between a holding's change and the S&P 500 fund's: "+6.4% vs +1.9%". */
  holdingVs: string;
  /** Beside Cash: parked cash is part of What you own's figure. */
  cashCounts: string;
  /** `rate` arrives pre-formatted: "3.97%". */
  cashRate: (rate: string) => string;
  /** Parking more once some is parked. */
  cashParkMore: string;
  boardYours: string;
  boardMovers: string;
  boardAll: (count: number) => string;
  newsMorePosts: string;
  newsMoreHeadlines: string;
  /** The Ask card's fake field and the phone's docked one. */
  askPlaceholder: string;
  askFine: string;
  /** Tapped, each opens Ask and sends itself. */
  askSuggestions: readonly string[];
  /** The short card on the board that leads to the account drawer's section. */
  assistantCardBody: string;
  /** A money row's name with its figure: "Cash, $2.00". */
  moneyRowName: (name: string, amount: string) => string;
  /** Under Funds, once they are counted. */
  fundsReadyLine: (assetCount: number) => string;

  /* — funds: the user's own wallets, what can pay for an order — */
  fundsTitle: string;
  /** Follows the bold figure: "≈ $12.40 …across 3 assets, ready to spend." */
  fundsReadyTail: (assetCount: number) => string;
  fundsEmpty: string;
  fundsSendAnything: string;
  fundsSignIn: string;
  fundsWhatsInside: string;
  fundsNeedsGas: string;
  topUp: string;
  signIn: string;
  fundsInsideTitle: string;
  fundsInsideSub: string;
  fundsTotalLabel: string;

  /* — the board: stocks and funds on offer — */
  boardTitle: string;
  boardHint: string;
  /**
   * Beside the board and in the buy and sell drawers, only while the US
   * market is shut. `day` is "today", "tomorrow" or a weekday, `time` the
   * open in the viewer's own zone: "US market closed. Opens Monday 15:30
   * your time." Says nothing about trading on; that waits for the weekend
   * checks (docs/plans/recurring-email.md, Around the clock).
   */
  marketClosedLine: (day: string, time: string) => string;
  /** `amount` arrives pre-formatted: "0.0089 NVDA ≈ €1.80". */
  boardYouHold: (amount: string) => string;
  /**
   * Under the board's hint: what the line and the change actually measure.
   * Said plainly because these tokens trade around the clock while the
   * market they track does not, and only the market's own days are counted.
   */
  boardPerformanceNote: (days: number) => string;
  /**
   * The row's news filter, revealed on hover on a desktop. The full sentence
   * is the button's accessible name and its tooltip; the pill itself shows
   * `boardFilterNewsShort`, because a board row has about seventy pixels to
   * spare and "Filter news to S&P 500 ETF" would eat the listing's own name.
   */
  boardFilterNews: (name: string) => string;
  boardFilterNewsShort: string;
  /** The same button once that listing is the filter: pressing it clears. */
  boardShowAllNews: string;

  /* — holdings: what the account owns — */
  holdingsTitle: string;
  holdingsHint: string;
  holdingsEmpty: string;
  /**
   * "Since your first buy" beside the S&P 500 fund (lib/benchmark). `date`
   * arrives formatted: "Sep 21". Always descriptive, never a verdict.
   */
  holdingSince: (date: string) => string;
  holdingBenchmark: string;
  holdingsMarketDays: (days: number) => string;
  /** Behind the (i): how the chart and the lines are made, and what they are not. */
  holdingsBenchmarkNote: string;
  /**
   * The portfolio line at the top of "What you own" (lib/portfolio-history).
   * The headline reads "Since Sep 21, 4 market days. You +0.6%, the same
   * dollars in [the S&P 500 fund] -0.6%." with the name as the chooser.
   * `date` arrives formatted: "Sep 21".
   */
  portfolioSince: (date: string, days: number) => string;
  portfolioYou: string;
  /** Before the benchmark's name, by id: "the same dollars in the" S&P 500 fund, "in" Gold. */
  portfolioSameDollarsIn: Record<"SPY" | "QQQ" | "PAXG" | "BTC" | "SGOV", string>;
  /** The chooser's menu heading, and the description its button carries. */
  portfolioCompareWith: string;
  portfolioChooserHint: string;
  /** One day stored and nothing to draw yet. */
  portfolioFirstDay: string;
  /**
   * Why the benchmark line is not drawn, one sentence each. `name` is the
   * chooser with its article ("the S&P 500 fund", "Gold").
   */
  portfolioNoBenchmark: Record<"unpriced_orders" | "unexplained_balance", (name: string) => string>;
  /**
   * After the "Since" sentence when the comparison starts on a later
   * snapshot, because money moved without an order before it.
   */
  portfolioRebased: (date: string) => string;
  /**
   * After the "Since" sentence on "First buy" when no day before `date` is
   * stored (the daily record began later, and the orders could not rebuild
   * the stretch before it). Absent when the line reaches the first buy.
   */
  portfolioRecordStarts: (date: string) => string;
  /** The "First buy" range chip when that window starts on a later snapshot instead. */
  portfolioRangeSince: (date: string) => string;
  /** The article a benchmark's name takes mid sentence, by id: "the " or nothing. */
  benchmarkArticle: Record<"SPY" | "QQQ" | "PAXG" | "BTC" | "SGOV", string>;
  /** `name` is the chooser, so another benchmark is one tap away. */
  portfolioNoMarks: (name: string) => string;
  /** The range control, by range id, and its accessible name. */
  portfolioRanges: Record<"1w" | "1m" | "3m" | "6m" | "1y" | "since" | "all", string>;
  portfolioRangeLabel: string;
  /**
   * The benchmarks the portfolio can be set beside (lib/benchmarks), by id.
   * Names, not tickers: a person reads these.
   */
  benchmarkNames: Record<"SPY" | "QQQ" | "PAXG" | "BTC" | "SGOV", string>;
  /**
   * Under a listing that moved a lot for it, naming the post Jev read as
   * related (lib/server/moves). "In the news", never "because": Berth does
   * not claim to know why a price moved. `source` is the author's name.
   */
  moveInTheNews: (source: string) => string;
  /** The same line's link, for a screen reader: where it goes. */
  moveReadPost: (source: string) => string;

  /* — the newsfeed: what is being written about the listings — */
  newsTitle: string;
  newsHint: string;
  /** Shown when every feed is quiet or unreachable. Never says "error". */
  newsEmpty: string;
  /** The chip above a filtered river: "NVIDIA only". */
  newsFilteredTo: (name: string) => string;
  /** Clears it. Short, because it sits beside the chip. */
  newsShowAll: string;
  /** When one listing has been quiet. Names it, so the silence is placed. */
  newsEmptyFor: (name: string) => string;
  /** Follows the listing's name: "NVIDIA The Motley Fool, 2 hours ago". */
  newsByline: (source: string, when: string) => string;
  /** The two ways of reading the column. Both are nouns, not verbs. */
  newsTabPosts: string;
  newsTabHeadlines: string;
  /** Names what the tabs switch, for a screen reader. */
  newsTabsLabel: string;
  /** The column's refresh control, for a screen reader, and while it works. */
  newsRefresh: string;
  newsRefreshing: string;
  /** `when` is formatTimeAgo's phrase: "just now", "3 minutes ago". */
  newsUpdated: (when: string) => string;
  /** After a refresh the throttle answered from the cache: nothing newer yet. */
  newsUpToDate: (when: string) => string;
  /** The posts tab's own hint, which promises something different. */
  postsHint: string;
  /** Shown when the accounts we follow have been quiet. */
  postsEmpty: string;
  postsEmptyFor: (name: string) => string;
  /**
   * Between the author's name and the time: "NVIDIA @nvidia, 2 hours ago".
   * Its own string because on a narrow row it gives way first, comma and
   * all, while the time never does.
   */
  postsHandle: (handle: string) => string;
  /**
   * Beside the time on a post this browser has not been shown before
   * (lib/seen-posts). Never on a first visit, when everything would carry it.
   */
  postNewToYou: string;
  /** Its tooltip. */
  postNewToYouLabel: string;
  /** On the mark that says where a post came from. */
  postsSourceLabel: string;
  /**
   * What a screen reader hears in place of the three figures under a post.
   * The figures themselves arrive already shortened: "11", "54", "1.2K".
   */
  postsMetrics: (replies: string, reposts: string, likes: string) => string;
  /**
   * Under a post that other accounts carried too, folded into its first
   * report (lib/story-groups). Names, in the order they posted.
   */
  postsAlsoBy: (names: readonly string[]) => string;
  /**
   * The posts tab's credit line. Jev (TypeSafe's model) reads every post
   * before it is shown, and saying so is the point: the column is chosen,
   * not scraped. The counts are real, from this refresh; see x-column.
   */
  jevCuratedBy: string;
  jevCuration: (seen: string, accounts: string, read: string, kept: string) => string;
  /** What Jev is, first line of the (i). */
  jevAbout: string;
  /** The same (i) on the headlines tab, with what Jev read this time. */
  jevAboutHeadlines: string;
  jevHeadlineCuration: (read: string, kept: string) => string;
  /** The link out to its maker, inside the (i). */
  jevLinkLabel: string;
  /** Jev's reading of one post, on its card. Absent when Jev did not read it. */
  jevVerdictMaterial: string;
  jevVerdictFact: string;
  jevVerdictAnalysis: string;
  /** The chip's tooltip and accessible name: "Jev reads this as new fact". */
  jevVerdictLabel: (verdict: string) => string;

  /* — cash: idle dollars in the Treasury ETF token — */
  cashTitle: string;
  /** Shown under the figure when no rate is available. */
  cashHint: string;
  /** `rate` arrives pre-formatted: "3.97%". */
  cashYieldLine: (rate: string) => string;
  cashEmpty: string;
  cashPark: string;
  cashTakeOut: string;

  /* — vaults: earlier leveraged positions, withdraw only — */
  vaultsTitle: string;
  vaultsHint: string;
  vaultWithdraw: string;

  /* — buy drawer — */
  buy: string;
  /** `name` is the plain name, "NVIDIA". */
  buyTitle: (name: string) => string;
  buySub: string;
  /** Title while no listing is chosen yet (defensive; never expected). */
  orderTitleFallback: string;
  whatPayingWith: string;
  /** The buy drawer's pay slot while the wallet balances are still coming in. */
  findingPayWith: string;
  gasShortWarning: (chainName: string, symbol: string) => string;
  gasShortCta: (symbol: string) => string;
  /** `amount` arrives pre-formatted: "≈ €130 (142 USDC)" or "142 USDC". */
  walletHolds: (amount: string) => string;
  checkingBalance: string;
  maxLabel: string;
  youllHold: string;
  atLeastLabel: string;
  fetchingQuote: string;
  noRouteForPair: string;
  gasCostChecking: string;
  nothingLeftForGas: string;
  connectChainWallet: (chainName: string) => string;
  ctaEnterAmount: string;
  ctaTooMuch: string;
  ctaSwitchNetwork: string;
  ctaNoRoute: string;
  /** `amount` arrives pre-formatted in the user's currency: "€1.00". */
  ctaAtLeast: (amount: string) => string;
  smallestOrder: (amount: string) => string;
  ctaGettingQuote: string;
  ctaSignInToBuy: string;
  ctaOpeningAccount: string;
  buyFilledTitle: string;
  buyFilledBody: string;
  buyFailedBody: string;
  /** Fill-complete body for a buy; `name` is the plain name. */
  settledBody: (name: string) => string;

  /* — sell drawer, and the withdraw drawer for vaults — */
  sell: string;
  sellTitle: (name: string) => string;
  sellSub: string;
  /** `amount` arrives pre-formatted: "≈ €1.93 (0.0089 NVDA)". */
  youHold: (amount: string) => string;
  sellSignOnce: (chainName: string) => string;
  ctaSellHowMuch: string;
  ctaNotThatMuchHeld: string;
  soldTitle: string;
  withdrawTitle: (name: string) => string;
  withdrawSub: string;
  /** `amount` arrives pre-formatted: "≈ €131" or "146.2 lsodaWEETH". */
  vaultHolds: (amount: string) => string;
  vaultSignOnce: (chainName: string) => string;
  /** `part`/`total` arrive pre-formatted in money or shares. */
  vaultSplitNote: (part: string, total: string, chainName: string) => string;
  ctaWithdrawHowMuch: string;
  ctaVaultNotThatMuch: string;
  withdrawnTitle: string;
  whereTo: string;
  whereToDeliver: string;
  sendElsewhere: string;
  useMyWallet: string;
  tripleCheckAddress: (symbol: string, chainName: string) => string;
  cashOutLink: string;
  youllGetBack: string;
  asTokenLabel: string;
  ctaAddressLooksOff: string;
  ctaTooSmallForBtc: string;
  deliveredBody: (chainName: string) => string;
  sellFailedBody: string;
  onItsWayTitle: string;
  onItsWayBody: (symbol: string, chainName: string) => string;
  onItsWayBodyFallback: string;

  /* — token picker — */
  pickerSelectTokenOn: (chainName: string) => string;
  pickerSelectChain: string;
  pickerSourceChainSub: string;
  pickerSourceHoldingsSub: string;
  pickerSourceGridSub: string;
  pickerDestTokenSub: string;
  pickerNothingReachable: (chains: string) => string;
  pickerUnreachableNote: (chains: string, plural: boolean) => string;
  addFunds: string;
  /** The picker's "pay from what you hold" screen: title and empty state. */
  pickerHoldingsTitle: string;
  pickerHoldingsEmpty: string;
  /** Under the holdings list for wallet users: reach a network the sweep does not cover. */
  pickerBrowseAll: string;
  pickerSearchPlaceholder: string;
  pickerNoMatches: (query: string) => string;

  /* — order progress: the stepper, then the fill tracker — */
  working: string;
  stepBuild: string;
  stepApprove: string;
  stepSign: string;
  stepSkipped: string;
  stepMsgBuilding: string;
  stepMsgApproving: string;
  stepMsgSigning: string;
  keepThisOpen: string;
  settling: string;
  settlingNote: string;
  delivering: string;
  done: string;
  orderFailedTitle: string;
  fillFailedScreenBody: string;
  closeLabel: string;
  teamTold: string;
  tellingTeam: string;
  teamToldNoReport: string;
  /** The fill's transaction reference shown on the tracker. */
  referenceLabel: string;
  /** An order sent but not settled inside the tracker's wait. Not a failure. */
  unsettledTitle: string;
  unsettledBody: string;
  /** Said while the screen keeps watching the order. */
  unsettledWatching: string;
  /** A Bitcoin payment broadcast and on its way to Sonic. Not a failure. */
  confirmingTitle: string;
  confirmingBody: string;
  /** Said while the drawer may close and the order carries on without it. */
  confirmingClose: string;
  /** The link that follows the payment on its own chain. */
  followPayment: string;
  /** A payment that did not reach Sonic inside the relay wait. */
  notArrivedBody: string;
  /** Shown only beside a link that follows the payment on mempool.space. */
  notArrivedWatching: string;
  /** A reopened drawer, while an earlier order is still on its way. */
  earlierOrderOnItsWay: string;
  /** Accessible names that never render visibly. */
  ariaAmount: string;
  ariaAmountIn: (currency: string) => string;
  ariaSharesToWithdraw: string;
  backToNetworks: string;
  loadingLabel: string;
  /** The thinking orb's name, by what it is showing (components/ui/thinking-orb). */
  orbLabel: Record<"working" | "searching" | "solving" | "composing" | "connecting" | "breathing", string>;

  /* — order failures, spoken by the order machine itself — */
  errWalletDrifted: string;
  errCouldNotPrepare: string;
  errCouldNotCheckAllowance: string;
  errApprovalFailed: string;
  errAllowanceStillPending: string;
  errOrderFailed: string;
  /**
   * `shortfall` is already formatted with its symbol, e.g. "0.00024 ETH".
   * Said when the wallet cannot cover the network fee, where the generic
   * failure line would send the user round a loop that cannot succeed.
   */
  errNeedsGas: (shortfall: string, network: string) => string;
  errNeedsGasUnknown: (network: string) => string;

  /* — keys export — */
  exportKeysTitle: string;
  exportKeysSub: string;
  exportEvmLabel: string;
  exportSolanaLabel: string;
  /** Risk step shown before the EVM/Solana buttons unlock. */
  exportConfirmWarning: string;
  exportConfirmCheckboxLabel: string;

  /* — settings — */
  settingsTitle: string;
  settingsSub: string;
  appearanceSectionLabel: string;
  appearanceSystem: string;
  appearanceLight: string;
  appearanceDark: string;
  currencySectionLabel: string;
  /** Collapsed, closed by default: the private key export lives here now. */
  advancedSectionLabel: string;

  /* — info drawer: what this is, what you own, what it costs — */
  infoTitle: string;
  infoSub: string;
  infoHowTitle: string;
  infoHowBody: string;
  infoOwnTitle: string;
  infoOwnBody: string;
  infoFees: (feePct: string) => string;
  infoBuiltTitle: string;
  infoBuiltBody: string;
  infoBuildersCta: string;
  infoDocsCta: string;

  /* — rewards: ranks, avatars, invites, the ledger — */
  /** A wallet account's drawer, which holds the rewards and the assistant section. */
  walletAccountDrawerTitle: string;
  walletAccountDrawerSub: string;
  /** Toast after Privy's add-funds flow completes. */
  fundsAddedTitle: string;
  fundsAddedBody: string;
  /** Wallet drawer: the embedded wallet row, versus an external "Connected". */
  walletEmbeddedLabel: string;
  walletEmbeddedNote: string;
  walletConnectedLabel: string;
  rankLine: (level: number, xp: string) => string;
  /** "+150 XP": a payout, or one still coming. */
  xpPlus: (amount: number) => string;
  /* the ladder: ten rungs under the rank, and one caption line */
  /** The rung row, for a screen reader. */
  ladderLabel: string;
  ladderRungAria: (
    name: string,
    level: number,
    state: "reached" | "current" | "ahead",
  ) => string;
  /** The default caption: the next rung. `xp` is already formatted. */
  ladderNext: (xp: string, rankName: string) => string;
  ladderTop: string;
  /** A tapped rung. `xp` is its threshold, already formatted. */
  ladderRung: (rankName: string, xp: string) => string;
  ladderHere: string;
  /** What a rung opens, said about a rung not reached yet. */
  unlockNext: (unlock: Unlock) => string;
  /** The same, about a rung already reached. */
  unlockDone: (unlock: Unlock) => string;
  /* the level-up card */
  levelUpTitle: (rankName: string) => string;
  /** `reason` is the single reward's REWARD_REASONS line, when there was one. */
  levelUpLine: (level: number, total: number, reason: string | null) => string;
  /** The card's second line, when the rung opened something. */
  levelUpUnlock: (unlock: Unlock) => string;
  /* rank-gated faces in the picker */
  /** `face` is the avatar's own name, `rankName` the rung it opens on. */
  avatarLockedLabel: (face: string, rankName: string) => string;
  avatarUnlocksAt: (rankName: string) => string;
  pickFace: (amount: number) => string;
  newFace: string;
  /** Offered only to a wallet account, which has no email of its own. */
  addEmailTitle: string;
  addEmailSub: (amount: number) => string;
  addEmailPlaceholder: string;
  addEmailContinue: string;
  /** While the wallet is being asked to prove it owns the address. */
  addEmailSigning: string;
  addEmailSending: string;
  /** Above the code field; `email` is the address it went to. */
  addEmailCodeSent: (email: string) => string;
  addEmailCodePlaceholder: string;
  addEmailVerify: string;
  addEmailVerifying: string;
  addEmailDone: string;
  addEmailCancel: string;
  addEmailFailed: string;
  /** After the code is accepted, while the rewards row is told. */
  addEmailSaving: string;
  addEmailCodeWrong: string;
  addEmailResend: string;
  addEmailResent: string;
  /** The email is on the account but the rewards side did not hear of it. */
  addEmailSaveFailed: string;
  addEmailRetrySave: string;
  /**
   * Account merge (lib/server/account-merge). Shown only after both
   * accounts were proved. `survivor` is relative to the account in hand.
   */
  mergeEmailTitle: string;
  mergeEmailAsk: string;
  mergeWalletTitle: string;
  mergeWalletAsk: string;
  /** Before the second code: the email's own account must be opened once. */
  mergeOneMoreCode: string;
  mergeContinue: string;
  /** Above the second code field. */
  mergeCodeSent: (email: string) => string;
  mergeStays: (survivor: "this" | "other", kind: "email" | "wallet") => string;
  mergeWhatMoves: string;
  /** What does not come along from the joining account. */
  mergeLeftBehind: (usernameComes: boolean) => string;
  mergeTogether: (xp: string, orders: number) => string;
  mergeChart: string;
  mergeConfirm: string;
  mergeKeepSeparate: string;
  mergeWorking: string;
  mergeDone: (xp: string) => string;
  /** Under the done line: how to sign in now, and where buys land. */
  mergeDoneHow: string;
  /** The email flow: what the email's own wallet holds sells from an email sign in. */
  mergeDoneEmailWallet: string;
  /** The wallet flow, this account joined the other: this browser is signed out. */
  mergeDoneSignedOut: string;
  mergeFailed: string;
  mergeChanged: string;
  mergeClose: string;
  /** Keep separate, in the email flow: nothing was added. */
  mergeKeptSeparate: string;
  /** The page reloaded mid merge; the flow's session was ended. */
  mergeInterrupted: string;
  /** The wallet is asked to sign that its account may join the email's. */
  mergeSigning: string;
  /** An offer or a code older than ten minutes. */
  mergeExpired: string;
  mergeStartAgain: string;
  /**
   * Someone signed in with the email of a wallet account. The funds are on
   * the wallet, so the email alone opens nothing; say so and send them to it.
   */
  walletAccountEmailSignIn: string;
  inviteLockedTitle: (rankName: string) => string;
  inviteLockedSub: (level: number) => string;
  friendInvitedYou: string;
  inviteFirstTradePaid: (amount: number) => string;
  inviteFirstTradePending: (amount: number) => string;
  inviterLevel: (level: number) => string;
  /** Under "A friend invited you", once the referral has made the two friends. */
  invitedFriendsWith: (name: string | null) => string;
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
  inviteTaps: (taps: number) => string;
  friendsTitle: string;
  friendsTally: (joined: number, traded: number, taps: number) => string;
  xpBankedWord: string;
  xpPendingWord: string;
  copyNudge: string;
  nudgeCopiedTitle: string;
  nudgeCopiedSub: string;
  nudgeMessage: (amount: number, link: string) => string;
  ledgerTitle: string;
  ledgerLoading: string;
  ledgerEmpty: string;
  /** Buys that will pay held_30_days once they have been held thirty days. */
  ledgerHoldsTitle: string;
  /** `name` is the listing's plain name, null when it is not known. */
  ledgerHoldReason: (name: string | null) => string;
  /** When a pending hold pays, `date` already formatted. */
  ledgerHoldDue: (date: string) => string;

  /* — the nudge: one line under the total, only ever a true thing — */
  nudgeAddFunds: string;
  nudgeAddFundsAction: string;
  nudgeFirstBuy: string;
  /** `name` is the listing's plain name. Says there is news, never what to do about it. */
  nudgeHeldNews: (name: string) => string;
  nudgeHeldNewsAction: string;
  nudgeParkCash: string;
  nudgeParkCashAction: string;
  nudgeInvite: string;
  nudgeInviteAction: string;
  nudgeDismissLabel: string;

  /* — the email nudge: one strip asking a wallet-only account to add an email — */
  emailNudgeText: string;
  emailNudgeAction: string;
  emailNudgeDismiss: string;

  /* — agent access: an assistant reads the account and drafts orders, the person signs — */
  /**
   * The consent screen's heading. The party is derived from where the answer
   * goes (lib/assistant-party), never from the name an app gives itself.
   */
  authorizeTitle: (party: ConsentParty) => string;
  /** Under the heading for an app Berth does not recognise, or one on this computer; null for a known assistant. */
  authorizeUnverified: (party: ConsentParty) => string | null;
  /** Over the sign in buttons when someone arrives from an assistant signed out. */
  authorizeSignInLead: (party: ConsentParty) => string;
  authorizeCanLead: string;
  authorizeScopeRead: string;
  authorizeScopeDraft: string;
  authorizeCannot: string;
  /** Where the browser goes afterwards, so a look alike app shows its real address. */
  authorizeReturnTo: (host: string) => string;
  /** Which Berth account is being connected. `who` is an email or a short address. */
  authorizeAccount: (who: string) => string;
  authorizeApprove: string;
  authorizeDecline: string;
  authorizeReturning: (party: ConsentParty) => string;
  authorizeFailed: string;
  authorizeNeedsWallet: string;
  authorizeConnectWallet: string;
  authorizeExpired: string;
  authorizeErrorTitle: string;
  authorizeErrorUnknownClient: string;
  authorizeErrorRedirect: string;
  /** When the request could not be judged at all (a hiccup on Berth's side). */
  authorizeTroubleTitle: string;
  authorizeTroubleBody: string;
  authorizeTryAgain: string;

  /** The account drawer section. */
  assistantTitle: string;
  assistantBody: string;
  /** The three buttons; names are the products' own. */
  assistantClaude: string;
  assistantChatGpt: string;
  assistantGrok: string;
  /** The sheet each button opens. `name` is the product's own name. */
  assistantSheetTitle: (name: string) => string;
  assistantSheetBody: string;
  /** The sheet's line when that assistant already holds a grant on this account. */
  assistantSheetConnected: (name: string) => string;
  /** A button's accessible name when that assistant is connected. */
  assistantButtonConnected: (name: string) => string;
  /** Once connected: prompts that open a new chat with the words filled in. Each names Berth, so the assistant reaches for it. */
  assistantPromptsTitle: string;
  assistantPrompts: readonly string[];
  /** A prompt row's accessible name; it opens in a new tab. */
  assistantPromptLabel: (name: string, prompt: string) => string;
  /** Under ChatGPT's prompts: its Developer mode apps are off in a chat until chosen. */
  assistantPromptHintChatGpt: string;
  /** Once connected, the setup steps fold away behind this. */
  assistantSetupAgain: string;
  assistantAddressLabel: string;
  assistantCopyLabel: string;
  assistantCopied: string;
  assistantStepsClaude: readonly string[];
  assistantStepsChatGpt: readonly string[];
  assistantStepsGrok: readonly string[];
  /** The (i) beside Your assistant: why connect one. */
  assistantWhy: string;
  /** Under ChatGPT's steps: the icon its app form asks for. */
  assistantIconDownload: string;
  /** The primary action in a sheet: "Open Claude". */
  assistantOpen: (name: string) => string;
  assistantConnectedTitle: string;
  /** `when` is a relative time: "2 hours ago". */
  assistantLastUsed: (when: string) => string;
  assistantNeverUsed: string;
  assistantDisconnect: string;
  /** `name` is the assistant's own name. */
  assistantDisconnectLabel: (name: string) => string;
  /** The same button after a first tap, asking for the second. */
  assistantDisconnectConfirm: (name: string) => string;
  assistantDisconnected: (name: string) => string;
  assistantDisconnectFailed: string;
  /** How the drawer lists a grant to an app answering on loopback. */
  assistantLocalApp: string;

  /** A draft from an assistant opens the order drawer, prefilled, never sent. */
  draftOpenedTitle: string;
  draftOpenedBody: string;
  draftUnknownListing: string;
  draftNothingToSell: (name: string) => string;
  /** A drafted sell whose holdings could not be read in time. */
  draftCouldNotCheck: (name: string) => string;

  /* — Ask: the assistant inside Berth (components/chat). It reads and drafts, the person signs — */
  chatOpen: string;
  chatOpenLabel: string;
  /** The (i) beside Ask: why use it. */
  chatWhy: string;
  chatTitle: string;
  chatSub: string;
  /** The model's name, as the not advice line says it. */
  chatModelName: string;
  chatNotAdvice: (model: string) => string;
  chatNoCopyKept: string;
  chatPlaceholder: string;
  chatSend: string;
  chatStop: string;
  chatClear: string;
  chatEmpty: string;
  /** One line per tool while it runs, then once it has. */
  chatTool: Record<BerthToolName, { doing: string; done: string }>;
  chatToolsFolded: (n: number) => string;
  chatToolFailed: string;
  chatDraftLabel: string;
  chatDraftBuy: (name: string) => string;
  chatDraftSell: (name: string) => string;
  chatDraftShares: (quantity: string) => string;
  chatDraftAbout: (usd: string) => string;
  chatDraftNothingYet: string;
  chatDraftOpen: string;

  /* — limit orders (behind LIMIT_ORDERS_USERS) — */
  limitModeNow: string;
  limitModePrice: string;
  limitBuyAt: string;
  limitSellAt: string;
  limitPriceNow: (price: string) => string;
  limitUntilCancelled: string;
  limitUntilDate: string;
  limitDateLabel: string;
  limitPriceLabel: string;
  limitFillsNow: string;
  limitNeedsDollarsBuy: string;
  limitNeedsDollarsSell: string;
  limitCtaEnterPrice: string;
  limitCtaPickDate: string;
  limitCtaPastDate: string;
  limitCtaTooFar: string;
  limitCtaReview: string;
  limitCtaThroughBuy: string;
  limitCtaNoPrice: string;
  limitNoPrice: string;
  limitCtaThroughSell: string;
  limitThroughBuy: string;
  limitThroughSell: string;
  limitCtaDollarsBuy: string;
  limitCtaDollarsSell: string;
  limitReviewTitle: string;
  limitSummaryBuy: (name: string, price: string) => string;
  limitSummarySell: (name: string, price: string) => string;
  limitSummaryPay: (amount: string) => string;
  limitSummaryPut: (amount: string) => string;
  limitSummaryGet: (amount: string) => string;
  limitSummaryLocked: string;
  limitSummaryWhole: string;
  limitSummaryUntilCancelled: string;
  limitSummaryUntilDate: (day: string) => string;
  limitSummaryFee: (fee: string) => string;
  limitPlace: string;
  limitBack: string;
  limitPlacedTitle: string;
  limitUnsaved: string;
  limitPlacedBody: (name: string, price: string) => string;
  limitWaitingTitle: string;
  limitWaitingPart: string;
  limitUnpricedNote: string;
  limitStripLead: (usd: string) => string;
  limitStripItem: (name: string, price: string) => string;
  limitStripPartial: (count: number) => string;
  limitListSub: string;
  limitRowBuy: (name: string) => string;
  limitRowSell: (name: string) => string;
  limitRowAtBuy: (price: string) => string;
  limitRowAtSell: (price: string) => string;
  limitRowUntil: (day: string) => string;
  limitRowUntilCancelled: string;
  limitRowFilled: (percent: string) => string;
  limitRowNotFilled: string;
  limitRowSetAside: (amount: string) => string;
  limitRowCancelAsked: string;
  limitCancel: string;
  limitCancelConfirm: (name: string) => string;
  limitCancelBodyBuy: string;
  limitCancelBodySell: string;
  limitCancelKeep: string;
  limitCancelling: string;
  limitCancelledToast: string;
  limitCancelKept: string;
  limitCancelFailed: string;
  limitCancelNotYours: string;
  limitFilledBuy: (name: string) => string;
  limitFilledSell: (name: string) => string;
  limitExpiredToast: (name: string) => string;
  limitRefundBuy: string;
  limitRefundSell: string;
  askSuggestionLimit: string;
  chatDraftAtBuy: (price: string) => string;
  chatDraftAtSell: (price: string) => string;
  chatThinking: string;
  chatFailed: string;
  chatRetry: string;
  chatLimitMinute: string;
  chatLimitDay: string;
  chatLeft: (n: number) => string;
  chatBudget: string;
  chatLimitMonth: string;
  chatUnavailable: string;
  chatTooLong: string;
  chatLockedTitle: (rankName: string) => string;
  chatLockedBody: (xp: number) => string;
  /* — email (lib/server/email): notices by mail, and the settings that choose them — */
  email: EmailCopy;
  recurring: RecurringCopy;

  /* — the privacy policy (app/privacy): public, signed in or not — */
  /** The small link to /privacy, in the settings drawer and under the consent screen. */
  privacyLink: string;
  privacyPolicy: LegalDocument;

  /* — the terms of use (app/terms): public, signed in or not — */
  /** The small link to /terms, beside Privacy in the settings drawer and under the consent screen. */
  termsLink: string;
  termsOfUse: LegalDocument;

  /* — the help page for assistants (app/assistants): public, the directories' documentation and support page — */
  /** The small link to /assistants under "Your assistant" in the account drawer. */
  assistantsLink: string;
  assistantsHelp: AssistantsHelp;

  /* — the account's wallets (account drawer; docs/plans/account-linking.md, phase 2) — */
  accountWalletsTitle: string;
  accountWalletsSub: string;
  walletsHomeTag: string;
  /** Under the home address. */
  walletsHomeNote: string;
  /** Under any other address. */
  walletsPayFromNote: string;
  /** The network family heading, e.g. EVM. */
  walletsNetworkEvm: string;
  walletsAdd: string;
  walletsAddHint: string;
  walletsAddHintEmail: string;
  walletsMakeHome: string;
  walletsRemove: string;
  walletsCancel: string;
  walletsMakeHomeConfirm: (short: string) => string;
  walletsRemoveConfirm: (short: string) => string;
  walletsRemoveHolds: string;
  walletsRemoveHomeFirst: string;
  walletsRemoveSignedIn: string;
  /** The confirm button: the change needs one free signature. */
  walletsSignToConfirm: string;
  /** Home and remove are confirmed by the home wallet, which is not the one connected. */
  walletsNeedHomeSigner: (short: string) => string;
  walletsLinkedToast: string;
  walletsHomeToast: string;
  walletsRemovedToast: string;
  walletsOtherAccount: string;
  walletsCooling: string;
  walletsFailed: string;
  walletsDeclined: string;
  /** The quiet prompt when the connected wallet is not on the account. */
  walletNotLinkedPrompt: string;
  walletNotLinkedAdd: string;
  walletNotLinkedDismiss: string;
  /** Wallet mode, a new extension address with no session here while an earlier account's has one. */
  signedInAsWallet: (short: string) => string;
  connectedWallet: (short: string) => string;
  signInWithWallet: (short: string) => string;
  addToThisAccount: string;
  /** A link's second signature: the home confirms, after the new wallet signed. */
  walletsConfirmWithHome: (short: string) => string;
  walletsHomeMissing: (short: string) => string;
  walletsSlowDown: string;
  /** An email account adds a wallet only with an email code entered in the last ten minutes. */
  walletsSignInAgain: string;
  walletsSignInAgainAction: string;
  /** "Add a wallet", opened: every address the extensions have open, by network. */
  walletsAddListSub: string;
  walletsAdded: string;
  walletsAddOne: string;
  /** Shown only after the address signed. */
  walletsBelongsElsewhere: string;
  walletsCoolingShort: string;
  walletsComingSoon: string;
  walletsComingSoonList: (names: string) => string;
  walletsConnectNetwork: (name: string) => string;
  walletsNetworkSolana: string;
  walletsNetworkBitcoin: string;
  /** Under a linked Bitcoin address: it pays (the Bitcoin relay), and what it buys lands with the signed in wallet. */
  walletsBitcoinNote: string;
  /** Under a linked Solana address: it pays, and what it buys lands with the signed in wallet. */
  walletsSolanaNote: string;
  /** A sell draft for more than the chosen hub wallet holds. */
  sellUpToFromWallet: (amount: string) => string;
  /** SIWE statements, shown inside the wallet next to the address. */
  walletLinkStatement: string;
  walletHomeStatement: (short: string) => string;
  /** Signed by the account's home wallet to confirm a new wallet joins it. */
  walletLinkConfirmStatement: (short: string) => string;
  walletRemoveStatement: (short: string) => string;
  /** The signature a wallet gives to join its account to an email's (lib/server/account-merge-route). */
  walletMergeStatement: (short: string) => string;
  /** A buy paid from a wallet that is not on the account yet. */
  ctaAddWalletFirst: string;
  /** A sell from a hub wallet another address of the account owns. */
  ctaSellSwitchWallet: (short: string) => string;
  /** The holding sits in the account's email wallet, which only an email sign in signs for. */
  ctaSellSignInEmail: string;
  sellFromLabel: string;
  sellFromHomeTag: string;
  social: SocialCopy;
};

/**
 * The public help page for assistants. The steps for each assistant are not
 * here: the page reads assistantStepsClaude and its siblings, the same words
 * the account drawer shows.
 */
/**
 * Usernames, profiles, Salutes and friends (docs/plans/social.md). Short
 * lines: a profile is one phone screen and the drawer section is a few rows.
 * Never "beat", "win", "top", "streak" or a money figure.
 */
export type SocialCopy = {
  sectionTitle: string;
  /** The section's one (i). */
  sectionWhy: string;
  addEmail: string;
  addEmailSub: string;
  pickTitle: string;
  pickSub: string;
  pickPlaceholder: string;
  pickRules: string;
  pickSave: string;
  pickChecking: string;
  pickFree: string;
  /** Why a name cannot be had; `nextChange` is a readable date for "cooldown". */
  refusal: (reason: HandleRefusal, nextChange?: string) => string;
  saved: (handle: string) => string;
  saveFailed: string;
  view: string;
  change: string;
  cancel: string;
  hide: string;
  hideSub: string;
  hiddenNote: string;
  friends: string;
  friendsNone: string;
  requestsTitle: string;
  sentLabel: string;
  accept: string;
  decline: string;
  shareLink: string;
  shareLinkSub: string;
  shareLinkText: (handle: string) => string;
  linkCopied: string;
  newLink: string;
  newLinkDone: string;
  boardRow: string;
  boardRowSub: string;
  blocked: string;
  unblock: string;
  /* — the profile — */
  memberSince: (month: string) => string;
  xpLabel: string;
  salutesLabel: string;
  sinceLabel: string;
  salute: string;
  saluted: string;
  saluteUndoLabel: (handle: string) => string;
  saluteNeedsEmail: string;
  relation: Record<Exclude<Relation, "self">, string>;
  addFriend: string;
  cancelRequest: string;
  removeFriend: string;
  removeConfirm: string;
  needHandle: string;
  youAreFriends: (handle: string) => string;
  requestSent: string;
  selfNote: string;
  signInLine: string;
  signIn: string;
  notFound: string;
  notFoundSub: string;
  /* — find a friend, by exact username — */
  findTitle: string;
  findSub: string;
  findLabel: string;
  findButton: string;
  findSlow: string;
  back: string;
  moreLabel: string;
  block: string;
  blockConfirm: (handle: string) => string;
  blockDone: string;
  report: string;
  reportReasons: Record<ReportReason, string>;
  reportDone: string;
  actionFailed: string;
  /* — the friends board — */
  boardTitle: string;
  boardMonth: (month: string) => string;
  boardWhy: string;
  /** The word after a board row's number. */
  boardPointsUnit: (points: number) => string;
  boardYou: string;
  boardEmpty: string;
  boardNoHandle: string;
  boardSignedOut: string;
};

export type AssistantsHelp = {
  title: string;
  intro: readonly string[];
  connectHeading: string;
  connectBody: string;
  canHeading: string;
  can: readonly string[];
  cannotHeading: string;
  cannot: readonly string[];
  disconnectHeading: string;
  disconnect: readonly string[];
  moreHeading: string;
  more: readonly string[];
  support: string;
  backHome: string;
};

/**
 * A legal page as data: headings, paragraphs and lists, rendered by
 * components/legal-page for app/privacy and app/terms. Three facts are the
 * operator's to give; they live in PRIVACY_OPERATOR and are interpolated
 * wherever a page names them.
 */
export type LegalSection = {
  id: string;
  heading: string;
  /** Paragraphs before the list. */
  body: readonly string[];
  list?: readonly string[];
  /** Paragraphs after the list. */
  after?: readonly string[];
};

export type LegalDocument = {
  title: string;
  /** Under the title: the status and the effective date. */
  status: string;
  intro: readonly string[];
  sections: readonly LegalSection[];
  backHome: string;
};

/**
 * Recurring buys (docs/adr/0007): reminders the person signs. Never
 * "automatic", "autopilot", "set and forget" or "DCA", and never a claim
 * that buying regularly lowers risk. Skipping is never a loss.
 */
export type RecurringCopy = {
  sectionLabel: string;
  empty: string;
  add: string;
  whenWeekly: (day: string) => string;
  whenMonthly: (ordinal: string) => string;
  row: (usd: string, when: string) => string;
  next: (day: string) => string;
  paused: string;
  asDip: (pct: string) => string;
  runWords: Record<"due" | "opened" | "placed" | "skipped", string>;
  lastRuns: (list: string) => string;
  pause: string;
  resume: string;
  edit: string;
  remove: string;
  /** Delete asks once, in place: the plan and its history go together. */
  removeConfirm: string;
  removeConfirmYes: string;
  removeConfirmNo: string;
  removed: string;
  /** Resuming a plan when ten already run: the cap counts plans that are not paused. */
  resumeTooMany: string;
  sheetTitle: string;
  sheetSub: string;
  listingLabel: string;
  amountLabel: string;
  weekly: string;
  monthly: string;
  dayOfMonth: string;
  dipLabel: string;
  dipSub: (pct: string) => string;
  dipPctLabel: string;
  nothingUntil: string;
  /** The plan sheet signed out: what saving needs, and that the choice waits. */
  signInToSave: string;
  signInToSaveButton: string;
  save: string;
  saved: (day: string) => string;
  errors: Record<"amount" | "too_many" | "failed" | "day" | "listing" | "limit_off" | "dip" | "time_zone", string>;
  strip: (lead: string, name: string, usd: string) => string;
  stripLimit: (price: string) => string;
  /** A dip plan whose price could not be set today: the draft is an ordinary buy. */
  stripUnpriced: string;
  /** The toast when a reminder email's link opens the buy drawer: Berth reminded, nobody suggested. */
  linkOpenedTitle: string;
  linkOpenedBody: string;
  stripOpen: string;
  stripSkip: string;
  skipped: (day: string) => string;
  monthlyLead: string;
  /** Sunday first, as lib/recurring numbers them. */
  weekdays: readonly string[];
  /** "1st", "2nd", "23rd": a day of the month as a person says it. */
  ordinal: (day: number) => string;
  /** The locale a due day is written in ("6 October"). */
  dateLocale: string;
  weekdaysShort: readonly string[];
  makeRecurring: string;
  cardLabel: string;
  /** The card's schedule line, on its own, so it starts a sentence. */
  cardWeekly: (day: string) => string;
  cardMonthly: (ordinal: string) => string;
  cardOpen: string;
  cardNothingYet: string;
  planOpened: string;
};

/**
 * Every word an email says (lib/server/email/compose), and the Email
 * section of the settings drawer and the unsubscribe page. One fact, one
 * button, one line on why the email arrived. Security notices never ask
 * for a code or a click to "secure" anything, and link only to Berth.
 */
export type EmailCopy = {
  openBerth: string;
  /** Before the privacy contact's address, at the foot of every security notice. */
  notYou: string;
  securityWhy: string;
  why: Record<"orders" | "friends" | "weekly" | "recurring", string>;
  unsubscribe: string;
  signoff: string;
  /** With its article, as a sentence opens: "An EVM", "A Solana". */
  family: Record<"evm" | "solana" | "bitcoin", string>;
  walletAdded: { subject: string; heading: string; body: (family: string, address: string) => string };
  walletRemoved: { subject: string; heading: string; body: (family: string, address: string) => string };
  accountsMerged: { subject: string; heading: string; body: string };
  assistantConnected: {
    /** When the app gave no name. */
    unnamed: string;
    subject: (app: string) => string;
    heading: string;
    body: (app: string) => string;
    scopes: Record<"read" | "draft", string>;
    after: string;
  };
  orderFilled: {
    subject: (name: string, side: "buy" | "sell") => string;
    heading: string;
    body: (name: string, side: "buy" | "sell", price: string) => string;
    priceLabel: string;
    receivedLabel: string;
  };
  orderExpired: {
    subject: (name: string, side: "buy" | "sell") => string;
    heading: string;
    body: (name: string, side: "buy" | "sell") => string;
  };
  friendRequest: { subject: (username: string) => string; heading: string; body: (username: string) => string };
  recurringDue: {
    subject: (lead: string, name: string) => string;
    heading: string;
    body: (lead: string, usd: string, name: string) => string;
    limitBody: (price: string) => string;
    unpricedBody: string;
    button: string;
    after: string;
  };
  settings: {
    sectionLabel: string;
    goesTo: (address: string) => string;
    securityAlways: string;
    kinds: Record<"orders" | "friends" | "weekly" | "recurring", { label: string; sub: string }>;
    addEmail: string;
    addEmailSub: string;
    undeliverable: string;
    saveFailed: string;
  };
  unsubscribePage: {
    title: string;
    kindName: Record<"orders" | "friends" | "weekly" | "recurring", string>;
    confirm: (kind: string) => string;
    confirmSub: string;
    confirmButton: string;
    done: (kind: string) => string;
    doneSub: string;
    turnBackOn: string;
    backOn: (kind: string) => string;
    invalid: string;
    backHome: string;
  };
};

/** "first day", "1 market day", "4 market days". */
function marketDays(days: number): string {
  if (days <= 0) return "first day";
  return days === 1 ? "1 market day" : `${days} market days`;
}

/**
 * The three facts about the operator that the privacy policy names. The
 * country of establishment also sets the governing law and the lead
 * supervisory authority named in the policy.
 */
export const PRIVACY_OPERATOR = {
  name: "RD Norra-Winkels",
  email: "support@berthmarkets.com",
  country: "the Netherlands",
} as const;

/**
 * Where Berth may be used, as the terms of use state it. This is a DEFAULT,
 * not a decision: Robinhood's stock tokens are issued for customers outside
 * the United States, so the United States is excluded until someone with
 * standing says otherwise.
 *
 * TODO(David): confirm this list, ideally with counsel, before the terms
 * are relied on or a directory listing names its countries. Add a country
 * here and the terms say it; the sanctions and local law clause stays
 * whatever the list holds.
 */
export const TERMS_AVAILABILITY = {
  excluded: ["the United States"],
} as const;

/** "the United States", "the United States or Canada", "A, B or C". */
function orList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

export const COPY: Copy = {
  brand: "Berth",
  tagline: "A place to tie up.",
  welcomeLede:
    "Buy NVIDIA, Apple, the S&P 500 fund or Gold with the stablecoins, ETH, SOL or Bitcoin you already hold, from more than 20 networks, in one signature.",
  signInEmail: "Continue with email",
  connectWallet: "Connect a wallet",
  noSeedPhrases: "An email is enough. No seed phrase, and the keys are yours to export.",
  walletDetectedLead: "Or continue with a wallet you already have",
  continueWithWallet: (name) => `Continue with ${name}`,
  walletConnecting: (name) => `Waiting for ${name}…`,
  walletConnectFailed: "Could not connect. Try again, or continue with email.",

  infoOpenLabel: "How Berth works",
  withdrawCustomAddressLabel: "Address to send to",
  avatarChooseLabel: (face) => `Choose ${face}`,
  inviteCopyLabel: "Copy your invite link",
  rewardsChipLabel: "Your rewards",
  rankLevelShort: (level) => `Lv ${level}`,
  rankLevelLong: (level) => `Level ${level}`,
  rankAriaLabel: (name, level) => `${name}, level ${level}`,

  accountSignedInAs: (email) => `Signed in as ${email}`,
  accountSignedInEmail: "Signed in via email",
  accountSignOut: "Sign out",
  receiveEvmTitle: "EVM address",
  receiveEvmBody:
    "One address for Ethereum, Base, Arbitrum, Polygon, BNB and every other EVM network.",
  receiveEvmToast: "Works on every EVM network. Send funds there to top up.",
  receiveSolanaTitle: "Solana address",
  receiveSolanaBody: "Only for Solana assets: SOL, JitoSOL, USDC on Solana.",
  receiveSolanaToast: "Only send Solana assets to this one.",
  receiveShowQr: (what) => `Show ${what} as a QR code`,
  receiveCopyLabel: (what) => `Copy ${what}`,
  receiveCopied: "Address copied",
  topUpSub: "Card, bank, or crypto from any network.",

  walletsTitle: "Wallets",
  walletsSub: "Connect a wallet for each network you want to pay from.",
  walletConnectTitle: (family) => `Connect ${family}`,
  walletConnectSub: "Choose a wallet to continue.",
  walletBack: "Back",
  walletDisconnectLabel: (name) => `Disconnect ${name}`,
  walletGet: "Get",
  walletWaitingTitle: (name) => `Waiting for ${name}`,
  walletWaitingBody: "Approve the connection request in your wallet.",
  walletScanTitle: "Continue in your wallet",
  walletScanBody: "Scan the code, or approve the request in your wallet app.",
  walletCancel: "Cancel",
  walletConnectedTitle: "Connected",
  walletNoneTitle: "No wallets found",
  walletNoneBody: "No wallet for this network is available in this browser.",
  walletChooseAnother: "Choose another wallet",
  walletTryAgain: "Try again",
  walletCancelledTitle: "Request cancelled",
  walletCancelledBody: "You dismissed the request in your wallet. Try again when you are ready.",
  walletFailedTitle: "Connection failed",
  walletFailedBody: "Something went wrong while connecting.",
  inviteWaiting: "A friend invited you. Sign in and the invite is yours.",
  welcomePreviewTitle: "On the board today",
  welcomePreviewHint: "Live prices, and the last months of each. Sign in to buy any of them.",
  footerNote:
    "Stock tokens track a share; they are not the share. Read what you own before you buy.",
  welcomePage: {
    navLabel: "Berth",
    nav: { how: "What it is", assistant: "The Assistant", ai: "For your AI" },
    eyebrow: "US stocks and funds, in your own custody",
    headlineLead: "Stocks for the money that ",
    headlineMark: "already lives onchain.",
    emailCta: "Sign in with email",
    previewLabel: "What the board looks like",
    previewExample: "Example",
    onNetwork: (network) => `on ${network}`,
    value: {
      title: "Buy US stocks with the crypto you hold. Keep them in your own wallet.",
      body:
        "Berth is software, not a broker. Choose what to pay with, sign once in your own wallet, and independent solvers fill the order through SODAX. What you buy lands with you.",
      fine: "What you buy are tokens that track a share, issued by third parties.",
      points: {
        pay: {
          title: "Pay with what you hold",
          body: "Stablecoins, ETH, SOL or Bitcoin, on more than 20 networks. One signature.",
        },
        custody: {
          title: "Your custody, always",
          body: "You sign every order. Berth never holds your keys or your funds.",
        },
        email: {
          title: "Start with an email",
          body: "No seed phrase to write down. Your keys can be exported from Settings, Advanced.",
        },
        cash: {
          title: "Cash that earns",
          body: "Park idle money in a Treasury bill fund at the T\u2011bill rate. It counts toward what you own.",
        },
      },
    },
    features: {
      compare: {
        title: "See what your money would have made elsewhere",
        body: [
          "Your portfolio beside the same dollars, on the same days, in the S&P 500 fund, the Nasdaq 100 fund, Gold, Bitcoin or Treasury bills. Over a week, a month, three months or since your first buy.",
        ],
      },
      assistant: {
        title: "The Assistant reads and drafts. You sign.",
        body: [
          "Ask about your account and the market in plain words: what you own, how it compares, what moved and why. Ask for a buy or a sell and it hands you the order, filled in, to check and sign.",
        ],
        fine: "Facts, not advice. Berth keeps no copy of the chat. Unlocks at level 2.",
        ask: "Am I ahead of Gold this month?",
        answer: "You are up 6.1% this month. The same dollars in Gold are up 3.8%.",
        askBuy: "Buy $20 of Apple.",
        draft: "Draft order, ready to check",
        buy: "Buy",
        amount: "Amount",
        payWith: "Pay with",
      },
      ai: {
        title: "Bring Berth into your AI",
        body: [
          "Connect Claude, ChatGPT or Grok to your Berth account. Your own AI reads your account beside everything else it does, and drafts orders you sign in Berth. Disconnect any time.",
        ],
        reads: "Your AI reads and drafts",
        sign: "You sign in Berth",
      },
      news: {
        title: "News about your stocks, curated by Jev",
        body: [
          "Posts on X and headlines, each read by Jev, a model by TypeSafe, and kept only when it reports something. When a price moves a lot, What moved links it to the post that reported it.",
        ],
      },
      night: {
        title: "Buy on weekday nights, when US markets are closed",
        body: [
          "US markets keep their hours. Berth orders still fill through the night and the early morning on weekdays, usually in under half a minute.",
        ],
        fine: "Weekends and US market holidays are not covered yet.",
        clock: "Filled by Berth, New York time",
        open: "US market open",
        filled: (seconds) => `filled in ${seconds} s`,
      },
      friends: {
        title: "Friends, Salutes and a board without money",
        body: [
          "Pick a username for a one screen profile. Find a friend by their exact username, salute people and see a friends board ranked on XP and Salutes, never returns. Nobody sees anyone's friends.",
        ],
      },
      wallets: {
        title: "One account, many wallets",
        body: [
          "Link EVM, Solana and Bitcoin wallets to one account. Buys land at your home wallet, and your total adds up every one.",
        ],
        home: "Home",
        linked: "Linked",
        evm: "EVM wallet",
        solana: "Solana wallet",
        bitcoin: "Bitcoin wallet",
      },
      email: {
        title: "A short email when it matters",
        body: [
          "Berth writes when a wallet joins or leaves your account, accounts merge or an AI is connected, when a limit order fills or expires, when a friend asks, and on the day a recurring buy you set comes due. Each kind has its own switch, and one tap unsubscribes. No marketing.",
        ],
        from: "Berth",
        always: "Security notices always reach you.",
        switches: "Everything else has its own switch.",
      },
      ranks: {
        title: "Ranks, XP and invites",
        body: [
          "Earn XP for buying, holding, adding an email and bringing friends. Climb ten harbour ranks from First Line to Harbour Master, with avatars and features unlocked on the way.",
          "Share your link, and you both earn XP when a friend joins and trades. You become friends at once.",
        ],
        xp: "1,120 / 1,500 XP",
        now: (rank, level) => `${rank}, level ${level}`,
      },
    },
    comingTitle: "Coming",
    coming: [
      { name: "Limit orders", line: "Set a price, and the order waits until it is reached. In testing." },
    ],
    legal:
      "Not available in the United States or where local law or sanctions forbid it. Stocks on Berth are tokens that track a share, issued by third parties. Nothing here is advice, and past results say nothing about the future.",
  },

  accountTotalLabel: "Your account",
  accountTotalSub: "Funds, holdings and cash, in one figure.",
  accountSplitHoldings: "Stocks",
  portfolioSameDays: "Same dollars, same days",
  holdingsSubline: "Since you bought, beside the S&P 500 fund.",
  holdingsCashIncluded: "Includes your parked cash.",
  holdingsWalletsNote: "Money waiting in your wallets is not counted.",
  holdingsAll: (count) => `All ${count} holdings`,
  disclosureFewer: "Fewer",
  holdingVs: "vs",
  cashCounts: "Counts toward What you own.",
  cashRate: (rate) => `About ${rate} a year.`,
  cashParkMore: "Add",
  boardYours: "Yours",
  boardMovers: "Moving most today",
  boardAll: (count) => `All ${count} stocks and funds`,
  newsMorePosts: "More posts",
  newsMoreHeadlines: "More headlines",
  askPlaceholder: "Ask about your account",
  askFine: "Facts, not advice. You sign every order.",
  askSuggestions: ["What moved today?", "Am I ahead of Gold?", "Buy $5 of NVIDIA"],
  assistantCardBody: "Let Claude, ChatGPT or Grok read your account and draft orders you sign here.",
  moneyRowName: (name, amount) => `${name}, ${amount}`,
  fundsReadyLine: (assetCount) =>
    assetCount === 1 ? "In one asset, ready to spend." : `Across ${assetCount} assets, ready to spend.`,

  fundsTitle: "Funds",
  fundsReadyTail: (assetCount) =>
    assetCount === 1
      ? "in one asset, ready to spend."
      : `across ${assetCount} assets, ready to spend.`,
  fundsEmpty: "Nothing to spend yet.",
  fundsSendAnything:
    "Send stablecoins or any supported asset to your address on any network. It shows up here.",
  fundsSignIn: "Sign in and your funds appear here.",
  fundsWhatsInside: "What is inside",
  fundsNeedsGas: "needs a network fee",
  topUp: "Add funds",
  signIn: "Sign in",
  fundsInsideTitle: "Your funds",
  fundsInsideSub:
    "Each asset, the network it sits on, and whether that network can pay its own fee.",
  fundsTotalLabel: "Total",

  boardTitle: "Stocks and funds",
  boardHint: "Robinhood Stock Tokens. Choose one to buy.",
  marketClosedLine: (day, time) => `US market closed. Opens ${day} ${time} your time.`,
  boardYouHold: (amount) => `You hold ${amount}`,
  boardPerformanceNote: (days) =>
    `The figure under the line is the last ${days} days. The figure by the price is the day. Only days the market was open are counted.`,
  boardFilterNews: (name) => `Filter news to ${name}`,
  boardFilterNewsShort: "News",
  boardShowAllNews: "Show all news",

  holdingsTitle: "What you own",
  holdingsHint: "Held in your account. Sell any of it with one signature.",
  holdingsEmpty: "Nothing yet. Your first buy lands here.",
  holdingSince: (date) => `Since ${date}`,
  holdingBenchmark: "S&P 500 fund",
  holdingsMarketDays: (days) => marketDays(days),
  moveInTheNews: (source) => `In the news: ${source}`,
  moveReadPost: (source) => `Read what ${source} posted, on X`,
  holdingsBenchmarkNote:
    "The line is your money each day at the close, and today at the live price, beside the same dollars put on the same days into what you compare it with, priced the same way. Your side includes the fee you paid; the other side does not. The percentage is time weighted, so money you add is not counted as a gain. Coins waiting in your wallets are not in the line; Treasury bills you hold are. Prices are one a day, so a few days mostly shows noise. The line under each holding sets that holding alone beside the S&P 500 fund. It describes what happened, and says nothing about what to do.",
  portfolioSince: (date, days) => `Since ${date}, ${marketDays(days)}.`,
  portfolioYou: "You",
  portfolioSameDollarsIn: {
    SPY: "the same dollars in the",
    QQQ: "the same dollars in the",
    PAXG: "the same dollars in",
    BTC: "the same dollars in",
    SGOV: "the same dollars in",
  },
  portfolioCompareWith: "Compare with",
  portfolioChooserHint: "What your money is compared with. Choose another.",
  portfolioFirstDay: "Your first day. The line starts once the next market day's prices are in.",
  portfolioNoBenchmark: {
    unpriced_orders: (name) =>
      `A buy was paid in a coin we could not price, so ${name} cannot be set beside it.`,
    unexplained_balance: (name) =>
      `Money moved in or out without a Berth order, so ${name} is set beside it from the next evening that adds up.`,
  },
  portfolioRebased: (date) => `Money moved without a Berth order before ${date}, so the comparison starts then.`,
  portfolioRecordStarts: (date) =>
    `Daily values are on record from ${date}, after your first buy. The percentages count from the first buy.`,
  portfolioRangeSince: (date) => `Since ${date}`,
  benchmarkArticle: { SPY: "the ", QQQ: "the ", PAXG: "", BTC: "", SGOV: "" },
  portfolioNoMarks: (name) => `No prices for ${name} yet.`,
  portfolioRanges: {
    "1w": "1W",
    "1m": "1M",
    "3m": "3M",
    "6m": "6M",
    "1y": "1Y",
    since: "First buy",
    all: "All",
  },
  portfolioRangeLabel: "Time range",

  benchmarkNames: {
    SPY: "S&P 500 fund",
    QQQ: "Nasdaq 100 fund",
    PAXG: "Gold",
    BTC: "Bitcoin",
    SGOV: "Treasury bills",
  },

  newsTitle: "In the news",
  newsHint:
    "Headlines about the stocks and funds on the board. Tapping one opens the publisher's own page.",
  newsEmpty: "Nothing new about these right now.",
  newsFilteredTo: (name) => `${name} only`,
  newsShowAll: "Show all",
  newsEmptyFor: (name) => `Nothing new about ${name} right now.`,
  newsByline: (source, when) => `${source}, ${when}`,
  newsTabPosts: "Posts",
  newsTabHeadlines: "Headlines",
  newsTabsLabel: "What to read",
  newsRefresh: "Refresh the news",
  newsRefreshing: "Refreshing the news",
  newsUpdated: (when) => `Updated ${when}`,
  newsUpToDate: (when) => `Up to date, updated ${when}`,
  postsHint:
    "What the companies and the market desks are posting on X. Tapping one opens the post. The list refreshes every half hour, or when you ask, and the posts you have not seen yet are marked New.",
  postsEmpty: "The accounts we follow have been quiet.",
  postsEmptyFor: (name) => `Nothing about ${name} on X right now.`,
  postsHandle: (handle) => `@${handle},`,
  postNewToYou: "New",
  postNewToYouLabel: "You have not seen this post here before",
  postsSourceLabel: "Posted on X",
  postsMetrics: (replies, reposts, likes) =>
    `${replies} replies, ${reposts} reposts, ${likes} likes`,
  postsAlsoBy: (names) =>
    names.length <= 2
      ? `Also posted by ${names.join(" and ")}.`
      : `Also posted by ${names[0]}, ${names[1]} and ${names.length - 2} more.`,

  cashTitle: "Cash",
  cashHint: "Idle dollars sit in a token tracking a fund of short Treasury bills, not in a lending pool.",
  cashYieldLine: (rate) =>
    `The 3 month Treasury bill rate is ${rate}. What you earn is the fund's return after its costs, and it moves with that rate.`,
  cashEmpty: "Nothing parked yet.",
  cashPark: "Park cash",
  cashTakeOut: "Take out",

  vaultsTitle: "Earlier vault positions",
  vaultsHint:
    "Leveraged staking vaults from before Berth. They are no longer offered, and you can withdraw at any time.",
  vaultWithdraw: "Withdraw",

  buy: "Buy",
  buyTitle: (name) => `Buy ${name}`,
  buySub: "Pay from any wallet, on any network. It lands in your account.",
  orderTitleFallback: "Place an order",
  whatPayingWith: "What are you paying with?",
  findingPayWith: "Finding what you can pay with",
  gasShortWarning: (chainName, symbol) =>
    `Your ${chainName} wallet holds no ${symbol} for the network fee. This order pays its fee in ${symbol}, so it cannot start until some arrives.`,
  gasShortCta: (symbol) => `Send a little ${symbol} to your address`,
  walletHolds: (amount) => `You have ${amount}`,
  checkingBalance: "Checking your balance…",
  maxLabel: "Max",
  youllHold: "You will hold",
  atLeastLabel: "At least, after price movement",
  fetchingQuote: "Getting a quote…",
  noRouteForPair: "No route for this pair right now",
  gasCostChecking: "Checking the network fee. One moment.",
  nothingLeftForGas: "Not enough left over for the network fee",
  connectChainWallet: (chainName) => `Connect a ${chainName} wallet`,
  ctaEnterAmount: "Enter an amount",
  ctaTooMuch: "More than you have",
  ctaSwitchNetwork: "Switch network",
  ctaNoRoute: "No route for this pair",
  ctaAtLeast: (amount) => `Minimum ${amount}`,
  smallestOrder: (amount) => `The smallest order is ${amount}.`,
  ctaGettingQuote: "Getting a quote…",
  ctaSignInToBuy: "Sign in with email to buy",
  ctaOpeningAccount: "Opening your account…",
  buyFilledTitle: "Bought.",
  buyFilledBody: "It is in your account.",
  buyFailedBody: "The order could not be filled. Nothing was taken. Try again.",
  settledBody: (name) => `${name} is in your account.`,

  sell: "Sell",
  sellTitle: (name) => `Sell ${name}`,
  sellSub: "To any asset, on any network. One signature, and it is on its way.",
  youHold: (amount) => `You hold ${amount}`,
  sellSignOnce: (chainName) =>
    `You sign once on ${chainName}. Your account does the rest.`,
  ctaSellHowMuch: "Sell how much?",
  ctaNotThatMuchHeld: "You do not hold quite that much",
  soldTitle: "Sold.",
  withdrawTitle: (name) => `Withdraw from ${name}`,
  withdrawSub: "Back to any asset, on any network. One signature.",
  vaultHolds: (amount) => `This vault holds ${amount} for you`,
  vaultSignOnce: (chainName) =>
    `You sign once on ${chainName}, the network you deposited from.`,
  vaultSplitNote: (part, total, chainName) =>
    `${part} of your ${total} sits under ${chainName}. The rest was deposited from other networks and can be withdrawn in a second pass.`,
  ctaWithdrawHowMuch: "Withdraw how much?",
  ctaVaultNotThatMuch: "The vault does not hold quite that much",
  withdrawnTitle: "Withdrawn.",
  whereTo: "Where to?",
  whereToDeliver: "Where should it go?",
  sendElsewhere: "Sending to a different address",
  useMyWallet: "Use my wallet",
  tripleCheckAddress: (symbol, chainName) =>
    `Check this address twice. Funds sent to a wrong address are gone, and the receiving side, your exchange for instance, must accept ${symbol} on ${chainName}.`,
  cashOutLink: "Send to an exchange address instead",
  youllGetBack: "You will receive",
  asTokenLabel: "As",
  ctaAddressLooksOff: "That address does not look right",
  ctaTooSmallForBtc: "Too small for a Bitcoin transfer",
  deliveredBody: (chainName) => `Delivered on ${chainName}.`,
  sellFailedBody: "Your holding is untouched. Try again.",
  onItsWayTitle: "On its way.",
  onItsWayBody: (symbol, chainName) =>
    `${symbol} is on its way to you on ${chainName}.`,
  onItsWayBodyFallback: "It is on its way to you.",

  pickerSelectTokenOn: (chainName) => `Choose an asset on ${chainName}`,
  pickerSelectChain: "Choose a network",
  pickerSourceChainSub: "Pay with anything you hold.",
  pickerSourceHoldingsSub: "Straight from what you hold.",
  pickerSourceGridSub: "Where is the money coming from?",
  pickerDestTokenSub: "Choose what it arrives as.",
  pickerNothingReachable: (chains) =>
    `Nothing found on the networks we could reach, and ${chains} did not answer. Still trying.`,
  pickerUnreachableNote: (chains, plural) =>
    `${chains} did not answer just now, so anything ${plural ? "on those networks" : "there"} is missing from this list. Still trying.`,
  addFunds: "Add funds",
  pickerHoldingsTitle: "What you hold",
  pickerHoldingsEmpty: "Nothing to pay with yet.",
  pickerBrowseAll: "Pay from another network",
  pickerSearchPlaceholder: "Search by name or symbol",
  pickerNoMatches: (query) => `No assets match "${query}"`,

  working: "Working…",
  stepBuild: "Prepare",
  stepApprove: "Approve",
  stepSign: "Sign",
  stepSkipped: "skipped",
  stepMsgBuilding: "Preparing your order…",
  stepMsgApproving: "Approve the spend in your wallet…",
  stepMsgSigning: "Confirm in your wallet…",
  keepThisOpen: "Keep this open. It usually takes under a minute.",
  settling: "Settling your order…",
  settlingNote: "Usually under a minute, sometimes a little more.",
  delivering: "Passing it to the network that fills the order.",
  done: "Done",
  orderFailedTitle: "That did not go through.",
  fillFailedScreenBody:
    "Nothing was lost and your funds are safe. If they do not reappear shortly, the reference below identifies this order.",
  closeLabel: "Close",
  teamTold: "The team has been told, so someone can look into it.",
  tellingTeam: "Telling the team…",
  teamToldNoReport:
    "The team has been told, so someone can look into it. No need to report it.",
  referenceLabel: "Reference",
  unsettledTitle: "Sent, but not settled yet.",
  unsettledBody:
    "Your order left your wallet and is taking longer than usual. Your funds are not lost, and it may still complete on its own.",
  unsettledWatching:
    "This screen updates if it settles while it stays open. The reference below follows it on the Sonic explorer.",
  confirmingTitle: "Bitcoin sent. Waiting for it to confirm.",
  confirmingBody:
    "Bitcoin usually confirms in 10 to 30 minutes, and now and then takes an hour. Your funds are not lost while it does.",
  confirmingClose:
    "You can close this. Leave Berth open in a tab and the order carries on by itself. Once it settles, it shows in what you own.",
  followPayment: "Follow it on mempool.space",
  notArrivedBody:
    "Your order was sent but has not reached Sonic yet, which is slower than usual. Your funds are not lost.",
  notArrivedWatching: "The link below follows the payment on mempool.space.",
  earlierOrderOnItsWay:
    "An earlier order is still on its way. Let it settle before placing the same one again.",
  ariaAmount: "Amount",
  ariaAmountIn: (currency) => `Amount in ${currency}`,
  ariaSharesToWithdraw: "Shares to withdraw",
  backToNetworks: "Back to networks",
  loadingLabel: "Loading",
  orbLabel: {
    working: "Working",
    searching: "Looking",
    solving: "Working it out",
    composing: "Writing",
    connecting: "Handing back",
    breathing: "Loading",
  },

  errWalletDrifted: "Your wallet switched network mid way. Please try again.",
  errCouldNotPrepare: "Could not prepare the order. Please try again.",
  errCouldNotCheckAllowance:
    "Could not check your wallet's allowance. Please try again.",
  errApprovalFailed: "The approval did not go through. Please try again.",
  errAllowanceStillPending:
    "The approval is still confirming. Wait a few seconds and try again.",
  errOrderFailed: "The order did not go through. Try again.",
  errNeedsGas: (shortfall, network) =>
    `Not enough to cover the network fee. Add about ${shortfall} on ${network} and try again.`,
  errNeedsGasUnknown: (network) =>
    `Not enough to cover the network fee. Add a little more on ${network} and try again.`,

  exportKeysTitle: "Export a private key",
  exportKeysSub:
    "Move your funds with any wallet. Privy shows the key in its own window, so Berth never sees it.",
  exportEvmLabel: "EVM key",
  exportSolanaLabel: "Solana key",
  exportConfirmWarning:
    "Anyone with this key can take everything in this wallet. Berth will never ask for it. Never paste it into a website or a chat.",
  exportConfirmCheckboxLabel: "I understand",

  settingsTitle: "Settings",
  settingsSub: "How the app looks, and which currency it speaks.",
  advancedSectionLabel: "Advanced",
  appearanceSectionLabel: "Appearance",
  appearanceSystem: "System",
  appearanceLight: "Light",
  appearanceDark: "Dark",
  currencySectionLabel: "Currency",

  infoTitle: "How Berth works",
  infoSub: "What an order does, what you own, and what it costs.",
  infoHowTitle: "One signature, any network",
  infoHowBody:
    "You pay with what you hold, on the network where you hold it. A network of solvers fills the order and delivers the stock token to your account. Selling works the same way in reverse. Berth never holds your funds.",
  infoOwnTitle: "What you own",
  infoOwnBody:
    "A Robinhood Stock Token is a debt security issued by Robinhood Assets in Jersey that tracks the price of a share and its dividends. It is not the share itself: no voting rights, and the issuer's credit risk sits with you. Cash you park is a token tracking a fund of short US Treasury bills.",
  infoFees: (feePct) =>
    `Every buy and sell includes a ${feePct} fee, taken from the amount before the order is filled. There are no other charges from Berth.`,
  infoBuiltTitle: "How it was built",
  infoBuiltBody:
    "On the SODAX System, which reaches twenty networks including native Bitcoin, and written with Claude in the open.",
  infoBuildersCta: "See how it is built at SODAX Builders",
  infoDocsCta: "SODAX developer docs",

  walletAccountDrawerTitle: "Your account",
  walletAccountDrawerSub: "Your rank, rewards and avatar, and the AI you bring Berth into.",
  fundsAddedTitle: "Funds added",
  fundsAddedBody: "USDC is on its way to your account.",
  walletEmbeddedLabel: "Your account wallet",
  walletEmbeddedNote: " · from your email sign in",
  walletConnectedLabel: "Connected",
  rankLine: (level, xp) => `Level ${level} · ${xp} XP`,
  xpPlus: (amount) => `+${amount.toLocaleString()} XP`,
  ladderLabel: "The ten ranks",
  ladderRungAria: (name, level, state) =>
    state === "current"
      ? `${name}, level ${level}, where you are`
      : state === "reached"
        ? `${name}, level ${level}, reached`
        : `${name}, level ${level}`,
  ladderNext: (xp, rankName) => `${xp} XP to ${rankName}.`,
  ladderTop: "You have reached the top of the ladder.",
  ladderRung: (rankName, xp) => `${rankName}, from ${xp} XP.`,
  ladderHere: "You are here.",
  unlockNext: (unlock) =>
    unlock.kind === "chat"
      ? "Unlocks the Assistant, Berth's own AI."
      : unlock.kind === "invite"
        ? "Unlocks your own invite link."
        : `Unlocks the ${unlock.face} face.`,
  unlockDone: (unlock) =>
    unlock.kind === "chat"
      ? "The Assistant, Berth's own AI, is open to you."
      : unlock.kind === "invite"
        ? "Your own invite link is open to you."
        : `The ${unlock.face} face is yours to wear.`,
  levelUpTitle: (rankName) => `You reached ${rankName}`,
  levelUpLine: (level, total, reason) =>
    `Level ${level} · +${total.toLocaleString()} XP${reason ? ` ${reason}` : ""}`,
  levelUpUnlock: (unlock) =>
    unlock.kind === "chat"
      ? "The Assistant is open. It is at the top of the screen."
      : unlock.kind === "invite"
        ? "Your own invite link is ready in your account."
        : `The ${unlock.face} face is now in your avatar picker.`,
  avatarLockedLabel: (face, rankName) => `${face}, unlocks at ${rankName}`,
  avatarUnlocksAt: (rankName) => `Unlocks at ${rankName}`,
  pickFace: (amount) => `Pick an avatar · +${amount} XP`,
  newFace: "Change avatar",
  addEmailTitle: "Add an email to your account",
  addEmailSub: (amount) => `+${amount} XP. Your wallet stays the key to your account.`,
  addEmailPlaceholder: "you@example.com",
  addEmailContinue: "Continue",
  addEmailSigning: "Confirm in your wallet, so we know the account is yours.",
  addEmailSending: "Sending you a code.",
  addEmailCodeSent: (email) => `Enter the code we sent to ${email}.`,
  addEmailCodePlaceholder: "6 digit code",
  addEmailVerify: "Add email",
  addEmailVerifying: "Checking the code.",
  addEmailDone: "Email added.",
  addEmailCancel: "Cancel",
  addEmailFailed: "That did not go through. Try again.",
  addEmailSaving: "Saving it to your account.",
  addEmailCodeWrong: "That code did not work. Check it, or send a new one.",
  addEmailResend: "Send a new code",
  addEmailResent: "A new code is on its way.",
  addEmailSaveFailed: "Your email was added, but saving it here did not go through.",
  addEmailRetrySave: "Try again",
  mergeEmailTitle: "This email already has a Berth account.",
  mergeEmailAsk: "Bring this wallet into it?",
  mergeWalletTitle: "This wallet already has a Berth account.",
  mergeWalletAsk: "Make them one account?",
  mergeOneMoreCode: "We will send one more code to that email, to open its account.",
  mergeContinue: "Continue",
  mergeCodeSent: (email) => `Enter the new code we sent to ${email}.`,
  mergeStays: (survivor, kind) =>
    survivor === "this"
      ? "This account stays, and the other one joins it."
      : kind === "email"
        ? "The account with this email stays. This wallet joins it."
        : "The other account stays, and this one joins it.",
  mergeWhatMoves: "Your XP, orders and friends come along. Nothing moves on chain.",
  mergeLeftBehind: (usernameComes) =>
    usernameComes
      ? "Assistants connected to the joining account don't come along."
      : "The joining account's username and connected assistants don't come along.",
  mergeTogether: (xp, orders) => `Together: ${xp} XP and ${orders} ${orders === 1 ? "order" : "orders"}.`,
  mergeChart: "Your chart is redrawn overnight.",
  mergeConfirm: "Make them one",
  mergeKeepSeparate: "Keep separate",
  mergeWorking: "Joining the accounts.",
  mergeDone: (xp) => `Done. One account now, with ${xp} XP.`,
  mergeDoneHow: "Sign in with your email or any of its wallets. Each buy lands in the wallet you signed in with.",
  mergeDoneEmailWallet: "To sell what your email's wallet holds, sign in with your email.",
  mergeDoneSignedOut: "You are signed out. Sign in with the other account's email or any of its wallets.",
  mergeFailed: "That did not go through. Try again.",
  mergeChanged: "Something changed. Start again.",
  mergeClose: "Close",
  mergeKeptSeparate: "The email was not added. Both accounts stay as they were.",
  mergeInterrupted: "The accounts were not joined. Nothing changed.",
  mergeSigning: "Confirm in your wallet that its account is yours.",
  mergeExpired: "That took too long. Send a new code.",
  mergeStartAgain: "Start again",
  walletAccountEmailSignIn: "That email belongs to a wallet account. Connect the wallet to sign in.",
  inviteLockedTitle: (rankName) => `Invites unlock at ${rankName}`,
  inviteLockedSub: (level) =>
    `Reach level ${level} and you can invite friends too.`,
  friendInvitedYou: "A friend invited you",
  inviteFirstTradePaid: (amount) =>
    `Your first trade paid you both +${amount} XP.`,
  inviteFirstTradePending: (amount) =>
    `Make your first trade and +${amount} XP lands for you both.`,
  inviterLevel: (level) => `Level ${level}`,
  invitedFriendsWith: (name) =>
    name ? `You and ${name} are now friends.` : "You are now friends.",
  claimAskTitle: "Arrived on a friend's invite?",
  claimAskSub: "Enter their code and your first trade pays you both.",
  claimInputLabel: "Your friend's invite code",
  claimPlaceholder: "eight letters",
  claimCta: "Claim",
  claimMissed:
    "That code did not take. Check it with your friend; codes never use the letters i, l, o or the digits 0 and 1.",
  claimSuccessTitle: "Invite claimed",
  claimSuccessSub: "Your first trade pays you both.",
  inviteRowTitle: "Invite a friend",
  inviteRowCopied: "Link copied",
  inviteRowSub: (amount) =>
    `+${amount} XP for you both when a friend makes their first trade.`,
  inviteTaps: (taps) =>
    taps === 1
      ? "Your link has been opened once."
      : `Your link has been opened ${taps} times.`,
  friendsTitle: "Friends",
  friendsTally: (joined, traded, taps) =>
    `${joined} joined · ${traded} traded${taps > 0 ? ` · ${taps} link opens` : ""}`,
  xpBankedWord: "earned",
  xpPendingWord: "pending",
  copyNudge: "Copy a message to send",
  nudgeCopiedTitle: "Message copied",
  nudgeCopiedSub: "Send it however you like.",
  nudgeMessage: (amount, link) =>
    `I have a place for you at Berth. Buy US stocks with the stablecoins you already hold, from any network. Your first trade earns us both ${amount} XP: ${link}`,
  ledgerTitle: "Activity",
  ledgerLoading: "Loading…",
  ledgerEmpty: "Nothing yet. Your first trade will show here.",
  ledgerHoldsTitle: "Coming ashore",
  ledgerHoldReason: (name) =>
    name === null ? REWARD_REASONS.held_30_days : `for holding ${name} thirty days`,
  ledgerHoldDue: (date) => `on ${date}`,

  jevCuratedBy: "Live curation by Jev",
  jevCuration: (seen, accounts, read, kept) =>
    `X returned ${seen} posts from ${accounts} accounts this week. Jev read ${read} and kept ${kept}.`,
  jevAbout: "Jev is a model by TypeSafe. It reads each post before it is shown, and keeps the ones that report something.",
  jevAboutHeadlines:
    "Jev is a model by TypeSafe. It reads each headline before it is shown, and keeps the ones mainly about the listing that report something.",
  jevHeadlineCuration: (read, kept) => `Jev read the newest ${read} headlines and kept ${kept}.`,
  jevLinkLabel: "About Jev, by TypeSafe",
  jevVerdictMaterial: "Material news",
  jevVerdictFact: "New fact",
  jevVerdictAnalysis: "Analysis",
  jevVerdictLabel: (verdict) => `Jev reads this as ${verdict.toLowerCase()}`,

  nudgeAddFunds: "Your account is empty. Add funds by card, bank or crypto whenever you are ready.",
  nudgeAddFundsAction: "Add funds",
  nudgeFirstBuy: "Your funds have arrived. Choose any name on the board when you are ready.",
  nudgeHeldNews: (name) => `There is news about ${name} today.`,
  nudgeHeldNewsAction: "Read it",
  nudgeParkCash: "Idle dollars can wait in Cash, a Treasury bill fund, until you need them.",
  nudgeParkCashAction: "Park cash",
  nudgeInvite: "Invites are open to you now. Your link is in your account.",
  nudgeInviteAction: "Open account",
  nudgeDismissLabel: "Dismiss",

  emailNudgeText: "Add an email to keep your account and pick a username.",
  emailNudgeAction: "Add email",
  emailNudgeDismiss: "Not now",

  authorizeTitle: (party) =>
    party.kind === "known"
      ? `${party.name} would like to use your Berth account`
      : party.kind === "loopback"
        ? "An app on this computer would like to use your Berth account"
        : `An app at ${party.host}, not one Berth recognises, would like to use your Berth account`,
  authorizeUnverified: (party) =>
    party.kind === "known"
      ? null
      : party.selfName
        ? `It calls itself “${party.selfName}”. Allow it only if you added it yourself.`
        : "Allow it only if you added it yourself.",
  authorizeSignInLead: (party) =>
    party.kind === "known"
      ? `Sign in to Berth to connect ${party.name}.`
      : party.kind === "loopback"
        ? "Sign in to Berth to connect an app on this computer."
        : `Sign in to Berth to connect an app at ${party.host}.`,
  authorizeCanLead: "If you allow it, it can",
  authorizeScopeRead: "See what you own, your orders, and what the same money would have made in other holdings.",
  authorizeScopeDraft: "Suggest a buy or a sell. Nothing happens until you approve it and sign, here in Berth.",
  authorizeCannot: "It cannot move your money, sign for you, or see your keys. You can disconnect it at any time from your account.",
  authorizeReturnTo: (host) => `Afterwards you go back to ${host}.`,
  authorizeAccount: (who) => `Connecting the account of ${who}.`,
  authorizeApprove: "Allow",
  authorizeDecline: "Decline",
  authorizeReturning: (party) =>
    party.kind === "known"
      ? `Done. Taking you back to ${party.name}.`
      : party.kind === "loopback"
        ? "Done. Taking you back to the app."
        : `Done. Taking you back to ${party.host}.`,
  authorizeFailed: "That did not go through. Please try again.",
  authorizeNeedsWallet: "To allow it, connect the wallet you use for Berth in this window. Berth asks it for a free signature to know it is you.",
  authorizeConnectWallet: "Connect your wallet",
  authorizeExpired: "This request has expired. Start again from your AI.",
  authorizeErrorTitle: "This link cannot be used",
  authorizeErrorUnknownClient: "Berth does not recognise the app that sent you here. Start again from your AI.",
  authorizeErrorRedirect: "The app that sent you here asked to be answered at an address it never registered, so Berth will not send you there.",
  authorizeTroubleTitle: "Berth could not open this request",
  authorizeTroubleBody: "Something went wrong on our side. Nothing was connected. Please try again in a moment.",
  authorizeTryAgain: "Try again",

  assistantTitle: "Bring Berth into your AI",
  assistantBody:
    "Let your AI read your account. It can see what you own, what the same money would have made in other holdings, and what moved today. It can suggest a buy or a sell, and nothing happens until you approve and sign it, here in Berth.",
  assistantClaude: "Claude",
  assistantChatGpt: "ChatGPT",
  assistantGrok: "Grok",
  assistantSheetTitle: (name) => `Connect ${name}`,
  assistantSheetBody: "Berth is added to your AI as a connector. You sign in here once, and can disconnect it whenever you like.",
  assistantSheetConnected: (name) => `${name} is connected to this account.`,
  assistantButtonConnected: (name) => `${name}, connected`,
  assistantPromptsTitle: "Try asking",
  assistantPrompts: [
    "Would my Berth money have done better in Gold or Bitcoin?",
    "What moved on Berth today, and why?",
    "Draft a $20 buy of NVIDIA on Berth.",
  ],
  assistantPromptLabel: (name, prompt) => `Ask ${name}: ${prompt}`,
  assistantPromptHintChatGpt: "Switch Berth on in the chat's + menu first.",
  assistantSetupAgain: "Connect another account",
  assistantAddressLabel: "Berth's address for assistants",
  assistantCopyLabel: "Copy the address",
  assistantCopied: "Address copied",
  assistantStepsClaude: [
    "Open Claude below. The form fills itself in.",
    "Choose Add, then Connect. Sign in to Berth and allow it.",
    "Free plans allow one custom connector.",
  ],
  assistantStepsChatGpt: [
    "Open ChatGPT below and turn on Developer mode. Needs Plus or higher.",
    "Choose Add, then Create MCP App. Name it Berth, paste the address, keep OAuth.",
    "The elevated risk label is ChatGPT's own, on every app it has not reviewed. Tick the box and choose Create.",
    "Sign in to Berth and allow it.",
  ],
  assistantIconDownload: "Berth's icon, for the app form",
  assistantWhy:
    "Use the AI you already have: Claude, ChatGPT or Grok. It reads Berth beside the web, your files and your other tools, so it can research what you own and draft an order you sign here.",
  assistantStepsGrok: [
    "Open Grok below and choose New connector, then Custom. Needs SuperGrok or X Premium+.",
    "Name it Berth and paste the address.",
    "Sign in to Berth and allow it.",
  ],
  assistantOpen: (name) => `Open ${name}`,
  assistantConnectedTitle: "Connected",
  assistantLastUsed: (when) => `Last used ${when}`,
  assistantNeverUsed: "Not used yet",
  assistantDisconnect: "Disconnect",
  assistantDisconnectLabel: (name) => `Disconnect ${name}`,
  assistantDisconnectConfirm: (name) => `Disconnect ${name}?`,
  assistantDisconnected: (name) => `${name} can no longer read your account.`,
  assistantDisconnectFailed: "That did not go through. Please try again.",
  assistantLocalApp: "An app on this computer",

  draftOpenedTitle: "Suggested by your AI",
  draftOpenedBody: "Check the amount and what you pay with. Nothing is sent until you sign.",
  draftUnknownListing: "That suggestion names something Berth does not offer.",
  draftNothingToSell: (name) => `There is no ${name} in your account to sell.`,
  draftCouldNotCheck: (name) => `Berth could not check your ${name} just now. You can sell it from what you own when it shows.`,

  chatOpen: "Assistant",
  chatOpenLabel: "Open the Assistant",
  chatWhy:
    "Quick answers without leaving Berth. It reads your account and today's market, and turns a request like buy $20 of NVIDIA into an order ready to sign.",
  chatTitle: "Assistant",
  chatSub: "About the market and your account.",
  chatModelName: "GPT-6 Luna",
  chatNotAdvice: (model) => `${model} is an AI. It shares facts, not advice. You sign every order.`,
  chatNoCopyKept: "Berth keeps no copy of this chat.",
  chatPlaceholder: "Ask about a stock or your account",
  chatSend: "Send",
  chatStop: "Stop",
  chatClear: "Clear",
  chatEmpty: "Ask about the market or your account.",
  chatTool: {
    list_listings: { doing: "Reading the board", done: "Read the board" },
    get_listing: { doing: "Looking at a listing", done: "Looked at a listing" },
    get_moves: { doing: "Reading what moved", done: "Read what moved" },
    get_market_feed: { doing: "Reading what is being said", done: "Read what is being said" },
    get_account: { doing: "Reading your account", done: "Read your account" },
    get_holdings: { doing: "Reading your holdings", done: "Read your holdings" },
    get_performance: { doing: "Measuring how your money did", done: "Measured how your money did" },
    get_orders: { doing: "Reading your orders", done: "Read your orders" },
    get_my_profile: { doing: "Reading your card", done: "Read your card" },
    get_friends_board: { doing: "Reading your friends board", done: "Read your friends board" },
    draft_order: { doing: "Drafting an order", done: "Drafted an order" },
    list_recurring: { doing: "Reading your recurring buys", done: "Read your recurring buys" },
    draft_recurring: { doing: "Drafting a recurring buy", done: "Drafted a recurring buy" },
  },
  chatToolsFolded: (n) => (n === 1 ? "Read 1 thing" : `Read ${n} things`),
  chatToolFailed: "Could not read that",
  chatDraftLabel: "Draft",
  chatDraftBuy: (name) => `Buy ${name}`,
  chatDraftSell: (name) => `Sell ${name}`,
  chatDraftShares: (quantity) => `${quantity} shares`,
  chatDraftAbout: (usd) => `about ${usd} now`,
  chatDraftNothingYet: "Nothing is placed until you sign.",
  chatDraftOpen: "Open the order",

  limitModeNow: "Now",
  limitModePrice: "Set a price",
  limitBuyAt: "Buy at",
  limitSellAt: "Sell at",
  limitPriceNow: (price) => `Now ${price}`,
  limitUntilCancelled: "Until cancelled",
  limitUntilDate: "Until a date",
  limitDateLabel: "Last day of the order",
  limitPriceLabel: "Price in dollars",
  limitFillsNow: "At this price it may fill right away.",
  limitNeedsDollarsBuy: "To set a price, pay with a dollar coin on an EVM network.",
  limitNeedsDollarsSell: "To set a price, take the money out in a dollar coin.",
  limitCtaEnterPrice: "Enter a price",
  limitCtaPickDate: "Pick a date",
  limitCtaPastDate: "Pick a later date",
  limitCtaTooFar: "Pick a date within a year",
  limitCtaReview: "Review order",
  limitCtaThroughBuy: "Above today's price",
  limitCtaNoPrice: "No live price",
  limitNoPrice: "No live price right now. Try again in a moment.",
  limitCtaThroughSell: "Below today's price",
  limitThroughBuy: "This is above today's price, so it would fill now at your price. Use Now for today's price.",
  limitThroughSell: "This is below today's price, so it would fill now at your price. Use Now for today's price.",
  limitCtaDollarsBuy: "Pay with a dollar coin",
  limitCtaDollarsSell: "Take out a dollar coin",
  limitReviewTitle: "Check your order",
  limitSummaryBuy: (name, price) => `Buy ${name} when it is ${price} or lower.`,
  limitSummarySell: (name, price) => `Sell ${name} when it is ${price} or higher.`,
  limitSummaryPay: (amount) => `You pay ${amount} now.`,
  limitSummaryPut: (amount) => `You set aside ${amount} now.`,
  limitSummaryGet: (amount) => `You get at least ${amount}.`,
  limitSummaryLocked: "It waits in SODAX's contract until it fills or you cancel it.",
  limitSummaryWhole: "It fills whole, never in part.",
  limitSummaryUntilCancelled: "It waits until you cancel it.",
  limitSummaryUntilDate: (day) => `If it has not filled by the end of ${day}, it comes back to you.`,
  limitSummaryFee: (fee) => `Fee ${fee}, plus the network fee.`,
  limitPlace: "Place order",
  limitBack: "Back",
  limitPlacedTitle: "Your order is waiting",
  limitUnsaved: "Your order was placed but Berth hasn't saved it yet. It will appear shortly.",
  limitPlacedBody: (name, price) => `It fills when ${name} reaches ${price}. You can follow it or cancel it under your total.`,
  limitWaitingTitle: "Waiting orders",
  limitWaitingPart: "Waiting",
  limitUnpricedNote: "Some waiting orders have no dollar price right now, so they are not in your total.",
  limitStripLead: (usd) => `${usd} waiting in orders`,
  limitStripItem: (name, price) => `${name} at ${price}`,
  limitStripPartial: (count) => `${count} partly filled`,
  limitListSub: "Each fills when its price is reached, or waits until you cancel it.",
  limitRowBuy: (name) => `Buy ${name}`,
  limitRowSell: (name) => `Sell ${name}`,
  limitRowAtBuy: (price) => `at ${price} or lower`,
  limitRowAtSell: (price) => `at ${price} or higher`,
  limitRowUntil: (day) => `Until ${day}`,
  limitRowUntilCancelled: "Until cancelled",
  limitRowFilled: (percent) => `${percent} filled`,
  limitRowNotFilled: "Not filled yet",
  limitRowSetAside: (amount) => `${amount} set aside`,
  limitRowCancelAsked: "Cancel sent. It clears in a minute or two.",
  limitCancel: "Cancel order",
  limitCancelConfirm: (name) => `Cancel your ${name} order?`,
  limitCancelBodyBuy: "The money goes back to the wallet that paid. One signature.",
  limitCancelBodySell: "Your shares go back to your account. One signature.",
  limitCancelKeep: "Keep it",
  limitCancelling: "Cancelling",
  limitCancelledToast: "Cancel sent",
  limitCancelKept: "Nothing changed. The order still waits.",
  limitCancelFailed: "Could not cancel. The order still waits. Try again.",
  limitCancelNotYours: "This order was not placed from this account.",
  limitFilledBuy: (name) => `Your ${name} order filled.`,
  limitFilledSell: (name) => `Your ${name} sell filled.`,
  limitExpiredToast: (name) => `Your ${name} order expired.`,
  limitRefundBuy: "The money goes back to the wallet that paid.",
  limitRefundSell: "Your shares are back in your account.",
  askSuggestionLimit: "Buy NVIDIA if it drops to $200",
  chatDraftAtBuy: (price) => `at ${price} or lower`,
  chatDraftAtSell: (price) => `at ${price} or higher`,
  chatThinking: "Thinking",
  chatFailed: "That did not go through. Try again.",
  chatRetry: "Try again",
  chatLimitMinute: "One moment. Try again in a minute.",
  chatLimitDay: "That is today's messages. More tomorrow, and more as your rank rises.",
  chatLeft: (n) => (n === 1 ? "1 message left today." : `${n} messages left today.`),
  chatBudget: "The Assistant is resting until the 1st.",
  chatLimitMonth: "You have used this month's share of the Assistant. It opens again on the 1st.",
  chatUnavailable: "The Assistant is not available right now. Everything else in Berth works as usual.",
  chatTooLong: "That message is too long. Try a shorter one.",
  chatLockedTitle: (rankName) => `The Assistant opens at ${rankName}`,
  chatLockedBody: (xp) =>
    `${xp} XP to go. Adding an email to your account or making your first buy gets you there.`,
  recurring: {
    sectionLabel: "Recurring",
    empty: "No recurring buys yet. Nothing is ever bought without your signature.",
    add: "Add a recurring buy",
    whenWeekly: (day) => `every ${day}`,
    whenMonthly: (ordinal) => `on the ${ordinal} of each month`,
    row: (usd, when) => `${usd} ${when}`,
    next: (day) => `Next on ${day}`,
    paused: "Paused",
    asDip: (pct) => `On the dip, ${pct} under`,
    runWords: { due: "ready", opened: "opened", placed: "signed", skipped: "let pass" },
    lastRuns: (list) => `Last: ${list}`,
    pause: "Pause",
    resume: "Resume",
    edit: "Edit",
    remove: "Delete",
    removeConfirm: "Delete this plan and its history?",
    removeConfirmYes: "Delete it",
    removeConfirmNo: "Keep it",
    removed: "Recurring buy deleted.",
    resumeTooMany: "Ten recurring buys can run at once. Pause one to resume this one.",
    sheetTitle: "Recurring buy",
    sheetSub: "Berth reminds you. You sign.",
    listingLabel: "What",
    amountLabel: "Each time",
    weekly: "Weekly",
    monthly: "Monthly",
    dayOfMonth: "Day of the month",
    dipLabel: "Buy on the dip",
    dipSub: (pct) => `Each reminder is a limit buy ${pct} under the price that day.`,
    dipPctLabel: "Under by",
    nothingUntil: "On the day, Berth reminds you in the app and by email. Nothing is bought until you sign, and letting one pass costs nothing.",
    signInToSave: "Sign in to save this plan. What you chose here waits for you.",
    signInToSaveButton: "Sign in to save",
    save: "Save",
    saved: (day) => `Saved. The first reminder is on ${day}.`,
    errors: {
      amount: "Between $1 and $10,000 each time.",
      too_many: "Ten recurring buys is the most an account can have.",
      failed: "That did not save. Try again.",
      day: "Pick a day.",
      listing: "Pick a stock or fund.",
      limit_off: "Buy on the dip is not open on this account.",
      dip: "Between 0.5% and 50% under.",
      time_zone: "Your time zone could not be read. Try again.",
    },
    strip: (lead, name, usd) => `Your ${lead} ${name} buy of ${usd} is ready.`,
    stripLimit: (price) => `At ${price} or lower.`,
    stripUnpriced: "The dip could not be set today, so this is an ordinary buy.",
    linkOpenedTitle: "Your recurring buy, as you planned it",
    linkOpenedBody: "Nothing is bought until you sign. Not this time? Let it pass.",
    stripOpen: "Open it",
    stripSkip: "Skip",
    skipped: (day) => `Skipped. That is fine, the next one is on ${day}.`,
    monthlyLead: "monthly",
    weekdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    ordinal: (day) => {
      const rem100 = day % 100;
      if (rem100 >= 11 && rem100 <= 13) return `${day}th`;
      return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
    },
    dateLocale: "en-GB",
    weekdaysShort: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    makeRecurring: "Make this recurring",
    cardLabel: "Recurring buy",
    cardWeekly: (day) => `Every ${day}`,
    cardMonthly: (ordinal) => `On the ${ordinal} of each month`,
    cardOpen: "Check and save",
    cardNothingYet: "Nothing is saved until you save it, and nothing is bought until you sign.",
    planOpened: "A recurring buy is filled in. Check it and save, or close it.",
  },
  email: {
    openBerth: "Open Berth",
    notYou: "Not you? Write to us at",
    securityWhy: "This is a security notice. Berth sends these to every account with an email, whatever your email settings say.",
    why: {
      orders: "You get this because order emails are on.",
      friends: "You get this because friend emails are on.",
      weekly: "You get this because the weekly summary is on.",
      recurring: "You get this because you set a recurring buy and its reminders are on.",
    },
    unsubscribe: "Turn these off",
    signoff: "Berth. A place to tie up.",
    family: { evm: "An EVM", solana: "A Solana", bitcoin: "A Bitcoin" },
    walletAdded: {
      subject: "A wallet was added to your Berth account",
      heading: "A wallet was added",
      body: (family, address) => `${family} wallet, ${address}, was added to your Berth account. It can now pay for your orders.`,
    },
    walletRemoved: {
      subject: "A wallet was removed from your Berth account",
      heading: "A wallet was removed",
      body: (family, address) =>
        `${family} wallet, ${address}, was removed from your Berth account. Orders it paid for stay in your history.`,
    },
    accountsMerged: {
      subject: "Your Berth accounts were merged",
      heading: "Your accounts are now one",
      body: "Two Berth accounts were merged into this one. Your orders, rewards and wallets are all here now.",
    },
    assistantConnected: {
      unnamed: "An AI app",
      subject: (app) => `${app} was connected to your Berth account`,
      heading: "An AI was connected",
      body: (app) => `${app} was connected to your Berth account. It can:`,
      scopes: {
        read: "See what you own and your orders.",
        draft: "Suggest a buy or a sell, which you check and sign in Berth.",
      },
      after: "It cannot move your money or sign for you. You can disconnect it from your account at any time.",
    },
    orderFilled: {
      subject: (name, side) => `Your ${name} ${side === "buy" ? "buy" : "sell"} order filled`,
      heading: "Your order filled",
      body: (name, side, price) =>
        side === "buy"
          ? `Your limit order to buy ${name} filled at ${price} or less, the price you set.`
          : `Your limit order to sell ${name} filled at ${price} or more, the price you set.`,
      priceLabel: "Your price",
      receivedLabel: "Received",
    },
    orderExpired: {
      subject: (name, side) => `Your ${name} ${side === "buy" ? "buy" : "sell"} order expired`,
      heading: "Your order expired",
      body: (name, side) =>
        side === "buy"
          ? `Your limit order to buy ${name} reached its end date without filling. The money came back to your wallet.`
          : `Your limit order to sell ${name} reached its end date without filling. Your ${name} came back to your account.`,
    },
    friendRequest: {
      subject: (username) => `${username} asked to be your friend on Berth`,
      heading: "A friend request",
      body: (username) => `${username} asked to be your friend on Berth. Open Berth to accept or decline.`,
    },
    recurringDue: {
      subject: (lead, name) => `Your ${lead} ${name} buy is ready to sign`,
      heading: "Your buy is ready",
      body: (lead, usd, name) => `Your ${lead} buy of ${usd} in ${name} is ready. Nothing is bought until you sign.`,
      limitBody: (price) => `It waits for ${price} or lower, the dip you chose.`,
      unpricedBody: "Berth could not set the dip you chose today, so this one is an ordinary buy at the market price. Let it pass if you would rather wait.",
      button: "Open it in Berth",
      after: "Not this time? Let it pass. Nothing happens, and the next one comes as planned.",
    },
    settings: {
      sectionLabel: "Email",
      goesTo: (address) => `Notices go to ${address}.`,
      securityAlways: "Security notices always reach you: a wallet added or removed, accounts merged, an AI connected.",
      kinds: {
        orders: { label: "Orders", sub: "When a limit order fills or expires." },
        friends: { label: "Friends", sub: "When someone asks to be your friend." },
        weekly: { label: "Weekly summary", sub: "Your week against your benchmark." },
        recurring: { label: "Recurring buys", sub: "When a plan's buy is ready to sign." },
      },
      addEmail: "Add an email to get notices",
      addEmailSub: "Security and order notices, by mail.",
      undeliverable: "Mail to this address did not arrive, so Berth stopped sending. Write to us to start again.",
      saveFailed: "That did not save. Try again.",
    },
    unsubscribePage: {
      title: "Email settings",
      kindName: { orders: "order", friends: "friend", weekly: "weekly summary", recurring: "recurring buy" },
      confirm: (kind) => `Turn off ${kind} emails?`,
      confirmSub: "Security notices still reach you whatever you choose here.",
      confirmButton: "Turn off",
      done: (kind) => `${kind.charAt(0).toUpperCase()}${kind.slice(1)} emails are off.`,
      doneSub: "Security notices still reach you. You can turn this back on here or in Berth's settings.",
      turnBackOn: "Turn back on",
      backOn: (kind) => `${kind.charAt(0).toUpperCase()}${kind.slice(1)} emails are on again.`,
      invalid: "This link no longer works. You can change your email settings in Berth.",
      backHome: "Go to Berth",
    },
  },
  privacyLink: "Privacy",
  privacyPolicy: {
    title: "Privacy policy",
    status: "Effective 30 September 2026.",
    intro: [
      "This policy explains what Berth collects when you use www.berthmarkets.com and the Berth connector for your AI, why, who else sees it, how long we keep it, and what you can ask of us.",
      "Berth is self custodial. We never hold your keys and we never hold your money.",
    ],
    sections: [
      {
        id: "who-we-are",
        heading: "Who we are",
        body: [
          `Berth is operated by ${PRIVACY_OPERATOR.name}, established in ${PRIVACY_OPERATOR.country} ("we" or "us"). We are the controller of the personal data described here.`,
          `For any question or request about this policy, write to ${PRIVACY_OPERATOR.email}. This includes requests from the European Union and the United Kingdom.`,
        ],
      },
      {
        id: "what-we-collect",
        heading: "What we collect and why",
        body: ["We keep only what the app needs to work. This is all of it."],
        list: [
          "Your sign in. If you sign in with email, our sign in provider Privy checks the address and gives us an account identifier. We store that identifier and your email address. If you sign in with a wallet, we store its public address, after you sign a free message that proves the wallet is yours.",
          "Your account. The avatar you pick, your XP and rank, the rewards you earned and when, your invite code, and who invited you, if anyone.",
          "Your orders. For each order: buy or sell, which listing, the quantity, what you paid with and on which network, the fee, the value in dollars, the transaction identifiers, the delivery address, and the time. We also keep the price of each comparison fund at the minute of the order, so your results can be drawn beside it.",
          "Your recurring buys. For each plan you set: the listing, the dollar amount, weekly or monthly and on which day, your browser's time zone so the day begins at your own midnight, and, if you chose it, how far under the price to wait. For each time a plan comes due: when it was due, whether you opened it, signed it or let it pass, the order that answered it, and whether its reminder went out.",
          "Your daily value. Once a day, after the New York close, we read your balances from the blockchain and keep that day's holdings and value, so your history can be drawn.",
          "Invite links. When someone opens an invite link, we count the visit against the invite code. We do not record who opened it.",
          "Your AI. If you connect Claude, ChatGPT, Grok or another AI, we keep which app you approved, what it may do, and when you approved, used and disconnected it. Its access tokens are stored only in hashed form. For each request it makes, we log which tool it used, whether it worked and how long it took. We never store what your AI asked or what Berth answered.",
          "Error reports. When an order fails or does not settle, the app sends a report so we can fix the cause: the step it stopped at, the networks, the token and amount, the transaction hashes, a shortened form of your address, the error text, recent app logs, the page address, your screen size and your browser's user agent. Keys and tokens are removed first, and it never includes your email address.",
          "Usage statistics. We count page views with Vercel Web Analytics, which uses no cookies.",
          "Emails we send. For each notice: its type, what it was about (an order, a connection), whether it was sent, and the email provider's message identifier. Never the email's text: while a notice waits to be sent again, we keep only what it will name (such as a listing, a price or a shortened wallet address), and delete that once it is sent. Your choices of which emails to get, and whether mail to your address bounced or was reported as spam.",
        ],
        after: [
          "We use this to run your account, show what you own and how it has done, check an order before a reward is paid for it, pay invite rewards, keep the service secure, limit abuse, and fix what breaks.",
          "We do not sell personal data. We do not use it for advertising, and we do not build profiles of you for anyone else.",
          "Where the law asks for a legal basis: running your account and your orders is necessary to provide the service you asked for. Security, abuse limits, error reports and usage statistics rest on our legitimate interest in a service that works and is safe. For anything else, we will ask you first.",
        ],
      },
      {
        id: "never-collect",
        heading: "What we never collect",
        body: [
          "We never see or store your seed phrase or private keys. If you sign in with a wallet, the keys stay in your wallet. If you sign in with email, your wallet is created and secured by Privy, and you can export its keys at any time. Berth cannot sign for you and cannot move your money.",
          "We do not collect identity documents, bank details or card numbers. If you add funds by card inside Berth, the purchase is handled by the provider shown on that screen, under its own terms and privacy policy, and we do not receive your card details.",
        ],
      },
      {
        id: "onchain",
        heading: "The blockchain is public",
        body: [
          "Orders settle on public blockchains. Your addresses, balances and transactions can be seen by anyone, permanently. No one controls that record, and no one, including us, can change or delete it.",
        ],
      },
      {
        id: "assistants",
        heading: "Your AI and the Berth connector",
        body: [
          "You can connect Claude, ChatGPT or Grok to your Berth account through Berth's connector at www.berthmarkets.com/mcp. Nothing is shared until you approve the connection on Berth's own consent screen, signed in to your account.",
          "Once approved, your AI can do two things.",
        ],
        list: [
          "Read. Your holdings, orders, results against a benchmark, rank and XP, account addresses, and the public board: listings, prices, what moved and the news.",
          "Draft. Prepare a buy or a sell as a link. The link opens Berth with the order filled in, and nothing happens unless you check it and sign it yourself. It can also draft a recurring buy, which is saved only if you save it in Berth, and even then only reminds you.",
        ],
        after: [
          "Your AI never holds your keys, never signs and never moves money. It is not given your email address.",
          "What your AI does with Berth's answers is governed by its provider's own terms and privacy policy: Anthropic for Claude, OpenAI for ChatGPT, xAI for Grok. Those answers may be kept in your chat history with that provider.",
          "To disconnect, open the account drawer in Berth, go to Bring Berth into your AI, and choose Disconnect. Access ends straight away. You can also remove the connector in your AI's own settings.",
        ],
      },
      {
        id: "assistant-chat",
        heading: "The Assistant in Berth",
        body: [
          "If you use the Assistant, Berth's own chat, your messages, and the account details needed to answer them, are sent to OpenAI to generate the replies. Berth does not store the content of the chat. We keep only the number of tokens each reply used and what it cost. OpenAI handles the messages under its API data policy.",
        ],
      },
      {
        id: "profiles",
        heading: "Your profile and friends",
        body: [
          "A profile exists only if you pick a username, and you can hide it at any time. Anyone who knows your username can see your face, rank, XP, the month you joined and how many Salutes you have. Never your email, your wallets, your money or what you own.",
          "We keep who you salute, your friend requests and friends, who you block and any report you make, with a record of each change for moderation. Nobody else can see your friends or who you block. The record of changes is kept for a year.",
        ],
      },
      {
        id: "email",
        heading: "Email from Berth",
        body: [
          "If your account has a verified email address, Berth sends it short notices about your account. We send no marketing.",
        ],
        list: [
          "Security notices: a wallet added to or removed from your account, two accounts merged, an AI connected. These always go out, because they are how you would learn that someone else is using your account. They never ask you for a code or a password.",
          "Order notices: a limit order filled, or expired and the money came back. On unless you turn them off.",
          "Friend notices: someone asked to be your friend, at most one email a day. On unless you turn them off.",
          "Recurring buy reminders: on the day a plan you set comes due, one email for that plan, with a link that opens the buy for you to sign or let pass. On unless you turn them off.",
        ],
        after: [
          "We do not track whether you open an email or click its links. Every notice other than a security notice has a link to turn that kind off, and you can change them all under Email in the app's settings. If mail to your address bounces or is reported as spam, we stop sending to it.",
        ],
      },
      {
        id: "sharing",
        heading: "Who we share it with",
        body: ["We share personal data only with the services that run Berth, each for its own part."],
        list: [
          "Privy, for email sign in and the wallets it creates for email accounts. Privy receives your email address and secures your wallet's keys.",
          "Neon, which hosts our database.",
          "Vercel, which hosts the app, serves every request and counts page views. Like any web host, it processes your IP address and browser details to do so.",
          "SODAX, whose service, solvers and relayers price, route and fill your orders. They receive the addresses, amounts and transactions needed to fill them.",
          "Blockchain networks. Your browser reads balances and sends transactions through public network nodes. A Bitcoin order links to mempool.space so you can follow it there.",
          "GitHub, where error reports are kept in a private repository.",
          "OpenAI, if you use the Assistant in Berth, as described above.",
          "Resend, which delivers our emails. It receives your email address, the notice's content (such as a listing's name, an amount, a price, or a friend's username) and whether the email was delivered, bounced or reported as spam.",
          "TypeSafe, whose Jev model helps choose the one line shown at the top of the app, such as news about something you own. It receives which listings your account holds and whether it has cash to spend, never your name, email or address.",
          "Price and news sources: DefiLlama, the Federal Reserve Bank of St. Louis, Frankfurter, Nasdaq and X. They supply prices, rates and the market feed and receive no personal data from us. Posts from X show their authors' pictures, which your browser loads from X.",
        ],
        after: [
          "We disclose personal data to authorities only when the law requires it.",
          "Some of these providers process data outside your country, including in the United States. Where the law requires it, we rely on appropriate safeguards, such as standard contractual clauses.",
        ],
      },
      {
        id: "storage",
        heading: "Cookies and local storage",
        body: [
          "Berth sets no advertising or tracking cookies. The app keeps a few things in your browser's local storage so it remembers your choices:",
        ],
        list: [
          "your appearance and currency, and the comparison and time range you last picked;",
          "whether your account holds any stocks, so the home screen opens in the right order;",
          "which suggestions you dismissed;",
          "an invite code you arrived with, until your account is created;",
          "a signed session token when you sign in with a wallet, valid for seven days.",
        ],
        after: [
          "When you sign in with email, Privy keeps its own sign in session in your browser. Clearing this site's data in your browser removes all of it.",
        ],
      },
      {
        id: "retention",
        heading: "How long we keep it",
        body: [],
        list: [
          "Your account, rewards, orders, daily values and the AI apps you approved: for as long as your account is active, and after that as long as needed for legal, accounting and security purposes.",
          "Sign in codes for your AI: they expire after 90 seconds and are deleted within the hour.",
          "Your AI's access tokens last an hour and refresh tokens thirty days. Both are deleted a week after they expire or are revoked.",
          "The log of requests from your AI: 90 days.",
          "Abuse limit counters: one day. They hold a hashed form of the caller's IP address, never the address itself.",
          "Your recurring plans and the record of each time one came due: until you delete the plan, or your account. Deleting a plan deletes its record with it.",
          "Invite link visits and error reports: up to 12 months.",
          "The record of profile and friend changes: 12 months.",
          "The record of emails sent: 12 months. A block on an address that bounced or reported spam: as long as the account exists, so the block holds.",
        ],
      },
      {
        id: "rights",
        heading: "Your choices and rights",
        body: [
          "You can disconnect your AI at any time, sign out, and clear the app's storage in your browser.",
          `You can ask for a copy of the personal data we hold about you, ask us to correct it, or ask us to delete your account. Write to ${PRIVACY_OPERATOR.email} from the email address on your account, or with proof that you control the wallet. We answer within 30 days.`,
          "When we delete an account, we delete or anonymise its data within 30 days, except what the law requires us to keep. Records on a blockchain are public and permanent, and no one can delete them. Your money stays in your own wallet either way.",
          "Depending on where you live, including the European Economic Area and the United Kingdom, you may also have the right to object to or restrict how we use your data, to receive it in a portable form, and to complain to a data protection authority. Our lead supervisory authority is the Dutch Data Protection Authority, the Autoriteit Persoonsgegevens. You may also complain to the authority where you live.",
        ],
      },
      {
        id: "security",
        heading: "Security",
        body: [
          "Connections to Berth are encrypted. Every secret we issue, such as your AI's tokens, is stored only as a one way hash. Your AI's access is limited to what you approved and ends when you disconnect it, and a refresh token used twice ends the whole connection.",
          "No system is perfectly secure. If a breach affects your data, we will tell you as the law requires.",
        ],
      },
      {
        id: "children",
        heading: "Age",
        body: [
          "Berth is a trading product for adults. You must be 18 or older to use it. We do not knowingly collect data from anyone younger, and if you believe a minor has an account, write to us and we will delete it.",
        ],
      },
      {
        id: "law",
        heading: "Governing law",
        body: [
          `This policy is governed by the laws of ${PRIVACY_OPERATOR.country}, without taking away any protection the law where you live gives you.`,
        ],
      },
      {
        id: "changes",
        heading: "Changes to this policy",
        body: [
          "When this policy changes, we update the effective date at the top. For a change that matters, we will say so in the app before it applies.",
        ],
      },
      {
        id: "contact",
        heading: "Contact",
        body: [`${PRIVACY_OPERATOR.name}, established in ${PRIVACY_OPERATOR.country}. Email ${PRIVACY_OPERATOR.email}.`],
      },
    ],
    backHome: "Back to Berth",
  },
  termsLink: "Terms",
  termsOfUse: {
    title: "Terms of use",
    status: "Effective 28 September 2026.",
    intro: [
      "These terms apply when you use www.berthmarkets.com, the Berth app and the Berth connector for your AI. By using Berth you agree to them. If you do not agree, please do not use Berth.",
      "Berth is software. It never holds your keys or your money, and it does not give investment advice.",
    ],
    sections: [
      {
        id: "who-we-are",
        heading: "Who we are",
        body: [
          `Berth is operated by ${PRIVACY_OPERATOR.name}, established in ${PRIVACY_OPERATOR.country} ("we" or "us"). You can reach us at ${PRIVACY_OPERATOR.email}.`,
        ],
      },
      {
        id: "what-berth-is",
        heading: "What Berth is",
        body: ["Berth is software that helps you buy and sell tokenised stocks and funds with money you already hold in your own wallet."],
        list: [
          "Berth is self custodial. Your wallet and its keys are yours. We never hold your keys or your funds, and we cannot move them.",
          "You sign every order yourself, in your own wallet. Nothing is bought or sold unless you sign it.",
          "Orders are filled by independent solvers through SODAX, a protocol run by others. We do not fill orders ourselves.",
          "A tokenised stock or fund is a token that tracks the price of a share or a fund. It is issued by a third party under its own terms. It is not the share itself, and holding one does not make you a shareholder of the company.",
        ],
      },
      {
        id: "no-advice",
        heading: "No investment advice",
        body: [
          "Nothing in Berth is investment, financial, legal or tax advice, or a recommendation to buy or sell anything. Prices, history, comparisons, market posts and headlines are facts and reports, shown as they are.",
          "The same holds for AI apps. When you connect Claude, ChatGPT, Grok or another AI, or use the Assistant inside Berth, what it tells you is information, not advice. Your AI can only read your account and draft an order as a link. It cannot place, sign or send an order. You decide, and you sign.",
          "Past performance tells nothing certain about the future. Make your own decisions, and ask a qualified adviser if you need one.",
        ],
      },
      {
        id: "risks",
        heading: "Risks",
        body: ["Buying and holding tokens carries real risk. You can lose some or all of what you put in."],
        list: [
          "Prices move, sometimes quickly, including outside market hours. A token can lose value, trade at a price different from the share it tracks, or stop trading.",
          "Blockchain transactions are final. An order you sign, or funds sent to a wrong address, cannot be reversed by us or by anyone else.",
          "Networks can be slow, congested or down, and what they charge can change.",
          "The issuer of a token, the solvers, SODAX, a blockchain, a wallet or another service Berth relies on can fail, pause, change its terms or be attacked.",
          "Rules about tokens differ from country to country and can change.",
        ],
        after: ["You are responsible for keeping your wallet, your sign in and your recovery details safe."],
      },
      {
        id: "fees",
        heading: "Fees",
        body: [
          "Berth charges a fee on orders. The fee, and what you will receive, are shown before you sign. Networks, solvers and card providers may charge their own fees, shown where they are known.",
        ],
      },
      {
        id: "eligibility",
        heading: "Who may use Berth",
        body: [],
        list: [
          "You must be 18 or older, and able to enter a binding agreement where you live.",
          `Berth is not offered in ${orList(TERMS_AVAILABILITY.excluded)}. You may not use it if you live there or are there when you use it.`,
          "You may not use Berth where the law that applies to you prohibits it, if you are subject to sanctions, or from a country or region under sanctions.",
          "You are responsible for knowing and following the laws that apply to you, including tax rules.",
        ],
      },
      {
        id: "acceptable-use",
        heading: "Using Berth fairly",
        body: ["Please do not:"],
        list: [
          "Break the law with Berth, or use it to launder money or to fund anything unlawful.",
          "Try to reach accounts, data or systems that are not yours, or get around a limit or a safeguard.",
          "Overload, disrupt or reverse engineer Berth, or copy it at a volume that harms it.",
          "Pretend to be someone else, or use Berth for someone who may not use it.",
        ],
        after: ["We may limit or end access for anyone who does, and we may refuse or pause service where the law requires it."],
      },
      {
        id: "assistants",
        heading: "Your AI and other services",
        body: [
          "Berth's connector lets the AI you choose read your account and draft orders as links, within what you approve when you connect it. You can disconnect it at any time, in Berth or in your AI.",
          "AI apps such as Claude, ChatGPT and Grok, wallets, sign in and card providers, SODAX and token issuers are run by others. Their own terms and privacy policies apply to your use of them, and we are not responsible for what they do or say.",
          "What we keep about requests from your AI is set out in our privacy policy.",
        ],
      },
      {
        id: "availability",
        heading: "Availability",
        body: [
          "We work to keep Berth running, but it may at times be unavailable, slow or wrong, and we may change, pause or stop parts of it. Your tokens stay in your own wallet whatever happens to Berth.",
        ],
      },
      {
        id: "liability",
        heading: "Liability",
        body: [
          "Berth is provided as it is and as available. To the extent the law allows, we do not promise that it is free of errors, or that prices, data and third party content are accurate or complete.",
          "To the extent the law allows, we are not liable for losses from price changes, from your own decisions, from transactions you signed, or from the failure of any third party, network or token. Where we are liable, our liability is limited to the fees you paid Berth in the twelve months before the claim.",
          "Nothing in these terms limits liability that the law does not allow to be limited, or takes away your rights as a consumer.",
        ],
      },
      {
        id: "law",
        heading: "Governing law",
        body: [
          `These terms are governed by the laws of ${PRIVACY_OPERATOR.country}, and disputes go to the competent courts of ${PRIVACY_OPERATOR.country}. If you are a consumer, this does not take away the protection the law where you live gives you, or your right to go to the courts there.`,
        ],
      },
      {
        id: "changes",
        heading: "Changes to these terms",
        body: [
          "When these terms change, we update the effective date at the top. For a change that matters, we will say so in the app before it applies. Using Berth after that means you accept the new terms.",
        ],
      },
      {
        id: "contact",
        heading: "Contact",
        body: [`${PRIVACY_OPERATOR.name}, established in ${PRIVACY_OPERATOR.country}. Email ${PRIVACY_OPERATOR.email}.`],
      },
    ],
    backHome: "Back to Berth",
  },
  assistantsLink: "How your AI works with Berth",
  assistantsHelp: {
    title: "Bring Berth into your AI",
    intro: [
      "Claude, ChatGPT and Grok can connect to your Berth account. Once connected, you can ask about what you own and the market in plain words, and have an order drafted for you to check and sign in Berth.",
      "Your AI reads and drafts. You sign.",
    ],
    connectHeading: "Connect your AI",
    connectBody:
      "Claude, ChatGPT and Grok each add Berth as a connector. You sign in to Berth once and choose what it may do: read your account, draft orders, or both. Signed in to Berth, you can also start from Bring Berth into your AI in your account.",
    canHeading: "What your AI can do",
    can: [
      "See what you own, what it is worth now, and how it has done over a week, a month, three months or since your first buy.",
      "Compare your money with the same dollars in the S&P 500 fund, the Nasdaq 100 fund, Gold, Bitcoin or Treasury bills.",
      "Read your past orders, what moved on the last trading day, and what companies and the press have been saying, with links.",
      "Read your own card and friends board. Never anyone else's.",
      "Draft a buy or a sell, if you allowed it. A draft is a link to Berth's order screen with the listing and amount filled in.",
    ],
    cannotHeading: "What it cannot do",
    cannot: [
      "Place, sign or send an order. A draft only becomes an order if you open the link, check it and sign in Berth.",
      "Hold your keys or move your money. Nothing on Berth's side can.",
      "See anything you did not allow when you connected it.",
      "Give advice. It reports prices, history and what was said. The decision is yours.",
    ],
    disconnectHeading: "Disconnect",
    disconnect: [
      "In Berth, open your account and choose Disconnect beside it under Bring Berth into your AI. It stops working at once.",
      "You can also remove Berth in your AI's own connector settings.",
    ],
    moreHeading: "Privacy and terms",
    more: [
      "Berth keeps a short record of which tools your AI called, never what you asked or what it answered.",
      "Your AI itself is run by its own company, under its own terms and privacy policy.",
    ],
    support: `Questions or trouble connecting? Write to ${PRIVACY_OPERATOR.email}.`,
    backHome: "Back to Berth",
  },
  accountWalletsTitle: "Wallets",
  accountWalletsSub: "Each wallet stays the key to its own money. Your totals add them up.",
  walletsHomeTag: "Home",
  walletsHomeNote: "Your main wallet. A buy lands in the wallet you sign in with.",
  walletsPayFromNote: "Pays for orders. Its holdings count.",
  walletsNetworkEvm: "Ethereum and similar networks",
  walletsAdd: "Add a wallet",
  walletsAddHint: "Another Ethereum account? Switch to it in your extension.",
  walletsAddHintEmail: "Connect the other wallet in this browser. Berth will ask to add it.",
  walletsMakeHome: "Make home",
  walletsRemove: "Remove",
  walletsCancel: "Cancel",
  walletsMakeHomeConfirm: (short) => `Make ${short} your home? Nothing you hold moves.`,
  walletsRemoveConfirm: (short) => `Remove ${short}? Its orders stay in your history.`,
  walletsRemoveHolds: "This wallet still holds stocks in Berth. Sell them or move them home first.",
  walletsRemoveHomeFirst: "This is your home. Make another wallet home first.",
  walletsRemoveSignedIn: "You are signed in with this wallet. Switch to another to remove it.",
  walletsSignToConfirm: "Sign to confirm",
  walletsNeedHomeSigner: (short) => `Switch to your home wallet, ${short}, to confirm.`,
  walletsLinkedToast: "Wallet added.",
  walletsHomeToast: "Home changed.",
  walletsRemovedToast: "Wallet removed.",
  walletsOtherAccount: "This wallet belongs to another Berth account.",
  walletsCooling: "This wallet left another account recently. Try again in a week.",
  walletsFailed: "That did not go through. Try again.",
  walletsDeclined: "No signature, so nothing changed.",
  walletNotLinkedPrompt: "This wallet isn't part of your account. Add it?",
  walletNotLinkedAdd: "Add it",
  walletNotLinkedDismiss: "Not now",
  signedInAsWallet: (short) => `Signed in as ${short}`,
  connectedWallet: (short) => `Connected ${short}`,
  signInWithWallet: (short) => `Sign in with ${short}`,
  addToThisAccount: "Add to this account",
  walletsConfirmWithHome: (short) => `Confirm with your home wallet ${short}. Switch to it in your extension.`,
  walletsHomeMissing: (short) => `Your home wallet, ${short}, was not connected, so nothing changed.`,
  walletsSlowDown: "Too many tries. Wait a little and try again.",
  walletsSignInAgain: "To add a wallet, sign in with your email again.",
  walletsSignInAgainAction: "Sign in again",
  walletsAddListSub: "What your wallet extensions have open now, by network.",
  walletsAdded: "Added",
  walletsAddOne: "Add",
  walletsBelongsElsewhere: "Belongs to another account",
  walletsCoolingShort: "It can be added again 7 days after it was removed.",
  walletsComingSoon: "Coming soon",
  walletsComingSoonList: (names) => `Coming soon: ${names}.`,
  walletsConnectNetwork: (name) => `Connect ${name}`,
  walletsNetworkSolana: "Solana",
  walletsSolanaNote: "Pays for orders. What you buy lands in the wallet you sign in with.",
  walletsNetworkBitcoin: "Bitcoin",
  walletsBitcoinNote: "Pays for orders. What you buy lands in the wallet you sign in with.",
  sellUpToFromWallet: (amount) => `You can sell up to ${amount} from this wallet.`,
  walletLinkStatement: "Add this wallet to your Berth account. Signing is free and moves nothing.",
  walletLinkConfirmStatement: (short) => `Let ${short} join your Berth account. Signing is free and moves nothing.`,
  walletHomeStatement: (short) => `Make ${short} the home of your Berth account. Signing is free and moves nothing.`,
  walletRemoveStatement: (short) => `Remove ${short} from your Berth account. Signing is free and moves nothing.`,
  walletMergeStatement: (short) => `Make the Berth account of ${short} one with your email's account. Signing is free and moves nothing.`,
  ctaAddWalletFirst: "Add this wallet to your account first",
  ctaSellSwitchWallet: (short) => `Switch to ${short} to sell from it`,
  ctaSellSignInEmail: "Sign in with your email to sell these",
  sellFromLabel: "Sell from",
  sellFromHomeTag: "Home",
  social: {
    sectionTitle: "Your profile",
    sectionWhy:
      "Only people who know your username can open your profile. It shows your face, rank, XP and Salutes, never money or what you own.",
    addEmail: "Add an email to get a profile",
    addEmailSub: "A profile needs a verified email.",
    pickTitle: "Pick a username",
    pickSub: "Until you do, nobody can find you.",
    pickPlaceholder: "username",
    pickRules: "3 to 20 letters, numbers or _. People who know it can open your profile.",
    pickSave: "Save",
    pickChecking: "Checking",
    pickFree: "Available",
    refusal: (reason, nextChange) =>
      ({
        short: "At least 3 characters.",
        long: "At most 20 characters.",
        charset: "Letters, numbers and _ only.",
        edge: "No _ at the start or end.",
        offensive: "Pick another name.",
        taken: "That name isn't available.",
        cooldown: nextChange ? `You can change it again on ${nextChange}.` : "You changed it recently.",
        noEmail: "Add an email first.",
      })[reason],
    saved: (handle) => `Your username is ${handle}.`,
    saveFailed: "That did not save. Try again.",
    view: "View",
    change: "Change",
    cancel: "Cancel",
    hide: "Hide my profile",
    hideSub: "While hidden, your username finds no one.",
    hiddenNote: "Hidden. Only you can see this.",
    friends: "Friends",
    friendsNone: "No friends yet.",
    requestsTitle: "Wants to be friends",
    sentLabel: "Sent",
    accept: "Accept",
    decline: "Decline",
    shareLink: "Share your friend link",
    shareLinkSub: "Anyone with it can ask to be friends.",
    shareLinkText: (handle) => `Be my friend on Berth. I am ${handle}.`,
    linkCopied: "Link copied",
    newLink: "New link",
    newLinkDone: "The old link no longer works.",
    boardRow: "Friends board",
    boardRowSub: "You and your friends, this month.",
    blocked: "Blocked",
    unblock: "Unblock",
    memberSince: (month) => `Since ${month}`,
    xpLabel: "XP",
    salutesLabel: "Salutes",
    sinceLabel: "Member since",
    salute: "Salute",
    saluted: "Saluted",
    saluteUndoLabel: (handle) => `Take back your Salute to ${handle}`,
    saluteNeedsEmail: "Add an email to salute or add friends.",
    relation: {
      none: "Add friend",
      sent: "Request sent",
      received: "Wants to be friends",
      friends: "Friends",
    },
    addFriend: "Add friend",
    cancelRequest: "Cancel request",
    removeFriend: "Remove",
    removeConfirm: "Tap again to remove",
    needHandle: "Pick a username to add friends.",
    youAreFriends: (handle) => `You and ${handle} are friends.`,
    requestSent: "Request sent.",
    selfNote: "This is you.",
    signInLine: "Sign in to see this profile.",
    signIn: "Sign in",
    notFound: "No one by that name.",
    notFoundSub: "Usernames are exact. Ask them for their link.",
    findTitle: "Find a friend",
    findSub: "Type their exact username.",
    findLabel: "Their username",
    findButton: "Find",
    findSlow: "That is a lot of looking for one hour. Try again later.",
    back: "Back to Berth",
    moreLabel: "More",
    block: "Block",
    blockConfirm: (handle) => `Block ${handle}? They will not be told.`,
    blockDone: "Blocked.",
    report: "Report",
    reportReasons: {
      name: "Offensive name",
      impersonation: "Pretends to be someone",
      other: "Something else",
    },
    reportDone: "Thank you. We will look at it.",
    actionFailed: "That did not go through. Try again.",
    boardTitle: "Friends board",
    boardMonth: (month) => `Friends board, ${month}`,
    boardWhy:
      "Points come from what you do in Berth this month, not what you earn. Orders count up to 300, invites up to 250, Salutes up to 10. Money and returns never count.",
    boardPointsUnit: (points) => (points === 1 ? "point" : "points"),
    boardYou: "You",
    boardEmpty: "Add friends and they appear here.",
    boardNoHandle: "Pick a username in your account to have friends.",
    boardSignedOut: "Sign in to see your friends board.",
  },
};
