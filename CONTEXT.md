# CONTEXT — the domain, in its own words

The glossary architecture reviews and code speak. A term listed here is the
name to use — in modules, in suggestions, in commit messages. Where a term
has a home module, it is named. Identifiers from the LSTeaTime era (pour,
cup, teapot) still appear inside the order machine and its tests; they mean
what this glossary says and are renamed only in mechanical passes, never in
a round that changes behaviour.

## The product

- **Berth** — self custodial software, not a broker: buy US stocks with the
  crypto you hold (stablecoins, ETH, SOL or Bitcoin, on more than 20
  networks) as Robinhood Stock Tokens on Sonic, tokens that track a share,
  in one signature; sell the same way; park idle dollars in the SGOV
  Treasury ETF token. Lead line "Wall Street, in your wallet."
  (docs/product/features.md). Home: berthmarkets.com.
- **Listing** — one asset the house offers on the Sonic hub: a stock or fund
  (a Robinhood Stock Token, an ERC-20 on Sonic), cash (SGOV), or a vault
  (an earlier leveraged position, withdraw only). Registry `lib/listings`;
  the SDK learns the hand-carried ones through `lib/sodax-config`;
  `pnpm listings:verify` checks the pins against the backend and the chain.
- **The board** — the listings on offer, priced by the solver oracle
  (`components/board/listing-board`, prices via `/api/listing-prices`).
- **Holdings** — what the account owns, read as plain ERC-20 balances of
  every listing at the account in one multicall (`hooks/use-hub-holdings`,
  query key root `LISTINGS_QUERY_KEY`, invalidated after every fill).
- **Cash** — idle dollars in SGOV, a plain swap in and out, never a money
  market supply. The yield line is the 3 month Treasury bill rate from FRED
  (`/api/treasury-rate`), labelled before fund costs.

## Money and accounts

- **Account** — the user's one place on the hub: the SODAX hub wallet derived
  from `(HOME_CHAIN = Base, Privy embedded EVM address)`. Every buy delivers
  there (`deliverTo` on the order machine), every sell spends from there with
  one `sendMessage` signature on Base (`hubWalletSwap`). Rule in
  `lib/account` (`HOME_CHAIN`, `homeSpokeAddress`), derived by
  `hooks/use-hub-account` through the same SDK call the deposit builder uses.
  An email session or a connected EVM wallet owns an account (the address
  rule on the home chain); a browser with only a non-EVM wallet funds but
  has no account until it signs in with email.
- **Funds** — the user's own wallets, what can pay for an order: the Privy
  embedded wallets in email mode, the connected wallet otherwise. Swept and
  valued by `hooks/use-embedded-holdings`, shown by `components/funds-module`.
