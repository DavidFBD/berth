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
import { REWARD_REASONS } from "@/lib/xp";
import type { ConsentParty } from "@/lib/assistant-party";

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

  /* — account total: funds plus holdings plus cash, one figure — */
  accountTotalLabel: string;
  accountTotalSub: string;

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
   * The posts tab's credit line. Jev (TypeSafe's model) reads every post
   * before it is shown, and saying so is the point: the column is chosen,
   * not scraped. The counts are real, from this refresh; see x-column.
   */
  jevCuratedBy: string;
  jevCuration: (seen: string, accounts: string, read: string, kept: string) => string;
  /** What Jev is, first line of the (i). */
  jevAbout: string;
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

  /* — settings — */
  settingsTitle: string;
  settingsSub: string;
  appearanceSectionLabel: string;
  appearanceSystem: string;
  appearanceLight: string;
  appearanceDark: string;
  currencySectionLabel: string;

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
  /** The honest ending: that address is somebody else's account already. */
  addEmailTaken: string;
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
  assistantAddressLabel: string;
  assistantCopyLabel: string;
  assistantCopied: string;
  assistantStepsClaude: readonly string[];
  assistantStepsChatGpt: readonly string[];
  assistantStepsGrok: readonly string[];
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
};

/** "first day", "1 market day", "4 market days". */
function marketDays(days: number): string {
  if (days <= 0) return "first day";
  return days === 1 ? "1 market day" : `${days} market days`;
}

export const COPY: Copy = {
  brand: "Berth",
  tagline: "A place to tie up.",
  welcomeLede:
    "Buy US stocks and funds with the stablecoins or Bitcoin you already hold, from any network, in your own custody. Cash waits in Treasury bills. You are told what you own before you buy.",
  signInEmail: "Continue with email",
  connectWallet: "Connect a wallet",
  noSeedPhrases: "An email is enough. The keys are yours, held in your account, and you can export them at any time.",
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

  accountTotalLabel: "Your account",
  accountTotalSub: "Funds, holdings and cash, in one figure.",

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
      `Your balance and your orders here do not agree, so ${name} cannot be set beside it.`,
  },
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
  postsHint:
    "What the companies and the market desks are posting on X. Tapping one opens the post. The list refreshes every hour, and the posts you have not seen yet are marked New.",
  postsEmpty: "The accounts we follow have been quiet.",
  postsEmptyFor: (name) => `Nothing about ${name} on X right now.`,
  postsHandle: (handle) => `@${handle},`,
  postNewToYou: "New",
  postNewToYouLabel: "You have not seen this post here before",
  postsSourceLabel: "Posted on X",
  postsMetrics: (replies, reposts, likes) =>
    `${replies} replies, ${reposts} reposts, ${likes} likes`,

  cashTitle: "Cash",
  cashHint: "Idle dollars sit in a token tracking a fund of short Treasury bills, not in a lending pool.",
  cashYieldLine: (rate) =>
    `The 3 month Treasury bill rate is ${rate}. What you earn is the fund's return after its costs, and it moves with that rate.`,
  cashEmpty: "Nothing parked yet",
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

  exportKeysTitle: "Take your keys",
  exportKeysSub:
    "Export a private key and move your funds with any wallet. Privy shows it in its own window, so the app never sees it.",
  exportEvmLabel: "EVM key",
  exportSolanaLabel: "Solana key",

  settingsTitle: "Settings",
  settingsSub: "How the app looks, and which currency it speaks.",
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
  walletAccountDrawerSub: "Your rank, rewards and avatar, and the assistant you connect to Berth.",
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
    unlock.kind === "invite"
      ? "Unlocks your own invite link."
      : `Unlocks the ${unlock.face} face.`,
  unlockDone: (unlock) =>
    unlock.kind === "invite"
      ? "Your own invite link is open to you."
      : `The ${unlock.face} face is yours to wear.`,
  levelUpTitle: (rankName) => `You reached ${rankName}`,
  levelUpLine: (level, total, reason) =>
    `Level ${level} · +${total.toLocaleString()} XP${reason ? ` ${reason}` : ""}`,
  levelUpUnlock: (unlock) =>
    unlock.kind === "invite"
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
  addEmailTaken:
    "That email already belongs to another account. Try a different one.",
  addEmailFailed: "That did not go through. Try again.",
  addEmailSaving: "Saving it to your account.",
  addEmailCodeWrong: "That code did not work. Check it, or send a new one.",
  addEmailResend: "Send a new code",
  addEmailResent: "A new code is on its way.",
  addEmailSaveFailed: "Your email was added, but saving it here did not go through.",
  addEmailRetrySave: "Try again",
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
  authorizeScopeRead: "See what you own, your orders, and how your money compares with the S&P 500 fund.",
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
  authorizeExpired: "This request has expired. Start again from your assistant.",
  authorizeErrorTitle: "This link cannot be used",
  authorizeErrorUnknownClient: "Berth does not recognise the app that sent you here. Start again from your assistant.",
  authorizeErrorRedirect: "The app that sent you here asked to be answered at an address it never registered, so Berth will not send you there.",
  authorizeTroubleTitle: "Berth could not open this request",
  authorizeTroubleBody: "Something went wrong on our side. Nothing was connected. Please try again in a moment.",
  authorizeTryAgain: "Try again",

  assistantTitle: "Your assistant",
  assistantBody:
    "Let your assistant read your account. It can see what you own, how it compares with the S&P 500 fund, and what moved today. It can suggest a buy or a sell, and nothing happens until you approve and sign it, here in Berth.",
  assistantClaude: "Claude",
  assistantChatGpt: "ChatGPT",
  assistantGrok: "Grok",
  assistantSheetTitle: (name) => `Connect ${name}`,
  assistantSheetBody: "Berth is added to your assistant as a connector. You sign in here once, and can disconnect it whenever you like.",
  assistantSheetConnected: (name) => `${name} is connected to this account. The steps below connect it again, for example on another ${name} account.`,
  assistantButtonConnected: (name) => `${name}, connected`,
  assistantAddressLabel: "Berth's address for assistants",
  assistantCopyLabel: "Copy the address",
  assistantCopied: "Address copied",
  assistantStepsClaude: [
    "Open Claude with the button below. It goes straight to adding a connector. You can also find it under Customize, then Connectors, then Add custom connector.",
    "Name it Berth and paste the address above, if Claude has not filled it in.",
    "Choose Connect, sign in to Berth, and allow it.",
    "On the free plan Claude allows one custom connector.",
  ],
  assistantStepsChatGpt: [
    "In ChatGPT's settings, turn on Developer mode (Plus plan or higher), then create an app named Berth with the address above.",
    "Sign in to Berth when ChatGPT asks, and allow it.",
  ],
  assistantStepsGrok: [
    "Open Grok's connectors with the button below and choose New connector, then Custom. It needs SuperGrok or X Premium+.",
    "Name it Berth and paste the address above.",
    "Sign in to Berth when Grok asks, and allow it.",
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

  draftOpenedTitle: "Suggested by your assistant",
  draftOpenedBody: "Check the amount and what you pay with. Nothing is sent until you sign.",
  draftUnknownListing: "That suggestion names something Berth does not offer.",
  draftNothingToSell: (name) => `There is no ${name} in your account to sell.`,
  draftCouldNotCheck: (name) => `Berth could not check your ${name} just now. You can sell it from what you own when it shows.`,
};
