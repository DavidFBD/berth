# CONTEXT — the domain, in its own words

The glossary architecture reviews and code speak. A term listed here is the
name to use — in modules, in suggestions, in commit messages. Where a term
has a home module, it is named.

## The game

- **Pour** — a deposit ("pour in") or withdrawal ("pour back"): one
  intent-based cross-chain swap between a spoke-chain asset and lsoda*
  vault shares on the Sonic hub. Never "transaction" or "swap" in copy.
- **Cup** — one vault position as the user sees it. Cups sit minimized on
  the **shelf** and spring open into the full card.
- **Teapot** — the user's spendable holdings (embedded wallets in email
  mode; the connected wallet otherwise).
- **Steeping** — the pot: what a cup holds, valued in the underlying asset
  (or USD when the oracle prices it).
- **Steam / fill** — a cup's rendered heat and fullness. Derived once, in
  `lib/cup-view` (via `hooks/use-cup-view`); a cup steams by what it is
  worth.
- **Sawtooth** — the microscopic negative drift of a leveraged vault's
  price-per-share between LSD oracle ticks. Suppressed inside a 0.1% noise
  band by `lib/cup-view`; a real loss stays red.
- **Mode / voice** — one of six visual+copy personalities. The seam is
  `useCopy()` (`lib/copy`, six adapters behind one interface); mode ids
  live in `lib/modes` so the server never imports the voices.

## The machinery

- **Pour lifecycle** — every step a pour passes through, from first tap to
  solver fill: `idle → building → approving → signing → tracking → filled |
  fillFailed | error`. Owned end to end by `hooks/use-vault-action`
  (the pour machine); the pure transitions live in `lib/pour-lifecycle`.
  Solver status codes and the raw swap response never leave the machine.
- **Amount pipeline** — how typed text becomes a pour: parse (USD or
  token), the pre-fee/post-fee pairing (build on pre-fee, quote on
  post-fee — `quoteInputFor` is its only implementation), slippage floor,
  gas-buffered Max, dust floor, and the CTA **gate** (the single reason a
  pour can't go yet). All in `lib/pour-amount`; quotes via
  `hooks/use-pour-quote`.
- **Account** — whose address the user is on a given chain. THE rule lives
  in `lib/account` (`resolveAccount`): an email session wins on EVM (the
  Privy embedded wallet), the SODAX store wins everywhere else (email-mode
  Solana is bridged into the store). `hooks/use-vault-wallet` is its
  signing face. The address that is read is the address that signs.
- **Rewards identity** — which ledger row a browser is. A session question,
  not a chain question (`useIdentity` in `hooks/use-profile`); it never
  volunteers an external wallet while an email session is live, because
  account linking is an explicit act.
- **Rewards till** — the server side of XP: `lib/server/rewards-route`
  owns auth → identity → award → envelope for every XP route; `awardXp`
  (`lib/server/accounts`) is the idempotent ledger write; `lib/server/hub-tx`
  verifies a pour's hub receipt before it earns anything.
- **Hub wallet** — the Sonic-side wallet derived from a (chainKey, address)
  pair. The same EOA maps to a DIFFERENT hub wallet per source chain, which
  is why share rows are never interchangeable across chains.

## Settled decisions (do not re-propose)

Recorded in `thoughts.md`: wallet-guest mutations trusted by address (SIWE
deferred), pour-ownership proof deferred, account-linking edge accepted,
leaderboard explicitly not now. The `useVaultAction` pipeline body, the
Privy EVM provider bridge, the gas buffer model, and the earned-yield
pure/impure split were reviewed (2026-08-07) and confirmed deep — leave
them whole.
