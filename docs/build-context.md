# Build context — SODAX leverage-yield vault app

Shared contract for all builders. Read fully before writing code. Everything here was verified against the installed `@sodax/*` 2.0.0 dists and SDK source.

## App

Mobile-first Next.js 16 App Router app (React 19, TS, Tailwind v4, shadcn/ui base-nova, pnpm). User connects wallet(s), picks any solver-supported asset on any SODAX spoke chain, picks a leverage-yield vault (ERC-4626 on Sonic hub), deposits. Deposits are intent-based cross-chain swaps: input token → lsoda* share token, delivered to the user's **derived hub wallet** on Sonic (never the EOA).

## Existing foundation (import these, don't recreate)

- `@/lib/sodax-config` → `sodaxConfig`, `walletConfig`, `DEFAULT_SLIPPAGE_PCT` (0.5)
- `@/lib/chains` → `DEPOSIT_SOURCE_CHAINS: readonly SpokeChainKey[]`, `getChainName(chainKey)`, `getChainLogo(chainKey)` (URL string | undefined), `getDepositTokens(chainKey): readonly XToken[]` (production solver set minus lsoda*)
- `@/lib/vaults-meta` → `getVaultMeta(name): VaultMeta` `{ title, underlyingSymbol, borrowSymbol, strategy, ecosystem, gradient, glyph }`
- `@/lib/format` → `formatRayAsPercent(ray, digits?)`, `formatWadAsMultiplier(wad)`, `formatBps(bps)`, `formatTokenAmount(value, decimals, maxFrac?)`, `parseAmount(input, decimals): bigint | undefined`, `shortenAddress(addr)`, `applySlippage(quoted, slippagePct)`
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
3. Quote (dapp-kit `useQuote`, refetch 3s): `useQuote({ params: { payload: amount && token ? { token_src: token.address, token_src_blockchain_id: srcChainKey, token_dst: vault.vault, token_dst_blockchain_id: ChainKeys.SONIC_MAINNET, amount: inputAmount, quote_type: 'exact_input' } : undefined } })` — data is a RAW `Result`; branch `data?.ok`; success `data.value.quoted_amount: bigint` (lsoda shares 18dp). Quote errors carry `error.detail.message` — show "No route" gracefully. Add `queryOptions: { retry: false }` NOT allowed (queryOptions omits enabled/queryKey/queryFn only — retry IS allowed; set `retry: false`).
4. `minOutputAmount = applySlippage(quoted, DEFAULT_SLIPPAGE_PCT)`.
5. Build: `useLeverageYieldDeposit().mutateAsyncSafe({ vault: vault.vault, srcChainKey, srcAddress, inputToken: token.address, inputAmount, minOutputAmount })` → `Result<LeverageYieldSwapPayload>`; branch `.ok`. Build RIGHT BEFORE executing (payload deadline = hub time + 5 min).
6. Allowance (deposits only): `useSwapAllowance({ params: { payload: built.value.params, srcChainKey, walletProvider } }): UseQueryResult<boolean>` (pre-unwrapped) — or check imperatively then `useSwapApprove().mutateAsyncSafe({ params: built.value.params, walletProvider })`; after approve resolves, allowance re-checks (2s refetch). Native tokens / non-EVM report true.
7. EVM network gate: `useEvmSwitchChain({ xChainId: srcChainKey })` → show "Switch network" while `isWrongChain`.
8. Execute: `useLeverageYieldVaultSwap().mutateAsyncSafe({ ...built.value, walletProvider })` → ONE user signature on the spoke chain, then SDK: verify → relay → notifySolver. Success `VaultSwapResponse = { solverExecutionResponse: { intent_hash }, intent, intentDeliveryInfo: { srcTxHash, dstTxHash, ... } }`.
9. Track fill: `useStatus({ params: { intentTxHash: response.intentDeliveryInfo.dstTxHash } })` — data is RAW `Result`; poll (3s built-in) until `data.value.status === 3 /* SOLVED */` (`SolverIntentStatusCode` from `@sodax/sdk`; -1 NOT_FOUND, 1 NOT_STARTED, 2 STARTED, 3 SOLVED, 4 FAILED).
10. After success: `queryClient.invalidateQueries({ queryKey: ['leverageYield'] })` (share balances converge on 15s refetch otherwise).

Withdraw (mirror, NO approval step): `useLeverageYieldWithdraw().mutateAsyncSafe({ vault, srcChainKey, srcAddress, dstChainKey, outputToken, inputAmount: shares18dp, minOutputAmount })` → `vaultSwap({ ...built.value, walletProvider })` (payload carries `hubWalletSwap: true`). Quote with `token_src = vault.vault`, `token_dst = outputToken`. Max = user's share balance for that chainKey row. BTC output: minOutputAmount ≥ 546 sats.

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
