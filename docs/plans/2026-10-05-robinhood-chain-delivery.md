# Robinhood Chain delivery: build plan, 5 October 2026

David decided GO on 4 Oct: a hybrid behind a per-user switch. New EVM buys deliver the native Robinhood stock token to the person's own wallet on Robinhood Chain (chain 4663, SDK key `robinhood`, relay id 21071). Hub holdings on Sonic stay sellable exactly as today. Colosseum closes 12 Oct and has a Robinhood Chain track, so the goal of this plan is a demoable, switched-on slice in production by Sun 11 Oct.

Inputs: `~/Github/_scratch-berth/reports/robinhood-chain.md` (research, 8 to 11 build days), `reports/robinhood-chain-plan.md` (first plan, 4 Oct), `reports/rh-p0a-build.md`, `rh-p0a-review.md` and `rh-p0a-delta.md`. This plan supersedes the first one where they differ. Base is `origin/master` 6ee518a. The main checkout's local `master` (94d1d1c) is about 30 commits behind origin, so always branch and ship from `origin/master`.

## 1. State of `rh-p0a-sdk` (phase 0a, the SDK bump)

**What it changes.** 14 commits ahead of its merge base, HEAD bb167ca, worktree `~/Github/_scratch-berth/rh-p0a`, bundle `docs/proposed-diffs/2026-10-05/rh-p0a-sdk.bundle`. 26 files, +722/-1009, of which about 1,000 lines are lockfile.
- `package.json`: the four `@sodax/*` packages pinned exactly at `2.2.0-rc.8`, up from 2.0.0. rc.8 is the only version with the 24 stock tokens on the `robinhood` spoke.
- `src/lib/sodax-config.ts`: Robinhood Chain RPC pinned in `PINNED_EVM_RPCS` (publicnode) with dRPC in `EVM_RPC_FAILOVERS`, the same shape as Polygon.
- `src/lib/chains.ts`: `HUB_VAULT_DISPLAY` keeps the sodaBTC and sodaSOL names that rc.8 renamed to BTC and SOL. It adds `sdkAddress(chainKey, address)`, which checksums every EVM address handed to the SDK because rc.8's `encodeAddress` is strict. `isTypedEvmAddress` covers the typed cash-out field. `getNativeGasToken(bitcoin)` stays undefined, since rc.8 changed BTC's native token to `'0:0'`.
- `src/hooks/use-vault-action.ts`, `action-stepper.tsx`, `pour-lifecycle.ts`: before approving, a read-only `sodax.swaps.buildApproveTxs({ raw: true })` probe with a 5 s cap tells the stepper when the wallet will ask twice. rc.8 sends a USDT-style reset and the approve as two prompts (`Erc20Service.planApproval`, `SpokeService.executeErc20ApprovalPlan`).
- `slow-order.ts` tests: a `-999` from `swaps.getStatus`, which rc.8 can return from its new backend fallback, means keep waiting.
- Server: `getUserHubWalletAddress` now gets checksummed input in `portfolio.ts`, `orders-recover.ts`, `pour-ownership.ts`, `use-hub-account.ts` and `use-limit-orders.ts`. Stored `pay_symbol` keeps the soda names in `server/orders.ts`, `server/limit-orders.ts` and `scripts/orders-backfill.mjs`.
- New tests: `sui-pay.test.ts`, an offline check of the `SuiGrpcTransport` rewrite, plus Robinhood Chain not reachable as a pay-from chain (`DEPOSIT_SOURCE_CHAINS`) and present in `PRIVY_SUPPORTED_CHAINS`.

**Green?** I checked a detached copy of bb167ca on 5 Oct, which has since been removed.
- `pnpm exec tsc --noEmit`: 0 errors.
- `pnpm test`: 192 files and 2,358 tests pass. One fails: `src/lib/server/social-proof.db.test.ts`, "puts the listings on a friend's card only when both share".
  - This failure is not from the SDK. The test dates fixtures to `2026-10-01`. But `social/cards.ts` calls `friendHolds(viewer, id)` without `now`, so it uses the real clock, and `FRIEND_HOLDINGS_MAX_AGE_DAYS = 3` puts 1 Oct outside the window from 5 Oct on.
  - The same test is red on master today. The fix is small: pass `now` through the card read, or date the fixture relative to `Date.now()`. It goes in with P0a so every later package has a green gate.
- The 4 Oct review (3 lenses plus a deep diff) said SHIP, and so did the delta verifier. The four minors it raised are fixed in 8661ab8, a5df421, b92aecf and bb167ca, and no delta has been run on those four commits.

