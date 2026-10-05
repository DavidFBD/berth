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
import { LEGAL_EFFECTIVE_DATE } from "@/lib/legal-version";
import { ACTIVE_WINDOW_DAYS } from "@/lib/campaigns";
import type { ConsentParty } from "@/lib/assistant-party";
import type { HandleRefusal } from "@/lib/handle";
import type { Currency } from "@/lib/currencies";
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

  /** The quiet "Beta" pill beside the wordmark; BERTH_BETA in lib/beta.ts hides it everywhere at once. */
  beta: {
    tag: string;
    openLabel: string;
    body: string;
    contactLabel: string;
    contactHref: string;
  };

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
  receiveBitcoinTitle: string;
  receiveBitcoinBody: string;
  receiveBitcoinToast: string;
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
  /**
   * The soft landing where Berth is not available (lib/availability): what
   * an excluded visitor reads instead of a way in, a buy, a plan or an
   * assistant connection, and the quiet banner an existing account sees
   * while it is there. Plain, never an error.
   */
  unavailable: {
    title: string;
    /** For a comprehensively sanctioned place, where nothing beyond the public pages is served. */
    sanctionsTitle: string;
    /** There, instead of "nothing was stored": what someone who holds something needs to hear. */
    fundsStay: string;
    /** Why, in one line, by reason. */
    reason: { "united-states": string; "not-offered": string; sanctions: string };
    /** Only to a visitor with no account: before any sign in, nothing was kept. */
    nothingKept: string;
    /** To a signed in account instead: its data is kept, as it always is. */
    accountKept: string;
    readOn: string;
    links: { welcome: string; terms: string; privacy: string; assistants: string };
    /** Before the address, which is PRIVACY_OPERATOR.email. */
    support: string;
    haveAccount: string;
    /** In place of the buy drawer. */
    drawerTitle: string;
    drawerBody: string;
    close: string;
    /** On the consent screen: nothing was connected. */
    authorizeBody: string;
    /** A sign in that would have made a new account here. */
    noAccountTitle: string;
    noAccountBody: string;
    signOut: string;
    /** The banner an existing account sees while it is somewhere Berth is not available. */
    banner: string;
    /** What the Assistant's draft tools answer; the model retells it. */
    draftRefused: string;
  };
  /** Footer line under "powered by": the one honest sentence about risk. */
  footerNote: string;
  /**
   * The first look (lib/first-look), beside the first buy's examples and on
   * the first stock's card. Only these fixed lines: no headline or post text
   * ever sits beside Buy. Jev only decides which line is true.
   */
  firstLook: {
    /** After the ticker in the pick list, when one of today's headlines (New York) passed. */
    rowInNews: string;
    /** After the ticker, when one passed in the past seven days but none today. */
    rowInNewsWeek: string;
    /** Berth's own fixed line: never a headline, never a post (lib/first-look). Today, in New York. */
    inNews: (name: string) => string;
    /** The same line when what passed is from the past seven days, not today. */
    inNewsWeek: (name: string) => string;
    /** Opens the news drawer on the listing, where the news column's own rules apply. */
    readNews: string;
    /** The last trading day's move, only when it was large for the listing. Code's numbers, no cause. */
    move: (name: string, direction: "rose" | "fell", pct: string) => string;
    /** Under the news line when news is linked. */
    newsNote: string;
    ask: (name: string) => string;
    askPrompt: (name: string) => string;
    firstStockTitle: string;
    firstStockLine: (name: string) => string;
    dismiss: string;
  };
  /**
   * The signed-in home's one next step per state (components/home-next-step):
   * add money, buy the first stock, or buy more; and the short list of what
   * sits behind a tap (components/home-more).
   */
  calmHome: {
    addTitle: string;
    addLine: string;
    addAction: string;
    /** A wallet account pays from the wallet it connected, so its next step is choosing. */
    walletAddLine: string;
    walletAddAction: string;
    browse: string;
    firstTitle: string;
    firstReady: (amount: string) => string;
    /** Nothing spendable, but cash is parked, in its row just below: take some out, or add money. */
    firstFromCash: string;
    /** The same for a wallet account, whose step chooses a stock rather than adding money. */
    walletCashLine: string;
    /** A wallet account's empty step: it pays from the wallet it connected. */
    walletAddTitle: string;
    /** An earlier vault position, in its row just below, worth `amount` when priced. */
    vaultLine: (amount: string | undefined) => string;
    /** The step's title while cash is parked but nothing is spendable. */
    addTitleCash: string;
    /** Money the oracle cannot price yet: the buy drawer reads it per token. */
    firstReadyUnpriced: string;
    /** The card and bank row inside the Add money drawer. */
    cardRowTitle: string;
    pickLabel: string;
    firstChoose: string;
    firstBuy: (name: string) => string;
    seeAll: (count: number) => string;
    buyAction: string;
    compareShow: string;
    compareHide: string;
    addMoneyTitle: string;
    addMoneySub: string;
    moreLabel: string;
    moreBoardSub: string;
    moreNewsSub: string;
    moreAiSub: string;
  };
  /** The guided first path (lib/first-path, components/first-path): one step at a time, then "You're set up". */
  firstPath: FirstPathCopy;
  /** The welcome page around the way in (components/welcome): hero with the phone film, three short sections, the Wall Street film, the close. */
  welcomePage: {
    navLabel: string;
    eyebrow: string;
    /** The positioning line, split where the highlighted phrase starts. */
    headlineLead: string;
    headlineMark: string;
    emailCta: string;
    /** "on Base": a coin's network, under its name. */
    onNetwork: (network: string) => string;
    /**
     * The quiet entry badge near the eyebrow. `href` points at Colosseum's
     * own site for now; swap it for Berth's own Colosseum project page once
     * one exists.
     */
    colosseum: { label: string; href: string };
    /** Superteam Netherlands, shown as its mark beside the Colosseum badge; `label` names the link for screen readers. */
    superteam: { label: string; href: string };
    /** The three sections between the hero and the Wall Street film: one line of headline, one short line, a compact visual. */
    sections: {
      what: { title: string; line: string };
      pay: { title: string; line: string; draft: string; buy: string; amount: string; payWith: string };
      custody: { title: string; line: string; keys: string; funds: string; orders: string; withYou: string; signedByYou: string };
    };
    /**
     * The two launch films (components/welcome/welcome-films). `line` is the
     * one sentence beside or under a film, `label` its accessible name.
     */
    films: {
      hero: { line: string; label: string };
      wallStreet: { line: string; label: string };
      /** The pill's words: what a tap will do. */
      soundOn: string;
      soundOff: string;
      /** Shown instead of autoplay when reduced motion is asked for. */
      play: string;
    };
    legal: string;
  };

  /* — account total: funds plus holdings plus cash, one figure — */
  accountTotalLabel: string;
  accountTotalSub: string;
  /** Beside figures drawn from the last reading while the live one arrives (lib/last-known). */
  lastKnownUpdating: string;
  /** The (i)'s line while the figure is the last reading: when that was. */
  lastKnownAsOf: (when: string) => string;
  /* — the signed-in board's own words (components/home, components/board) — */
  /** The first of the three figures under the total: stocks and funds held, not cash. */
  accountSplitHoldings: string;
  /** Under the comparison chart, beside the range: what the two lines are. */
  portfolioSameDays: string;
  /** Under the percent line: both lines are returns from the same start, buys and sells set aside. */
  portfolioReturnCaption: string;
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
  /** Over the board's quiet list of listings by how many people bought them (lib/social-proof). */
  /** `week` is the published week's Monday, as words ("Oct 5"). */
  mostBoughtTitle: (week: string) => string;
  /** One row of it: a count of people, never an amount; `plus` when rounded down ("15+"). */
  mostBoughtRow: (people: number, plus: boolean) => string;
  /** Over the board's quiet card of listings by the share of people holding them (lib/most-held); `week` as for mostBoughtTitle. */
  mostHeldTitle: (week: string) => string;
  /**
   * One row of it, and the quiet line in a listing's own view: a rounded "1 in N", never a count or an amount.
   * It names its base, people who own a stock or fund on Berth, because the share is of them and not of every account.
   */
  mostHeldRow: (oneIn: number) => string;
  /** The card's one (i): its accessible name, and the line behind it. */
  mostHeldInfoLabel: string;
  mostHeldInfo: string;
  /** A row of "Your friends hold" in the Friends screen: how many friends who share hold it, with up to four of their faces. */
  friendsHold: (count: number, names: readonly string[]) => string;
  /** After the faces under a "Your friends hold" row, the friends beyond them ("+2"). */
  friendsHoldMore: (more: number) => string;
  /** The once per account notice of the two social counts (components/board/social-notice-line). */
  socialNotice: { text: string; action: string; dismiss: string };
  /** The once per account notice of the new terms and privacy policy (POLICY_NOTICE_ID). */
  policyNotice: { text: string; terms: string; privacy: string; dismiss: string };
  /**
   * The sheet that asks once for the terms (components/terms-sheet), before
   * the first buy or sell under a new version. A buy waits for Accept; a
   * sell may go on without it.
   */
  termsSheet: {
    title: string;
    lede: string;
    summary: (feePct: string) => readonly string[];
    read: string;
    terms: string;
    privacy: string;
    accept: string;
    notNow: string;
    buyNote: string;
    continueSell: string;
    sellNote: string;
    failed: string;
  };
  newsMoreStories: string;
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
  /** Networks past their read deadline (lib/read-deadline), still being read. */
  fundsStillReading: (chains: string) => string;
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
   * money in [the S&P 500 fund] -0.6%." with the name as the chooser.
   * `date` arrives formatted: "Sep 21".
   */
  portfolioSince: (date: string, days: number) => string;
  portfolioYou: string;
  /** Before the benchmark's name, by id: "the same money in the" S&P 500 fund, "in" Gold. */
  portfolioSameDollarsIn: Record<"SPY" | "QQQ" | "PAXG" | "BTC" | "SGOV", string>;
  /** The chooser's menu heading, and the description its button carries. */
  portfolioCompareWith: string;
  portfolioChooserHint: string;
  /** One day stored: the line runs from what was paid to what it is worth now. */
  portfolioFirstDay: string;
  /** Nothing to draw yet at all: no point today (a closed market) or no price for it. */
  portfolioFirstDayWait: string;
  /** The first day's line, scrubbed: its start and its end. */
  portfolioWhenBought: string;
  portfolioNow: string;
  /** After "You" and the first day's percentage: what it counts from. */
  portfolioSinceBuy: string;
  /** A day in the week strip and the day line when it is the live point. */
  portfolioToday: string;
  /**
   * Over the week strip: the last seven market days, or, while there are
   * fewer, how far into the first seven the account is.
   */
  portfolioWeekLabel: string;
  portfolioFirstWeek: (day: number) => string;
  /**
   * A day of the strip for a screen reader: the date, the day's change
   * ("up 1.2%, $0.42"), and the holding that moved most, when known.
   */
  portfolioDayAria: (date: string, change: string | null, mover: string | null) => string;
  portfolioDayUp: (pct: string, usd: string) => string;
  portfolioDayDown: (pct: string, usd: string) => string;
  portfolioDayFlat: string;
  /** The day line: the first day, counted from what was paid. */
  portfolioFromBuy: string;
  /** The day line when a price for the day is missing. */
  portfolioDayUnknown: string;
  /** The day line: an order that landed that day. The amount follows in figures. */
  portfolioBought: (name: string) => string;
  portfolioSold: (name: string) => string;
  /** After the orders the day line names, how many more there were. */
  portfolioMoreOrders: (count: number) => string;
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
  /** The column's refresh control, for a screen reader, and while it works. */
  newsRefresh: string;
  newsRefreshing: string;
  /** `when` is formatTimeAgo's phrase: "just now", "3 minutes ago". */
  newsUpdated: (when: string) => string;
  /** After a refresh the throttle answered from the cache: nothing newer yet. */
  newsUpToDate: (when: string) => string;
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
  /** The reading of one post, on its card. Absent when none was made. */
  newsVerdictMaterial: string;
  newsVerdictFact: string;
  newsVerdictAnalysis: string;
  /** The chip's tooltip and accessible name: "Read as new fact". */
  newsVerdictLabel: (verdict: string) => string;

  /* — the news column's sections (lib/news-stories) — */
  /** The column's hint, now one list of stories from every source. */
  newsStoriesHint: string;
  /** The (i): what keeps a story in. */
  newsAboutStories: string;
  /** Under it, the last 24 hours' real counts across every source. */
  newsReadKept: (read: string, kept: string) => string;
  /** The first section, for someone who owns something. */
  newsForWhatYouOwn: string;
  /** Dated lines about holdings: "Coming up" for dates ahead, "Recently filed" when there are only filings. */
  newsComingUp: string;
  newsRecentlyFiled: string;
  /** Everything else, as the river always was. */
  newsAcrossBerth: string;
  /** When Jev read stories about every holding and none is news. */
  quietDayTitle: string;
  /** `names` are the holdings Jev read about and found nothing, in the order held. The window is 36 hours. */
  quietDayBody: (names: readonly string[]) => string;
  /** Beside it, the holdings Jev has read nothing about yet. */
  quietDayNotRead: (names: readonly string[]) => string;
  /** When Jev has read nothing about any holding yet: never "quiet", which nobody checked. */
  quietDayUnjudged: string;
  /** When the store could not be read. Never a quiet day. */
  newsUnavailable: string;
  /** Before the publishers a post's story also came from, each a link. */
  alsoReportedByPrefix: string;
  /** Under a story other publishers carried too; opens the list of them. */
  alsoReportedBy: (count: number) => string;
  /** Before the X accounts that posted the same story, each a link. */
  alsoOnX: string;
  /**
   * A filing from SEC EDGAR, written by code. `report` is which kind
   * (lib/news-schedule SHOWN_FORMS), `date` the reader's own long date.
   */
  eventFiling: (name: string, report: "report" | "quarterly" | "annual", date: string) => string;
  /** The link beside a filing line. */
  eventReadOnSec: string;

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
  /**
   * Why a pay token is greyed in the picker, and the message that stops an
   * order before the wallet opens: the chain's native token cannot pay the
   * fee (lib/gas-need).
   */
  gasNeededToPay: (symbol: string, chainName: string) => string;
  /** The same, for the native token itself: what is there would all go to the fee. */
  gasNeededNative: (symbol: string, chainName: string) => string;
  /** The (?) button's name beside a greyed pay token. */
  gasHelpLabel: string;
  /** The buy or sell button while the signing chain cannot pay its fee. */
  ctaNeedsGas: (symbol: string) => string;
  /**
   * Under the button when the chain's own price is covered but not what
   * some wallets attach on top (lib/gas-need floorWarns). The person may sign.
   */
  gasFloorWarning: (symbol: string) => string;
  /**
   * Where the network fee would be mentioned, when Privy pays it for an
   * email user's embedded wallet on this chain (lib/gas-sponsor). The
   * trade's own fees still apply, so never "free".
   */
  noNetworkFeeOn: (chainName: string) => string;
  /** The same, as a tiny muted note on a pay token row in the picker. */
  noNetworkFeeNote: string;
  /** The first buy step, for email users: the sponsored chains, joined ("Base, Arbitrum and Polygon"). Says "network fee", never "free", and promises no limit on how many buys. */
  gasCoveredChains: (chainNames: string) => string;
  /** The last joiner in a list of names: "Base, Arbitrum and Polygon". */
  listAnd: string;
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
  /** A signed in wallet whose extension is away: the order button opens it. */
  ctaWakeWallet: (name: string | null) => string;
  /** The wallet would not open for the signature (locked prompt dismissed, or not in this browser). */
  wakeWalletFailed: (name: string | null) => string;
  /** The wallet drawer's row for a wallet signed in whose extension is away. */
  walletAsleepLabel: string;
  walletAsleepNote: (name: string | null) => string;
  walletSignOutLabel: string;
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
  /** The approve step when Berth sends it for the person (an email account, fee paid): nothing to confirm. */
  stepMsgApprovingHeadless: string;
  /** The sign step when Berth sends it for the person (an email account, fee paid): nothing to confirm. */
  stepMsgSending: string;
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
   * A gas-sponsored send whose outcome is unknown (lib/gas-sponsor
   * SponsoredOutcomeUnknown): it may still land, so retrying now could buy
   * twice. The retry stays off for a minute (outcome hold).
   */
  errOutcomeUnknown: string;
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
  /** The display currency's name as a reader says it of an amount: "euros". */
  currencyNames: Record<Currency, string>;
  /**
   * Under the currency chips when the display currency is not USD: what the
   * converted figures are, and where the rate comes from.
   */
  fxNote: (currencyName: string) => string;
  fxCredit: string;
  /** Beside the credit when the ECB rate in use is more than a day old. */
  fxRateOf: (day: string) => string;
  /**
   * Under a figure that stays in US dollars (a limit price), when the display
   * currency is not USD: "about €184.00 at today's rate", or, once the rate
   * is more than a day old, "about €184.00 at the rate of Oct 3".
   */
  moneyAboutAtTodaysRate: (amount: string) => string;
  moneyAboutAtRateOf: (amount: string, day: string) => string;
  /**
   * On the performance chart and the comparison when the display currency is
   * not USD: the percentages are the change in US dollars, not in the
   * reader's own currency, and the (i) says so in full.
   */
  inUsDollars: string;
  inUsDollarsNote: string;
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
  /** What one batch of XP was for, several reasons read as one line. */
  xpReasons: (reasons: string[]) => string;
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
  /** `stayed`: friends who set up and stayed, the ones whose invite XP landed. */
  friendsTally: (joined: number, stayed: number, taps: number) => string;
  xpBankedWord: string;
  xpPendingWord: string;
  copyNudge: string;
  nudgeCopiedTitle: string;
  nudgeCopiedSub: string;
  /** The clipboard line for a friend yet to set up: an invitation, never a reward. */
  nudgeMessage: (link: string) => string;
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
  /** The fee line when Privy pays the network fee on this chain (lib/gas-sponsor). */
  limitSummaryFeeNoGas: (fee: string, chainName: string) => string;
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

  /* — product analytics (lib/analytics): the quiet consent card and its Settings switch — */
  analytics: AnalyticsCopy;

  /* — the privacy policy (app/privacy): public, signed in or not — */
  /** The small link to /privacy, in the settings drawer and under the consent screen. */
  privacyLink: string;
  privacyPolicy: LegalDocument;

  /* — the terms of use (app/terms): public, signed in or not — */
  /** The small link to /terms, beside Privacy in the settings drawer and under the consent screen. */
  termsLink: string;
  termsOfUse: LegalDocument;

  /* — Berth's own account on X (lib/berth-x): the quiet link in the welcome footer and in Settings — */
  /** The link's label, beside X's mark. */
  xLink: string;
  /**
   * Sharing your own invite link on X (lib/x-intent): the button's label,
   * and the one line X's composer opens with, before the link. Calm, no
   * buy: nothing is ever given for a post or for the tap.
   */
  inviteXShare: string;
  inviteXText: string;
  /**
   * "Share what you hold on X" (components/share-holdings-on-x): a quiet
   * link under What you own, only while something is held, and the small
   * sheet it opens to choose which holdings to name. Never prompted, never
   * rewarded. The post names holdings by name and nothing else: no amount,
   * value, price, return or advice.
   */
  holdingsXShare: string;
  holdingsXSheet: {
    title: string;
    lede: string;
    /** Above the list of holdings to tick. */
    choose: string;
    /** Above the exact words X will open with. */
    preview: string;
    /** Shown in the preview while nothing is ticked. */
    none: string;
    open: string;
    notNow: string;
  };
  /** The post's one line: the joined list, and how many holdings it stands for (one reads "a token"). */
  holdingsXText: (list: string, count: number) => string;
  /** "NVIDIA, Apple and Tesla", or "NVIDIA, Apple and three more" when `more` are counted, not named. */
  holdingsXList: (names: readonly string[], more: number) => string;

  /* — the help page for assistants (app/assistants): public, the directories' documentation and support page — */
  /** The small link to /assistants under "Your assistant" in the account drawer. */
  assistantsLink: string;
  /** The 404 page: what happened, and that nothing of yours moved. */
  notFound: { title: string; body: string; backHome: string };
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
  /** A buy paid from a Solana or Bitcoin wallet not on the account yet: why it is added first. */
  buyLinkForXp: string;
  /** A buy paid from a network no wallet can be linked in (Sui, Stellar, NEAR, Injective, ICON, Stacks). */
  buyNoXpNetwork: string;
  /** A sell from a hub wallet another address of the account owns. */
  ctaSellSwitchWallet: (short: string) => string;
  /** The holding sits in the account's email wallet, which only an email sign in signs for. */
  ctaSellSignInEmail: string;
  sellFromLabel: string;
  sellFromHomeTag: string;
  social: SocialCopy;
  /** The account drawer's first screen, its next step and its rows (components/account-drawer). */
  drawer: DrawerCopy;
  og: OgCopy;
  /** The staff area, internal (STAFF_COPY). */
  staff: StaffCopy;
  /** Reward campaigns (lib/campaigns): the landing, the home line, the staff page. */
  campaign: CampaignCopy;
  /** Berth's own automatic posts on X (lib/x-autopost). */
  xAutopost: XAutopostCopy;
};

