# Handover: start building Berth (week one)

Paste everything below the line into a fresh Claude Code session opened in `/Users/david/Github/leveraged-staked-yield-vibe`.

---

You are picking up a decided plan, not making one. Read this whole prompt, then the files it names, before touching code.

## What this repo is and what it is becoming

The repo is LSTeaTime, a live real-money Next.js 16 app at lsteatime.com that pours any asset from 20 chains into four leveraged LST vaults on Sonic through SODAX intents. It is being pivoted into **Berth** (domain berthmarkets.com): a self-custodial brokerage where people who already hold stablecoins or Bitcoin buy Robinhood Stock Tokens (ERC-20s on Sonic) from any chain in one signature, park idle cash in the tokenized SGOV Treasury ETF, and see exactly what they own before they buy. Target: Colosseum Crypto World's Fair, Robinhood Chain track, submissions due 2026-10-12. Only work done after 2026-09-14 is judged.

Read in this order:
1. `CLAUDE.md` and `CONTEXT.md` (conventions and vocabulary).
2. `docs/research/2026-09-16-colosseum-pivot-deep-dive.md` (the decision record: verdict, connection model, account model, name, 26-day plan, risks).
3. `docs/build-context.md` (verified SDK facts; trust it over docs.sodax.com).
4. `thoughts.md`, the last six entries (the go decision, the account model, the name).
5. `~/Github/_scratch-lsteatime/colosseum-2026/account-model-checks.md` (the live checks behind the account model, with SDK type references and quote results).
6. `~/Github/_scratch-lsteatime/colosseum-2026/app-ingestion.md` (a map of the codebase: reusable blocks with paths, what is brand-specific, known gaps).

## Decisions already made. Do not relitigate.

- **Account model.** The user's account is the SODAX hub-wallet abstraction derived from their Privy embedded EVM address on Base (the canonical spoke), obtained via `EvmHubProvider.getUserHubWalletAddress`. Every buy, from any source wallet or chain, sets `dstAddress` at intent creation to that hub wallet, exactly as `leverageYield.deposit` already delivers vault shares. Every sell is one `sendMessage` signature on Base with `hubWalletSwap: true`, the mechanism the current withdraw flow already uses in production (`src/hooks/use-vault-action.ts`). The user never needs the S token. Sponsoring Base gas through Privy smart wallets is a week-two improvement, not week one.
- **Identity.** Privy login is the account for everyone. External wallets (Phantom, Xverse, Leather, Lobstr) are funding sources, allowed on mobile through wallet in-app browsers, verified wallet by wallet. Deposit address per chain (Base, Solana) is the second funding door.
- **Asset universe.** Robinhood Stock Tokens on Sonic only, one wrapper at launch. xStocks are phase two. Cash is the SGOV token, reached by a plain swap, never `moneyMarket.supply`.
- **Consumer layer carries over unchanged**: avatar picker, referral program with verified first-trade payout, ten-rank ladder (names change later), theme switcher, six display currencies, email login, error pipeline. Do not delete parlours, lore or tea art; they go dormant in the rebrand slot.
- **Cut, do not build**: cross-wrapper best execution, recurring DCA (needs delegated signing), any money-market supply, leaderboard, agent-as-wallet.
- **Rebrand is Oct 7 to 9.** Until then the code keeps its tea vocabulary and the commit voice stays as in `git log`. Do not rename files or copy for brand reasons this week.

## Week one scope (Sep 17 to 21): the variable asset model and the account

Deliver, in order, one commit per finished piece:
1. **Destination asset registry.** Replace the four-vault enum (`src/lib/vaults-meta.ts`, the `leverageYieldVaults` usage in `src/lib/sodax-config.ts`, the six-slot `useFilledCups`) with a registry that covers the 13 Robinhood Stock Tokens on Sonic plus SGOV. Resolve token addresses and decimals live from the SDK config (`getSupportedSolverTokens`, `sonicSupportedTokens`), never from notes; notes from research disagree on which address is the Sonic ERC-20 versus the hub vault asset, so verify on chain.
2. **Account address.** A single hook that yields the user's hub wallet derived from (Base, Privy EVM address), and a balance read for arbitrary ERC-20s held by that hub wallet (today's `useLeverageYieldShareBalances` is vault-share specific). Show the NVDA balance for a test account before anything else.
3. **Buy path.** Existing pour state machine with a stock token as destination and `dstAddress` set to the account. Prove with one tiny real buy signed by David: about 2 USDC on Base into NVDA. There is no testnet; every transaction is real money. Never move funds without David signing.
4. **Sell path.** New quote shape (stock on Sonic to a stablecoin on a chosen chain), signed on Base with `hubWalletSwap: true`, recipient explicit. Prove with the same tiny position.
5. **Cash.** Idle USDC into SGOV and back, same machinery, shown as a Treasury yield line.

Acceptance for the week: a Privy email user funds from Base, buys NVDA, sees it in one account, sells to USDC on Solana, and parks cash in SGOV, with `pnpm test`, `pnpm lint` and `pnpm exec tsc --noEmit` clean and a WebKit screenshot from `pnpm shot` of each new screen.

## Guardrails

- pnpm only. Every user-facing string in `src/lib/copy.ts`, base voice. No dashes as punctuation in copy. No emoji in UI; Phosphor duotone or nothing. Verify visuals in WebKit via the repo harness, never an ad-hoc Playwright script.
- `@sodax/*` is pinned at 2.0.0 with hand-patches for the fourth vault; do not bump the SDK this week unless a blocker forces it, and record why in `thoughts.md` if you do.
- `SODAX_API_KEY` travels only through the server proxy (`src/app/api/sodax/[...path]/route.ts`); never expose it client-side.
- Quotes fail above roughly $25k to $40k per order and below about $1; keep test sizes tiny and expect "No path was found" on odd pairs.
- Strike through finished items in `thoughts.md` with a status note; one commit per round; commit messages in the current house voice until the rebrand.
- Subagent policy from the global CLAUDE.md applies: the main loop plans and adjudicates, Sonnet does reading and mechanical edits, Opus does verification. Cap concurrency at 4.

## Where things live

- Pitch deck (interactive, pinned in David's sidebar): https://claude.ai/artifact/DpZp5SJmZb1MAr63c39qjd. Update it by passing that URL to the Artifact tool; read it first.
- Research evidence, refutations, naming and account checks: `~/Github/_scratch-lsteatime/colosseum-2026/`.
- Namecheap API keys and the Colosseum Copilot token are in `.env.local` (gitignored). The Copilot skill is installed in the repo; the shell copy of its token is stale, read the file.

## Open questions to close in week one, in this order

1. Does a swap intent from a non-EVM source (Solana, Stellar, Bitcoin) accept the Base-derived hub wallet as `dstAddress` on Sonic and settle there? Verified at the type and REST level, not yet with a live fill.
2. Which on-chain address is the tradeable NVDA ERC-20 on Sonic versus the hub vault asset, and which one does the solver deliver?
3. Does `hubWalletSwap: true` work for a plain token held by the hub wallet, not only for vault shares?

Start by confirming you have read the six files, then propose the first commit's file list before editing.