**Conflicts with current master.** `git merge-tree origin/master rh-p0a-sdk` gives 2 content conflicts. Everything else auto-merges, including `package.json`, `use-vault-action.ts`, `withdraw-drawer.tsx`, `copy.ts` and `server/limit-orders.ts`.
- `src/components/flow/action-stepper.tsx`: master added `headless` (a sponsored email send has no wallet screen) and the branch added `approveTwice`. Both change the `stepMessage(step, copy, …)` signature.
  - Resolution: `stepMessage(step, copy, { headless, approveTwice })`.
  - When both are true, the headless approve words win, with a short "two approvals" variant, because nobody is asked to confirm anything.
  - Needs one new copy key and a test.
- `src/components/flow/deposit-drawer.tsx:754`: keep both props, `headless={mode === "email" && gas.sponsored(srcChainKey)}` and `approveTwice={action.approveTwice}`.

**Left before it can ship.**
1. Merge `origin/master` into the branch and resolve the two conflicts as above.
2. Fix the clock-rot test.
3. Run tsc, lint and test on the merged tree.
4. Run one Opus delta lens on the merge resolution and the four post-delta commits. Tier A, because it touches the order stepper.
5. Squash-ship as its own round.
6. Gas sponsorship (`NEXT_PUBLIC_GAS_SPONSOR_CHAINS`) is **not** enabled in the same deploy, so a regression points at one change.

**Risks to live orders, all on today's hub path.**
- **Relayer endpoint.** It moved to `api.sodax.com/v1/relay` (verified keyless, CORS `*`).
- **Sui is a whole transport rewrite** (`@mysten/sui` 2.x, gRPC). Nothing live has tested it; the offline test only checks the config.
- **Two-prompt approves.** USDT-style tokens with a stale allowance now get two wallet prompts.
- **Strict address encoding.** A mixed-case address with a wrong checksum is now refused at build. That is safer.
- **`expectedChainId`.** The EVM wallet provider now refuses a send on the wrong chain. That is also safer.
- **NEAR's RPC and the Bound host** changed upstream and are unpinned.
- The exact version pin makes a revert one commit.

**Recommendation: ship P0a now, alone, as package 1 of session 1,** gated by David's live smoke the same day.
- **Smoke test:**
  - $5 NVDA from Base USDC: the quote shows 0.4% and the fee receiver is `0xbe59…Ca23`.
  - Sell it back.
  - Place and cancel a limit order.
  - $2 paid in SUI from Sui.
  - Robinhood Chain appears nowhere in pay-from.
- If the smoke shows a fill or relay regression, revert and raise it with the SODAX SDK team (memory: report SDK bugs upstream). Everything below depends on rc.8.

## 2. Packages

Each package is one round: built in its own worktree `~/Github/_scratch-berth/rh-<pkg>`, committed per finding, bundled to `docs/proposed-diffs/2026-10-0x/`, squash-shipped from a detached `origin/master` worktree, then deployed. Review tiers follow the global rules:
- **A:** 3 Opus lenses plus 1 delta verifier where blockers or majors were fixed.
- **B:** 1 lens.

"Days" are the research report's build-effort units. With agents, one session is about one calendar day for 3 packages.

**The switch.** `ROBINHOOD_DELIVERY_USERS` is a server env var parsed by the existing `switchedOn()` in `src/lib/limit-orders.ts`, mirroring `limitOrdersOn` in `src/lib/server/limit-orders.ts`. The client learns it from a route, never from a `NEXT_PUBLIC_` var. Unset means nobody, which is how every package below ships dark.

**Update, 8 Oct (David: default to Robinhood Chain, ship dark).** The switch is now `ROBINHOOD_DELIVERY` in `src/lib/server/delivery.ts`:
- unset or empty: `listed`, only the accounts in `ROBINHOOD_DELIVERY_USERS` (empty means nobody). This is the code's default, so no deploy switches delivery on by accident.
- `on`: every eligible account. **Turn on by setting `ROBINHOOD_DELIVERY=on` and redeploying**, once a sell from Robinhood Chain (P3a), the server reads (P1b) and the Terms addendum (P5) are in.
- `off`, or any value it does not recognise: nobody.
- `ROBINHOOD_DELIVERY_DENY` keeps the named user ids or wallets on the hub in every mode.
- Every other check is unchanged: restricted and unknown countries, no new buys, signer not a linked EVM wallet, not a plain key, failed reads all answer the hub.
- Robinhood Chain holdings are read for every account with an EVM wallet, whatever the switch says, so turning it off never hides what was delivered.