/**
 * Berth's own automatic posts on X (lib/x-autopost, lib/server/x-autopost).
 * Strict templates filled with facts, never free text: no advice, no
 * prediction, no price, no performance, never "buy". A headline is quoted
 * verbatim and attributed. Each post is a body, a call to action and one
 * link, and must fit X's 280 (a link counts 23).
 */
export type XAutopostCopy = {
  /** A whole day the market is shut: "Thursday 26 November", "Thanksgiving", the next session's day. */
  holiday: (day: string, name: string, reopens: string) => string;
  /** A 1pm close. */
  halfDay: (day: string) => string;
  /** A headline, quoted as the publisher wrote it. */
  news: (name: string, publisher: string, headline: string) => string;
  /** Most held's top row, as the board publishes it (lib/most-held). */
  mostHeld: (week: string, name: string, oneIn: number) => string;
  /** Most bought's top row, as the board publishes it (lib/social-proof). */
  mostBought: (week: string, name: string, people: number, plus: boolean) => string;
  /**
   * A signup campaign: a new account opened through the campaign's link,
   * set up and still in use `days` later, earns its owner the amount, never
   * for a buy, while places last. `places` only when known; `ends` only
   * when set.
   */
  campaign: (amount: string, days: number, places: number | null, ends: string | null) => string;
  /** The default call to action, beside a link to the home page (never a listing's, which opens the buy drawer). */
  seeIt: string;
  /** The signup campaign as a news or calendar post's call to action. */
  campaignCta: (amount: string, days: number) => string;
  /** The campaign post's own call to action. */
  campaignLink: string;
};

/**
 * A campaign, in words. Money is stated exactly and never dressed up: the
 * amount, the minimum, the days. Berth adds nothing it has not promised.
 */
export type CampaignCopy = {
  /** The /c/<code> landing, under the mark. */
  landingTitle: string;
  landingLede: (amount: string, days: number) => string;
  /** Under the lede: the link is remembered only in the browser it was opened in, before sign up. */
  landingSameBrowser: string;
  /** The home line of an account that opened through a campaign's link and has not finished setting up. */
  setUp: (amount: string, days: number) => string;
  /** Set up, but no place is free for now (all taken, or the campaign paused): it may still free up before `deadline`. */
  waiting: (amount: string, days: number, deadline: string) => string;
  /** The campaign is paused before the account took a place: no promise. */
  paused: string;
  /** The account is set up and is waiting out the days. */
  staying: (amount: string, eligible: string) => string;
  qualified: string;
  paid: (amount: string) => string;
  /** The terms link at the end of the line. */
  termsLink: string;
  staff: CampaignStaffCopy;
};

/** The staff page (/staff/campaigns) and pnpm campaign:queue. */
export type CampaignStaffCopy = {
  title: string;
  lede: string;
  nothingHere: string;
  loading: string;
  failed: string;
  meter: (reservedUsd: string, paidUsd: string, budgetUsd: string, slots: number, maxClaims: number) => string;
  active: string;
  inactive: string;
  activate: string;
  deactivate: string;
  /** The confirmation before a campaign goes live: the staff member's own reading (no counsel yet, 2026-10-05). */
  activateConfirm: (title: string) => string;
  activateCheck: string;
  /** Deleting a campaign that never took on money: the one confirm line naming it, the button, and what it says after. */
  deleteConfirm: (title: string, code: string) => string;
  /** The reason a delete asks for, kept in the audit log. */
  deleteReason: string;
  delete: string;
  deleted: (code: string) => string;
  /** Shown beside the confirm panel's own checks when the check in question is still unticked. */
  activateNeedsReviewed: string;
  activateNeedsFunding: string;
  /** The Funding block (components/staff/campaign-funding): where a sponsor's USDC goes, on the create form and each campaign card. */
  funding: {
    heading: string;
    network: string;
    networkValue: string;
    token: string;
    tokenValue: string;
    tokenContract: string;
    wallet: string;
    controlledBy: string;
    instruction: string;
    berthHolds: string;
    copy: string;
    copied: string;
    basescan: string;
    qrLabel: string;
    balance: string;
    refresh: string;
    reading: string;
    unreadable: string;
    readAt: (time: string) => string;
    enoughFor: (rewards: number) => string;
    budgetNeeds: (usd: string, rewards: number) => string;
    covered: string;
    short: (usd: string) => string;
    noWallet: string;
    moreWallets: (count: number) => string;
    addressLabel: string;
    addressHint: string;
    checksummed: string;
    judgements: Record<"invalid" | "bad_checksum" | "zero", string>;
    berthAddress: Record<"usdc_contract" | "fee_wallet" | "intents_contract" | "listing_token", string>;
    /** The second box before activation, beside the reading check. Recorded in the audit log. */
    fundingCheck: string;
    createNeedsWallet: string;
    /** The reason kept on the payout source a new campaign is created with. */
    createdReason: string;
  };
  sources: {
    heading: string;
    none: string;
    fallback: string;
    address: string;
    reason: string;
    add: string;
    remove: string;
    removeReason: string;
    added: (when: string, reason: string) => string;
  };
  cancel: string;
  confirm: string;
  sections: Record<"qualified" | "approved" | "holding" | "paid" | "closed", string>;
  waiting: (invited: number) => string;
  empty: string;
  states: Record<"attributed" | "buying" | "holding" | "qualified" | "approved" | "paid" | "rejected" | "expired", string>;
  labels: {
    account: string;
    signup: string;
    setUp: string;
    lastSeen: string;
    wallets: string;
    signals: string;
    payTo: string;
    paid: string;
    reason: string;
  };
  terms: (amount: string, days: number) => string;
  /** A campaign made under retired rules (kind buy or invite): shown read only. */
  retired: string;
  span: (from: string, to: string) => string;
  signupLine: (signup: string, counted: string) => string;
  setUpLine: (setUp: string, judged: string) => string;
  unlinked: string;
  noSignals: string;
  noDeviceSignals: string;
  signals: Record<"email_alias" | "close_signup" | "shared_wallet" | "same_payout" | "same_email_domain", string>;
  payTo: (amount: string, chain: string) => string;
  approve: string;
  reject: string;
  signInAgain: string;
  /** Show one masked field in full; the reveal is audited. */
  reveal: string;
  revealWallets: string;
  rejectReasons: Record<"not_active" | "one_per_person" | "abuse" | "other", string>;
  expireReasons: Record<"ended" | "full", string>;
  /** Why the rules closed a claim, the retired buy rules' reasons included for old rows. */
  systemReasons: Record<string, string>;
  rejectNote: string;
  /** Approved claims whose account staff marked not eligible since: said before anyone pays by hand. */
  ineligibleApproved: (count: number) => string;
  ineligibleClaim: (at: string) => string;
  /** On an approved claim, before anyone sends USDC by hand: what the campaign's checks say of the person now. */
  sinceApproval: Record<"wallet_used" | "email_used" | "existing_customer" | "staff_ineligible" | "no_person", string>;
  markPaid: string;
  txHash: string;
  batchNote: string;
  verified: string;
  unverified: string;
  recheck: string;
  refusals: Record<string, string>;
  create: {
    heading: string;
    code: string;
    title: string;
    amount: string;
    budget: string;
    maxClaims: string;
    stayDays: string;
    starts: string;
    ends: string;
    submit: string;
    /** Under the submit button: what pressing it does, in place of the vague old label. */
    submitHint: string;
    note: string;
    /** One plain line under each field: what it means and what it does. */
    hints: Record<"code" | "title" | "amount" | "budget" | "maxClaims" | "stayDays" | "starts" | "ends", string>;
    /** The campaign's link, as the code makes it, under the code field. */
    link: (url: string) => string;
    /** Places times the amount, against the budget, as the fields stand. */
    fits: (total: string, places: number) => string;
    overBudget: (total: string) => string;
    /** The success line shown on the new campaign's own card after a create. */
    createdLine: (title: string) => string;
  };
};

/**
 * One link preview card (lib/og/card): a plain topic line above the
 * headline, the headline, one sentence under it, and the alt text that
 * describes the picture. Never a price, a return or anyone's money.
 */
export type OgCard = { eyebrow: string | null; title: string; line: string; alt: string };

export type OgCopy = {
  domain: string;
  home: OgCard;
  invite: OgCard;
  /**
   * The invite card when the inviter can be named (lib/og/people): the
   * invite card's own title and line, with the inviter's username, from
   * the database, in the eyebrow and the alt.
   */
  inviteFrom: { title: (handle: string) => string; eyebrow: (handle: string) => string; alt: (handle: string) => string };
  profile: OgCard;
  /**
   * The profile card when its owner turned on "Show my avatar, username and rank on
   * links to my profile": the username, from the database, as the title,
   * and the rank name in the line. Never a number.
   */
  profileOwner: { title: (handle: string) => string; eyebrow: string; line: (rank: string) => string; alt: (handle: string, rank: string) => string };
  friendLink: OgCard;
  assistants: OgCard;
  privacy: OgCard;
  terms: OgCard;
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
export type FirstPathCopy = {
  /** The calm progress line above a step's title. */
  progress: (index: number, total: number) => string;
  skip: string;
  /** The toast after a skip, with its Undo. */
  skipped: string;
  undo: string;
  titles: { avatar: string; username: string; money: string; walletMoney: string; firstBuy: string; invite: string };
  /** The Done moment, said once as a step closes. */
  done: { avatar: string; username: string; money: string; walletMoney: string; firstBuy: string; invite: string; inviteCopied: string };
  doneNext: (title: string) => string;
  doneLast: string;
  avatarSub: string;
  usernameSub: string;
  /** A wallet account without an email: the username step adds one first. */
  usernameNeedsEmail: string;
  inviteSub: string;
  inviteNeedsName: string;
  inviteNeedsNameAction: string;
  /** The first buy step when the money step was set aside and nothing spendable is known. */
  firstUnfunded: string;
  /** The drawer's first buy line when money is ready: the choice itself is on the home. */
  firstFunded: string;
  xpFirstBuy: (amount: number) => string;
  /** In the account drawer, the steps that live on the home. */
  goMoney: string;
  goWalletMoney: string;
  goFirstBuy: string;
  setUpTitle: string;
  setUpLine: string;
  /** Where Berth cannot take an order: no money and no buy were asked for. */
  setUpLineAway: string;
  /** Some steps were set aside, so it is not everything. */
  setUpLineSome: string;
  setUpSkipped: string;
  setUpClose: string;
  /**
   * The quiet link to Berth's own account on X under "You're set up"
   * (lib/berth-x). Not a step: it earns nothing and counts toward nothing.
   */
  followOnX: string;
  /** An established account's one quiet drawer row (lib/first-path establishedPrompt). */
  quietAvatar: string;
  /** `amount` is the first username's XP (lib/xp username_set). */
  quietUsername: (amount: number) => string;
};

export type DrawerCopy = {
  /** Where a second screen of the drawer goes back to. */
  back: string;
  noUsername: string;
  changeAvatar: string;
  nextStep: string;
  avatarTitle: string;
  avatarSub: string;
  avatarXp: (amount: number) => string;
  avatarSave: string;
  avatarPickFirst: string;
  avatarSaved: string;
  avatarFailed: string;
  avatarChangeTitle: string;
  avatarChangeSub: string;
  inviteTitle: string;
  inviteSub: string;
  inviteAction: string;
  notNow: string;
  rows: {
    rewards: { title: string; sub: (rank: string, level: number) => string };
    friends: { title: string; sub: (friends: number, requests: number) => string; subNoName: string };
    money: { title: string; sub: string };
    wallets: { title: string; sub: string };
    notifications: { title: string; sub: string };
    ai: { title: string; sub: string };
  };
  /** The profile page's way back when it was opened from the drawer. */
  profileBack: string;
};

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
  /** Under a first pick only: what the first username pays (lib/xp username_set). */
  pickXp: (amount: number) => string;
  /** Why a name cannot be had; `nextChange` is a readable date for "cooldown". */
  refusal: (reason: HandleRefusal, nextChange?: string) => string;
  saved: (handle: string) => string;
  saveFailed: string;
  view: string;
  change: string;
  cancel: string;
  hide: string;
  hideSub: string;
  /** The opt-in for a personal link preview card on /u/<username> (lib/og/people). */
  linkFace: string;
  linkFaceSub: string;
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
  /** The opt-in for friends to see which listings you hold (lib/server/social-proof), off by default. */
  shareHoldings: string;
  shareHoldingsSub: string;
  /** Beside friend requests: what accepting does and does not share. */
  acceptHoldingsNote: string;
  /** Beside a card's Accept or Add friend, when the viewer's own switch is on. */
  cardShareNote: string;
  /** The read-only fold of which listings friends who share hold. */
  holdingTitle: string;
  holdingOff: string;
  holdingNone: string;
  /** On a friend's card, when both share: which listings they hold, by name. */
  cardHolds: (names: readonly string[]) => string;
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
  why: Record<"orders" | "friends" | "weekly", string>;
  unsubscribe: string;
  signoff: string;
  /** With its article, as a sentence opens: "An EVM", "A Solana". */
  family: Record<"evm" | "solana" | "bitcoin", string>;
  walletAdded: { subject: string; heading: string; body: (family: string, address: string) => string };
  walletRemoved: { subject: string; heading: string; body: (family: string, address: string) => string };
  accountsMerged: { subject: string; heading: string; body: string };
  /** To the other staff admins (lib/server/staff/reveal-limit). */
  staffReveals: { subject: string; heading: string; body: (staff: string, count: number) => string; after: string; button: string };
  /** To staff admins only (lib/server/staff/budgets): a paid service is running low. */
  budgetLow: {
    service: Record<"openai" | "jev" | "x" | "resend", string>;
    subject: (service: string) => string;
    heading: string;
    body: (service: string, remaining: string, estimate: boolean) => string;
    runway: (days: number) => string;
    after: string;
    button: string;
    why: string;
  };
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
  payoutSource: {
    subject: (change: "added" | "removed", campaign: string) => string;
    heading: (change: "added" | "removed") => string;
    body: (change: "added" | "removed", campaign: string, address: string) => string;
    reasonLabel: string;
    button: string;
  };
  campaignPaid: { subject: (amount: string) => string; heading: string; body: (amount: string, chain: string) => string; after: string };
  /**
   * The weekly summary (lib/server/weekly): opt in, Monday mornings, the
   * week before. Every number in it is one the app already shows; a
   * section with nothing trusted to say is left out, never guessed.
   */
  weeklySummary: {
    /** `weekOf` is the week's Monday: "22 September". */
    subject: (weekOf: string) => string;
    heading: string;
    /** `closeDay` is the last close the week has: "Friday 26 September". */
    intro: (weekOf: string, closeDay: string | null) => string;
    previewWorth: (worth: string, closeDay: string) => string;
    previewPlain: string;
    account: {
      heading: string;
      worth: string;
      change: string;
      /** The benchmark named as the email names it everywhere, by its listing: "S&P 500 ETF". */
      benchmark: (name: string) => string;
      /** Under the numbers when the change is shown: what it counts. */
      changeNote: string;
    };
    /** Each holding's worth, and beside it its price's move over the week. */
    holdings: {
      heading: string;
      note: string;
      /** The holdings the list leaves out, with their worth beside: "And 2 more", or "2 holdings" when none is listed. */
      more: (count: number, afterList: boolean) => string;
    };
    orders: {
      heading: string;
      filled: string;
      /**
       * Every order that filled this week, as the app's order log counts
       * them; `limits` is how many of those were limit orders, a part of
       * the count, never added to it.
       */
      filledValue: (buys: number, sells: number, limits: number) => string;
      limits: string;
      /** Limit orders that expired unfilled this week. */
      limitsValue: (expired: number) => string;
    };
    friends: { heading: string; added: string; salutes: string };
    after: string;
  };
  settings: {
    sectionLabel: string;
    goesTo: (address: string) => string;
    securityAlways: string;
    kinds: Record<"orders" | "friends" | "weekly", { label: string; sub: string }>;
    addEmail: string;
    addEmailSub: string;
    undeliverable: string;
    saveFailed: string;
  };
  unsubscribePage: {
    title: string;
    kindName: Record<"orders" | "friends" | "weekly", string>;
    confirm: (kind: string) => string;
    confirmSub: string;
    confirmButton: string;
    done: (kind: string) => string;
    doneSub: string;
    turnBackOn: string;
    backOn: (kind: string) => string;
    invalid: string;
    /** An old link for a kind Berth no longer sends (lib/email-kinds RETIRED_KINDS). */
    retired: string;
    backHome: string;
  };
};

/** "first day", "1 market day", "4 market days". */
function marketDays(days: number): string {
  if (days <= 0) return "first day";
  return days === 1 ? "1 market day" : `${days} market days`;
}

/**
 * The staff area (app/staff, docs/adr/0008-staff-area.md). Internal and
 * terse, still one voice: commas and periods, no dashes as punctuation, no
 * emoji, no exclamation. Counts and definitions, never a judgement of a
 * person. Shared by server pages (COPY.staff) and client parts (useCopy).
 */
