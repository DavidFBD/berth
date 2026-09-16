# Build context — SODAX leverage-yield vault app

Shared contract for all builders. Read fully before writing code. Everything here was verified against the installed `@sodax/*` 2.0.0 dists and SDK source.

## App

Mobile-first Next.js 16 App Router app (React 19, TS, Tailwind v4, shadcn/ui base-nova, pnpm). User connects wallet(s), picks any solver-supported asset on any SODAX spoke chain, picks a leverage-yield vault (ERC-4626 on Sonic hub), deposits. Deposits are intent-based cross-chain swaps: input token → lsoda* share token, delivered to the user's **derived hub wallet** on Sonic (never the EOA).

## Existing foundation (import these, don't recreate)

- `@/lib/sodax-config` → `sodaxConfig`, `walletConfig`, `DEFAULT_SLIPPAGE_PCT` (0.5)
- `@/lib/chains` → `DEPOSIT_SOURCE_CHAINS: readonly SpokeChainKey[]`, `getChainName(chainKey)`, `getChainLogo(chainKey)` (URL string | undefined), `getDepositTokens(chainKey): readonly XToken[]` (production solver set minus lsoda*)
- `@/lib/vaults-meta` → `getVaultMeta(name): VaultMeta` `{ title, underlyingSymbol, borrowSymbol, strategy, ecosystem, gradient, glyph }`
- `@/lib/format` → `formatRayAsPercent(ray, digits?)`, `formatWadAsMultiplier(wad)`, `formatBps(bps)`, `formatTokenAmount(value, decimals, maxFrac?)`, `parseAmount(input, decimals): bigint | undefined`, `shortenAddress(addr)`
- `@/lib/pour-amount` → the amount pipeline for a pour (either direction): `pourAmounts(text, denom, decimals, priceUsd)`, `quoteInputFor(buildAmount)` (the pre-fee/post-fee pairing lives here and only here), `applySlippage`/`minReceivedFor`, `depositMax`, `amountText`, `belowBtcDust`, `depositGate`/`withdrawGate` (the CTA validation ladders), `SHARE_DECIMALS`, `BTC_DUST_SATS`. Quote via `@/hooks/use-pour-quote` (`usePourQuote`), which takes the PRE-fee build amount and owns fee adjust + slippage + Result unwrap.
- `@/lib/utils` → `cn()`
- `@/components/providers` already mounts SodaxProvider > QueryClientProvider > SodaxWalletProvider + `<Toaster />` (sonner). Toasts: `import { toast } from "sonner"`.
- shadcn components in `@/components/ui/`: button, card, input, badge, skeleton, drawer, dialog, sheet, separator, sonner, tabs, scroll-area, select, spinner. Icons: `lucide-react`.

## Import rules

- Import ONLY from package roots: `@sodax/dapp-kit`, `@sodax/wallet-sdk-react`, `@sodax/sdk` (dapp-kit re-exports the whole sdk — `ChainKeys`, types, `getSupportedSolverTokens`, `adjustAmountByFee` are importable from `@sodax/dapp-kit` too). NEVER deep-import dist paths. NEVER import `@sodax/types` (not installed).
- Every file using any sodax/react-query hook: `"use client"`.
- No new npm deps. `viem` is available (`parseUnits`, `formatUnits`). Exception: `vitest` + `vite-tsconfig-paths` are installed as dev deps for the test suite (`pnpm test`); tests live in colocated `src/**/*.test.ts` files and cover pure module cores only.
- ALWAYS `ChainKeys.*` constants, never chain-key string literals.

## Wallet layer (`@sodax/wallet-sdk-react`)