**SDK facts this plan relies on**, checked in `~/Github/_scratch-berth/rh-p0a/node_modules/@sodax/sdk@2.2.0-rc.8`:
- `ChainKeys.ROBINHOOD_MAINNET = "robinhood"` (`@sodax/types` `chains/chain-keys`). `robinhoodSupportedTokens` lists the 24 listings, with `address` the native token and `hubAsset` the hub asset. The `robinhoodChain` viem chain is exported from `@sodax/sdk`.
- Berth buys with `sodax.leverageYield.deposit(…)`, then `sodax.leverageYield.createVaultIntent({ ...payload, walletProvider, raw: false })`, then `relayTxAndWaitPacket`, then `sodax.leverageYield.notifySolver`.
  - `payload.params` is a plain `CreateIntentParams` with `dstChainKey`, `outputToken` and `dstAddress`.
  - `createVaultIntent` only checks `config.isValidOriginalAssetAddress(params.dstChainKey, params.outputToken)` and `isValidSpokeChainKey(dstChainKey)`. It does not require the output to be a vault.
  - So an RH buy is today's buy with three params overridden: `dstChainKey: "robinhood"`, `outputToken: <native RH token>` and `dstAddress: <EVM address>`. This is the same override pattern `deliverTo` already uses at `use-vault-action.ts:1246`.
- **An RH sell is not `leverageYield.withdraw`.** `withdraw` sets `hubWalletSwap: true` and spends from the hub wallet. An RH sell is a spoke-source intent built directly:
  - It goes through `createVaultIntent` with no `hubWalletSwap`, using `srcChainKey: "robinhood"`, `inputToken: <native RH token>` and the payout chain and token as output.
  - It needs an ERC-20 approve to the robinhood asset manager first, using the approve path every EVM spoke already uses: `sodax.swaps.isAllowanceValid`, `buildApproveTxs`, and dapp-kit `useSwapApprove`.
  - The fee is still `config.leverageYieldPartnerFee`, the global 0.4%.

| # | Package | Days | Tier | Session |
|---|---|---|---|---|
| P0a | SDK 2.2.0-rc.8 ship (+ stale test, merge fix) | 0.25 | A (delta lens only, review done) | 1 (Mon 5) |
| P0b | Registry, switch, `holding_chain`, holds guard | 0.5 | B | 1 |
| P2a | Server accepts RH-delivered buys (dark) | 1 | A | 1 |
| P1a | Client reads holdings on two chains | 1 | A | 2 (Tue 6) |
| P2b | Buy destination switch | 1 | A | 2 |
| P3a | Sell from Robinhood Chain | 1.5 | A | 3 (Wed 7) |
| P4d | Demo copy: RH holding custody line, arrival line | 0.5 | B + legal-copy read | 3 |
| P1b | Server reads: evening job, holds, MCP | 1 | A | 4 (Thu 8) |
| P3b | Send out from Robinhood Chain | 0.5 | A | 4 |
| — | Demo rehearsal on production | — | — | 4 |
| buffer | Fixes only, nothing new merges after Sat 10 | — | — | Fri 9 to Sun 11 |

The total is 7.25 build days to the demo, plus P5 to P7 after it.

### P0a. SDK bump ships (session 1, first, alone)

As in section 1. Files: the branch as is, plus the stepper and drawer merge resolution, `src/lib/copy.ts` (one headless-twice key) and `src/lib/server/social-proof.db.test.ts` or `social/cards.ts` (the clock fix).
- **Touches live write paths:** yes, every order goes through the new SDK.
- **Ships dark:** not dark, by nature. The revert is one commit.
- **Verified by:** tsc, lint and test on the merged tree, `pnpm listings:verify`, and `pnpm shot` (webkit) of the buy sheet with the stepper. Then David signs the smoke test above on mainnet.

### P0b. Registry, switch, schema (session 1)

- `src/lib/listings.ts`: each listing gains `rhAddress`, from `ROBINHOOD_CHAIN_ADDRESS_BY_SYMBOL` in `src/lib/market-ids.ts`, and `rhHubAsset`, from `sodax.config` or `spokeChainConfig.robinhood.supportedTokens`. A test checks all 24 are present and that each differs from the Sonic vault address.
- `scripts/verify-listings.mjs`: also diff against the robinhood spoke tokens, via `config.getSupportedSwapTokensByChainId("robinhood")`.
  - In rc.8 the name is `getSupportedSwapTokensByChainId`; the old plan's `getSupportedSolverTokens` does not exist in the d.ts.
- New `src/lib/delivery.ts`:
  - `deliveryFor({ switched, evmAddress, country }) -> { chainKey: "sonic" | "robinhood", address }`, a pure function.
  - Tests cover: no EVM wallet, switched, unswitched, and a Robinhood-restricted country (decision 3).