export const STAFF_COPY = {
  title: "Staff",
  role: { admin: "Admin", viewer: "Viewer" },
  nav: {
    overview: "Overview",
    users: "Users",
    health: "Health",
    budgets: "Budgets",
    campaigns: "Campaigns",
    posts: "Posts",
    audit: "Audit",
  },
  signOut: "Leave staff area",
  /** The account drawer's quiet entry, shown only to an account on a staff list (lib/staff/entry). */
  entry: {
    label: "Staff",
    walletTitle: "The staff area opens with your email",
    walletBody: "It opens only after you sign in with a code sent to this account's email. A wallet sign in never opens it.",
    walletAction: "Sign in with email",
    working: "Signing in",
    failed: "The staff area did not open. Sign in with the code sent to this account's own email and try again.",
    notNow: "Not now",
  },
  signOutEverywhere: "Sign out everywhere",
  loggedNote: "Every view of a person, every reveal and every change here is logged.",
  fresh: {
    title: "Confirm it is you",
    body: "Reveals and changes need an email code entered in the last 15 minutes. Sign in again to continue.",
    action: "Sign in again",
    working: "Signing in",
    failed: "That did not work. Try again.",
  },
  confirm: {
    reasonLabel: "Reason",
    reasonHint: "Why, in a few words. It goes in the audit log.",
    reasonShort: "Give a reason of at least four characters.",
    cancel: "Cancel",
    done: "Done.",
    failed: "That did not work. Nothing was changed.",
    adminOnly: "Only an admin can do this.",
    revealLimit: "Twenty reveals an hour is the most. Try again later.",
  },
  reveal: {
    action: "Reveal",
    title: (what: string) => `Reveal ${what}`,
    body: "The full value is shown once, here, and the reveal is logged with your reason.",
    confirm: "Reveal",
    hide: "Hide",
    copied: "Copied",
    email: "this email",
    wallet: "this wallet",
  },
  lowStrip: (names: string) => `Running low: ${names}.`,
  lowStripLink: "See budgets",
  units: {
    accounts: (n: number) => (n === 1 ? "1 account" : `${n.toLocaleString("en-US")} accounts`),
    orders: (n: number) => (n === 1 ? "1 order" : `${n.toLocaleString("en-US")} orders`),
    hours: (n: number) => (n === 1 ? "1 hour" : `${n} hours`),
    days: (n: number) => (n === 1 ? "1 day" : `${n} days`),
  },
  none: "None",
  notTracked: "Not tracked yet",
  overview: {
    title: "Overview",
    posthog: "Product analytics in PostHog",
    posthogChecklist: "Before deploy, in PostHog's project settings: Discard client IP data on, replay retention 30 days, console log and network capture off. The privacy policy promises all three.",
    accounts: "Accounts",
    accountsNote: "Live accounts. A merged account counts once, as its survivor.",
    active7: "Active, 7 days",
    active30: "Active, 30 days",
    activeNote: "Opened Berth signed in (counted once a day, from 1 October 2026 on), placed an order, or used the Assistant or a connected AI in the window. An XP award is not a visit.",
    holdings: "Held at last close",
    holdingsNote: (accounts: number, day: string | null) =>
      day ? `Each account's latest stored close in the last week, ${accounts} accounts, latest ${day}.` : "No stored close in the last week.",
    volume30: "Volume, 30 days",
    fee30: "Fees, 30 days",
    allTime: (value: string) => `${value} all time`,
    hoursShort: (hours: number) => `${hours} h`,
    feeNote: "The fee each order recorded, priced at the order's own rate, else 0.4% of its dollar value. An estimate, not what reached the fee wallet. Orders with no dollar value are left out.",
    signups: "Signups",
    signupsDaily: "Per day, last 30 days",
    signupsWeekly: "Per week, last 12 weeks",
    stages: "Where accounts stand",
    stagesNote:
      "As the server can tell. Owns: a stock or fund in its latest stored day, or by its orders. Funded: Cash or an earlier order, no stock now. None: everyone else, including money still in a person's own wallet, which Berth never stores.",
    stage: { none: "None", funded: "Funded", owns: "Owns" },
    firstBuys: "First buys",
    firstBuysNote: "The first filled buy of a stock or fund. Cash is not a first buy. The same rule as pnpm first-buys.",
    firstBuyRate: "Made a first buy",
    medianToFirst: "Median time to it",
    withinDay: "Within a day",
    withinWeek: "Within a week",
    byWeek: "By signup week",
    week: "Week of",
    signupsCol: "Signups",
    firstBuysCol: "First buys",
    gotIt: "Closed the first stock card",
    orders: "Orders and volume",
    ordersNote: "Filled orders by day of fill, in UTC. Volume is the dollar value where known.",
    ordersCol: "Orders",
    buys: "Buys",
    sells: "Sells",
    volumeCol: "Volume",
    unpricedCol: "No value",
    day: "Day",
    retention: "Retention by signup week",
    retentionNote: "Buys of a stock or fund, Cash left out, and who was active in the last 30 days (visits counted from 1 October 2026 on).",
    orderedWeek1: "Bought in week 1",
    orderedLater: "Bought in weeks 2 to 5",
    active30Col: "Active, 30 days",
    referrals: "Invites",
    clicks: "Invite link visits",
    clicks30: "In the last 30 days",
    referred: "Signed up with a code",
    referredBuys: "Of those, made a first buy",
    linkRequests: "Friend link requests",
    linkAccepted: "Of those, now friends",
    topListings: "Most bought",
    listing: "Listing",
    buyers: "Buyers",
  },
  users: {
    title: "Users",
    searchLabel: "Search",
    searchPlaceholder: "Username, exact email, exact wallet or account id",
    searchHint: "A username matches from its start. An email, a wallet or an id must be exact.",
    search: "Search",
    invalid: "Nothing matches that. An email or a wallet address must be typed in full.",
    filters: "Filters",
    stage: "Stage",
    anyStage: "Any stage",
    from: "Joined from",
    to: "Joined to",
    hasEmail: "Has email",
    referred: "Arrived with an invite",
    hidden: "Profile hidden",
    ineligible: "Not eligible for campaigns",
    campaignAttributed: "Arrived through a campaign link",
    apply: "Apply",
    clear: "Clear",
    empty: "No accounts match.",
    username: "Username",
    noUsername: "No username",
    joined: "Joined",
    rank: "Rank",
    xp: "XP",
    orders: "Orders",
    email: "Email",
    wallet: "Wallet",
    flags: "Flags",
    flag: { referred: "Invited", hidden: "Hidden", ineligible: "No campaigns" },
    page: (page: number, pages: number, total: number) =>
      `Page ${page} of ${Math.max(pages, 1)}, ${total === 1 ? "1 account" : `${total.toLocaleString("en-US")} accounts`}`,
    previous: "Previous",
    next: "Next",
  },
  user: {
    back: "All users",
    accountId: "Account",
    retired: "This account was merged into another.",
    openSurvivor: "Open the account it became",
    joined: "Joined",
    stage: "Stage",
    rank: "Rank",
    identities: "Sign in and wallets",
    identitiesNote: "Masked. A reveal shows the full value once and is logged with its reason.",
    kind: { email: "Email", wallet: "Wallet" },
    primary: "Primary",
    home: "Home",
    unlinked: "Unlinked",
    proof: "Proved by",
    since: "Since",
    fromColumn: "From the account row",
    history: "Account history",
    merges: "Merges",
    mergeRole: { survivor: "Absorbed another", absorbed: "Merged into another" },
    auditEmpty: "Nothing recorded.",
    orders: "Orders",
    ordersCount: (shown: number, total: number) => (shown < total ? `Latest ${shown} of ${total}` : `${total}`),
    side: { buy: "Buy", sell: "Sell" },
    paidWith: "Paid with",
    limitOrders: "Limit orders",
    limitPrice: "Limit",
    status: "Status",
    expires: "Expires",
    portfolio: "Value",
    portfolioNote: "Stored closes, the last 180 days.",
    noPortfolio: "No stored day yet.",
    latestClose: (day: string) => `Close of ${day}`,
    xp: "XP",
    social: "Friends and invites",
    friends: "Friends",
    salutes: "Salutes received",
    referredBy: "Invited by",
    referralsOut: "Invited",
    referralsOutBuys: (n: number) => `${n} made a first buy`,
    email: "Email",
    primaryEmail: "Sends go to",
    noEmail: "No verified email.",
    prefs: "Switches",
    pref: { orders: "Orders", friends: "Friends", weekly: "Weekly" },
    on: "On",
    off: "Off",
    suppressed: (reason: string) => `Suppressed, ${reason}`,
    deliverable: "Deliverable",
    sends: "Recent sends",
    stuck: "Stuck",
    attempts: (n: number) => (n === 1 ? "1 try" : `${n} tries`),
    assistants: "AI connections",
    noGrants: "No AI connected.",
    client: "App",
    scope: "Scope",
    lastUsed: "Last used",
    revoked: "Revoked",
    live: "Live",
    usage30: (mcp: number, messages: number, cost: string) => `Last 30 days: ${mcp} AI tool calls, ${messages} Assistant messages, ${cost}`,
    firstLook: "First stock card",
    firstLookClosed: (at: string) => `Closed ${at}`,
    firstLookOpen: "Not closed",
    campaign: "Campaigns",
    eligible: "Eligible",
    ineligibleSince: (at: string) => `Not eligible since ${at}`,
    campaignLink: "Open campaigns",
    profile: "Profile",
    profileVisible: "Visible",
    profileHidden: (at: string | null) => (at ? `Hidden by the person since ${at}` : "Hidden by the person"),
    profileHiddenByStaff: (at: string | null) => (at ? `Hidden by staff since ${at}` : "Hidden by staff"),
    profileOwnHide: "The person hid it. Only they can show it again.",
    suppressionHolds: "A bounce or a complaint. It holds, and staff cannot lift it.",
    noProfile: "No profile.",
    viewLogged: "This view was logged.",
  },
  actions: {
    suppress: "Stop all email",
    unsuppress: "Allow email again",
    hide: "Hide profile",
    unhide: "Show profile",
    revoke: "Revoke",
    retry: "Send again",
    ineligible: "Mark not eligible",
    eligible: "Make eligible again",
    title: {
      suppress: "Stop all email to this account",
      unsuppress: "Allow email to this account again",
      hide: "Hide this profile",
      unhide: "Show this profile again",
      revoke: "Revoke this AI connection",
      retry: "Send this notice again",
      ineligible: "Mark not eligible for campaigns",
      eligible: "Make eligible for campaigns again",
      budget: "Save budget settings",
    },
    body: {
      suppress: "Its primary address goes on the suppression list. Nothing more is sent to it, security notices included.",
      unsuppress: "The stop staff put on comes off. A bounce or a complaint is never lifted here.",
      hide: "The card reads as missing to everyone. Only staff can show it again; the person's own switch cannot.",
      unhide: "The card staff hid can be found again by its exact username.",
      revoke: "The app's tokens stop working at once. The person can connect it again.",
      retry: "The notice is checked again against the person's switches and address, then sent.",
      ineligible: "Campaign payouts skip this account: a claim of it reserves no place, and one it already holds cannot be approved or paid. The reason stays in the audit log.",
      eligible: "The mark comes off the account.",
      budget: "The balance and threshold are saved and the change is logged.",
    },
  },
  health: {
    title: "Health",
    crons: "Crons",
    cronNote: "Two a day on Hobby. Each stage runs whatever the one before it did.",
    job: { morning: "Morning, 06:00 UTC", evening: "Evening, 22:00 UTC weekdays" },
    lastRun: "Last run",
    neverRan: "No run recorded yet. Runs are recorded from this release on.",
    ok: "Ran clean",
    failedRun: "Failed",
    stageFailed: "Did not finish",
    stage: {
      holds: "Holds",
      // Morning runs before 2026-10-04 carry a recurring stage; kept so their history still reads.
      recurring: "Recurring",
      emails: "Email retry",
      weekly: "Weekly summary",
      budgets: "Budget alerts",
      marks: "Marks",
      orderMarks: "Order prices",
      snapshot: "Snapshots",
      oauthPrune: "AI housekeeping",
      limitOrders: "Limit orders",
      pourClaims: "Order claims",
      rebuilds: "Merged histories",
      histories: "History backfill",
    } as Record<string, string>,
    recent: "Recent runs",
    email: "Email today",
    emailNote: "UTC day. Past the daily cap only security notices go out.",
    type: "Type",
    sentToday: "Sent or going",
    cap: "Cap",
    total: "All types",
    failedToday: "Failed today",
    suppressions: "Suppressed addresses",
    suppressionReason: { bounce: "Bounced", complaint: "Complaints", suppressed: "Suppressed by Resend", staff: "By staff" } as Record<string, string>,
    stuckSends: "Stuck sends",
    stuckNote: "Pending more than ten minutes. The morning and evening passes try them again.",
    noStuck: "None stuck.",
    x: "X column",
    xUsed: "Posts read today",
    xReserved: "Reserved in flight",
    xStored: "Posts stored",
    xLastFetch: "Last fetch",
    xFailing: "Queries failing",
    spend: "Paid services",
    spendNote: "Spend and what is left are on Budgets.",
    issues: "Error reports",
    issuesNote: "Failed orders file themselves on GitHub, one issue per cause.",
    issuesOff: "GITHUB_ISSUE_TOKEN is not set here.",
    issuesFailed: "GitHub could not be read just now.",
    noIssues: "No open reports.",
    comments: (n: number) => (n === 1 ? "1 repeat" : `${n} repeats`),
    claims: "Order claims waiting",
    claimsNote: "Orders whose fill was not confirmed when XP was asked for. The evening pass pays or drops them.",
    stuckClaims: "Waiting over two days",
    limits: "Limit orders waiting",
    resting: "Resting",
    partial: "Partly filled",
    ofCap: (used: string, cap: string) => `${used} of ${cap}`,
    suppressionCount: (n: string, last30: string) => `${n}, ${last30} in 30 days`,
    runLine: (at: string, ok: boolean) => `${at}, ${ok ? "clean" : "failed"}`,
    oldestCheck: "Oldest check",
    listings: "Listing registry",
    listingsNote: "pnpm listings:verify runs on a laptop against the live token list and the chain, and stores nothing. Run it before a release.",
  },
  budgets: {
    title: "Budgets",
    note: "Spend today and this month, and what is left. Where a provider has no balance to read, enter it from its dashboard; what is left is that less what Berth metered since, an estimate.",
    service: {
      openai: "Assistant, OpenAI",
      jev: "Jev, TypeSafe",
      x: "X API",
      resend: "Resend",
      neon: "Neon",
      vercel: "Vercel",
    } as Record<string, string>,
    source: {
      openai: "Berth's chat_usage, priced per token. Against CHAT_MONTHLY_BUDGET_USD.",
      jev: "Berth's own meter, by request size at $0.042 a million tokens. TypeSafe has no usage or balance API.",
      x: "Posts read per UTC day at $0.005 a post, from x_read_budget.",
      resend: "Notices sent, from email_sends, against the plan's quota.",
      neon: "Neon's usage API is for paid plans only.",
      vercel: "Vercel's billing API is for Pro plans only. The project is on Hobby.",
    } as Record<string, string>,
    meter: {
      budget: "House budget, this month",
      credit: "Prepaid credit",
      cap: "Daily post cap",
      quota: "Monthly quota",
      day: "Daily quota",
    } as Record<string, string>,
    today: "Today",
    month: "This month",
    left: "Left",
    unknown: "Enter a balance",
    runway: "Runs out in",
    threshold: "Alert at",
    lowThreshold: "Running low",
    lowRunway: "Running low at this pace",
    fine: "Fine",
    estimate: "Estimate",
    resets: (days: number) => `Resets in ${days < 1 ? "under a day" : days === 1 ? "1 day" : `${Math.floor(days)} days`}`,
    balanceLabel: "Balance, from the provider's dashboard",
    thresholdLabel: "Alert below",
    thresholdLabelUnit: (unit: string) => `Alert below, ${unit}`,
    save: "Save",
    balanceAt: (at: string) => `Balance read ${at}`,
    providerOpenai: (usd: string) => `OpenAI's own bill this month: ${usd}`,
    providerOpenaiOff: "Set OPENAI_ADMIN_KEY (an admin key, read only) to show OpenAI's own bill beside this.",
    providerX: (used: number, cap: number | null) => `X's own count this cycle: ${used.toLocaleString("en-US")}${cap ? ` of ${cap.toLocaleString("en-US")}` : ""} posts`,
    providerUnread: "The provider's figure could not be read just now.",
    alerts: "When something runs low, the morning run emails each staff admin, once per service a day.",
  },
  audit: {
    title: "Audit",
    note: "Every staff view of a person, exact search, reveal and change. Kept 24 months.",
    action: "Action",
    anyAction: "Any action",
    staff: "Staff",
    target: "Target",
    detail: "Detail",
    at: "When",
    empty: "Nothing logged yet.",
    filter: "Filter",
    staffPlaceholder: "Account id",
    targetPlaceholder: "user:<account id>",
    page: (page: number, pages: number) => `Page ${page} of ${Math.max(pages, 1)}`,
  },
  posts: {
    title: "Posts on X",
    note: "Every automatic post Berth tried on X, newest first, and how it ended. Read only: nothing here posts.",
    on: "Automatic posting is on.",
    off: "Automatic posting is off. It runs only in production with X_AUTOPOST_ENABLED set to 1.",
    tokenNone: "No token stored yet. The first run seeds it from the environment.",
    tokenDead: "X refused the stored token. Authorise the account again and set OAUTH_REFRESH_TOKEN to the new refresh token.",
    tokenUnreadable:
      "The stored token can no longer be read: its key changed (X_TOKEN_KEY, or X_CLIENT_SECRET when X_TOKEN_KEY is unset). Authorise the account again and set OAUTH_REFRESH_TOKEN to the new refresh token.",
    tokenRefreshed: (when: string) => `Token last refreshed ${when}.`,
    tokenError: (error: string) => `Last token problem: ${error}`,
    at: "When",
    source: "Source",
    status: "Result",
    text: "Post",
    link: "On X",
    open: "Open",
    empty: "Nothing tried yet.",
    sources: { campaign: "Campaign", calendar: "Calendar", news: "News", milestone: "Milestone" } as Record<string, string>,
    statuses: {
      sending: "Sending",
      posted: "Posted",
      unknown: "Unknown, may be live",
      failed: "Failed",
      skipped: "Skipped",
    } as Record<string, string>,
  },
};

export type StaffCopy = typeof STAFF_COPY;

/** Product analytics consent (components/analytics): the card, and the switch in Settings. */
export type AnalyticsCopy = {
  /** The card's title and the switch's label. */
  title: string;
  body: string;
  allow: string;
  decline: string;
  /** The link to the policy's analytics section. */
  more: string;
  /** Under the switch in Settings. */
  switchSub: string;
  /** Under the switch when the browser sends Do Not Track or Global Privacy Control. */
  signalNote: string;
};

/**
 * The three facts about the operator that the privacy policy names. The
 * country of establishment also sets the governing law and the lead
 * supervisory authority named in the policy.
 */
export const PRIVACY_OPERATOR = {
  name: "David",
  email: "support@berthmarkets.com",
  country: "the Netherlands",
  /** How both legal pages name the operator while Berth has no company. */
  description: "David, an individual based in the Netherlands",
} as const;

/** The one effective date both legal pages carry, and their "What changed" headings (lib/legal-version). */
export { LEGAL_EFFECTIVE_DATE };

/**
 * Where Berth may be used, as the terms of use state it, and the one list
 * the availability gate (lib/availability, lib/server/availability) reads,
 * so the terms and the gate can never disagree. This is a DEFAULT, not a
 * decision: Robinhood's stock tokens are issued for customers outside the
 * United States, so the United States is excluded until someone with
 * standing says otherwise, and the sanctioned places are the ones under
 * comprehensive sanctions that the sanctions clause already covers.
 *
 * TODO(David): confirm this list with counsel before the terms are relied
 * on or a directory listing names its countries. Add a place here and both
 * the terms and the gate follow.
 *
 * Codes are what Vercel reports: `x-vercel-ip-country` is ISO 3166-1
 * alpha-2, `x-vercel-ip-country-region` the region part of ISO 3166-2
 * ("43" for UA-43). A region is written here in full ("UA-43").
 *   US and its territories: PR Puerto Rico, GU Guam, VI US Virgin Islands,
 *   AS American Samoa, MP Northern Mariana Islands, UM the minor outlying
 *   islands. Ukraine: UA-43 Crimea, UA-40 Sevastopol, UA-14 Donetsk,
 *   UA-09 Luhansk (every region here is in Ukraine; the terms say so).
 *
 * The occupied regions may not arrive as Ukraine (checked 2026-09-30):
 * - Vercel does not say which geolocation database it uses, or what it
 *   answers for these areas. Unverified; worth one real request from there.
 * - ISO 3166-2:RU has no code for Crimea or Sevastopol, so an ISO faithful
 *   database answers UA-43 and UA-40 (MaxMind places Crimea in UA).
 * - Some databases still use the old FIPS codes, UA-11 Krym and UA-20
 *   Sevastopol; neither is an ISO code for anywhere else in Ukraine, so
 *   both are gated. The FIPS codes for Donetsk and Luhansk collide with
 *   ISO codes for free oblasts, so they are not.
 * - IPs of the Russian ISPs serving these areas can geolocate to RU. Codes
 *   some databases use for them, RU-CR and RU-SEV (Crimea,
 *   Sevastopol) and RU-DPR and RU-LPR (Donetsk, Luhansk), are gated,
 *   unverified. Where such an IP reads as a Russian oblast (Rostov, say)
 *   nothing here can tell it apart, and it passes.
 */