- `useXConnectors({ xChainType }): IXConnector[]` — `{ id, name, icon, isInstalled, installUrl, xChainType }`. Browser-only detection → render connector lists only after user interaction/mount.
- `useXConnect(): UseMutationResult<XAccount | undefined, Error, IXConnector>` — for EVM/Solana/Sui resolves `undefined` and state lands async; read `useXAccount` instead of the return value.
- `useXAccount({ xChainId } | { xChainType }): { address?: string }` — always an object; check `.address`. Pass exactly ONE of the two params.
- `useXAccounts(): Partial<Record<ChainType, XAccount>>`
- `useXDisconnect(): ({ xChainType }) => Promise<void>`
- `useWalletModal(opts?)` — headless connect state machine: `{ state, open(), close(), back(), selectChain(chainType), selectWallet(connector), retry() }`; `state.kind: 'closed'|'chainSelect'|'walletSelect'|'connecting'|'success'|'error'`. `selectWallet`/`retry` never reject. When `state.kind==='connecting' && state.connector.id==='walletConnect'` render nothing (wagmi QR modal owns the screen).
- `useChainGroups(opts?): ChainGroup[]` — `{ chainType, chainIds, displayName, iconUrl?, isConnected, account? }`, one row per enabled family.
- `useConnectedChains(): { chains: ConnectedChain[], total, status: 'loading'|'ready' }` — gate first paint on `'ready'` to avoid rehydration flash.
- `useEvmSwitchChain({ xChainId }): { isWrongChain, handleSwitchChain }` — REQUIRED gate before EVM signing; non-EVM always false.
- `useWalletProvider({ xChainId }): IXxxWalletProvider | undefined` — THE bridge into dapp-kit mutations; undefined until connected; pass into mutate vars UNCAST.
- `useXService({ xChainType }): XService | undefined`, `getXChainType(chainKey): ChainType`, `sortConnectors(connectors, { preferred })`.
- ChainType = `'EVM'|'SOLANA'|'SUI'|'BITCOIN'|'STELLAR'|'ICON'|'INJECTIVE'|'NEAR'|'STACKS'`.

## Vault data (`@sodax/dapp-kit`)

- Vault registry (sync, no hook): `const { sodax } = useSodaxContext(); sodax.leverageYield.listVaults(): readonly LeverageYieldVault[]` — `{ name, vault: Address, asset, borrowToken, lsdSource?: { poolId, fallbackAprPct, label } }`. 3 vaults: lsodaWEETH, lsodaWSTETH, lsodaJITOSOL. `vault` address == share token address, 18dp, on Sonic.
- `useLeverageYieldEffectiveApr({ params: { vault } }): UseQueryResult<LeverageYieldEffectiveApr>` — data pre-unwrapped. HEADLINE = `effectiveNetAprRay` (RAY 1e27, signed). Breakdown fields: `lsdApr: { aprRay, label, stale }`, `supplyAprRay`, `borrowAprRay`, `targetLtvBps`, `leverageMultiplierWad` (WAD), `netAprRay` (AAVE-only, often negative — never headline), `effectiveSupplyAprRay`. `lsdApr.stale === true` → label "(est.)".
- `useLeverageYieldTotalAssets({ params: { vault } }): UseQueryResult<bigint>` — TVL, 18dp asset units.
- `useLeverageYieldPreviewRedeem({ params: { vault, shares } }): UseQueryResult<bigint>` — pass `shares: 10n ** 18n` for price/share; use to value user shares in underlying.
- `useLeverageYieldPosition({ params: { vault } })` — VAULT-level `{ collateral, debt, ltv (bps), healthFactor (WAD; uint256.max = no debt), idleAsset }`, NOT per-user.
- `useLeverageYieldShareBalances({ params: { vault, holders } }): UseQueryResult<{ chainKey, holder, shares }>[]` — ARRAY (useQueries), one row per `{ chainKey, address }`; resolves hub wallet internally; aggregate `reduce((a,q)=>a+(q.data?.shares??0n),0n)`. Holders = for each connected account, one entry per source chain of that family (an EVM address maps to a DIFFERENT hub wallet per chainKey).

## Deposit flow (exact order)