- New `src/app/api/delivery/route.ts`, mirroring `src/app/api/limit-orders/route.ts`: `{ robinhood: boolean, address }` for the signed-in account.
- `db/schema.sql`: `alter table orders add column if not exists holding_chain text;`. Null means sonic. Then `pnpm db:push`, with `.env.local` symlinked into the worktree and removed after.
- **Holds guard.** `src/lib/server/holds.ts` judges `balanceOf(listing, delivered_to)` on Sonic, and a "not held" verdict is final ("forfeit"). Until P1b, its candidate query (`holdCandidates`, around line 75) adds `and coalesce(o.holding_chain, 'sonic') = 'sonic'`, so an RH buy can never be wrongly forfeited on day 30.
- **Touches live write paths:** schema only, additive. **Ships dark:** the env var is unset.
- **Verified by:** tests and a db test of the holds filter.

### P2a. Server accepts RH-delivered buys (session 1, dark)

- `src/lib/server/pour-verify.ts`, `orders.ts`, `orders-recover.ts`: an intent with `dstChain` 21071 and an output equal to a listing's `rhHubAsset` is a buy of that listing. Record `delivered_to` (the EVM address) and `holding_chain = 'robinhood'`.
- `src/lib/server/portfolio.ts`: `LISTING_BY_ADDRESS` also maps `rhAddress` and `rhHubAsset`.
- `src/lib/server/pour-ownership.ts`, `judgeOwnership` rule 2: a buy delivered to robinhood is accepted at one of the account's EVM wallets, owned at intent time (`heldAt`).
- `src/lib/server/issue-body.ts` and `error-report.ts`: auto-filed issues show the delivery chain.
- **Touches live write paths:** yes, order rows, XP and the ownership proof. Tier A. Lenses:
  1. Ownership and spoofing: a stranger's address, a wallet linked after the intent, a Solana-only account.
  2. Order, XP and fee accounting.
  3. Recovery and idempotency of a stuck RH-bound intent.
- **Ships dark:** no client creates these intents yet.
- **Verified by:** db tests for each case above.

### P1a. Client holdings on two chains (session 2)

- `src/hooks/use-hub-holdings.ts` (`useHubHoldings`): today it runs one `sodax.hubProvider.publicClient.multicall` of `balanceOf` on Sonic. Add a second multicall on a viem public client for `robinhoodChain`, using the pinned RPC from `getPinnedRpcUrls`, reading `balanceOf(rhAddress, evmAddress)` for each linked EVM wallet. Each holding gains a `chain`.
- `src/hooks/use-hub-account.ts` and the board, listing and drawer components that sum holdings: one position per listing, summed, with a per-chain breakdown in the holding detail.
- If the RH read fails, the screen degrades to hub only. It must never show a zero as fact; reuse `home_last_known` if possible.
- `src/lib/token-multiplier.ts`: no change, because the native token carries `uiMultiplier()`. Add a test that both legs get the same multiplier.
- **Touches:** customer-visible money (balances). Tier A.
- **Ships dark:** reads are live for every EVM account and return zero until something lands. Alternatively, gate the RH multicall on the switch to save RPC calls. That is cheaper, and recommended until P5.
- **Verified by:**
  - tests: merge and sum, a zero chain dropped, a failed read;
  - `pnpm shot` webkit of `/dev/board` with a mixed-holdings fixture (`/dev/board?open=NVDA`), phone and 1280 wide.

### P2b. Buy destination switch (session 2) — first live RH buy

- `src/hooks/use-vault-action.ts`: when `/api/delivery` says robinhood, override `payload.params` with `dstChainKey: "robinhood"`, `outputToken: listing.rhAddress` and `dstAddress: sdkAddress("robinhood", evmAddress)`. This sits beside the existing `deliverTo` override.
- `src/lib/pour-amount.ts`: quote to the RH token on the robinhood chain (`token_dst`), so `minOutputAmount` is in the right units. Native RH tokens and vault shares are both 18 decimals, but the quote must still be taken to the RH token.
- `src/components/flow/deposit-drawer.tsx`: the review sheet shows one arrival line, from a copy key.
- Limit buys keep hub delivery for the whole plan (P6).
- Any non-200 answer from `/api/delivery` (an error, a timeout, a 401, a 5xx) means hub. Only a 200 that says robinhood switches the destination; the hook never infers robinhood from anything else.
- **Touches live write paths:** yes, the destination of real money. Tier A, lens 1 focused on `params` mutation after `deposit()`.
- **Ships dark:** the switch.
- **Verified by:**
  - `pnpm shot` of the review sheet;
  - then David, switched on, buys $5 of NVDA from Base USDC. Expect: the native token at his EVM address on 4663 (Blockscout), an order row with `holding_chain = robinhood`, the board showing it, and the fill timed. The research expects about 7 to 8 s extra.
  - Until P3a, the only exit for this $5 is waiting for P3a, which is accepted because only David is switched.