export const TERMS_AVAILABILITY = {
  /**
   * Not offered: no new account, buy, limit buy, reward, XP or assistant
   * connection, while an account that already exists can always see, sell,
   * withdraw, cancel a limit order, cash out and export its keys.
   * `reason` picks the landing's words; `persons` also bars the country's
   * citizens and residents wherever they are, as the terms say.
   * Russia and Belarus (2026-10-04): under wide EU sanctions on financial
   * and crypto services to their residents. They were open until then, so
   * accounts there likely exist, and their holdings sit in a SODAX hub
   * wallet reachable only through an app like Berth; they get this
   * treatment, not the sanctioned one, so no one there is cut off from
   * what they hold.
   */
  excluded: [
    { name: "the United States", countries: ["US", "PR", "GU", "VI", "AS", "MP", "UM"], reason: "united-states", persons: true },
    { name: "Russia", countries: ["RU"], reason: "not-offered", persons: false },
    { name: "Belarus", countries: ["BY"], reason: "not-offered", persons: false },
  ],
  /**
   * Under comprehensive sanctions: whole countries. Here, and in the
   * regions below, Berth serves nothing beyond its public pages, not even
   * an account that already exists: no sign in, buy, sell, withdraw, limit
   * order, plan or assistant approval (decided 2026-09-30). The exception
   * for an existing account (see, sell, withdraw, cancel, export keys) is
   * for the places in `excluded` only: the United States and its
   * territories, Russia and Belarus.
   * TODO(David): confirm with counsel, both the lists and that a person
   * there must not even withdraw through Berth. Their holdings stay in their
   * Berth account on the SODAX hub, but reaching them needs software that
   * can instruct SODAX's contracts, and Berth will not serve them there.
   */
  sanctionedCountries: [
    { name: "Cuba", countries: ["CU"] },
    { name: "Iran", countries: ["IR"] },
    { name: "North Korea", countries: ["KP"] },
    { name: "Syria", countries: ["SY"] },
  ],
  /** Under comprehensive sanctions: regions of Ukraine. */
  sanctionedRegions: [
    { name: "Crimea", regions: ["UA-43", "UA-40", "UA-11", "UA-20", "RU-CR", "RU-SEV"] },
    { name: "Donetsk", regions: ["UA-14", "RU-DPR"] },
    { name: "Luhansk", regions: ["UA-09", "RU-LPR"] },
  ],
} as const;

/** "A", "A and B", "A, B and C". */
function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "the United States", "the United States or Canada", "A, B or C". */
function orList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/** Names joined for a sentence that says "nothing about": "NVIDIA, Apple or Tesla", "NVIDIA, Apple or 2 others". */
function orNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  return `${names[0]}, ${names[1]} or ${names.length - 2} others`;
}

const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

/** A small count in words ("three more"), so a shared post carries no figures. */
function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

