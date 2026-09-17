# CONTEXT — the domain, in its own words

The glossary architecture reviews and code speak. A term listed here is the
name to use — in modules, in suggestions, in commit messages. Where a term
has a home module, it is named. Identifiers from the LSTeaTime era (pour,
cup, teapot) still appear inside the order machine and its tests; they mean
what this glossary says and are renamed only in mechanical passes, never in
a round that changes behaviour.

## The product

- **Berth** — a self custodial brokerage for people whose savings already
  live onchain: buy Robinhood Stock Tokens on Sonic with stablecoins or
  Bitcoin from any supported network, in one signature, sell the same way,
  park idle dollars in the SGOV Treasury ETF token. Home: berthmarkets.com.
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
  Only an email session owns an account; external wallets fund.
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
  approving → signing → tracking → filled | fillFailed | error`, owned end
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
- **Appearance** — light, dark or system (`lib/appearance`), stamped by
  next-themes before hydration. The `useCopy()` seam returns the one voice.

## Settled decisions (do not re-propose)

Load-bearing decisions live in `docs/adr/` (base-voice rewards copy, the
level-3 invite gate, no leaderboard, referral pays at first verified order)
and in `docs/research/2026-09-16-colosseum-pivot-deep-dive.md` (the pivot,
the account model, the name). Recorded in `thoughts.md`: the account-linking
edge is accepted; SIWE and order-ownership proof are done. The
`useVaultAction` pipeline body, the Privy EVM provider bridge and the gas
buffer model were reviewed (2026-08-07) and confirmed deep — leave them whole.
Cut, do not build: cross-wrapper best execution, recurring DCA, any money
market supply, leaderboard, agent as wallet.
