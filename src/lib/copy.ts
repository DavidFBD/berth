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
  /** Follows the author's name: "NVIDIA @nvidia, 2 hours ago". */
  postsByline: (handle: string, when: string) => string;
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
  rewardsTitle: string;
  rewardsDrawerSub: string;
  /** Toast after Privy's add-funds flow completes. */
  fundsAddedTitle: string;
  fundsAddedBody: string;
  /** Wallet drawer: the embedded wallet row, versus an external "Connected". */
  walletEmbeddedLabel: string;
  walletEmbeddedNote: string;
  walletConnectedLabel: string;
  rankLine: (level: number, xp: string) => string;
  xpToNext: (xp: string, rankName: string) => string;
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
};

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
    "What the companies and the market desks are posting on X. Tapping one opens the post.",
  postsEmpty: "The accounts we follow have been quiet.",
  postsEmptyFor: (name) => `Nothing about ${name} on X right now.`,
  postsByline: (handle, when) => `@${handle}, ${when}`,
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

  rewardsTitle: "Your rank",
  rewardsDrawerSub: "Rewards for using Berth, and an avatar for your account.",
  fundsAddedTitle: "Funds added",
  fundsAddedBody: "USDC is on its way to your account.",
  walletEmbeddedLabel: "Your account wallet",
  walletEmbeddedNote: " · from your email sign in",
  walletConnectedLabel: "Connected",
  rankLine: (level, xp) => `Level ${level} · ${xp} XP`,
  xpToNext: (xp, rankName) => `${xp} XP to ${rankName}`,
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
};