export const COPY: Copy = {
  brand: "Berth",
  tagline: "A place to tie up.",
  welcomeLede:
    "Buy NVIDIA, Apple, the S&P 500 ETF or Gold with the stablecoins, ETH, SOL or Bitcoin you already hold, from more than 20 networks, in one signature.",
  signInEmail: "Continue with email",
  connectWallet: "Connect a wallet",
  noSeedPhrases: "An email is enough. No seed phrase, and the keys are yours to export.",
  walletDetectedLead: "Or continue with a wallet you already have",
  continueWithWallet: (name) => `Continue with ${name}`,
  walletConnecting: (name) => `Waiting for ${name}…`,
  walletConnectFailed: "Could not connect. Try again, or continue with email.",

  beta: {
    tag: "Beta",
    openLabel: "About the beta label",
    body: "Berth is new. We are still improving it, and your feedback helps.",
    contactLabel: "support@berthmarkets.com",
    contactHref: "mailto:support@berthmarkets.com",
  },

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
  receiveEvmTitle: "Base, Arbitrum and other EVM networks",
  receiveEvmBody:
    "One address for Ethereum, Base, Arbitrum, Polygon, BNB and every other EVM network.",
  receiveEvmToast: "Works on every EVM network. Send crypto there to add money.",
  receiveSolanaTitle: "Solana",
  receiveSolanaBody: "Only for Solana assets: SOL, JitoSOL, USDC on Solana.",
  receiveSolanaToast: "Only send Solana assets to this one.",
  receiveBitcoinTitle: "Bitcoin",
  receiveBitcoinBody: "Your linked Bitcoin wallet. Only send Bitcoin to it.",
  receiveBitcoinToast: "Only send Bitcoin to this one.",
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
  unavailable: {
    title: "Berth isn't available where you are",
    sanctionsTitle: "Berth can't serve this place",
    fundsStay: "Anything you hold stays in your own wallet, or in your Berth account, which your wallet controls. Berth never held it, so nothing of yours is kept here.",
    reason: {
      "united-states":
        "The stocks on Berth are tokens issued for people outside the United States, so Berth can't open an account or take an order here.",
      "not-offered": "Berth isn't offered in this country, so it can't open an account or take an order here.",
      sanctions:
        "Berth can't be used from a country or region under sanctions, so it offers nothing here beyond these public pages.",
    },
    nothingKept: "Nothing was taken, and nothing about you was stored.",
    accountKept: "Nothing was taken. Your account and what you own are just as they were.",
    readOn: "You're welcome to read on.",
    links: { welcome: "How Berth works", terms: "Terms of use", privacy: "Privacy", assistants: "Assistants" },
    support: "Questions are welcome at",
    haveAccount: "Already have a Berth account? You can always see it, sell and withdraw.",
    drawerTitle: "Buying isn't available where you are",
    drawerBody: "Selling and withdrawing work as always, and what you own stays yours.",
    close: "Close",
    authorizeBody: "No assistant was connected, and nothing was shared.",
    noAccountTitle: "There's no Berth account for this sign in",
    noAccountBody: "Berth can't open a new account where you are, so none was made.",
    signOut: "Sign out",
    banner:
      "You're somewhere Berth isn't available. You can see what you own, sell and withdraw as always. Buying waits until you're back.",
    draftRefused:
      "Berth isn't available where this person is right now, so it can't draft a buy. They can still see what they own, sell and withdraw in Berth. Say this plainly and kindly, without guessing where they are, and mention support@berthmarkets.com for questions.",
  },
  footerNote:
    "Stock tokens track a share; they are not the share. Read what you own before you buy.",
  firstLook: {
    rowInNews: ", in today's news",
    rowInNewsWeek: ", in recent news",
    inNews: (name) => `${name} is in today's news.`,
    inNewsWeek: (name) => `${name} was in the news this past week.`,
    readNews: "Read the news",
    move: (name, direction, pct) => `${name} ${direction} ${pct} on the last trading day, more than it usually moves.`,
    newsNote: "News to read, not advice.",
    ask: (name) => `Ask about ${name}`,
    askPrompt: (name) => `What has been in the news about ${name} this week?`,
    firstStockTitle: "Your first stock",
    firstStockLine: (name) =>
      `${name} is in your account as a token that tracks its share price. It is yours, in an account your wallet controls, and you can sell it any day under What you own.`,
    dismiss: "Got it",
  },
  calmHome: {
    addTitle: "Add money to begin",
    addLine: "Pay by card or bank, or send crypto you already hold. Then choose a stock.",
    addAction: "Add money",
    walletAddLine:
      "Berth pays from the wallet you connected. If it holds nothing yet, send it stablecoins, ETH, SOL or Bitcoin first.",
    walletAddAction: "Choose a stock",
    browse: "See what you can buy",
    firstTitle: "Buy your first stock or fund",
    firstReady: (amount) => `${amount} is ready to spend. Choose one to start, or look through them all.`,
    firstFromCash: "Your money is parked as cash, just below. Take some out there to spend it, or add money.",
    walletCashLine:
      "Your money is parked as cash, just below. Take some out there to spend it, or choose a stock and pay from your wallet.",
    walletAddTitle: "Pay from your wallet",
    vaultLine: (amount) =>
      `Your earlier vault position${amount ? `, worth ${amount},` : ""} is just below and can be withdrawn. Then choose a stock or fund.`,
    addTitleCash: "Add money to buy",
    firstReadyUnpriced: "Your wallet holds crypto Berth can pay with. Choose one to start, or look through them all.",
    cardRowTitle: "Card or bank",
    pickLabel: "Some well known names",
    firstChoose: "Choose one above",
    firstBuy: (name) => `Buy ${name}`,
    seeAll: (count) => `All ${count} stocks and funds`,
    buyAction: "Buy",
    compareShow: "How it compares",
    compareHide: "Hide the comparison",
    addMoneyTitle: "Add money",
    addMoneySub: "Choose how to pay. What you add lands in your account, ready to buy with.",
    moreLabel: "More on Berth",
    moreBoardSub: "Every stock and fund, with today's moves.",
    moreNewsSub: "Stories about the stocks on Berth.",
    moreAiSub: "Let Claude, ChatGPT or Grok read your account.",
  },
  firstPath: {
    progress: (index, total) => `Step ${index} of ${total}`,
    skip: "Skip for now",
    skipped: "Set aside for now",
    undo: "Undo",
    titles: {
      avatar: "Choose your avatar",
      username: "Pick a username",
      money: "Add money",
      walletMoney: "Pay from your wallet",
      firstBuy: "Your first buy",
      invite: "Invite a friend",
    },
    done: {
      avatar: "Avatar chosen.",
      username: "Username picked.",
      money: "Money added.",
      walletMoney: "Your wallet can pay.",
      firstBuy: "Your first buy is in.",
      invite: "Invite sent.",
      inviteCopied: "Link copied.",
    },
    doneNext: (title) => `Next: ${title}.`,
    doneLast: "That was the last step.",
    avatarSub: "Tap a face to make it yours, then save it. It sits beside your name and rank.",
    usernameSub: "Friends find you by your exact username. Your profile never shows money, and shows what you hold only to friends if you turn it on.",
    usernameNeedsEmail: "A username needs an email on the account. Add one here first.",
    inviteSub: "Send your friend link. Anyone with it can ask to be friends.",
    inviteNeedsName: "Your friend link needs a username first.",
    inviteNeedsNameAction: "Pick a username",
    firstUnfunded: "Choose one to buy. The order asks how to pay, and you can add money there.",
    firstFunded: "Your money is ready. Choose your first stock or fund on the home.",
    xpFirstBuy: (amount) => `+${amount} XP when your first buy fills`,
    goMoney: "Add money",
    goWalletMoney: "Choose a stock",
    goFirstBuy: "Choose your first buy",
    setUpTitle: "You're set up",
    setUpLine: "That is everything. From here your home shows what you own and what you can buy.",
    setUpLineAway: "That is everything for now. Your profile and friends are ready.",
    setUpLineSome: "Your account is ready.",
    setUpSkipped: "You set these aside. Each is here if you want it now.",
    setUpClose: "Done",
    followOnX: "Follow Berth on X",
    quietAvatar: "A face beside your name and rank",
    quietUsername: (amount) => `So friends can find you · +${amount} XP`,
  },
  welcomePage: {
    navLabel: "Berth",
    eyebrow: "Wall Street, in your wallet.",
    headlineLead: "Stocks for the money that ",
    headlineMark: "already lives onchain.",
    emailCta: "Sign in with email",
    onNetwork: (network) => `on ${network}`,
    // Swap this href for Berth's own Colosseum project page once it exists.
    colosseum: { label: "Colosseum 2026 entry", href: "https://colosseum.com/" },
    superteam: { label: "Superteam Netherlands", href: "https://nl.superteam.fun" },
    sections: {
      what: {
        title: "US stocks and funds, in an account your wallet controls.",
        line: "NVIDIA, Apple, Tesla, the S&P 500 ETF, Gold and more, priced live. Each is a token that tracks a share.",
      },
      pay: {
        title: "Pay with what you hold, on more than 20 networks.",
        line: "Stablecoins, ETH, SOL or Bitcoin. You sign once, and independent solvers fill the order through SODAX.",
        draft: "One buy, one signature",
        buy: "Buy",
        amount: "Amount",
        payWith: "Pay with",
      },
      custody: {
        title: "Your keys, your funds, your signature.",
        line: "Berth is software, not a broker. It never holds your keys or your funds.",
        keys: "Your keys",
        funds: "Your funds",
        orders: "Every order",
        withYou: "With you",
        signedByYou: "Signed by you",
      },
    },
    films: {
      hero: {
        line: "Buy a company by name, sign once, and climb the ranks beside your friends.",
        label: "A short film: your avatar and what you hold, a buy of a stock by name signed once, a new rank and a board of friends.",
      },
      wallStreet: {
        line: "One buy of Tesla, paid with the ETH you already hold, in one signature.",
        label: "A short film: a $50 buy of Tesla, paid with ETH on Arbitrum and signed once in your own wallet, with no bridge or swap first.",
      },
      soundOn: "Sound on",
      soundOff: "Sound off",
      play: "Play the film",
    },
    legal:
      "Not available in the United States or where local law or sanctions forbid it. Stocks on Berth are tokens that track a share, issued by third parties. Nothing here is advice, and past results say nothing about the future.",
  },

  accountTotalLabel: "Your account",
  accountTotalSub: "Funds, holdings and cash, in one figure.",
  lastKnownUpdating: "Updating",
  lastKnownAsOf: (when) => `Showing what we last read, ${when}, while the latest arrives.`,
  accountSplitHoldings: "Stocks",
  portfolioSameDays: "Same money, same days",
  portfolioReturnCaption: "Returns, money in and out set aside",
  holdingsSubline: "Since you bought, beside the S&P 500 ETF.",
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
  mostBoughtTitle: (week) => `Most bought on Berth, the week of ${week}`,
  mostBoughtRow: (people, plus) => `Bought by ${people}${plus ? "+" : ""} ${people === 1 && !plus ? "person" : "people"}`,
  mostHeldTitle: (week) => `Most held on Berth, the week of ${week}`,
  mostHeldRow: (oneIn) => `Held by 1 in ${oneIn} people who own a stock or fund on Berth`,
  mostHeldInfoLabel: "About Most held on Berth",
  mostHeldInfo: "Counted once a week among people who own a stock or fund on Berth, always rounded to the smaller share, and shown only once enough people hold it.",
  friendsHold: (count, names) =>
    names.length === 1
      ? `Held by your friend ${names[0]}`
      : names.length === 2
        ? `Held by your friends ${names[0]} and ${names[1]}`
        : `Held by ${count} of your friends`,
  friendsHoldMore: (more) => `+${more}`,
  socialNotice: {
    text: "New: each week, the board shows how many people bought each stock, never who. You can also let friends see which stocks and funds you hold. It is off unless you turn it on.",
    action: "See the switch",
    dismiss: "Got it",
  },
  termsSheet: {
    title: "Berth's terms",
    lede: "Before you go on, the short version.",
    summary: (feePct) => [
      "Berth is software, not a broker or an adviser. Nothing in it is advice.",
      "You sign every order yourself. Berth never holds your keys or your money.",
      "The stocks are tokens issued by others that track a share. They are not the share, and you can lose what you put in.",
      `Berth takes a ${feePct} fee on every order.`,
    ],
    read: "The full text:",
    terms: "Terms of use",
    privacy: "Privacy policy",
    accept: "Accept",
    notNow: "Not now",
    buyNote: "Selling and withdrawing never wait on this.",
    continueSell: "Sell without accepting",
    sellNote: "You can sell without accepting. Buying waits until you do.",
    failed: "That did not save. Try again.",
  },
  policyNotice: {
    text: `Our terms and privacy policy are new from ${LEGAL_EFFECTIVE_DATE}. They say more plainly what Berth is and is not, and from the week of 19 October the board shows Most held on Berth: a rounded share of the people who hold each stock or fund, never who.`,
    terms: "Terms",
    privacy: "Privacy",
    dismiss: "Got it",
  },
  newsMoreStories: "More stories",
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
  fundsStillReading: (chains) => `Still reading ${chains}.`,
  fundsWhatsInside: "What is inside",
  fundsNeedsGas: "needs a network fee",
  topUp: "Add money",
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
  holdingBenchmark: "S&P 500 ETF",
  holdingsMarketDays: (days) => marketDays(days),
  moveInTheNews: (source) => `In the news: ${source}`,
  moveReadPost: (source) => `Read what ${source} posted, on X`,
  holdingsBenchmarkNote:
    "The line is the return on your money so far, each day at the close and today at the live price, beside the return of the same money put on the same days into what you compare it with. Both start at 0% together and count the same money on the same days, so the gap between them is the difference, your fee included. The return is time weighted: money you add or take out moves neither line, only prices do. Where a return cannot be told, the line shows your money in dollars instead and says why. Coins waiting in your wallets are not in the line; Treasury bills you hold are. Prices are one a day, so a few days mostly shows noise. Each day under the line is what your holdings made or lost that day, with buys and sells set aside, and the holding that moved most. A ringed dot on the line is a buy, a hollow ring a sell. The line under each holding sets that holding alone beside the S&P 500 ETF. It describes what happened, and says nothing about what to do.",
  portfolioSince: (date, days) => `Since ${date}, ${marketDays(days)}.`,
  portfolioYou: "You",
  portfolioSameDollarsIn: {
    SPY: "the same money in the",
    QQQ: "the same money in the",
    PAXG: "the same money in",
    BTC: "the same money in",
    SGOV: "the same money in",
  },
  portfolioCompareWith: "Compare with",
  portfolioChooserHint: "What your money is compared with. Choose another.",
  portfolioFirstDay:
    "Your first day, from what you paid, fee included, to what it is worth now. Daily values start after the next close.",
  portfolioFirstDayWait: "Your first day. The line starts once the next market day's prices are in.",
  portfolioWhenBought: "When you bought",
  portfolioNow: "Now",
  portfolioSinceBuy: "since you bought",
  portfolioToday: "Today",
  portfolioWeekLabel: "Your last seven market days",
  portfolioFirstWeek: (day) => `Your first seven market days. Day ${day}.`,
  portfolioDayAria: (date, change, mover) =>
    [date, change ?? "No figure for this day", mover ? `Moved most: ${mover}` : null].filter(Boolean).join(". ") + ".",
  portfolioDayUp: (pct, usd) => `Up ${pct}, ${usd}`,
  portfolioDayDown: (pct, usd) => `Down ${pct}, ${usd}`,
  portfolioDayFlat: "Unchanged",
  portfolioFromBuy: "Since you bought",
  portfolioDayUnknown: "No figure for this day, a price is missing.",
  portfolioBought: (name) => `You bought ${name}`,
  portfolioSold: (name) => `You sold ${name}`,
  portfolioMoreOrders: (count) => `and ${count} more ${count === 1 ? "order" : "orders"}`,
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
    SPY: "S&P 500 ETF",
    QQQ: "Nasdaq 100 ETF",
    PAXG: "Gold",
    BTC: "Bitcoin",
    SGOV: "Treasury bills",
  },

  newsTitle: "In the news",
  newsEmpty: "Nothing new about these right now.",
  newsFilteredTo: (name) => `${name} only`,
  newsShowAll: "Show all",
  newsEmptyFor: (name) => `Nothing new about ${name} right now.`,
  newsByline: (source, when) => `${source}, ${when}`,
  newsRefresh: "Refresh the news",
  newsRefreshing: "Refreshing the news",
  newsUpdated: (when) => `Updated ${when}`,
  newsUpToDate: (when) => `Up to date, updated ${when}`,
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
  cashHint: "Idle money sits in a token tracking a fund of short Treasury bills, not in a lending pool.",
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
  buySub: "Pay with what you hold, from more than 20 networks. It lands in your account.",
  orderTitleFallback: "Place an order",
  whatPayingWith: "What are you paying with?",
  findingPayWith: "Finding what you can pay with",
  gasShortWarning: (chainName, symbol) =>
    `Your ${chainName} wallet holds no ${symbol} for the network fee. This order pays its fee in ${symbol}, so it cannot start until some arrives.`,
  gasShortCta: (symbol) => `Send a little ${symbol} to your address`,
  gasNeededToPay: (symbol, chainName) =>
    `You need a little ${symbol} on ${chainName} to pay the network fee.`,
  gasNeededNative: (symbol, chainName) =>
    `Your ${symbol} on ${chainName} would all go to the network fee. Add a little more to pay with it.`,
  gasHelpLabel: "Why this cannot pay",
  ctaNeedsGas: (symbol) => `Not enough ${symbol} for the network fee`,
  gasFloorWarning: (symbol) =>
    `Some wallets ask for a higher network fee. If yours refuses, add a little ${symbol}.`,
  noNetworkFeeOn: (chainName) => `No network fee to pay on ${chainName}.`,
  noNetworkFeeNote: "no network fee",
  gasCoveredChains: (chainNames) => `Buying from ${chainNames} has no network fee to pay.`,
  listAnd: "and",
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
  ctaWakeWallet: (name) => (name ? `Open ${name} to sign` : "Open your wallet to sign"),
  wakeWalletFailed: (name) =>
    name ? `${name} did not open. Unlock it, then try again.` : "Your wallet did not open. Unlock it, then try again.",
  walletAsleepLabel: "Signed in",
  walletAsleepNote: (name) => (name ? `Open ${name} when you want to sign.` : "Open your wallet when you want to sign."),
  walletSignOutLabel: "Sign out",
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
  addFunds: "Add money",
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
  stepMsgApprovingHeadless: "Approving the spend…",
  stepMsgSending: "Sending your order…",
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
  errOutcomeUnknown: "This order may still go through. Check What you own in a minute before trying again.",
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
  currencyNames: {
    USD: "US dollars",
    EUR: "euros",
    GBP: "pounds",
    JPY: "yen",
    KRW: "won",
    AUD: "Australian dollars",
  },
  fxNote: (currencyName) =>
    `Berth's listings are priced in US dollars. Figures in ${currencyName} use the European Central Bank's rate for the day, so they move with the exchange rate as well as the market.`,
  fxCredit: "Exchange rates: European Central Bank, published once a business day.",
  fxRateOf: (day) => `Rate of ${day}.`,
  moneyAboutAtTodaysRate: (amount) => `about ${amount} at today's rate`,
  moneyAboutAtRateOf: (amount, day) => `about ${amount} at the rate of ${day}`,
  inUsDollars: "Changes in US dollars",
  inUsDollarsNote:
    "The percentages here are the change in US dollars, the currency Berth's listings are priced in. Figures in your own currency use the latest rate for every day, so the line's shape is the dollar line's.",

  infoTitle: "How Berth works",
  infoSub: "What an order does, what you own, and what it costs.",
  infoHowTitle: "One signature, any network",
  infoHowBody:
    "You pay with what you hold, on the network where you hold it, and sign once. Independent solvers fill the order through SODAX and deliver the stock token to your account. Selling works the same way in reverse. Orders fill any day, weekends included. Berth never holds your funds.",
  infoOwnTitle: "What you own",
  infoOwnBody:
    "A Robinhood Stock Token is a debt security issued by Robinhood Assets in Jersey that tracks the price of a share and its dividends. It is not the share itself: no voting rights, and the issuer's credit risk sits with you. Cash you park is a token tracking a fund of short US Treasury bills.",
  infoFees: (feePct) =>
    `Every order includes a ${feePct} fee, taken from the amount before the order is filled. There are no other charges from Berth.`,
  infoBuiltTitle: "How it was built",
  infoBuiltBody:
    "On the SODAX System, which reaches more than 20 networks, native Bitcoin among them, and written with Claude in the open.",
  infoBuildersCta: "See how it is built at SODAX Builders",
  infoDocsCta: "SODAX developer docs",

  walletAccountDrawerTitle: "Your account",
  walletAccountDrawerSub: "Your rank, rewards and avatar, and the AI you bring Berth into.",
  fundsAddedTitle: "Money added",
  fundsAddedBody: "USDC is on its way to your account.",
  walletEmbeddedLabel: "Your account wallet",
  walletEmbeddedNote: " · from your email sign in",
  walletConnectedLabel: "Connected",
  rankLine: (level, xp) => `Level ${level} · ${xp} XP`,
  xpPlus: (amount) => `+${amount.toLocaleString()} XP`,
  xpReasons: (reasons) =>
    reasons.length <= 1 ? (reasons[0] ?? "") : `${reasons.slice(0, -1).join(", ")} and ${reasons[reasons.length - 1]}`,
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
        : `Unlocks the ${unlock.face} avatar.`,
  unlockDone: (unlock) =>
    unlock.kind === "chat"
      ? "The Assistant, Berth's own AI, is open to you."
      : unlock.kind === "invite"
        ? "Your own invite link is open to you."
        : `The ${unlock.face} avatar is yours to wear.`,
  levelUpTitle: (rankName) => `You reached ${rankName}`,
  levelUpLine: (level, total, reason) =>
    `Level ${level} · +${total.toLocaleString()} XP${reason ? ` ${reason}` : ""}`,
  levelUpUnlock: (unlock) =>
    unlock.kind === "chat"
      ? "The Assistant is open. It is at the top of the screen."
      : unlock.kind === "invite"
        ? "Your own invite link is ready in your account."
        : `The ${unlock.face} avatar is now in your avatar picker.`,
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
    `Your first trade paid you +${amount} XP.`,
  inviteFirstTradePending: (amount) =>
    `Make your first trade and +${amount} XP lands for you.`,
  inviterLevel: (level) => `Level ${level}`,
  invitedFriendsWith: (name) =>
    name ? `You and ${name} are now friends.` : "You are now friends.",
  claimAskTitle: "Arrived on a friend's invite?",
  claimAskSub: "Enter their code so the invite counts.",
  claimInputLabel: "Your friend's invite code",
  claimPlaceholder: "eight letters",
  claimCta: "Claim",
  claimMissed:
    "That code did not take. Check it with your friend; codes never use the letters i, l, o or the digits 0 and 1.",
  claimSuccessTitle: "Invite claimed",
  claimSuccessSub: "You arrived on your friend's invite.",
  inviteRowTitle: "Invite a friend",
  inviteRowCopied: "Link copied",
  inviteRowSub: (amount) =>
    `+${amount} XP when a friend you invite sets up their account and still uses Berth a week later.`,
  inviteTaps: (taps) =>
    taps === 1
      ? "Your link has been opened once."
      : `Your link has been opened ${taps} times.`,
  friendsTitle: "Friends",
  friendsTally: (joined, stayed, taps) =>
    `${joined} joined · ${stayed} stayed${taps > 0 ? ` · ${taps} link opens` : ""}`,
  xpBankedWord: "earned",
  xpPendingWord: "pending",
  copyNudge: "Copy a message to send",
  nudgeCopiedTitle: "Message copied",
  nudgeCopiedSub: "Send it however you like.",
  nudgeMessage: (link) =>
    `I have a place for you at Berth. US stocks by name, held in an account your wallet controls: ${link}`,
  ledgerTitle: "Activity",
  ledgerLoading: "Loading…",
  ledgerEmpty: "Nothing yet. Your first trade will show here.",
  ledgerHoldsTitle: "Coming ashore",
  ledgerHoldReason: (name) =>
    name === null ? REWARD_REASONS.held_30_days : `for holding ${name} thirty days`,
  ledgerHoldDue: (date) => `on ${date}`,

  newsVerdictMaterial: "Material news",
  newsVerdictFact: "New fact",
  newsVerdictAnalysis: "Analysis",
  newsVerdictLabel: (verdict) => `Read as ${verdict.toLowerCase()}`,

  newsStoriesHint:
    "Stories about the stocks and funds on Berth, from the publishers, the companies' own accounts and the SEC. Each story shows once, from its first source, with who else reported it. Tapping a headline opens the publisher's own page.",
  newsAboutStories: "A story is kept only when it is about the company or fund and reports something.",
  newsReadKept: (read, kept) => `${read} stories looked at in the last day, ${kept} kept.`,
  newsForWhatYouOwn: "For what you own",
  newsComingUp: "Coming up",
  newsRecentlyFiled: "Recently filed",
  newsAcrossBerth: "Across Berth",
  quietDayTitle: "Quiet day for what you own.",
  quietDayBody: (names) => `Nothing new about ${orNames(names)} in the last day and a half.`,
  quietDayNotRead: (names) => `No stories about ${orNames(names)} have been checked yet.`,
  quietDayUnjudged: "The latest stories about what you own are still being looked at.",
  newsUnavailable: "The news cannot be read right now.",
  alsoReportedByPrefix: "Also reported by",
  alsoReportedBy: (count) => (count === 1 ? "Also reported by one other" : `Also reported by ${count} others`),
  alsoOnX: "Also on X:",
  eventFiling: (name, report, date) =>
    report === "quarterly"
      ? `${name} filed its quarterly report with the SEC on ${date}.`
      : report === "annual"
        ? `${name} filed its annual report with the SEC on ${date}.`
        : `${name} filed a report with the SEC on ${date}.`,
  eventReadOnSec: "Read it on sec.gov",

  nudgeAddFunds: "Your account is empty. Add money by card, bank or crypto whenever you are ready.",
  nudgeAddFundsAction: "Add money",
  nudgeFirstBuy: "Your funds have arrived. Choose any name on the board when you are ready.",
  nudgeHeldNews: (name) => `There is news about ${name} today.`,
  nudgeHeldNewsAction: "Read it",
  nudgeParkCash: "Idle money can wait in Cash, a Treasury bill fund, until you need it.",
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
  authorizeScopeDraft: "Draft a buy or a sell. Nothing happens until you check it and sign, here in Berth.",
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
    "Let your AI read your account. It can see what you own, what the same money would have made in other holdings, and what moved today. It can draft a buy or a sell, and nothing happens until you check it and sign, here in Berth.",
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

  draftOpenedTitle: "Drafted by your AI",
  draftOpenedBody: "Check the amount and what you pay with. Nothing is sent until you sign.",
  draftUnknownListing: "That draft names something Berth does not offer.",
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
  limitSummaryFeeNoGas: (fee, chainName) => `Fee ${fee}. No network fee to pay on ${chainName}.`,
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
  email: {
    openBerth: "Open Berth",
    notYou: "Not you? Write to us at",
    securityWhy: "This is a security notice. Berth sends these to every account with an email, whatever your email settings say.",
    why: {
      orders: "You get this because emails about your orders and payments are on.",
      friends: "You get this because friend emails are on.",
      weekly: "You get this because the weekly summary is on.",
    },
    unsubscribe: "Turn these off",
    signoff: "Berth. Wall Street, in your wallet.",
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
    staffReveals: {
      subject: "Many reveals in the staff area",
      heading: "Many reveals in an hour",
      body: (staff, count) => `The staff account starting ${staff} revealed ${count} email or wallet addresses in the last hour.`,
      after: "If that was not expected, use Sign out everywhere for that account and take it off the staff list. Each reveal and its reason is in the audit log.",
      button: "Open the audit log",
    },
    budgetLow: {
      service: { openai: "the Assistant's OpenAI budget", jev: "the news model credit", x: "the X API credit", resend: "the Resend email quota" },
      subject: (service) => `Running low: ${service}`,
      heading: "A paid service is running low",
      body: (service, remaining, estimate) => `${service.charAt(0).toUpperCase()}${service.slice(1)} has ${remaining} left${estimate ? ", by Berth's own estimate" : ""}.`,
      runway: (days) => (days < 1 ? "At the last week's pace it runs out within a day." : `At the last week's pace it runs out in about ${days === 1 ? "1 day" : `${days} days`}.`),
      after: "Top it up on the provider's own dashboard, then enter the new balance on the Budgets page. This email comes at most once a day for each service.",
      button: "Open Budgets",
      why: "You get this because you are a staff admin of Berth.",
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
        draft: "Draft a buy or a sell, which you check and sign in Berth.",
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
    payoutSource: {
      subject: (change, campaign) => `A payout wallet was ${change} on ${campaign}`,
      heading: (change) => (change === "added" ? "A payout wallet was added" : "A payout wallet was removed"),
      body: (change, campaign, address) =>
        change === "added"
          ? `${address} can now pay rewards for ${campaign}. When you record a reward as paid, Berth accepts USDC sent from this wallet.`
          : `${address} may no longer pay claims of ${campaign}. Claims it already paid stay paid.`,
      reasonLabel: "Reason given",
      button: "Open the campaigns",
    },
    campaignPaid: {
      subject: (amount) => `${amount} in USDC was added to your Berth account`,
      heading: "Your offer was paid",
      body: (amount, chain) => `${amount} in USDC was sent to your Berth account on ${chain}, for opening your account through a Berth offer and staying.`,
      after: "It is yours to keep, spend or take out, like any other money in your wallet.",
    },
    weeklySummary: {
      subject: (weekOf) => `Your Berth week of ${weekOf}`,
      heading: "Your week",
      intro: (weekOf, closeDay) =>
        closeDay
          ? `Here is your account for the week of ${weekOf}, as of the close on ${closeDay}.`
          : `Here is what happened in your account in the week of ${weekOf}.`,
      previewWorth: (worth, closeDay) => `Your account was worth ${worth} at the close on ${closeDay}.`,
      previewPlain: "What happened in your account last week.",
      account: {
        heading: "Your account",
        worth: "Worth at the close",
        change: "Your change this week",
        benchmark: (name) => `${name}, same days`,
        changeNote: "Your change counts what your holdings did, not money you added or took out.",
      },
      holdings: {
        heading: "What you hold",
        note: "Beside each, its price's move over the week.",
        more: (count, afterList) => (afterList ? `And ${count} more` : `${count} ${count === 1 ? "holding" : "holdings"}`),
      },
      orders: {
        heading: "Orders",
        filled: "Filled",
        filledValue: (buys, sells, limits) => {
          const counted = [buys > 0 ? `${buys} ${buys === 1 ? "buy" : "buys"}` : null, sells > 0 ? `${sells} ${sells === 1 ? "sell" : "sells"}` : null]
            .filter(Boolean)
            .join(", ");
          const total = buys + sells;
          if (limits <= 0) return counted;
          if (limits >= total) return `${counted}, ${total === 1 ? "a limit order" : total === 2 ? "both limit orders" : "all limit orders"}`;
          return `${counted}, of which ${limits} ${limits === 1 ? "was a limit order" : "were limit orders"}`;
        },
        limits: "Limit orders",
        limitsValue: (expired) => `${expired} expired`,
      },
      friends: { heading: "Friends", added: "New friends", salutes: "Salutes" },
      after: "Values are at the market's close, in US dollars.",
    },
    settings: {
      sectionLabel: "Email",
      goesTo: (address) => `Notices go to ${address}.`,
      securityAlways: "Security notices always reach you: a wallet added or removed, accounts merged, an AI connected.",
      kinds: {
        orders: { label: "Orders and payments", sub: "When a limit order fills or expires, and when an offer's USDC is paid." },
        friends: { label: "Friends", sub: "When someone asks to be your friend." },
        weekly: { label: "Weekly summary", sub: "On Mondays, your week beside the S&P 500 ETF." },
      },
      addEmail: "Add an email to get notices",
      addEmailSub: "Security and order notices, by mail.",
      undeliverable: "Mail to this address did not arrive, so Berth stopped sending. Write to us to start again.",
      saveFailed: "That did not save. Try again.",
    },
    unsubscribePage: {
      title: "Email settings",
      kindName: { orders: "order", friends: "friend", weekly: "weekly summary" },
      confirm: (kind) => `Turn off ${kind} emails?`,
      confirmSub: "Security notices still reach you whatever you choose here.",
      confirmButton: "Turn off",
      done: (kind) => `${kind.charAt(0).toUpperCase()}${kind.slice(1)} emails are off.`,
      doneSub: "Security notices still reach you. You can turn this back on here or in Berth's settings.",
      turnBackOn: "Turn back on",
      backOn: (kind) => `${kind.charAt(0).toUpperCase()}${kind.slice(1)} emails are on again.`,
      invalid: "This link no longer works. You can change your email settings in Berth.",
      retired: "Berth no longer sends these emails, so there is nothing to turn off. Your other email settings are as you left them.",
      backHome: "Go to Berth",
    },
  },
  analytics: {
    title: "Help improve Berth",
    body: "May Berth count which screens and steps you use, so we can see what works and fix what does not? With your yes we may also record how you move through the app, with every amount, balance, address and name hidden. Until you choose, nothing is sent.",
    allow: "Allow",
    decline: "No thanks",
    more: "How it works",
    switchSub: "Counts which screens and steps you use, and may record how you move through the app, with every amount, balance, address and name hidden. Off unless you allow it.",
    signalNote: "Your browser asks sites not to track you, so this stays off.",
  },
  privacyLink: "Privacy",
  privacyPolicy: {
    title: "Privacy policy",
    status: `Effective ${LEGAL_EFFECTIVE_DATE}.`,
    intro: [
      "This policy explains what Berth collects when you use www.berthmarkets.com, the Berth app and the Berth connector for your AI, why, on what legal basis, who else receives it, how long we keep it, and what you can ask of us.",
      "Berth is self custodial. We never hold your keys and we never hold your money. Our servers hold no key that can sign for you.",
    ],
    sections: [
      {
        id: "who-we-are",
        heading: "Who we are",
        body: [
          `Berth is operated by ${PRIVACY_OPERATOR.description} ("we" or "us"). We are the controller of the personal data described here.`,
          `For any question or request about this policy, write to ${PRIVACY_OPERATOR.email}. This includes requests from the European Union and the United Kingdom.`,
        ],
      },
      {
        id: "what-we-collect",
        heading: "What we collect",
        body: ["We keep only what the app needs to work. This is all of it."],
        list: [
          "Your sign in. If you sign in with email, our sign in provider Privy checks the address and gives us an account identifier. We store that identifier and your email address. If you sign in with a wallet, we store its public address, after you sign a free message that proves the wallet is yours.",
          "Your account. The avatar you pick, your XP and rank, the rewards you earned and when, your invite code, who invited you, if anyone, and which version of the terms you accepted and when.",
          "Your orders. For each order: buy or sell, which listing, the quantity, what you paid with and on which network, the fee, the value in dollars, the transaction identifiers, the delivery address, and the time. We also keep the price of each comparison fund at the minute of the order, so your results can be drawn beside it.",
          "Recurring buys you set before Berth retired them on 4 October 2026. For each plan: the listing, the dollar amount, weekly or monthly and on which day, your browser's time zone, and, if you chose it, how far under the price to wait. For each time a plan came due: when it was due, whether you opened it, signed it or let it pass, the order that answered it, and whether its reminder went out. Berth no longer reads or adds to this record.",
          "Your daily value. Once a day, after the New York close, we read your balances from the blockchain and keep that day's holdings and value, so your history can be drawn.",
          "Invite links. When someone opens an invite link, we count the visit against the invite code. We do not record who opened it.",
          "Campaigns. If you open your account through a campaign's link: which campaign, when your account was opened and set up (a verified email, a username and a wallet), whether you opened Berth signed in on the days the rules look at, and the transaction that paid you. To prevent abuse we compare each claim with other accounts and with the other claims in the same campaign: whether a wallet or an email address, or a variant of one, is shared, whether two claims share an email domain that is not a public mail provider, whether accounts signed up within minutes of each other, and whether a payout address is shared. A reviewer at Berth sees the claim with your email address and wallets, and records the decision and any note about it. We use all of this to pay each reward once, to the right person, and to refuse abuse.",
          "Your AI. If you connect Claude, ChatGPT, Grok or another AI, we keep which app you approved, what it may do, and when you approved, used and disconnected it. Its access tokens are stored only in hashed form. For each request it makes, we log which tool it used, whether it worked and how long it took. We never store what your AI asked or what Berth answered.",
          "Error reports. When an order fails or does not settle, the app sends a report so we can fix the cause: the step it stopped at, the networks, the token and amount, the transaction hashes, a shortened form of your address, the error text, recent app logs, the page address, your screen size and your browser's user agent. Keys and tokens are removed first, and it never includes your email address.",
          "Usage statistics, only if you allow it. We count page views with Vercel Web Analytics, which uses no cookies, and send it each page's address without anything in it that could name you, under the same Help improve Berth choice as product analytics.",
          "Product analytics, only if you allow it. Which screens you open and which steps you take, and a replay of how you moved through the app with every amount, balance, address and name hidden, through PostHog. See Product analytics below.",
          "Your country. With each visit and each request to your account, our host Vercel tells us the country your connection comes from, and for some countries its region, so Berth can say where it is not offered and not open an account or take an order there. We use it for that one answer and do not store or log it.",
          "Emails we send. For each notice: its type, what it was about (an order, a connection), whether it was sent, and the email provider's message identifier. Never the email's text: while a notice waits to be sent again, we keep only what it will name (such as a listing, a price or a shortened wallet address), and delete that once it is sent. Your choices of which emails to get, and whether mail to your address bounced or was reported as spam.",
        ],
        after: [
          "We do not sell personal data. We do not use it for advertising, and we do not build profiles of you for anyone else.",
        ],
      },
      {
        id: "legal-bases",
        heading: "Why we use it, and on what basis",
        body: ["Each use rests on one legal basis under the General Data Protection Regulation and the laws like it."],
        list: [
          "To run your account, show what you own and how it has done, carry out the orders you sign and keep their history: necessary to provide the service you asked for.",
          "Your profile, friends and Salutes, and the AI apps you connect: necessary to provide the parts of the service you chose to use. You can stop at any time.",
          "Security, abuse limits, error reports, the check of an order before a reward is paid for it, and the record of what staff at Berth did: our legitimate interest in a service that is safe, works and is used fairly.",
          "The check of the country your connection comes from: our legal obligations under sanctions law, and our legitimate interest in offering Berth only where we have chosen to offer it.",
          "Records of orders and the fees they paid: our legal obligations under tax and accounting law.",
          "Email. Security notices rest on our legitimate interest in telling you when your account changes. Order and friend notices are part of the service you asked for, and you can turn them off. The weekly summary rests on your consent, given when you turn it on.",
          "Campaign rewards: necessary to pay a reward under the campaign's rules. The checks against abuse rest on our legitimate interest in paying each reward once, to the right person.",
          "Usage statistics and product analytics: your consent, which you give and take back under Help improve Berth. That one choice also covers what analytics keeps in your browser.",
          "Showing your friends what you hold: your consent, which you give and take back with its switch.",
          `Most bought on Berth and Most held on Berth: our legitimate interest in showing what people on Berth buy and hold, in figures that name no one, with the safeguards described under Your profile and friends.`,
          "Choosing the one news line at the top of the app: our legitimate interest in showing news that is relevant to your account.",
        ],
        after: [
          "Where we rely on legitimate interest, you can object, as described under Your choices and rights. Where we rely on consent, you can take it back at any time, which does not affect what was done before. For any new use, we will tell you first, and ask you where the law requires it.",
          "No decision with a legal or similarly significant effect on you is made by software alone. Software checks a campaign's rules, and can close a claim that does not meet them; a person at Berth approves every reward, and you can ask for a person to look again at any refusal.",
        ],
      },
      {
        id: "analytics",
        heading: "Product analytics",
        body: [
          "If you allow it, Berth uses PostHog to learn how the app is used: which screens open, which of the first steps and which steps of a buy or a sell are reached, and why an order stopped, as a code. We use this to make Berth simpler and to fix what goes wrong, and for nothing else.",
          "Berth sends only events it names, never everything you tap. They carry no amounts, balances, addresses, email addresses, usernames, order identifiers or headlines. An amount you type is only ever sent as a broad range, such as 50 to 100 dollars. Page addresses are sent without anything in them that could name you, such as a username or an invite code.",
          "With the same yes, PostHog may record a replay of how you moved through the app, so we can see where something was hard. Everything you type, and every amount, balance, address, email address and name on screen, is hidden before the replay leaves your browser. Your private key, codes and lists of people are left out entirely. Network traffic and the browser's console are not recorded, and profile pages, invite and friend links, email links, the AI consent screen and staff pages are never recorded.",
          "Your account appears in PostHog only as a code made from your account identifier with a secret one way function, never as your email address, wallet or username. The link to that code is cleared from your browser when you sign out.",
          "PostHog stores this on servers in Frankfurt, in the European Union. Your IP address is discarded and not used to guess where you are.",
          "Nothing is sent until you choose Allow, and nothing at all if you choose No thanks. If your browser sends Do Not Track or Global Privacy Control, Berth takes that as no and does not ask. You can change your answer at any time under Settings, Help improve Berth, or, signed in or not, with the switch at the end of this section. Turning it off stops all sending at once, PostHog's and Vercel's page counts alike, and removes PostHog's identifier from your browser.",
          "This rests on your consent. Replays are kept for 30 days. Events are kept for as long as our PostHog plan keeps them, today one year.",
        ],
      },
      {
        id: "never-collect",
        heading: "What we never collect",
        body: [
          "We never see or store your seed phrase or private keys. If you sign in with a wallet, the keys stay in your wallet. If you sign in with email, your wallets are created by Privy and their keys are secured in Privy's systems, for you to use when signed in and to export at any time. Berth has not been given any permission to sign for you, cannot sign for you and cannot move your money.",
          "We do not ask for identity documents, bank details or card numbers. If you add funds by card inside Berth, the purchase is handled by the provider shown on that screen, under its own terms and privacy policy, and we do not receive your card details.",
        ],
      },
      {
        id: "onchain",
        heading: "The blockchain is public",
        body: [
          "Orders settle on public blockchains. Your addresses, balances and transactions, including your Berth account's address on the Sonic network and what it holds, can be seen by anyone, permanently. No one controls that record, and no one, including us, can change or delete it.",
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
          "Draft. Prepare a buy or a sell as a link. The link opens Berth with the order filled in, and nothing happens unless you check it and sign it yourself.",
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
          "A profile exists only if you pick a username, and you can hide it at any time. Anyone who knows your username can see your avatar, rank, XP, the month you joined and how many Salutes you have. Never your email, your wallets or your money, and what you own only to friends, as below.",
          "The preview of a link to your profile or of your invite link, its picture, title and description, names no one unless you turn on Show my avatar, username and rank on links I share. Then a profile link's preview shows your username, your avatar (or your rank mark if you have not picked one) and your rank name, and an invite link's preview shows your username and your avatar or rank mark, to anyone who opens or previews the link, or guesses your username. Never your email, your wallets, your money or what you own. It is off unless you turn it on, and it shows no one while your profile is hidden. When you turn it off or hide your profile, Berth stops serving your preview within ten minutes. Apps where a link was already shared may keep their own copy of its preview for longer, and we cannot remove it from them.",
          "We keep who you salute, your friend requests and friends, who you block and any report you make, with a record of each change for moderation. Nobody else can see your friends or who you block. The record of changes is kept for a year.",
          "If you turn on Let my friends see which stocks and funds I hold, your friends who turned it on too can see which stocks and funds you hold: in their list of what friends hold, with your username and avatar, for up to four of the friends who hold a listing, and on your profile. They never see how much you hold, what you paid or what it is worth. It is off unless you turn it on, you see theirs only while yours is on, and you can turn it off at any time. It is read from your last daily value and not shown once that is more than three days old. While your profile is hidden you are not shown.",
          "Most bought on Berth is public: anyone who opens the board sees it. It counts how many people bought each listing in one week, Monday to Sunday in UTC, from the orders we keep. Each week is counted once, after it ends, and kept as it was published; the first week counted begins on 5 October 2026. It names no one and shows no amount. Two accounts merged into one count as one person. Only buys of at least $10, from accounts at least a week old with a verified email, are counted, and staff accounts and buys that earn no XP are not. A listing bought by fewer than five people is left out, counts above ten are rounded down to a multiple of five, and the list is not shown at all in a week when fewer than ten people bought.",
          "Most held on Berth is public too. Once a week, published on Tuesday for the week before, Monday to Sunday in UTC, the board shows for each stock or fund a rounded share, such as 1 in 4, of the people who own a stock or fund on Berth who hold that one. It is never a count of people and never an amount, and never anything about one person. The people counted are those with a verified email whose account is at least 7 days old and held at least $10 of stocks and funds at its last daily value of the week; staff accounts are not counted. A listing is shown only when at least 20 people hold it, and nothing is shown in a week when fewer than 50 people hold a stock or fund. Each week is counted once, after it ends, and kept as published. The first week counted is the week of 19 October 2026, published on 27 October 2026.",
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
          "The weekly summary: on Mondays, what your account was worth at the week's last close, its change beside the S&P 500 ETF, what you hold and how each moved, what filled and which limit orders expired, and how many new friends and Salutes you had. Off unless you turn it on.",
        ],
        after: [
          "We do not track whether you open an email or click its links. Every notice other than a security notice has a link to turn that kind off, and you can change them all under Email in the app's settings. If mail to your address bounces or is reported as spam, we stop sending to it.",
        ],
      },
      {
        id: "sharing",
        heading: "Who receives it",
        body: [
          "We share personal data only with the services that run Berth, each for its own part. The first group below process it for us, under our instructions. The second receive what they need to do their own part and are responsible for it under their own terms.",
        ],
        list: [
          "Privy, for email sign in and the wallets it creates for email accounts. Privy receives your email address and secures your wallet's keys.",
          "Neon, which hosts our database.",
          "Vercel, which hosts the app and serves every request, and, only if you allow it, counts page views. Like any web host, it processes your IP address and browser details to do so.",
          "GitHub, where error reports are kept in a private repository.",
          "OpenAI, if you use the Assistant in Berth, as described above.",
          "PostHog, only if you allow product analytics, as described above. It receives the named events and masked replays, stored in the European Union.",
          "Resend, which delivers our emails. It receives your email address, the notice's content (such as a listing's name, an amount, a price, or a friend's username, and in a weekly summary you turned on, your account's value and holdings, what filled, and how many new friends and Salutes you had) and whether the email was delivered, bounced or reported as spam.",
          "TypeSafe, which provides a news-relevance model that helps choose the one line shown at the top of the app, such as news about something you own. It receives headlines, and which listings your account holds and whether it has cash to spend, never your name, email or address.",
          "SODAX, the protocol whose service, solvers and relayers price, route and fill your orders. They receive the addresses, amounts and transactions needed to fill them.",
          "Blockchain networks and the companies that run their nodes, such as PublicNode, dRPC and the networks' own public endpoints. Your browser reads balances and sends transactions through them, so they see your IP address and the addresses it asks about. A Bitcoin order links to mempool.space so you can follow it there.",
          "WalletConnect, if you connect a wallet through it. It relays the connection between Berth and your wallet.",
          "Price and news sources: DefiLlama, the Federal Reserve Bank of St. Louis, Frankfurter, Nasdaq and X. They supply prices, rates and the market feed and receive no personal data from us. Posts from X show their authors' pictures, which your browser loads from X.",
        ],
        after: [
          "We disclose personal data to authorities only when the law requires it.",
          "If Berth comes to be run by a company, for example one we form to run it, your data moves with it, under this policy, and we will tell you.",
        ],
      },
      {
        id: "transfers",
        heading: "International transfers",
        body: [
          "Some of these services process data outside the European Economic Area, mostly in the United States: among them Privy, Vercel, GitHub, OpenAI, Resend, X and node providers. PostHog keeps analytics in Frankfurt.",
          "Where data leaves the European Economic Area, it is protected by the European Commission's standard contractual clauses in each provider's data processing terms. You can ask us for a copy.",
        ],
      },
      {
        id: "storage",
        heading: "Cookies and local storage",
        body: [
          "Berth sets no advertising cookies, and no analytics cookie unless you allow product analytics. The app keeps a few things in your browser's local storage so it remembers your choices:",
        ],
        list: [
          "your appearance and currency, and the comparison and time range you last picked;",
          "whether your account holds any stocks, so the home screen opens in the right order;",
          "which suggestions you dismissed;",
          "an invite code you arrived with, until your account is created;",
          "a campaign code you arrived with, until your account is created;",
          "a signed session token when you sign in with a wallet, valid for seven days;",
          "whether you allowed product analytics, so you are not asked again;",
          "if you allowed it, PostHog's own identifier for this browser and session, in local storage and a cookie, removed when you turn it off.",
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
          "Your account, rewards, daily values, the AI apps you approved and the record of the terms you accepted: for as long as your account exists.",
          "Records of your orders and the fees they paid: for as long as your account exists, and after that for as long as tax and accounting law requires, at most 7 years.",
          "Sign in codes for your AI: they expire after 90 seconds and are deleted within the hour.",
          "Your AI's access tokens last an hour and refresh tokens thirty days. Both are deleted a week after they expire or are revoked.",
          "The log of requests from your AI: 90 days.",
          "Abuse limit counters: one day. They hold a hashed form of the caller's IP address, never the address itself.",
          "Recurring plans set before 4 October 2026 and the record of each time one came due: until you delete your account.",
          "Invite link visits and error reports: up to 12 months.",
          "Product analytics, if you allowed it: replays 30 days, events as long as our PostHog plan keeps them, today one year.",
          "Campaign records: for as long as needed for legal, accounting and abuse prevention purposes, and at most 7 years after the campaign ends.",
          "The record of what staff and reviewers at Berth did and looked at, including every view of an account, every search by email or wallet, every reveal, every change, and their decisions and notes on campaign claims: 24 months.",
          "The record of profile and friend changes: 12 months.",
          "The record of emails sent: 12 months. A block on an address that bounced or reported spam: as long as the account exists, so the block holds.",
        ],
      },
      {
        id: "rights",
        heading: "Your choices and rights",
        body: [
          "You can disconnect your AI at any time, sign out, turn off analytics and any email other than security notices, and clear the app's storage in your browser.",
          `You can ask for a copy of the personal data we hold about you, ask us to correct it, or ask us to delete your account. Write to ${PRIVACY_OPERATOR.email} from the email address on your account, or with proof that you control the wallet. We answer within 30 days.`,
          "When we delete an account, we delete or anonymise its data within 30 days, except what the law requires us to keep. Records on a blockchain are public and permanent, and no one can delete them. Your money stays in your own wallet and your Berth account either way.",
          "If you signed in with email, export your keys before you ask us to delete your account, if your wallet holds anything. Your wallet then stays yours to use in any wallet app.",
          "Depending on where you live, including the European Economic Area and the United Kingdom, you may also have the right to object to how we use your data where we rely on legitimate interest, to restrict it, to receive it in a portable form, and to complain to a data protection authority. Our lead supervisory authority is the Dutch Data Protection Authority, the Autoriteit Persoonsgegevens. You may also complain to the authority where you live.",
        ],
      },
      {
        id: "staff",
        heading: "Who at Berth can see your data",
        body: [
          "A few named people who run Berth can open a staff view of the service. Each is on a list we keep by name, and they use it only to give you support, to stop abuse, and to check and pay campaign rewards. Some of them can only look; only those we name as admins can change anything.",
          "It shows, as Berth stores them: your username, avatar, rank and XP and how you earned it, when you joined and how far along your account is, your orders and limit orders, your account's daily value and holdings, how many friends and Salutes you have, who invited you and whom you invited, the AI apps you connected and when they were last used, how many messages you sent the Assistant and what they cost, the record of changes to your account such as wallets added and accounts merged, your email settings, the notices we sent you and whether your address bounced, and whether you are eligible for campaign rewards.",
          "Your email address and wallet addresses are shown in part only: the first letter of your email, then the domain if it is a common mail provider (otherwise only its first letter and its ending), and the first four and last two characters of a wallet. An admin may reveal one in full only for one of the reasons above, after entering a new email code, with the reason written down, and at most twenty an hour. Staff can also find an account by typing an email address or a wallet address in full; each such search is recorded with the account it found. Reviewing a campaign claim is the one place a reviewer sees the email address and wallets of the account that opened through the campaign's link in full, as the Campaigns section says.",
          "An admin can make these changes, each with a written reason: stop or restart email to your address (never lifting a block from a bounce or a spam report), hide your profile or show again a profile staff hid (never one you hid yourself), disconnect an AI app, send a stuck notice again, and mark you as not eligible for campaign rewards.",
          "Every view of an account, every search by email or wallet, every reveal and every change made there, and every campaign review, is logged with who did it and why, in one log kept for 24 months. No one at Berth can sign in as you, sign for you or move your money, and no one changes your balance or XP by hand.",
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
          "Berth is for adults. You must be 18 or older to use it. We do not knowingly collect data from anyone younger, and if you believe a minor has an account, write to us and we will delete it.",
        ],
      },
      {
        id: "law",
        heading: "Governing law",
        body: [
          "This policy is governed by the laws of the Netherlands, where Berth's operator is based. This does not take away any protection the law where you live gives you.",
        ],
      },
      {
        id: "changes",
        heading: "Changes to this policy",
        body: [
          "When this policy changes, we update the effective date at the top and say what changed in the section below. For a change that matters, we will say so in the app before it applies.",
        ],
      },
      {
        id: "what-changed",
        heading: `What changed on ${LEGAL_EFFECTIVE_DATE}`,
        body: [],
        list: [
          "The legal basis for each use of your data is now listed use by use.",
          "A new section on international transfers.",
          "The services that receive data now include the companies that run network nodes, and WalletConnect, and are grouped by whether they act for us or on their own.",
          "Most held on Berth, a weekly rounded share of the people who hold each stock or fund, from the week of 19 October 2026.",
          "What to do with an email account's wallet before you ask us to delete your account.",
          "The record of which version of the terms you accepted, and when.",
          "Campaigns now record the account opened through a campaign's own link, which is the one paid, instead of who invited whom. Inviting someone with your own invite link never earns money.",
        ],
      },
      {
        id: "contact",
        heading: "Contact",
        body: [`${PRIVACY_OPERATOR.description}. Email ${PRIVACY_OPERATOR.email}.`],
      },
    ],
    backHome: "Back to Berth",
  },
  termsLink: "Terms",
  xLink: "Berth on X",
  inviteXShare: "Share on X",
  inviteXText: "I kept a place for you on Berth. US stocks by name, held in an account your own wallet controls.",
  holdingsXShare: "Share what you hold on X",
  holdingsXSheet: {
    title: "Share what you hold",
    lede: "Only the names go in the post, never amounts, prices or returns. X opens with the words filled in, and nothing is posted unless you post it.",
    choose: "Name these",
    preview: "The post",
    none: "Choose at least one to name.",
    open: "Open X",
    notNow: "Not now",
  },
  holdingsXText: (list, count) =>
    `I hold ${list} on Berth, as ${count === 1 ? "a token that tracks the shares" : "tokens that track the shares"}.`,
  holdingsXList: (names, more) => {
    if (more > 0) return `${names.join(", ")} and ${countWord(more)} more`;
    if (names.length <= 1) return names.join("");
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  },
  termsOfUse: {
    title: "Terms of use",
    status: `Effective ${LEGAL_EFFECTIVE_DATE}.`,
    intro: [
      "These terms apply when you use www.berthmarkets.com, the Berth app and the Berth connector for your AI. By using Berth you agree to them. If you do not agree, please do not use Berth.",
      "Berth is software. It is not a broker, an exchange, an investment firm or an adviser. It never holds your keys or your money, and it does not give investment advice.",
    ],
    sections: [
      {
        id: "who-we-are",
        heading: "Who we are",
        body: [
          `Berth is operated by ${PRIVACY_OPERATOR.description} ("we" or "us"). You can reach us at ${PRIVACY_OPERATOR.email}.`,
        ],
      },
      {
        id: "what-berth-is",
        heading: "What Berth is",
        body: [
          "Berth is software that helps you buy and sell tokens that track US stocks and funds, paying with crypto you already hold in your own wallet, and see what you hold.",
        ],
        list: [
          "Berth is not a broker, an exchange, a trading venue, a bank, a payment service, an investment firm or an investment adviser. It does not hold your money, and it does not decide, place or sign orders for you.",
          "You choose every order and sign it yourself, in your own wallet. The app builds the order from what you chose, shows you what you will pay, the fee and what you should receive, and, once you sign, sends it to SODAX to be filled. Nothing is bought or sold unless you sign it.",
          "Orders are filled by solvers that work through SODAX, a protocol run by others, from liquidity they find. We do not fill orders, take the other side of them, or set their price.",
          "Berth does not check whether a token or an order is suitable for you.",
        ],
      },
      {
        id: "custody",
        heading: "Who holds your keys and your tokens",
        body: [],
        list: [
          "If you sign in with a wallet you already have, its keys stay in that wallet. Berth never sees them.",
          "If you sign in with email, Privy, our wallet provider, creates wallets for you and secures their keys in its own systems so that you can use them when signed in. Berth cannot see or use those keys and has not been given any permission to sign for you. You can export the keys at any time under Settings, and we suggest you do, so that you keep access whatever happens to Privy or to Berth.",
          "The stocks and funds you buy are held at your Berth account: an address on the Sonic network, a wallet contract of the SODAX protocol tied to your own wallet and designed to move funds only on instructions you sign. Reaching it depends on SODAX's contracts and relay working.",
          "If you pay with Bitcoin, you sign the payment in your own Bitcoin wallet, and it goes to the SODAX protocol's Bitcoin service to be filled. Berth never receives it.",
          "Berth's servers hold no key that can sign for you or move your funds, and no one at Berth can change your balances.",
          "If you lose your keys, your sign in or access to your email, or someone else gets them, we cannot recover your wallet or your tokens, or reverse what was done with them.",
        ],
      },
      {
        id: "tokens",
        heading: "What the stock tokens are, and are not",
        body: [
          "The stocks and funds on Berth are tokens, each tracking the price of a share or a fund. They are issued by third parties under their own terms, today by Robinhood's issuing company, and reach Berth through the SODAX protocol.",
        ],
        list: [
          "A token is not the share or the fund itself. Holding one does not make you a shareholder, and gives you no vote, no claim on the company and no right that the issuer's own terms do not grant.",
          "Any right you have, to a dividend, a redemption or anything else, is against the issuer, under its terms, only if and as those terms allow. Berth is not the issuer and makes no promise for it.",
          "On Sonic, the token at your Berth account can be a representation, made through the SODAX protocol, of the issuer's token on another network. Its value then depends on SODAX's contracts as well as on the issuer.",
          "If the issuer fails, stops, freezes, redeems or changes a token, or a protocol it relies on fails, the token can lose some or all of its value, or stop being tradable.",
          "Whether you may buy or hold a token where you live, and whether its issuer offers it there, is for you to check. Issuers do not offer their tokens everywhere.",
          "Words on Berth such as stock, fund and what you own are short for these tokens. Company names and marks are their owners', shown only to say which share a token tracks. The companies do not endorse Berth.",
        ],
      },
      {
        id: "no-advice",
        heading: "No investment advice",
        body: [
          "Nothing in Berth is investment, financial, legal or tax advice, or a recommendation to buy, sell or hold anything. Prices, history, comparisons, lists such as Most bought on Berth, market posts and headlines are facts and reports, shown as they are.",
          "Past performance tells nothing certain about the future. Make your own decisions, and ask a qualified adviser if you need one.",
        ],
      },
      {
        id: "ai",
        heading: "What AI tells you",
        body: [
          "The Assistant inside Berth, and Claude, ChatGPT, Grok or another AI you connect, write their answers by machine. An answer can be wrong, out of date or incomplete, about prices, your holdings and the news alike, and it can sound sure when it is wrong. It is information, not advice.",
          "Your AI can only read your account and draft an order as a link. It cannot place, sign or send an order. A draft is what you asked for, as the AI understood it: check the listing, the amount and the price in Berth before you sign, because what you sign is yours.",
          "Berth's connector lets the AI you choose read your account and draft orders within what you approve when you connect it. You can disconnect it at any time, in Berth or in your AI. What we keep about requests from your AI is set out in our privacy policy.",
        ],
      },
      {
        id: "risks",
        heading: "Risks",
        body: ["Buying and holding tokens carries real risk. You can lose some or all of what you put in. Only use money you can afford to lose."],
        list: [
          "Prices move, sometimes quickly. A token can lose value or stop trading.",
          "A token can trade at a price different from the share or fund it tracks, sometimes by a lot, especially when few people trade it.",
          "Orders fill any day and at any hour, including when the US stock market is closed. Then there is no live price for the share, and the price you get is set by the solvers and the liquidity they find. It can be far from where the share opens next.",
          "There may be no one to fill an order at a fair price, or at all, and a large order may not fill.",
          "Berth relies on smart contracts written by others: the issuer's, SODAX's and the networks'. They can have bugs, be exploited, be upgraded or be paused, and funds held through them can be lost.",
          "A network, a bridge or a relay can halt, slow down, be congested or be attacked. An order can then be delayed, stuck or lost, and network costs can still be charged.",
          "Blockchain transactions are final. An order you sign, or funds sent to a wrong address, cannot be reversed by us or by anyone else.",
          "The issuer of a token, the solvers, SODAX, a blockchain, a wallet provider or another service Berth relies on can fail, pause, change its terms or be attacked.",
          "What you pay with, such as a stablecoin, ETH, SOL or Bitcoin, carries its own risks.",
          "Rules about tokens and the services around them differ from country to country and can change. A change can make a token or Berth unavailable to you.",
          "Buying, selling and holding tokens, and receiving rewards, can have tax consequences. Working them out and paying them is yours to do. Berth does not withhold tax for you.",
        ],
        after: ["You are responsible for keeping your wallet, your keys, your sign in, your email and your recovery details safe."],
      },
      {
        id: "fees",
        heading: "Fees",
        body: [
          "Berth charges a fee of 0.4% on every order: every buy, every sell and every withdrawal from an earlier vault position, taken from the amount you pay with before the order is filled and paid to Berth through the SODAX protocol. It is the only charge from Berth.",
          "The fee, what you pay and what you should receive are shown before you sign. Networks, solvers, the SODAX protocol and card providers may charge their own costs, which can be part of the price you are quoted. Once you sign, the fee is paid and cannot be refunded by us.",
          "A market order is carried out as soon as you sign it, at a price that depends on the market, so it cannot be withdrawn afterwards. A limit order can be cancelled until it fills.",
          "We may change our fee. A new fee applies only to orders you sign after it is shown to you.",
        ],
      },
      {
        id: "eligibility",
        heading: "Who may use Berth",
        body: [],
        list: [
          "You must be 18 or older, and able to enter a binding agreement where you live.",
          "You use Berth for yourself, with your own wallet, not for someone else or as a service to others.",
          `Berth is not offered in ${orList(TERMS_AVAILABILITY.excluded.map((place) => place.name))}. You may not use it if you live in one of them or are there when you use it, or if you are a citizen or resident of ${orList(TERMS_AVAILABILITY.excluded.filter((place) => place.persons).map((place) => place.name))}. If you are in one of them with an account that already exists, Berth lets you see, sell and withdraw what you hold, and nothing new.`,
          `You may not use Berth where the law that applies to you prohibits it, if you are named on a sanctions list of the United Nations, the European Union, the United Kingdom or the United States, or are owned or controlled by or act for someone who is, or from a country or region under sanctions, including ${andList([...TERMS_AVAILABILITY.sanctionedCountries.map((place) => place.name), `the ${andList(TERMS_AVAILABILITY.sanctionedRegions.map((place) => place.name))} regions of Ukraine`])}. There, the Berth app offers nothing beyond its public pages, not even to an account opened elsewhere.`,
          "Berth checks the country a connection comes from and may refuse service because of it. That check is not a promise that Berth is lawful where you are. Hiding where you are, with a VPN or any other way, to use Berth from a place where it is not offered breaks these terms.",
          "You are responsible for knowing and following the laws that apply to you, including whether you may buy these tokens where you live, and tax rules.",
          "We may stop offering Berth in more places at any time, at once where the law requires it.",
        ],
      },
      {
        id: "rewards",
        heading: "XP, ranks and rewards",
        body: [],
        list: [
          "XP, ranks, levels, Salutes and the friends board show how you use Berth. Some actions earn XP, buys and sells among them. XP has no cash value, is not property, and cannot be sold, transferred or exchanged for money, tokens or anything else.",
          "XP and ranks are not a reason to trade, and are not a promise of any return.",
          "We decide how XP is earned and what a level opens, and we may change those rules, correct a mistake, remove XP earned through abuse, or end XP and ranks.",
          "A reward in money or tokens exists only where a campaign or another offer we publish says so in writing, and is paid only under its rules.",
        ],
      },
      {
        id: "campaigns",
        heading: "Campaigns",
        body: [
          "From time to time we may run a campaign that rewards a new account: a stated amount in USDC on Base to you when you open a new Berth account through the campaign's own link, set it up and still use Berth a stated number of days later. Inviting someone with your own invite link or invite code never earns money. No campaign asks you to buy, hold or trade anything. Each campaign's rules are shown with its link and in the app. These rules apply to every campaign:",
        ],
        list: [
          "You must be new to Berth: a new account, opened inside the campaign's dates through the campaign's link. An account that existed before, or one merged with an older account, does not count.",
          "Open the campaign's link in the same browser you then sign up in, before you sign up. The link is remembered only in that browser, and an account opened anywhere else does not count.",
          `Set up means your account has a verified email, a username and a wallet with an EVM address, which can receive USDC on Base. Still uses Berth means you opened Berth signed in at least once in the last ${ACTIVE_WINDOW_DAYS} days of the stated number of days, on a later day than the one you set up on.`,
          "One reward per person. Accounts that are merged count as one person, and a wallet or an email address that already counted for another reward does not count again.",
          "Each campaign states a budget and a number of places. Once they are taken, a new account waits in line, and a place that frees up goes to the next in line until the campaign closes. Once the campaign ends, it is closed.",
          "We review every reward before it is paid. We send it by hand, usually within a few days, in USDC on Base to your Berth account's own address. An account with no EVM address of its own cannot be paid.",
          "We may refuse a reward where we see abuse, such as several accounts for one person. You can ask a person at Berth to look again at a refusal.",
          "We may end or change a campaign at any time for new claims. A reward we have approved will be paid.",
          "Campaigns are not available where Berth is not available.",
          "A reward is not investment advice, and not a reason to buy, hold or sell anything. You are responsible for any tax on it.",
        ],
      },
      {
        id: "acceptable-use",
        heading: "Using Berth fairly",
        body: ["Please do not:"],
        list: [
          "Break the law with Berth, or use it to launder money, to evade sanctions or to fund anything unlawful.",
          "Use Berth to manipulate a price, for example by trading with yourself or acting with others to move a price.",
          "Try to reach accounts, data or systems that are not yours, or get around a limit or a safeguard, including where Berth is offered.",
          "Use scripts, bots or several accounts to earn XP or rewards.",
          "Overload, disrupt or reverse engineer Berth, or copy it at a volume that harms it.",
          "Pretend to be someone else, use Berth for someone who may not use it, or pick a username that harasses, misleads or could be taken for Berth or someone else.",
        ],
        after: [
          "We may refuse or hide a username that breaks these terms, and you can ask us to look again at that decision.",
          "We may limit, suspend or end access for anyone who breaks these terms, and we may refuse or pause service where the law requires it. Where we do, we will tell you why, unless the law or security prevents it. What you hold stays in your own wallet and your Berth account either way, tied to your own wallet's keys. If you signed in with email, you can export those keys from Settings.",
        ],
      },
      {
        id: "third-parties",
        heading: "Services run by others",
        body: [
          "Berth works only because services run by others work: SODAX and its solvers and relayers, Privy, the issuers of the tokens, the blockchain networks and bridges, wallets, card providers, and AI apps such as Claude, ChatGPT and Grok. Their own terms and privacy policies apply to your use of them.",
          "We do not control them. If one fails, pauses, changes its terms or is attacked, an order can fail or be delayed, and what you hold can lose value or become hard to reach. To the extent the law allows, we are not responsible for what they do, fail to do or say.",
        ],
      },
      {
        id: "availability",
        heading: "Availability",
        body: [
          "We work to keep Berth running, but it may at times be unavailable, slow or wrong, and we may change, pause or stop parts of it, or all of it. Your tokens stay in your Berth account, tied to your own wallet's keys, whatever happens to Berth. If you signed in with email, you can export those keys from Settings, and we suggest you keep a copy. If we stop Berth, we will say so in advance where we can.",
        ],
      },
      {
        id: "warranties",
        heading: "What we promise, and what we do not",
        body: [
          "We will provide Berth with reasonable care and skill, as described in these terms.",
          "Beyond that, and to the extent the law allows, Berth is provided as it is and as available. We do not promise that it will be uninterrupted or free of errors, or that prices, data, news, AI answers and third party content are accurate, complete or current.",
          "If you use Berth as a consumer, you keep every right the law gives you, including about digital services you pay for, and nothing in these terms takes them away.",
        ],
      },
      {
        id: "liability",
        heading: "Liability",
        body: [],
        list: [
          "We are responsible for loss you suffer that is a foreseeable result of our breaking these terms or of our failing to take reasonable care. Loss is foreseeable if it was obvious it would happen, or if you and we both knew it might when you started using Berth.",
          "We are not responsible for loss we did not cause, including loss from market prices moving, from your own decisions, from an order you signed, from a token or its issuer, from SODAX, a solver, a network, a bridge, a wallet or another service run by others, or from someone else using your keys or your sign in.",
          "To the extent the law allows, we are not responsible for loss of profit, business or opportunity, or for loss that is not foreseeable.",
          "To the extent the law allows, our total liability to you for all claims about Berth in any twelve months is limited to the fees you paid Berth in those twelve months, or 100 euros if that is more.",
          "Nothing in these terms limits or excludes liability for death or personal injury caused by negligence, for fraud, for harm caused on purpose or by gross negligence, or any other liability the law does not allow to be limited or excluded. Nothing in them affects your rights as a consumer under the law where you live.",
        ],
        after: ["Each part of this section applies on its own. If one part cannot apply to you, the others still do."],
      },
      {
        id: "indemnity",
        heading: "Responsibility for misuse",
        body: [
          "If you break these terms or the law, and that causes us loss or a claim from someone else, you are responsible for it, to the extent the law allows. If you use Berth as a consumer, this applies only as far as the law where you live allows, and never to loss you did not cause.",
        ],
      },
      {
        id: "ending",
        heading: "Ending these terms",
        body: [
          "You can stop using Berth at any time, and ask us to delete your account as our privacy policy describes.",
          "We may end these terms with you, with reasonable notice where we can, if we stop offering Berth or stop offering it where you are, and at once if you break them seriously or the law requires it.",
          "When these terms end, what you hold stays yours, at your own wallet and account. The parts of these terms that by their nature should continue, such as Liability, continue.",
        ],
      },
      {
        id: "changes",
        heading: "Changes to these terms",
        body: [
          "We may change these terms when Berth changes, when the law does, or to make them clearer. When they change, we update the effective date at the top and say what changed in the section below. For a change that matters, we will say so in the app before it applies.",
          "If you do not agree with a change, you can stop using Berth before it applies, and your tokens stay yours. Using Berth after that means you accept the new terms. A change never applies to an order you signed before it.",
        ],
      },
      {
        id: "law",
        heading: "Governing law and disputes",
        body: [
          "These terms are governed by the laws of the Netherlands, where Berth's operator is based. If you are a consumer living in another country, you also keep the protection of the rules of that country's law that cannot be set aside by agreement.",
          "Disputes go to the competent court in the Netherlands. If you are a consumer, you may also go to the courts where you live, and any claim against you as a consumer will be brought where the law requires.",
        ],
      },
      {
        id: "general",
        heading: "General",
        body: [],
        list: [
          "If a court finds part of these terms invalid, the rest still applies.",
          "If we do not enforce a part of these terms at once, we can still enforce it later.",
          "We may transfer these terms to a company that takes over running Berth, such as one we form for it. We will tell you, and your rights under them will not be reduced. You may not transfer them without our agreement.",
          "These terms are written in English. If we provide a translation, the English text applies where they differ, unless the law where you live says otherwise.",
        ],
      },
      {
        id: "what-changed",
        heading: `What changed on ${LEGAL_EFFECTIVE_DATE}`,
        body: [],
        list: [
          "Berth now says plainly that it is not a broker, an exchange, an investment firm or an adviser, and does not check whether an order suits you.",
          "New sections on who holds your keys and tokens, and on what the stock tokens are and are not.",
          "More risks are named: prices when the US market is closed, smart contracts, networks and relays, lost keys and tax.",
          "The fee is stated: 0.4% on every order.",
          "Berth is no longer offered in Russia and Belarus. Accounts there can still see, sell and withdraw what they hold.",
          "New sections on XP, ranks and rewards, on what AI tells you, on services run by others, on what we promise, on ending these terms, and general terms.",
          "Liability is rewritten to keep every right consumer law gives you.",
          "Governing law and the courts for disputes are stated: the Netherlands, without taking away the protection of the law where you live.",
          "Campaigns now reward the new account opened through a campaign's own link, paid to that account. Inviting someone with your own invite link or invite code never earns money.",
        ],
      },
      {
        id: "contact",
        heading: "Contact",
        body: [`${PRIVACY_OPERATOR.description}. Email ${PRIVACY_OPERATOR.email}.`],
      },
    ],
    backHome: "Back to Berth",
  },
  assistantsLink: "How your AI works with Berth",
  notFound: {
    title: "This page isn't here",
    body: "The link may be old or mistyped. What you own stays in an account your wallet controls.",
    backHome: "Back to Berth",
  },
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
      "Compare your money with the same amount put in the S&P 500 ETF, the Nasdaq 100 ETF, Gold, Bitcoin or Treasury bills.",
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
  buyLinkForXp: "Add this wallet to your account first, so the buy counts as yours and earns XP.",
  buyNoXpNetwork: "Buys paid from this network are recorded but earn no XP.",
  ctaSellSwitchWallet: (short) => `Switch to ${short} to sell from it`,
  ctaSellSignInEmail: "Sign in with your email to sell these",
  sellFromLabel: "Sell from",
  sellFromHomeTag: "Home",
  drawer: {
    back: "Your account",
    noUsername: "No username yet",
    changeAvatar: "Change your avatar",
    nextStep: "Next step",
    avatarTitle: "Choose your avatar",
    avatarSub: "Tap a face to make it yours, then save it. It sits beside your name and rank.",
    avatarXp: (amount) => `+${amount} XP for your first avatar`,
    avatarSave: "Save this avatar",
    avatarPickFirst: "Tap a face first",
    avatarSaved: "Avatar saved",
    avatarFailed: "That did not save. Try again in a moment.",
    avatarChangeTitle: "Your avatar",
    avatarChangeSub: "More faces open as you climb the ranks.",
    inviteTitle: "Invite a friend",
    inviteSub: "Send your friend link. Anyone with it can ask to be friends.",
    inviteAction: "Share your friend link",
    notNow: "Not now",
    rows: {
      rewards: { title: "Rank and rewards", sub: (rank, level) => `${rank}, level ${level}. Invites and activity` },
      friends: {
        title: "Friends",
        sub: (friends, requests) =>
          [friends === 0 ? "No friends yet" : friends === 1 ? "1 friend" : `${friends} friends`, requests > 0 ? (requests === 1 ? "1 request" : `${requests} requests`) : null]
            .filter(Boolean)
            .join(", "),
        subNoName: "Your username, friends and who sees you",
      },
      money: { title: "Wallets and adding money", sub: "Add money, receive crypto, your wallets" },
      wallets: { title: "Wallets", sub: "The wallets on this account" },
      notifications: { title: "Notifications", sub: "Which emails Berth sends you" },
      ai: { title: "Your AI", sub: "Bring Berth into Claude, ChatGPT or Grok" },
    },
    profileBack: "Back",
  },
  social: {
    sectionTitle: "Your profile",
    sectionWhy:
      "Only people who know your username can open your profile. It shows your avatar, rank, XP and Salutes, never money. Which stocks and funds you hold is shown only to friends, and only if you turn it on.",
    addEmail: "Add an email to get a profile",
    addEmailSub: "A profile needs a verified email.",
    pickTitle: "Pick a username",
    pickSub: "Until you do, nobody can find you.",
    pickPlaceholder: "username",
    pickRules: "3 to 20 letters, numbers or _. People who know it can open your profile.",
    pickSave: "Save",
    pickChecking: "Checking",
    pickFree: "Available",
    pickXp: (amount) => `+${amount} XP for your username`,
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
    hideSub: "While hidden, your username finds no one, and friends do not see what you hold.",
    linkFace: "Show my avatar, username and rank on links I share",
    linkFaceSub: "Links to your profile and your invite link then show your username, your avatar or rank mark, and your rank name to anyone who opens or previews them, or guesses your username. Off, they show no one.",
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
    shareHoldings: "Let my friends see which stocks and funds I hold",
    shareHoldingsSub: "Only the names, never how much, to every friend who shares too, including friends you add later. You see theirs only while yours is on. Off unless you turn it on.",
    acceptHoldingsNote: "Friends never see your money. Which stocks and funds you hold is shared only if you both turn it on.",
    cardShareNote: "Your switch to share what you hold is on: they will see which stocks and funds you hold if they share theirs.",
    holdingTitle: "Your friends hold",
    holdingOff: "Turn on the switch below to see which stocks and funds your friends hold, if they share theirs too.",
    holdingNone: "None of your friends who share hold anything right now.",
    cardHolds: (names) =>
      names.length === 1 ? `Holds ${names[0]}.` : `Holds ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}.`,
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
  og: {
    domain: "berthmarkets.com",
    home: {
      eyebrow: null,
      title: "Wall Street, in your wallet.",
      line: "US stocks as tokens, bought from your crypto wallet.",
      alt: "Berth. Wall Street, in your wallet. A row of harbour creatures along the foot of the card, the seal in front.",
    },
    invite: {
      eyebrow: "A friend invited you",
      title: "A seat has been kept for you.",
      line: "Sign in and it is yours.",
      alt: "Berth. A seat has been kept for you. A row of harbour creatures with one empty place in the middle.",
    },
    inviteFrom: {
      /** The link's own title beside the picture, where the platform shows one. */
      title: (handle) => `${handle} invited you to Berth`,
      eyebrow: (handle) => `${handle} invited you`,
      alt: (handle) => `Berth. ${handle} invited you. A seat has been kept for you. A row of harbour creatures, ${handle}'s avatar lit beside one empty place.`,
    },
    profile: {
      eyebrow: "A profile on Berth",
      title: "A Berth profile, shared with you.",
      line: "Sign in to see whose it is and add them as a friend.",
      alt: "Berth. A Berth profile, shared with you. A row of harbour creatures in silhouette.",
    },
    profileOwner: {
      /** The link's own title beside the picture, where the platform shows one. */
      title: (handle) => `${handle} on Berth`,
      eyebrow: "A profile on Berth",
      line: (rank) => `${rank} on Berth. Sign in to add them as a friend.`,
      alt: (handle, rank) => `Berth. ${handle}, ${rank} on Berth. A row of harbour creatures, ${handle}'s avatar lit in the middle.`,
    },
    friendLink: {
      eyebrow: "A friend link",
      title: "Someone would like to be your friend.",
      line: "Sign in to Berth to see who it is.",
      alt: "Berth. Someone would like to be your friend. A row of harbour creatures in silhouette.",
    },
    assistants: {
      eyebrow: "Claude, ChatGPT and Grok",
      title: "Bring Berth into your AI.",
      line: "Your AI reads and drafts. You sign.",
      alt: "Berth. Bring Berth into your AI. A row of harbour creatures, the cormorant in front.",
    },
    privacy: {
      eyebrow: "Privacy policy",
      title: "We never hold your keys or your money.",
      line: "What Berth collects, why, who sees it, and what you can ask of us.",
      alt: "Berth. Privacy policy. A row of harbour creatures in silhouette.",
    },
    terms: {
      eyebrow: "Terms of use",
      title: "The terms of using Berth.",
      line: "Berth never holds your keys or your money, and gives no investment advice.",
      alt: "Berth. Terms of use. A row of harbour creatures in silhouette.",
    },
  },
  staff: STAFF_COPY,
  xAutopost: {
    holiday: (day, name, reopens) => `US stock markets are closed on ${day} for ${name}. Trading resumes on ${reopens}.`,
    halfDay: (day) => `US stock markets close early on ${day}, at 1pm New York time.`,
    news: (name, publisher, headline) => `${name} in the news. ${publisher} reports: \u201c${headline}\u201d`,
    mostHeld: (week, name, oneIn) =>
      `Most held on Berth, the week of ${week}: ${name}, held by 1 in ${oneIn} people who own a stock or fund on Berth.`,
    mostBought: (week, name, people, plus) =>
      `Most bought on Berth, the week of ${week}: ${name}, bought by ${people}${plus ? "+" : ""} ${people === 1 && !plus ? "person" : "people"}.`,
    campaign: (amount, days, places, ends) =>
      `New to Berth? Open an account through this link, set it up and still use Berth ${dayCount(days)} later, and ${amount} in USDC on Base is added to your account, while places last.` +
      (places !== null || ends !== null
        ? ` ${[places !== null ? `${places} ${places === 1 ? "place" : "places"} left` : null, ends !== null ? `until ${ends}` : null]
            .filter(Boolean)
            .join(", ")
            .replace(/^./, (first) => first.toUpperCase())}.`
        : ""),
    seeIt: "See it on Berth.",
    campaignCta: (amount, days) =>
      `New here? Join through this link, set up and still use Berth ${dayCount(days)} later, and ${amount} in USDC on Base is yours, while places last.`,
    campaignLink: "How it works:",
  },
  campaign: {
    landingTitle: "A Berth welcome offer",
    landingLede: (amount, days) =>
      `Open a new Berth account through this link, set it up and still use Berth ${dayCount(days)} later, and ${amount} in USDC on Base is added to your account, while places last.`,
    landingSameBrowser: "Sign up in this same browser, right after opening the link. The offer is remembered only here, and only for a new account.",
    setUp: (amount, days) =>
      `You joined through a Berth offer. Once your account is set up, with a verified email, a username and a wallet with an address on Base, and you still use Berth ${dayCount(days)} later, ${amount} in USDC on Base is added to your account, while places last.`,
    waiting: (amount, days, deadline) =>
      `Your account is set up. Every place in this offer is taken for now. If a place frees up for you before ${deadline}, ${amount} in USDC on Base is added once you still use Berth ${dayCount(days)} after that.`,
    paused: "The Berth offer you joined through is paused for now.",
    staying: (amount, eligible) => `Your account is set up. If you still use Berth on ${eligible}, ${amount} in USDC on Base is added to your account.`,
    qualified: "You stayed. Your reward is usually paid within a few days.",
    paid: (amount) => `Paid. ${amount} in USDC was added to your account.`,
    termsLink: "Rules",
    staff: {
      title: "Campaigns",
      lede: "Review qualified claims, pay approved ones by hand, and record the payment. Berth sends nothing itself.",
      nothingHere: "Nothing here.",
      loading: "Reading the queue",
      failed: "The queue could not be read.",
      meter: (reservedUsd, paidUsd, budgetUsd, slots, maxClaims) =>
        `${reservedUsd} reserved, ${paidUsd} paid, of ${budgetUsd}. ${slots} of ${maxClaims} places taken.`,
      active: "Active",
      inactive: "Inactive",
      activate: "Activate",
      deactivate: "Pause",
      activateConfirm: (title) =>
        `Activate ${title}? From now on, a new account opened through its link inside its dates, set up and still in use after the stated days, earns its owner the stated amount in USDC on Base. Activate only once you have read this campaign, its rules and the terms yourself, and they say exactly what will happen.`,
      activateCheck: "I have read this campaign, its rules and the terms, and they match what Berth will do.",
      activateNeedsReviewed: "Still needed: tick that you have read this campaign, its rules and the terms.",
      activateNeedsFunding: "Still needed: tick the funding check above, once the address and the network are right.",
      deleteConfirm: (title, code) =>
        `Delete ${title}? It is removed with its claims that never held a place and its payout wallets, and /c/${code} can be used again for a new campaign. This cannot be undone.`,
      deleteReason: "Why it is deleted, kept in the audit log",
      delete: "Delete",
      deleted: (code) => `Deleted. The code ${code} is free again.`,
      funding: {
        heading: "Funding",
        network: "Network",
        networkValue: "Base",
        token: "Token",
        tokenValue: "USDC on Base",
        tokenContract: "USDC contract on Base",
        wallet: "Payout wallet",
        controlledBy: "A wallet you control, outside Berth.",
        instruction:
          "Ask the sponsor to send USDC on the Base network to this address. USDC sent on any other network, or any other token, will not reach this campaign.",
        berthHolds: "Berth never holds these funds. You pay each reward by hand from this wallet.",
        copy: "Copy address",
        copied: "Copied",
        basescan: "Open on Basescan",
        qrLabel: "QR code of the payout wallet address",
        balance: "USDC on Base in this wallet now",
        refresh: "Read again",
        reading: "Reading Base",
        unreadable: "The balance could not be read on Base just now. Try again in a while.",
        readAt: (time) => `Read at ${time}.`,
        enoughFor: (rewards) => (rewards === 1 ? "Enough for 1 reward." : `Enough for ${rewards} rewards.`),
        budgetNeeds: (usd, rewards) => `The budget still needs ${usd}, ${rewards === 1 ? "1 reward" : `${rewards} rewards`}.`,
        covered: "That covers it.",
        short: (usd) => `${usd} more is needed to cover it.`,
        noWallet:
          "No payout wallet yet. Add one below before activating, and do not ask a sponsor to send anything until it is here.",
        moreWallets: (count) =>
          `${count === 1 ? "1 more payout wallet" : `${count} more payout wallets`} below also count for Mark paid. Funding goes to this one.`,
        addressLabel: "Payout wallet address on Base",
        addressHint: "A wallet you control, outside Berth. Paste it from the wallet itself.",
        checksummed: "Checksummed",
        judgements: {
          invalid: "That is not a wallet address. It starts with 0x, then 40 letters and digits.",
          bad_checksum: "Its mixed case does not match its checksum. Copy it again from the wallet.",
          zero: "That is the zero address. Nothing sent there can ever be spent.",
        },
        berthAddress: {
          usdc_contract: "This is the USDC contract itself, not a wallet. USDC sent here is lost.",
          fee_wallet: "This is Berth's fee wallet. Use a wallet you control for this campaign.",
          intents_contract: "This is a SODAX contract Berth trades through, not a wallet.",
          listing_token: "This is a listing's token contract, not a wallet.",
        },
        fundingCheck: "I've checked the address and the network: USDC on Base, to the payout wallet above.",
        createNeedsWallet: "Enter the payout wallet first.",
        createdReason: "Funding wallet, set when the campaign was created",
      },
      sources: {
        heading: "Payout wallets",
        none: "None yet. A reward can be recorded as paid only when the USDC came from a payout wallet.",
        fallback: "Wallets in STAFF_PAYOUT_ADDRESSES also count, for every campaign.",
        address: "Wallet address",
        reason: "Reason, kept in the audit log",
        add: "Add wallet",
        remove: "Remove",
        removeReason: "Why it is removed",
        added: (when, reason) => `Added ${when}. ${reason}`,
      },
      cancel: "Cancel",
      confirm: "Activate",
      sections: {
        qualified: "Qualified, to review",
        approved: "Approved, to pay",
        holding: "Set up, waiting out the days",
        paid: "Paid",
        closed: "Rejected and expired",
      },
      waiting: (arrived) =>
        arrived === 1 ? "1 new account arrived through the link, not set up yet." : `${arrived} new accounts arrived through the link, not set up yet.`,
      empty: "None.",
      states: {
        attributed: "Arrived, not set up",
        buying: "Waiting for a buy, retired",
        holding: "Set up, waiting out the days",
        qualified: "Qualified",
        approved: "Approved",
        paid: "Paid",
        rejected: "Rejected",
        expired: "Expired",
      },
      labels: {
        account: "Account, paid",
        signup: "Signed up",
        setUp: "Set up",
        lastSeen: "Last opened Berth",
        wallets: "Wallets",
        signals: "Signals",
        payTo: "Pay to",
        paid: "Payment",
        reason: "Reason",
      },
      terms: (amount, days) =>
        `${amount} in USDC on Base to each new account opened through this campaign's link that sets up and still uses Berth ${dayCount(days)} later. One per person.`,
      retired: "Made under retired rules. It cannot be activated again, and its claims are kept read only.",
      span: (from, to) => `${from} to ${to}`,
      signupLine: (signup, counted) => `${signup}. Counted for the campaign ${counted}.`,
      setUpLine: (setUp, judged) => `${setUp}. Judged on ${judged}.`,
      unlinked: "unlinked",
      noSignals: "None found.",
      noDeviceSignals: "Berth keeps no device data, so no device signal is shown.",
      signals: {
        email_alias: "Email is an alias of another claim's",
        close_signup: "Signed up within ten minutes of another claim",
        shared_wallet: "Shares a wallet with another claim",
        same_email_domain: "Its email domain, not a public mail provider, is on another claim of this campaign too",
        same_payout: "Another claim would be paid to the same address",
      },
      payTo: (amount, chain) => `${amount} USDC on ${chain}`,
      approve: "Approve",
      reject: "Reject",
      signInAgain: "Sign in again",
      reveal: "Show",
      revealWallets: "Show wallets and where to pay",
      rejectReasons: {
        not_active: "Did not use Berth again",
        one_per_person: "One per person",
        abuse: "Abuse",
        other: "Other",
      },
      expireReasons: { ended: "The campaign ended first", full: "The campaign was full" },
      systemReasons: {
        existing_customer: "Was on Berth before",
        staff_ineligible: "Marked not eligible by staff",
        wallet_used: "A wallet already counted for another claim",
        email_used: "The email already counted for another claim",
        not_active: "Did not open Berth in the last days before the check",
        self_invite: "Invited themselves, under the retired rules",
        inviter_cap: "The inviter's cap was reached, under the retired rules",
        inviter_gone: "The inviter's account was gone, under the retired rules",
        retired: "The campaign was retired",
        not_held: "Not held, under the retired rules",
        order_missing: "The order is gone, under the retired rules",
        hold_unreadable: "The hold could not be read, under the retired rules",
      },
      rejectNote: "Note, kept in the audit log",
      ineligibleApproved: (count) =>
        `Do not pay ${count === 1 ? "1 approved claim" : `${count} approved claims`}: the account was marked not eligible after approval. Mark paid will refuse it. Reject it instead.`,
      ineligibleClaim: (at) => `Marked not eligible on ${at}. Do not send USDC for this claim; Mark paid will refuse it. Reject it.`,
      sinceApproval: {
        wallet_used: "Since approval, this person stands on a wallet that already counted for another claim. Check before you send.",
        email_used: "Since approval, this person's email already counted for another claim. Check before you send.",
        existing_customer: "Since approval, this person turns out to have been on Berth before. Check before you send.",
        staff_ineligible: "Since approval, this person was marked not eligible. Check before you send.",
        no_person: "Since approval, this account is no longer there. Check before you send.",
      },
      markPaid: "Mark paid",
      txHash: "Transaction hash on Base",
      batchNote: "Send USDC from the payout wallet itself, one transfer per address or a batch the wallet signs (a Safe multisend, disperseTokenSimple). Never through a disperse contract's own transfer: that comes from the contract, and will not count.",
      verified: "Verified on Base",
      unverified: "Waiting to be read on Base. Not paid yet: check it again, or enter the right hash.",
      recheck: "Check again",
      refusals: {
        not_found: "No such claim.",
        wrong_state: "This claim has moved on. The queue is refreshed.",
        no_payout_address: "This account has no home address on Base to pay.",
        bad_hash: "That is not a transaction hash.",
        tx_failed: "That transaction failed on Base.",
        mismatch: "That transaction does not pay this address enough USDC on Base from a house payout wallet.",
        no_payout_senders: "This campaign has no payout wallet. Add one on its card first.",
        bad_address: "That is not a wallet address, or its mixed case does not match its checksum. Copy it again from the wallet.",
        source_exists: "That wallet is already a payout wallet of this campaign.",
        one_per_person: "This person already holds another claim.",
        wallet_used: "A wallet of this account already counted for another claim.",
        email_used: "This account's email already counted for another claim.",
        retired: "This campaign was made under retired rules. It cannot be activated or approved.",
        existing_customer: "This account was on Berth before the campaign link.",
        active: "Pause the campaign before deleting it.",
        has_places: "A claim of this campaign holds or once held a place, or was paid, so the campaign is kept. Pause it instead.",
        staff_ineligible: "This account is marked not eligible for campaigns. See its page under Users.",
        no_person: "This account is no longer there.",
        fresh_session: "Sign in again to do this. Staff actions need a sign in from the last fifteen minutes, by email.",
        error: "That did not go through. Nothing was changed. Try again.",
        bad_reason: "Choose a reason.",
        no_delete_reason: "Write why it is deleted.",
        bad_input: "Check the fields.",
        code_taken: "A campaign with that code already exists. Pick a different code.",
        stay_out_of_range: "The days a new account must still use Berth are 7 at least and 60 at most.",
        places_over_budget: "Places times the amount is more than the budget. Lower the places or raise the budget.",
        counsel_required: "Tick that you have read the campaign, its rules and the terms first.",
        zero_address: "That is the zero address. Nothing sent there can ever be spent.",
        funding_check_required: "Confirm the address and the network first.",
        no_funding_wallet: "This campaign has no payout wallet. Add one on its card before activating.",
      },
      create: {
        heading: "New campaign",
        code: "Code",
        title: "Title",
        amount: "Amount per new account that stays, USD, paid to that account",
        budget: "Budget, USD",
        maxClaims: "Places",
        stayDays: "Days the new account must still use Berth, 7 to 60",
        starts: "Starts",
        ends: "Ends",
        submit: "Create campaign",
        submitHint: "It starts switched off. You switch it on from the list above once it looks right.",
        hints: {
          code: "The short word in the campaign's link. Lowercase letters, numbers and hyphens, 3 to 32 of them.",
          title: "The campaign's name on this page. Only staff see it.",
          amount:
            "What each new account opened through the campaign's link gets, in USDC on Base to its own address, once it is set up and still uses Berth after the days below. A personal invite earns nothing.",
          budget: "The most this campaign pays in total. Places times the amount must fit in it.",
          maxClaims:
            "The most new accounts this campaign pays. Keep it small, 20 to 50, so every claim gets a real look. When all are taken, new accounts wait in line in case one frees up before the campaign closes.",
          stayDays:
            "How long after setting up the account must still be using Berth. It must be opened signed in at least once in the last 7 of these days. 7 to 60.",
          starts: "Only accounts opened through the link from this moment count. Accounts opened before it are ignored.",
          ends:
            "Accounts opened after this moment do not count. Accounts opened in time can still finish setting up until the end plus the days above.",
        },
        link: (url) => `The link: ${url}`,
        fits: (total, places) => `${places === 1 ? "1 place" : `${places} places`} at this amount come to ${total}, within the budget.`,
        overBudget: (total) => `Places times the amount come to ${total}, more than the budget. Lower the places or raise the budget.`,
        note: "A new campaign pays each new account opened through its link that sets up and stays, never for a buy. It is created inactive, and counts nobody until it is activated.",
        createdLine: (title) => `Campaign ${title} is created and switched off. Check it, then switch it on.`,
      },
    },
  },
};

/** "7 days", "1 day". */
function dayCount(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}
