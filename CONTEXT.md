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
- **Mode / voice** — one of eight visual+copy personalities. The seam is
  `useCopy()` (`lib/copy`); mode ids live in `lib/modes` so the server never
  imports the voices.
- **Base voice** — Original, the one voice that defines every `Copy` key;
  the other seven parlours are `Partial<Copy>` overrides layered on top, so
  a new line costs one edit. Rewards prose lives in the base only (agnostic
  by design; see CLAUDE.md).

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
  (`lib/server/accounts`) is the idempotent ledger write;
  `lib/server/pour-verify` proves a pour before it earns anything. The
  till's database seam is `SqlClient` (`lib/server/db`), two adapters: Neon
  in prod, PGlite in tests (`pglite-test-db`).
- **Announcer** — the XP ceremony module (`components/xp-toast`): queues
  payouts while an overlay owns the stage, derives rank crossings itself
  from `(rewards, newXp)`, and names what each award was for.
- **Invite code rulebook** — `lib/invite-code`, the ONE statement of what a
  referral code is (alphabet, length, normalizer); pocket, OG gates, claim
  input, and the server mint all ask it. Its server-side sibling is
  `CLAIMABLE_SQL` (`lib/server/accounts`): the late-claim rule stated once,
  asked by both the claim write and the panel's `canClaim`.
- **Rewards request core** — `useRewardsCall` (`hooks/use-profile`): the one
  identity+auth+POST ritual; `useRewardsQuery` and `useProfileMutation` are
  its two flavours, and every public rewards hook is configuration on top.
- **Hub wallet** — the Sonic-side wallet derived from a (chainKey, address)
  pair. The same EOA maps to a DIFFERENT hub wallet per source chain, which
  is why share rows are never interchangeable across chains.

## Settled decisions (do not re-propose)

Load-bearing decisions live in `docs/adr/` — read them before proposing
changes in their territory: base-voice rewards copy (0001), the level-3
invite gate (0002), no leaderboard (0003), referral pays at first verified
pour (0004). Smaller settled points, recorded in `thoughts.md`: the
account-linking edge is accepted; SIWE and pour-ownership proof are DONE
(2026-08-07), no longer deferred. The `useVaultAction` pipeline body, the
Privy EVM provider bridge, the gas buffer model, and the earned-yield
pure/impure split were reviewed (2026-08-07) and confirmed deep — leave
them whole.