### P3a. Sell from Robinhood Chain (session 3) — first live RH sell

- `src/hooks/use-vault-action.ts`: a new RH-source sell.
  - The params are built directly: `srcChainKey: "robinhood"`, `srcAddress` the EVM address, `inputToken: rhAddress`, the payout chain and token as output, `minOutputAmount` from the quote.
  - Then approve (`sodax.swaps.isAllowanceValid` / `useSwapApprove` against the robinhood asset manager), `createVaultIntent` without `hubWalletSwap`, relay and notify, the same as a buy from Base.
  - The wallet must be on 4663; `onRightChain()` and `expectedChainId` cover that.
- `src/components/flow/withdraw-drawer.tsx`, the sell size and Max:
  - When a listing is held on both chains, the default sells the Robinhood Chain leg first.
  - A quiet source choice appears only when both are held.
  - Never a silent two-leg sell.
- `src/lib/gas-need.ts`, `src/hooks/use-gas-gate.ts`: a Robinhood Chain ETH line. Embedded wallets are sponsored if 4663 is in `NEXT_PUBLIC_GAS_SPONSOR_CHAINS`. External wallets are told plainly that they need a little ETH on Robinhood Chain.
- `src/lib/server/pour-ownership.ts`: no change expected, since RH sells fit the generic spoke-source rule. Add a test anyway.
- **Touches live write paths:** yes. Tier A. Lenses: spend authority and approve; Max and two-source sizing; gas and sponsorship on 4663.
- **Ships dark:** the switch.
- **Verified by:** `pnpm shot` of the sell sheet with both sources. Then David sells the $5 NVDA back to Base USDC, once from the email (sponsored) account if decision 2 allows, otherwise from an external wallet holding ETH on 4663.

**Built 8 Oct on `feat/robinhood-sell` (with P1b), unreviewed.** A sell from the wallet on Robinhood Chain goes through `runWithdraw` with `robinhood: { rhAddress }`: the SDK's `leverageYield.withdraw` build becomes a robinhood spoke intent (`lib/robinhood-sell` `robinhoodSellPayload`: `srcChainKey`, `srcAddress`, `inputToken` replaced, `hubWalletSwap` dropped), then `sodax.swaps.isAllowanceValid` / `useSwapApprove` (the asset manager, for exactly `inputAmount`), `createVaultIntent`, relay and `notifySolver` through `sendMarket`. The sheet lists each place that holds the stock with its own Max and never sums them; it opens on the wallet on Robinhood Chain when this session signs for it. Market only. 6a48526 is undone in `lib/orders` `listingOfIntent`. Open: whether SODAX's relayer picks up an intent sent from inside a sponsored 7702 bundle on 4663 (decision 2). Until it answers yes, 4663 is held out of PRIVY_SPONSORABLE_CHAIN_IDS (lib/gas-sponsor), so listing it in NEXT_PUBLIC_GAS_SPONSOR_CHAINS does nothing and every sell from there pays its own fee.

**Support only (rh-money m3).** A sell from Robinhood Chain is created by the hub wallet derived for (Robinhood Chain, the wallet), not the home chain's. `pnpm orders:recover` now reads the intents filed under that hub wallet too, so a filled sell the page never reported is found. An unfilled, cancelled or expired sell that leaves value in that hub wallet is not shown anywhere in Berth: the app derives hub wallets on the home chain only. Until it does, such a case is support only: derive the hub wallet with `hubProvider.getUserHubWalletAddress(address, "robinhood")`, read its balances on Sonic, and help the person withdraw.

### P4d. Demo copy (session 3)

- `src/lib/copy.ts`:
  - The RH-holding custody line, using "in your own wallet on Robinhood Chain".
  - The arrival line on the buy sheet.
  - The source names on the sell sheet.
  - The holding detail's per-chain lines.
  - Hub holdings keep today's wording ("an account your wallet controls"), never "in your own wallet".
- Names, not tickers. No dashes as punctuation.
- **Tier B, plus a legal-copy read** against `reports/legal-pass.md` (b).
- **Verified by:** `pnpm shot` webkit phone and desktop, light and dark.

### P1b. Server reads on two chains (session 4)