1. Input: `srcChainKey`, `srcAddress` (from `useXAccount({ xChainId: srcChainKey }).address`), `token: XToken` (from `getDepositTokens`), amount string → `parseAmount(input, token.decimals)`.
2. Balance: `const xService = useXService({ xChainType: getXChainType(chainKey) }); useXBalances({ params: { xService, xChainId: chainKey, xTokens: [token], address } }): UseQueryResult<Record<string, bigint>>` — keyed by token.address.
3. Floor first: `belowMinimum(worthUsd, money.rate)` from `@/lib/pour-amount` (`MIN_POUR_USD` = 1, rounded up to a whole unit of the display currency by `minPourUsd(rate)`). Under it the quote is NOT requested (the solver answers "No path was found" below roughly $0.50 for pairs that route fine, measured 2026-09-16, floor varies per vault and per run) and the gate returns `belowMinimum`, worded `ctaPourAtLeast` / `smallestPour`. Unpriced tokens skip the floor and keep the solver's verdict. Same in the withdraw drawer, on the shares' USD worth.
4. Quote (dapp-kit `useQuote`, refetch 3s): `useQuote({ params: { payload: amount && token ? { token_src: token.address, token_src_blockchain_id: srcChainKey, token_dst: vault.vault, token_dst_blockchain_id: ChainKeys.SONIC_MAINNET, amount: inputAmount, quote_type: 'exact_input' } : undefined } })` — data is a RAW `Result`; branch `data?.ok`; success `data.value.quoted_amount: bigint` (lsoda shares 18dp). Quote errors carry `error.detail.message` — show "No route" gracefully. Add `queryOptions: { retry: false }` NOT allowed (queryOptions omits enabled/queryKey/queryFn only — retry IS allowed; set `retry: false`).
5. `minOutputAmount = applySlippage(quoted, DEFAULT_SLIPPAGE_PCT)`.
6. Build: `useLeverageYieldDeposit().mutateAsyncSafe({ vault: vault.vault, srcChainKey, srcAddress, inputToken: token.address, inputAmount, minOutputAmount })` → `Result<LeverageYieldSwapPayload>`; branch `.ok`. Build RIGHT BEFORE executing (payload deadline = hub time + 5 min).
7. Allowance (deposits only): `useSwapAllowance({ params: { payload: built.value.params, srcChainKey, walletProvider } }): UseQueryResult<boolean>` (pre-unwrapped) — or check imperatively then `useSwapApprove().mutateAsyncSafe({ params: built.value.params, walletProvider })`; after approve resolves, allowance re-checks (2s refetch). Native tokens / non-EVM report true.
8. EVM network gate: `useEvmSwitchChain({ xChainId: srcChainKey })` → show "Switch network" while `isWrongChain`.
9. Execute: `useLeverageYieldVaultSwap().mutateAsyncSafe({ ...built.value, walletProvider })` → ONE user signature on the spoke chain, then SDK: verify → relay → notifySolver. Success `VaultSwapResponse = { solverExecutionResponse: { intent_hash }, intent, intentDeliveryInfo: { srcTxHash, dstTxHash, ... } }`.
10. Track fill: `useStatus({ params: { intentTxHash: response.intentDeliveryInfo.dstTxHash } })` — data is RAW `Result`; poll (3s built-in) until `data.value.status === 3 /* SOLVED */` (`SolverIntentStatusCode` from `@sodax/sdk`; -1 NOT_FOUND, 1 NOT_STARTED, 2 STARTED, 3 SOLVED, 4 FAILED).
11. After success: `queryClient.invalidateQueries({ queryKey: ['leverageYield'] })`. Share balances otherwise refetch every 60s (`use-user-vault-position` overrides dapp-kit's 15s default: 12 EVM holder rows × 4 cups = 48 unbatched `balanceOf` POSTs to rpc.soniclabs.com per tick, noticed from outside 2026-09-16).

Withdraw (mirror, NO approval step): `useLeverageYieldWithdraw().mutateAsyncSafe({ vault, srcChainKey, srcAddress, dstChainKey, outputToken, inputAmount: shares18dp, minOutputAmount })` → `vaultSwap({ ...built.value, walletProvider })` (payload carries `hubWalletSwap: true`). Quote with `token_src = vault.vault`, `token_dst = outputToken`. Max = user's share balance for that chainKey row. BTC output: minOutputAmount ≥ 546 sats.

## Vault registry (four blends as of 2026-09-15)

- `sodax.leverageYield.listVaults()` reads the SDK's STATIC registry, never the backend. `GET /v1/leverage-yield/vaults` serves four; @sodax/sdk 2.0.0 and stable 2.1.0 compile in three (the fourth is in 2.2.0-rc.5), so `lib/sodax-config` appends `lsodaSUSDS` to the SDK's exported `leverageYieldVaults`. The append is name-guarded, so it no-ops on the release that carries it — upgrading needs no edit, just an eventual deletion. `sodax-config.test.ts` pins both halves.
- A vault the SDK doesn't know ALSO needs registering as a Sonic token: `lib/sodax-config` adds it to `chains[SONIC_MAINNET].supportedTokens` (name-guarded on `sonicSupportedTokens`, so it self-retires too). Every `getQuote` and every deposit build first asks `ConfigService.isValidOriginalAssetAddress(sonic, vault)`, which reads that table, and throws `unsupported token_dst` BEFORE any HTTP call when it's missing. The shelf, APR, TVL and share balances are plain on-chain reads by address and work without it, which is exactly why the fourth cup looked live for a day while never quoting (2026-09-16). `sodax-config.test.ts` pins the registration through `new Sodax(sodaxConfig).config`. The static `getSupportedSolverTokens` table is untouched, so the token never shows up as a deposit input.
- A vault needs a tea identity in `lib/vaults-meta` (title, teaName, cupKey, bowl, flavour, assetLine, strategy, gradient, steamThresholds) AND a `--cup-<key>` colour triple in all NINE theme blocks of `app/globals.css` (`:root`, `.dark`, and seven `.mode-*`), plus a `SILK_CUP` weave. Gold hues need HIGH lightness in oklch (L 0.72+); at mid lightness a yellow reads olive, and in near-monochrome sumie separate by hue instead, since every cup there shares one chroma.
- Cup SHAPE is `meta.bowl`, not a `cupKey === "sencha"` test — that test was in four files and a fourth blend would have broken it silently.
- The shelf grid sizes itself from `vaults.length` and tightens past three cups; the tea-name label reserves two lines so a wrapping name can't lift its cup off the shared baseline. `useFilledCups` has six fixed hook slots, so the shelf holds six before that needs touching.
- Copy never counts the cups. `loreBlendsTitle`/`loreBlendsBody` in all eight voices and `shelfHint` are deliberately count-free after a fourth blend made eight lines untrue at once.
- `/dev/tea` renders the real shelf (dev-only, 404 in prod), so a new blend can be reviewed without signing in.

## Listings: the destination asset registry (added 2026-09-16)

- `@/lib/listings` is the registry of everything a pour can land in on Sonic: `Listing = VaultListing | TokenListing`, kinds `vault` (the cups, still read from `sodax.leverageYield.listVaults()` and wrapped by `vaultListing`), `stock` (twelve Robinhood Stock Tokens) and `cash` (SGOV). `listListings(vaults)` composes both; `findListing`, `CASH_LISTING`, `STOCK_LISTINGS`, `TOKEN_LISTINGS`, `toXToken`, `isTokenListingAddress`. Pure module, no SDK instance, safe on the server.
- The thirteen tokens, 18dp, Sonic ERC-20s: SPCX `0xB585e2EE…2373` (private-company exposure, not listed equity), NVDA `0x2D5D2250…f74B`, GME `0x996e5591…f394`, MSTR `0xE0E2aF45…Fab1`, AAPL `0x4712D2D4…5185`, TSLA `0x8B7F4696…53b1`, MU `0x108147b1…3A22`, SNDK `0x568F2985…7EF7`, SPY `0x1816E408…b0c8`, QQQ `0x454ab3De…e500`, SGOV `0xf6938087…6E74`, USO `0x8DaBbADc…D2bc`, SLV `0x690B92c2…49A2`. Full addresses in the module. Verified 2026-09-16 on chain (`symbol()`, `name()`, `decimals()` at each address) and against `GET https://api.sodax.com/v1/swaps/tokens/sonic`, which serves them with `isRwa: true`.
- Hub asset versus token: for every one of these the backend's hub-asset table has `asset === vault === address`. The tradeable ERC-20 IS the hub asset; there is no separate wrapper (unlike USDC, asset `0x2921…` vs vault sodaUSDC `0xAbbb…`). Total supply on Sonic was near zero at verification (TSLA 0.03, QQQ 0.08, the rest 0), so the solver sources on fill.
- @sodax/sdk 2.0.0 knows NONE of them: absent from both `sonicSupportedTokens` (40 entries) and `getSupportedSolverTokens(sonic)` (35). Unregistered, `sodax.swaps.getQuote` throws `Invariant failed: unsupported token_dst for dst chain` before any HTTP call (reproduced 2026-09-16). So `lib/sodax-config` registers `TOKEN_LISTINGS.map(toXToken)` into `chains[sonic].supportedTokens` beside lsodaSUSDS, keyed by symbol and name-guarded on `sonicSupportedTokens`, self-retiring per token. `sodax-config.test.ts` pins that every listing validates AND resolves to its own address, so an SDK release carrying a ticker under another wrapper's contract fails in CI, not in a pour.
- Read-only quote proof through the registered SDK, 2026-09-16, `exact_input`: 2 USDC (Base) → 0.008972 NVDA; 2 USDC (Base) → 0.019094 SGOV; 0.01 NVDA → 2.0847 USDC on Solana and identically on Base; 0.02 SGOV → 1.9448 USDC (Base); 0.00005 BTC (native) → 0.004871 SPY. Both directions and a non-EVM source route at two-dollar size.
- `pnpm listings:verify` (`scripts/verify-listings.mjs`, `node --experimental-strip-types` so it imports the shipped table) diffs the registry against the live backend list and the chain, and fails on any drift or on a Robinhood token the backend trades that the registry lacks. Run it before a release and after any SDK bump.
- The deposit picker excludes listings on every chain (`getDepositTokens` asks `isTokenListingAddress`), so a stock is never offered as a pour input; selling is the sell path's job. `getSupportedSolverTokens` is untouched, so nothing changes for today's inputs.

## The account: one hub wallet, derived on Base (added 2026-09-16)

- Decided 2026-09-16: the user's account is the SODAX hub wallet derived from `(HOME_CHAIN = Base, Privy embedded EVM address)`. `lib/account` states it (`HOME_CHAIN`, `homeSpokeAddress(session)`: the embedded address in an email session, undefined otherwise; external wallets fund, they never own the shelf). `hooks/use-hub-account` derives it through dapp-kit's `useGetUserHubWalletAddress`, which calls `sodax.hubProvider.getUserHubWalletAddress(spokeAddress, chainKey)`, the SAME call `leverageYield.deposit` uses for `dstAddress` (SDK dist 29427/29583), so the address read is the address a buy lands in. Deterministic; dapp-kit never refetches it.
- `hooks/use-hub-holdings` reads every listing's `balanceOf(hubWallet)` in ONE multicall on `sodax.hubProvider.publicClient` (chain 146 configured, multicall3 at `0xca11…ca11`), 17 reads per request, 60s refetch, query key root `LISTINGS_QUERY_KEY = ['listings']`, which the pour machine must invalidate after a fill. `settled` is true only after a successful read; loading or errored is unknown, never zero. Vault shares are read here as plain ERC-20s too; valuing them is still `previewRedeem`'s job.
- Proof against real money, 2026-09-16, David's embedded address `0xcfcd8be8…a165`: Base-derived hub wallet `0xfD3B205eEac8780b37507C5aff9392f123dc9566` (empty, the new shelf); Ethereum-derived `0x004d8838…09AB` holds 1.0365 lsodaSUSDS; Polygon-derived `0x7A3C95E9…9103` holds dust of three cups; BSC-derived a hair of lsodaWEETH. Exactly where the cups already say the shares are. A hub wallet differs per source chain, which is why legacy cup positions stay on the multi-holder read (`useUserVaultPosition`) while everything new lands on the Base shelf.
- A real stock fill exists on chain: QQQ intent tx `0x97539286…c05e7`, block 79026324, mint 0.08108 to the solver `0xE77e9642…D0Ef`, 0.080816 to the Intents contract `0x6382D6cc…96ef`, then to the recipient hub wallet `0x8a641DF3ecc1374b44150B23ba902C34CA0F1CC7`, which still holds it. TSLA saw a mint and burn in one tx (a round trip). Useful as a non-zero test balance: `/dev/account?hub=0x8a64…1CC7`.
- Prices for listings: the solver oracle at `GET https://api.sodax.com/v1/intent/oracle` (public read, no key) lists all 13 on chainId 146 under `soda<TICKER>` symbols with `priceUsd` and `updatedAt`; 2026-09-16 15:00Z: NVDA 215.30, SGOV 101.05, SPY 759.09, QQQ 709.98, AAPL 333.84, TSLA 364.28. The money-market oracle (`useReservesUsdFormat`) and the DefiLlama feed know none of them, so a listing price source must read this endpoint (server-side, filtered to listing addresses). Not wired yet.
- `/dev/account` (404 in prod) is the inspector: `?address=` derives any home-chain address's shelf, `?hub=` reads a hub wallet directly, no params uses the signed-in Privy account.
- Sonic public RPC (`sonic-rpc.publicnode.com`) refuses `eth_getLogs` over 200k blocks; 10k-block windows work. Sonicscan's V1 API is retired (Etherscan V2 needs a key).

## SODAX API key (added 2026-09-15)

- SODAX mints partner API keys (portal.sodax.com; docs.sodax.com/developers/how-to/api-keys). They travel as an `x-api-key` header. Reads on `api.sodax.com` stay public; the WRITE routes are wired for the check and enforcement comes back on route by route.
- The key is server-side only, `SODAX_API_KEY`, never `NEXT_PUBLIC_`. A key in a browser bundle is a published key.
- This app's whole browser-side SODAX HTTP surface is three POSTs that the SDK hangs off `solver.solverApiEndpoint`: `/quote` (useQuote), `/status` (useStatus) and `/execute` (the notify inside `vaultSwap` — a write, and the one that makes a pour fill). Everything else the app calls is on-chain or the relayer at `xcall-relay.nw.iconblockchain.xyz`, which is not SODAX API and takes no key.
- So `sodaxConfig.solver.solverApiEndpoint` points at `${window.location.origin}/api/sodax/intent` in the browser and at `https://api.sodax.com/v1/intent` on the server. `app/api/sodax/[...path]` attaches the key and forwards; `lib/server/sodax-proxy` holds the allowlist (exactly those three routes — a pass-through proxy would lend the key to the whole API) and the header builder.
- The installed 2.0.0 SDK has no `apiKey` option; `new Sodax({ apiKey })` landed in 2.2.0-rc (2.1.0 is stable latest and does NOT have it). Irrelevant to the browser either way, which needs the proxy at any version. When 2.2.0 goes stable, server-side callers can pass `apiKey` instead of building headers.
- Enforcement is OFF upstream as of 2026-09-16: a quote with the real key, no key and a bogus key all answer identically, so nothing in a response proves the key was seen. The only evidence is SODAX's own partner dashboard. The proxy is live on lsteatime.com (verified: unknown paths get our JSON 404, real quotes come back from the solver through it). Whether `SODAX_API_KEY` is set in the Vercel production env could not be checked from the CLI (auth lapsed); without it the proxy forwards unkeyed and the dashboard stays empty.
- The hub client (`sodax.hubProvider.publicClient`, every vault read) uses the SDK default `hub.rpcUrl` = rpc.soniclabs.com and is NOT covered by `PINNED_EVM_RPCS`, which pins only the spoke-side Sonic client. `hub` is overridable in SodaxOptions if that ever needs to move; left alone because the hub client also polls receipts at 500ms during a pour.

## Server-side SDK use (verified 2026-08-07)

- `new Sodax(sodaxConfig)` works in Node/route handlers (module singleton in `lib/server/pour-verify.ts`); `sodaxConfig` is a plain constant, safe to import server-side.
- `sodax.swaps.getIntent(txHash): Promise<Result<Intent>>` decodes the IntentCreated log from a hub tx receipt and validates the canonical Intents contract (`0x6382…96ef` on Sonic). Intent carries `creator`, `inputToken`, `outputToken`, `srcAddress`/`dstAddress` (bytes hex: 20-byte for EVM sources, longer for Solana etc.).
- CAVEAT: `getIntent` POLLS for missing receipts (built for just-submitted hashes) — an invented hash held a route open ~116s. Always gate with one cheap `eth_getTransactionReceipt` first and race a timeout (see pour-verify.ts).
- `sodax.leverageYield.listVaults()` is sync and works server-side without initialization.
- SIWE needs no extra deps: `viem/siwe` ships `createSiweMessage`/`parseSiweMessage`/`validateSiweMessage`/`generateSiweNonce`; verify signatures with a public client's `verifyMessage` (handles EOA + ERC-1271 + ERC-6492). Client signing via wallet-sdk-react `useXSignMessage({ xChainType, message })`.

## Error handling

- All mutations: use `mutateAsyncSafe` (never rejects) and branch `.ok`. Error is `SodaxError`-ish: read `.code` where present.
- `USER_REJECTED` → friendly "Cancelled" state, not an error screen.
- `RELAY_TIMEOUT | RELAY_FAILED | TX_SUBMIT_FAILED | TX_VERIFICATION_FAILED` → spoke tx may have landed; funds in flight. Message: "Your transaction was sent but cross-chain delivery is delayed — funds are safe, this usually resolves itself."
- `EXECUTION_FAILED | EXTERNAL_API_ERROR` → intent registered; retryable solver notify.
- Amount units: deposit `inputAmount` in INPUT token decimals; `minOutputAmount` + share amounts 18dp; never `parseUnits(x, 18)` blindly.
- bigint in any custom queryKey → `.toString()` it.

## Design language

- Mobile-first single column, `max-w-md mx-auto` core layout; desktop just centers it (`sm:max-w-lg`); generous touch targets (min h-12 CTAs), bottom drawers (`drawer` = vaul) for pickers/flows, sticky bottom CTA inside drawers.
- Neutral shadcn palette, support dark mode (classes already tokenized: bg-background, text-foreground, text-muted-foreground, border-border, bg-card…). Accent gradients per vault come from `getVaultMeta(name).gradient` (use with `bg-gradient-to-br`).
- Numbers: tabular-nums for amounts/APR. Big headline APR on cards.
- Loading: skeleton components, never spinners for content; spinner only inside buttons during actions.
- Empty/error states always have copy + a retry or next action.
- The action button label doubles as the validation message ("Connect wallet", "Enter amount", "Insufficient balance", "Switch network", "No route for this pair", "Review deposit").
