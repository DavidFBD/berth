# Berth: what it does

The canonical feature list for pitches, brand videos and other content. Every
line says whether it is live or coming. Content made from this file must not
present a "coming" feature as available, and must keep the wording under
"Say it this way" (these are product truths, not style choices).

Voice: plain, calm, adult, never clever about money. Names, not tickers.
Positioning line: Stocks for the money that already lives onchain.

## The value proposition (say this first)

One headline, one paragraph, four points. The welcome page opens on it.

> **Buy US stocks with the crypto you hold. Keep them in your own wallet.**
> Berth is software, not a broker. Choose what to pay with, sign once in your
> own wallet, and independent solvers fill the order through SODAX. What you
> buy lands with you.

- **Pay with what you hold.** Stablecoins, ETH, SOL or Bitcoin, on more than
  20 networks. One signature.
- **Your custody, always.** You sign every order. Berth never holds your keys
  or your funds.
- **Start with an email.** No seed phrase. Keys can be exported from
  Settings, Advanced (behind a plain warning, EVM and Solana).
- **Cash that earns.** Park idle money in a Treasury bill fund at the T-bill
  rate. It counts toward what you own.

## Live

1. **Buy stocks and funds with the crypto you already hold.** US stocks and
   ETFs (NVIDIA, Tesla, Apple, SpaceX, the S&P 500 fund, Gold and more) paid
   from stablecoins, ETH, SOL, Bitcoin or other assets on 20+ networks, in
   one signature. Filled by independent solvers through SODAX.
2. **Your custody, always.** Berth is software, not a broker. You sign every
   order in your own wallet. Berth never holds keys or funds.
3. **Start with just an email.** Sign in with email and get a wallet with no
   seed phrase, or bring your own wallet extension. Keys can be exported
   under Settings, Advanced, after a plain warning.
4. **Cash that earns.** Park idle money in a Treasury bill fund, so waiting
   cash earns the T-bill rate. It counts toward what you own.
5. **See what your money would have made elsewhere.** Your portfolio drawn
   beside the same dollars, on the same days, in the S&P 500 fund, the Nasdaq
   100 fund, Gold, Bitcoin or Treasury bills, over a week, a month, three
   months or since your first buy. Each holding shows its own result the same
   way.
6. **The Assistant, inside Berth.** Ask about your account and the market in
   plain words: what you own, how it compares, what moved and why. Ask it to
   draft a buy or a sell and it hands you the order, filled in, to check and
   sign. Facts, not advice. Berth keeps no copy of the chat. Unlocks at
   level 2.
7. **Bring Berth into your AI.** Connect Claude, ChatGPT or Grok to your
   Berth account through Berth's MCP server. Your own AI can read your
   account beside everything else it does (the web, your files, your other
   tools) and draft orders you sign in Berth. Disconnect any time.
8. **News that is about your stocks, curated by Jev.** A live column of posts
   on X and headlines, each read and labelled by Jev (a model by TypeSafe),
   kept only when it reports something. "What moved" links a large price move
   to the post that reported it. A calm one-line nudge when there is news
   about something you own.
9. **Buy on weekday nights, when US markets are closed.** Orders fill outside
   the New York session, through the night and early morning between
   weekdays, usually in under half a minute. Evidence: every stock token fill
   SODAX has recorded (11, 8 of them Berth's, 2026-09-11 to 09-29) landed
   between 01:08 and 07:57 New York on a weekday
   (`reports/weekend-checks.md`). **Caveat: weekends and US market holidays
   are unproven** (no attempt has ever been made, and the prices underneath
   go flat from Friday 20:00 to Sunday 20:00 New York). The board says "US
   market closed" calmly while it is.
10. **Profiles, Salutes and friends.** Pick a username to get a one-screen
    profile (avatar, rank, XP, Salutes). Find a friend by their exact
    username (needs an email on the account), salute people, add friends, and
    see a friends board ranked on XP and Salutes, never returns. Private
    until you pick a name; nobody sees anyone's friends.
11. **One account, many wallets.** Link EVM, Solana and Bitcoin wallets to
    one account; buys land at your home wallet and totals add up every
    wallet. A linked Bitcoin address pays for orders.
12. **Calm email notices.** From mail.berthmarkets.com, when a wallet joins or
    leaves the account, accounts merge, an AI is connected, a friend asks,
    or a limit order fills or expires. Security notices always go out; every
    other kind has its own switch and a one-tap unsubscribe. No marketing.
    Answered at support@berthmarkets.com.
13. **Ranks, XP and avatars.** Earn XP for buying, holding, adding an email
    and bringing friends; climb ten harbour ranks from First Line to Harbour
    Master, with avatars and features unlocked on the way.
14. **Invite friends.** Share your link; it carries through any sign up,
    wallet or email. You both earn XP when they join and trade, and you
    become friends at once.

## Coming (not live yet)

- **Limit orders.** "Buy NVIDIA if it drops to $200": set a price, the order
  waits, and fills when the price is reached. Waiting money shows under your
  total. The Assistant can draft them. (In testing, not open to everyone.)
- **Trading at weekends.** Not until a weekend fill has been seen.

## Say it this way

- The Assistant and connected AIs **read and draft; you sign.** Never "trades
  for you", "does it for you" or "autonomous".
- Leaderboards rank **XP and salutes, never returns.** Never "see who made the
  most" or a returns leaderboard.
- The comparison is against **benchmarks** (the same dollars in another
  holding), not against other people's portfolios.
- Cash sits in a **Treasury bill fund**. Say "earns the T-bill rate", not
  "interest account", "savings" or a fixed percentage.
- Tokenized stocks are **tokens that track a share**, issued by third parties.
  Do not call them the shares themselves.
- Outside market hours, say **weekday nights** (or "when US markets are
  closed, on weekday nights"). Never "weekends", "24/7", "around the clock"
  or "any time", until a weekend fill is proven.
- Keys are **exportable from Settings, Advanced**, not from the account
  drawer.
- Not available in the United States or where local law or sanctions forbid
  it.
- No price predictions, no promises of returns, no "get rich".

## Where to look in the product (for screen capture)

- Board: `src/components/home.tsx`, gallery `/dev/board?home=held` (dev only).
- Assistant: `/dev/chat` (dev only, mock model), live via the Assistant button.
- Connector help: `/assistants`. Legal: `/privacy`, `/terms`.
- Brand: `public/berth-brand/brand-sheet.md`, rank names in
  `public/berth-brand/rank-names.md`, thinking orbs only while something works.