- `src/lib/server/portfolio.ts`, `readAccountBalances` and `runPortfolioSnapshot`: read both chains and sum before `savePortfolioDay`. Free EOA transfers are marked, never penalised.
- `src/lib/server/holds.ts`: read `balanceOf` on `holding_chain`, then lift the P0b guard. `src/lib/server/campaigns/eligibility.ts` gets the same.
- `src/lib/server/berth-tools/account.ts` and `registry.ts`: holdings lines carry their chain, and the wallets list includes the RH address.
- The weekly email and Most held read `portfolio_days`, so they need no change once days are summed.
- **Touches:** live writes (portfolio_days, XP holds). Tier A.
- **Ships dark:** the reads are a no-op for anyone with nothing on 4663.
- **Verified by:** db tests, MCP output snapshots, and a dry run of the evening snapshot for David's account (SELECT-only).
- Must land before **4 Nov**, the first possible 30-day hold of a demo buy. The P0b guard keeps it safe until then.

**Built 8 Oct on `feat/robinhood-sell`, unreviewed.** `lib/server/robinhood-balances` reads every wallet's 4663 balances in Multicall3 `aggregate3` calls (240 balances each, three to a request, one request at a time per process, 429s waited out by the multiplier reader's `robinhoodRpcBatch`, two minute memo). `readAccountBalances` adds them to the hub, so the snapshot (and the weekly email and Most held through `portfolio_days`), the history chart's live point, the assistant and the wallet removal check count them. The snapshot reads every wallet once up front; an account with a Robinhood Chain order writes no day when that chain does not answer, any other keeps its hub figure. The hold check reads `balanceOf(rhAddress, delivered_to)` on 4663 for a Robinhood row and the ON_SONIC guard is gone: a delivery that never arrived is never paid.

### P3b. Send out from Robinhood Chain (session 4)

- `src/components/flow/withdraw-drawer.tsx`: an RH holding sends as a plain ERC-20 `transfer` on 4663, with the address check (`isTypedEvmAddress`) and a gas line. Hub send-out is unchanged.
- **Tier A.** **Ships dark:** the switch. **Verified by:** shot, plus an optional $1 send by David.

### After the demo

- **P5.** A Terms and Privacy addendum for native delivery, drafted by Opus and approved by David. Full P4 copy (ownership screen, `llms.txt`, MCP wording). Then widen the switch to all eligible EVM accounts. 1 day.
- **P6.** Limit orders to and from Robinhood Chain. 1.5 days.
- **P7.** An optional "move my hub stocks to my wallet" flow: a hub to RH withdrawal for existing holders. 1 to 2 days.

## 3. Demo slice by Sun 11 Oct, and what is honestly not done

**Live behind the switch, for David's demo accounts on production:** P0a, P0b, P2a, P1a, P2b, P3a and P4d. P1b and P3b are expected by Thu 8 but can be cut.

**Demo script:**
1. A switched account buys NVIDIA with Base USDC in one signature.
2. The native "NVIDIA • Robinhood Token" lands in the person's own wallet on Robinhood Chain, about 8 seconds after the hub fill. It is visible on `robinhoodchain.blockscout.com`, with `uiMultiplier` applied.
3. The board shows it with "in your own wallet on Robinhood Chain".
4. The person sells it back to Base USDC from Robinhood Chain.

The best version uses an email account with no ETH anywhere (sponsored on Base and 4663). It needs decision 2. Otherwise the demo uses an external wallet with a little ETH on Base and 4663.

**Not done by 11 Oct:**
- Limit orders stay hub-only, switched accounts included.
- Existing hub holdings cannot be moved to the wallet.
- The switch is not widened. The Terms still describe hub custody, so only named accounts get native delivery.
- Solana, Bitcoin and other non-EVM accounts keep hub delivery, permanently, by design.
- If P1b slips: the history chart, weekly email and assistant do not see RH holdings, and holds stay guarded, not judged.
- If P3b slips: no send-out from RH in the app (any wallet can still transfer).
- rc.8 is a release candidate. 2.2.0 stable should replace it before widening.
- The SODAX question on the NVDA vault's Stellar and Hedera balances is still open. It affects the legacy hub wording only.

## 4. Decisions needed from David (only what blocks)

1. **Ship rc.8 to production today** (recommended), pinned exactly, and ask SODAX for 2.2.0 stable before the switch widens.
2. **Gas on 4663.** Put Robinhood Chain in the Privy dashboard's sponsorship list, turn on "Allow transactions from the client", and add `4663` (and `8453`) to `NEXT_PUBLIC_GAS_SPONSOR_CHAINS` in Vercel.
   - **Prerequisite:** the open SODAX relay question from the 4 Oct handover. Does the relayer pick up spoke messages inside a bundler's `handleOps` (ERC-4337 via EIP-7702)? Without a yes, sponsored sells from 4663, and sponsored buys from Base, may not relay.
   - If there is no answer by Wed 7, the demo uses unsponsored wallets.