- **Address rule** — whose address the user is on a given chain:
  `lib/account` `resolveAccount`: an email session wins on EVM, the SODAX
  store wins everywhere else. `hooks/use-vault-wallet` is its signing face;
  `useVaultAddress` reads without constructing a provider (a chain nobody
  signs on must never move the embedded wallet's global chain).
- **Hub wallet** — the Sonic side wallet derived from a (chainKey, address)
  pair. The same EOA maps to a DIFFERENT hub wallet per source chain, which
  is why vault positions are read per source chain while listings live on
  the one account.

## The machinery

- **Order** — a buy or a sell: one intent-based cross-chain swap between a
  spoke chain asset and a listing on Sonic. Lifecycle `idle → building →
  approving → signing → tracking → filled | fillFailed | error`, with
  `tracking → unsettled` when the solver says nothing terminal inside the
  bounded wait (sent, not failed; a late fill still resolves it), owned end
  to end by `hooks/use-vault-action` (the order machine; transitions in
  `lib/pour-lifecycle`). Solver status codes and the raw swap response never
  leave the machine. A buy is a deposit build with a listing as the
  destination; a sell or a vault withdraw is a withdraw build.
- **Amount pipeline** — how typed text becomes an order: parse (money or
  token), the pre-fee/post-fee pairing (`quoteInputFor` is its only
  implementation), slippage floor, gas-buffered Max, dust floor, and the CTA
  **gate** (the single reason an order cannot go yet, including
  `noAccount` and `accountPending`). All in `lib/pour-amount`; quotes via
  `hooks/use-pour-quote`.
- **Rewards identity** — which ledger row a browser is. A session question,
  not a chain question (`useIdentity` in `hooks/use-profile`); it never
  volunteers an external wallet while an email session is live.
- **Rewards till** — the server side of XP: `lib/server/rewards-route` owns
  auth → identity → award → envelope; `awardXp` (`lib/server/accounts`) is
  the idempotent ledger write; `lib/server/pour-verify` proves an order
  touched a listing before it earns anything. Database seam `SqlClient`
  (`lib/server/db`), Neon in prod, PGlite in tests.
- **Announcer** — the XP ceremony (`components/xp-toast`): queues payouts
  while an overlay owns the stage and derives rank crossings itself.
- **Invite code rulebook** — `lib/invite-code`, the one statement of what a
  referral code is; its server sibling is `CLAIMABLE_SQL`.
- **Rewards request core** — `useRewardsCall` (`hooks/use-profile`) and its
  two flavours; every public rewards hook is configuration on top.
- **Assistant** — Claude, ChatGPT or Grok connected to an account through
  Berth's MCP server (`app/mcp`, tools in `lib/server/mcp/tools`) after the
  person approves it on Berth's own OAuth consent screen
  (`lib/server/oauth`, `app/oauth/authorize`). It reads the account and the
  market (scope `berth.read`) and drafts orders (`berth.draft`): a draft is
  a link (`lib/draft-order`) that opens the order drawer prefilled, and
  nothing happens until the person signs. Grants are listed and revoked
  under "Your assistant" in the account drawer.
- **Ask** — the assistant inside Berth (`components/chat`, `app/api/chat`):
  GPT-6 Luna reading the same eleven tools as the MCP server
  (`lib/server/berth-tools/registry`, one definition for both doors) and
  drafting orders as cards that open the order drawer. Opens at Slip
  (`CHAT_UNLOCK_LEVEL`); capped per person per day and by a house budget;
  Berth keeps counts and cost (`chat_usage`), never what was said.
- **Username** — the name a person picks to have a card
  (`lib/handle`, the rulebook: shape, the lookalike fold, reserved and
  offensive names). Only an account with a verified email picks one;
  picking it is the opt-in to being findable by that exact name.
- **Card** — the public profile at `/u/<username>`: face, username, rank,
  XP, member since, Salutes count, and the viewer's relation to them.
  Never money, wallets, holdings or friends. Missing, hidden and blocked
  read the same ("No one by that name"). Server side in
  `lib/server/social`.
- **Salute** — one per giver per card, revocable, verified email only, no
  XP. The count shows on the card and feeds salute points.
- **Friends** — a mutual connection by request (`friend_requests`,
  `friends`; the plan called it crew). Only you see your friends. A friend
  link (`friend_links`) is its own token, not the referral code. A referral
  that binds makes the pair friends at once, no request (ADR-0006).
- **Friends board** — you and your friends ranked on board points
  (ADR-0005), this calendar month.
- **Recurring buy** — a plan (`recurring_plans`): a listing, a dollar
  amount, weekly on a weekday or monthly on a day from 1 to 28, in the
  person's own time zone. On its day Berth makes a **run**
  (`recurring_runs`: due, opened, placed or skipped) with a draft attached,
  shows the strip and sends one reminder email. The person signs it or lets
  it pass (ADR-0007). Never automatic buying.
- **Morning run** — the 06:00 UTC cron (`/api/cron/morning`,
  `lib/server/morning`): the hold check, the recurring runs and their
  reminders, the email retry. The evening run is the other of Hobby's two.
- **Appearance** — light, dark or system (`lib/appearance`), stamped by
  next-themes before hydration. The `useCopy()` seam returns the one voice.

## Settled decisions (do not re-propose)

Load-bearing decisions live in `docs/adr/` (base-voice rewards copy, the
level-3 invite gate, no leaderboard of strangers, referral pays at first
verified order, the friends board on capped points, referral is friendship,
recurring buys are reminders)
and in `docs/research/2026-09-16-colosseum-pivot-deep-dive.md` (the pivot,
the account model, the name). Recorded in `thoughts.md`: the account-linking
edge is accepted; SIWE and order-ownership proof are done. The
`useVaultAction` pipeline body, the Privy EVM provider bridge and the gas
buffer model were reviewed (2026-08-07) and confirmed deep — leave them whole.
No automatic buying. Recurring buys are reminders the person signs
(ADR-0007). Cut, do not build: cross-wrapper best execution, any money
market supply, a harbour-wide or all-time leaderboard, any ranking on
returns, agent as wallet. The friends board (ADR-0005) ranks board points:
this month's XP with order XP capped at 300, plus at most 10 salute points. Agents read and draft, the
person signs (2026-09-26): an assistant never holds a key, never signs and
never moves money; its most is a draft the person opens, checks and signs
in Berth.