3. **Who gets the switch first.** Proposed: David's own email account and one external MetaMask account, by Berth user id in `ROBINHOOD_DELIVERY_USERS`.
   - Robinhood restricts the UK, Canada and Switzerland (the US is already geofenced). The proposed default is that those accounts keep hub delivery even when switched. Confirm.
4. **Sign the live gates**, all small and on mainnet:
   - the P0a smoke (Mon);
   - the $5 RH buy (Tue);
   - the RH sell (Wed);
   - funding the demo accounts.

## 5. What changes in user-facing claims once it ships

Only for holdings delivered to Robinhood Chain, and only for switched accounts until P5:
- **Newly true:** "in your own wallet on Robinhood Chain". The person holds the Robinhood Assets (Jersey) token itself in an EOA they control. That removes the SODAX hub-wallet contract, the pooled vault share and the mixed-backing question from what they hold.
- **`src/lib/copy.ts`, keys to make per-holding (chain-aware) rather than global:**
  - `firstStockLine` (line ~2701, "in your account … an account your wallet controls");
  - `fundsStay` (~2661, which already says "your own wallet, or in your Berth account", and stays accurate);
  - the holding detail and ownership lines.
- **Unchanged until P5:**
  - `welcomePage.sections.what.title` ("US stocks and funds, in an account your wallet controls.") stays as is: most people still get hub delivery.
  - The Terms custody section (`termsOfUse`, `id: "custody"`, ~4200: "held at your Berth account: an address on the Sonic network…") stays until the addendum adds "or, where offered, delivered to your own wallet on Robinhood Chain".
  - The Privacy line (~3943, "your Berth account's address on the Sonic network") gains Robinhood Chain in P5.
- **Never claimed, for either path:**
  - shareholder rights;
  - an issuer other than Robinhood Assets (Jersey);
  - availability to US persons, which Robinhood prohibits.
  - SODAX stays the execution rail while an order is in flight.
- **Positioning can say now, for Colosseum:** "Berth can deliver the native Robinhood stock token straight to your own wallet on Robinhood Chain, in one signature from crypto you already hold on another network. In beta, for a first group of accounts." It cannot say "every Berth holding is in your own wallet."

## Carried into P2a / P1 (from the rh-p0b reviews, 2026-10-05)

P0b ships dark and fixes only what the route and the schema own. These are left on purpose for the package named, and must land before the switch names anyone.

**P2a (order recording)**
- **Server re-check of the destination when the order is recorded.** The route's answer is advice; the intent is built and signed in the browser. At `saveOrder`, re-run the geofence (restricted and unknown countries, `ROBINHOOD_RESTRICTED_COUNTRIES` in `src/lib/delivery.ts`) and the plain-key check (`isPlainKey` in `src/lib/server/delivery.ts`) for any row whose destination is Robinhood Chain, and refuse or flag one that fails. Copy must not claim Berth prevents Robinhood delivery anywhere until this exists.
- **Set `orders.holding_chain` in one place.** Derive it in `readOrder` (`src/lib/orders.ts`) from the intent's destination chain (buy) or source leg (sell), and add `holding_chain = coalesce(orders.holding_chain, excluded.holding_chain)` to the `saveOrder` upsert. Every new row writes an explicit value, so null keeps meaning "legacy, sonic" only. Values come from the SDK chain key only (`'robinhood'`, never `'4663'`): a check violation drops the whole order row.
- **Fix the four writers of `delivered_to` that know nothing of the chain**, in the same round: `src/lib/server/orders.ts:302` (upsert), `src/lib/server/orders-recover.ts:164` (recovery insert), `scripts/backfill-delivered-to.mjs` (fills `delivered_to` from `intent.dstAddress` whatever the chain), `scripts/orders-backfill.mjs`. A Robinhood buy recorded with `holding_chain` null is judged on Sonic once P1b lifts the guard, and forfeited. One db test per writer.
- **`listing_address` stays the Sonic listing address** for Robinhood rows. Never store `rhHubAsset` or `rhAddress` there: the hold filter, `paid_before`, order_marks, most bought and the staff views key on it. `orderListing` maps `rhHubAsset` (and `rhAddress`, for P3a sells) back to the listing; `buildOrder`'s fill read (a Sonic Transfer of `listing.address`) does not exist for a Robinhood buy and needs its own reading.
- **Record the proof kind of a wallet** (`user_identities.proof`: recovered locally vs verified on chain). `isPlainKey` cannot see a counterfactual ERC-6492 account deployed nowhere yet; the proof kind can.
- **Verify `rhHubAsset` on chain in `pnpm listings:verify`** (the hub asset manager's `assetInfo(rhHubAsset)` should return chain 4663 and `rhAddress`), instead of today's SDK-against-SDK comparison, which cannot drift.

**P1 (readers)**
- `src/lib/server/portfolio.ts` reads holdings with a Sonic `balanceOf` only; the weekly email, Most held and the history chart inherit it, so a Robinhood holding reads as zero.
- The assistant's sell draft caps at `held` from the chain read (`src/lib/server/berth-tools/registry.ts:586`) and will refuse a Robinhood-only holding.
- Staff views read `orders` without the chain.
- **Max on the hub sell and the limit sell must not be raised by Robinhood holdings**: both spend hub shares only.
- `home_last_known.snapshot` has no chain field; give it a per-chain shape before reusing it.
- **Filled on the hub is not arrived on 4663** (rh-p2a money review m3, carried to P1b on purpose). P2a reads a Robinhood buy's quantity from the hub fill (`IntentFilled.receivedOutput`), which proves the solver filled on Sonic, not that the asset manager's relay delivered on Robinhood Chain. If the relay stalls, the row says `quantity` held on `robinhood` and the pour pays XP while the wallet holds nothing. Holds are safe today only because of the `ON_SONIC` guard. P1b's `balanceOf` on `holding_chain` is the backstop: the hold check and the portfolio must judge a Robinhood row by the 4663 balance, never by `orders.quantity`, and lift the guard only then.

**P6**
- `limit_orders` has `src_chain` but no destination chain. Robinhood limit buys need one, plus the same derivation in the limit fill path. Until then limit buys stay on the hub.

**Rollback rule**
- d2c907b (switch and route) and its fixes can be reverted alone at any time.
- 38cc07f (registry) can be reverted alone until P2a reads `rhHubAsset`.
- **Once any row has `holding_chain = 'robinhood'`, never revert the holds guard (584e9f8, `ON_SONIC` in `src/lib/server/holds.ts`) alone**: the old check would judge that row on Sonic, read zero and forfeit it for good. To stop the feature, set `ROBINHOOD_DELIVERY=off` and redeploy (or empty `ROBINHOOD_DELIVERY_USERS` while it is unset or `listed`) instead.
- Deploy order: apply the schema (`pnpm db:push`, then `select holding_chain from orders limit 0`) before the code reaches production; the holds SQL names the column.

## P5 addendum inputs (rh-ux-sec B2, 8 Oct)

Not edited on purpose: this is legal and public text, for the P5 Terms and Privacy addendum (drafted by Opus, approved by David). Each line gives the file and line on `feat/robinhood-sell`, the current text in short, and what it must convey once delivery to Robinhood Chain is on.

1. `src/lib/copy.ts:4417` (Terms, "Who holds your keys and your tokens"). Now: "The stocks and funds you buy are held at your Berth account: an address on the Sonic network, a wallet contract of the SODAX protocol...". Must also say: a buy may instead be delivered as the native Robinhood token to the person's own EVM wallet on Robinhood Chain, held by that wallet's keys alone; Berth and SODAX cannot move it; selling it from there is signed in that wallet and pays a small ETH fee on Robinhood Chain.
2. `src/lib/copy.ts:4432` (Terms, "What the stock tokens are"). Now: "On Sonic, the token at your Berth account can be a representation ... of the issuer's token on another network." Must add: on Robinhood Chain the person holds the issuer's own token; the issuer's terms (including where it is offered, and its restricted countries) apply directly.
3. `src/lib/copy.ts:4097` (Privacy, "Your daily value"). Now: "Once a day, after the New York close, we read your balances from the blockchain...". Must say: this nightly read now includes the EVM addresses linked to the account on Robinhood Chain, and Berth's servers send those addresses to public RPC providers (Robinhood Chain's own endpoint, PublicNode, dRPC) to do it; the assistant and the hold check also read them on request.
4. `src/lib/copy.ts:4230` (Privacy, blockchain networks as recipients). Now: "Your browser reads balances and sends transactions through them...". Must say: Berth's servers do too (see 3), so those providers see the account's addresses together with Berth's server IP, not only the browser's.
5. `src/lib/copy.ts:3466` (info sheet, `infoHowBody`). Now: "...fill the order through SODAX and deliver the stock token to your account." Must say: to the Berth account, or for some accounts to their own wallet on Robinhood Chain.
6. `src/app/llms.txt/route.ts:12` (public note for language models). Now: "...(Robinhood Stock Tokens on Sonic)...". Must say: held in the person's Berth account on the SODAX hub (Sonic), or as the native token in their own wallet on Robinhood Chain.
