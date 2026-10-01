# Leveraged Staked Yield — Implementation Plan

> Historical: the plan for LSTeaTime, the leveraged staking app this repo was before it became Berth on
> 2026-09-14. What Berth does today is in docs/product/features.md.

Mobile-first Next.js app: deposit **any SODAX-supported asset from any SODAX-supported network** into a **SODAX leveraged-yield vault** (ERC-4626 on the Sonic hub).

## Stack

- Next.js 16 (App Router, Turbopack) · React 19 · TypeScript
- Tailwind CSS v4 + shadcn/ui (base-nova preset)
- pnpm
- `@sodax/dapp-kit@2.0.0` (React Query hooks; re-exports `@sodax/sdk`)
- `@sodax/wallet-sdk-react@2.0.0` (multi-chain wallet connect: EVM, Solana, Sui, Stellar, Injective, ICON…)
- `@tanstack/react-query@5`

## The three vaults (SDK v2.0.0 registry, `sodax.leverageYield.listVaults()`)

| Vault | Address (Sonic hub) | Asset | Borrows | LSD yield source |
|---|---|---|---|---|
| `lsodaWEETH` | `0xD09de2f5070699A909c0FD32fb5A909d3886701D` | sodaWEETH | sodaETH | EtherFi (weETH) |
| `lsodaWSTETH` | `0x136E5D1CEC5db1829E24941Eddd9C8640E02Ce7a` | sodaWSTETH | sodaETH | Lido (stETH) |
| `lsodaJITOSOL` | `0xD7Ae4853E0f93682F5DaA14734F5D18cBa09Bd78` | sodaJITOSOL | sodaSOL | Jito (JitoSOL) |

Vault proxy address == lsoda* share-token address, 18 decimals. Shares are **solver-tradeable**: deposits/withdrawals are intent-based cross-chain swaps, so *any* solver-supported input token on *any* spoke chain can route in. Shares are delivered to the user's **derived hub wallet** on Sonic (never the bare EOA).

## Core flow (deposit)

1. **Connect** — `useXConnectors({ xChainType })` → `useXConnect()`; address via `useXAccount`.
2. **Pick source** — chain + token picker over solver-supported tokens; balances via `useXBalances`.
3. **Pick vault** — cards w/ headline APR from `useLeverageYieldEffectiveApr` (`effectiveNetAprRay`, RAY 1e27 → %; `lsdApr.stale` ⇒ "estimate"), TVL via `useLeverageYieldTotalAssets`.
4. **Quote** — `useQuote` with `token_dst = vault address`, `token_dst_blockchain_id = 'sonic'`, `quote_type: 'exact_input'`; returns raw `Result` → branch `.ok`; `minOutputAmount = quoted × (1 − slippage)`. `retry: false` (no-path errors are deterministic).
5. **Build** — `useLeverageYieldDeposit` (BUILDER — returns `LeverageYieldSwapPayload`, broadcasts nothing).
6. **Approve if needed** — `useSwapAllowance({ payload: built.params, srcChainKey, walletProvider })` → `useSwapApprove` (spender = spoke AssetManager; skip for native tokens / non-EVM). EVM wrong-network gate via `useEvmSwitchChain`.
7. **Execute** — `useLeverageYieldVaultSwap({ ...built, walletProvider })` — one signature on the spoke chain; SDK does create-intent → verify → relay → notifySolver.
8. **Track fill** — `useStatus({ intentTxHash: result.intentDeliveryInfo.dstTxHash })` polling until `status === 3 (SOLVED)`; then share balance visible via `useLeverageYieldShareBalances` (holders = `{ chainKey, address }`, resolved to hub wallet internally).

Withdraw (phase 2 of UI, same page): `useLeverageYieldWithdraw` (shares 18dp) → `useLeverageYieldVaultSwap` — **no approval step** (`hubWalletSwap: true`).

## Key gotchas (from SDK source research)

- Deposit `inputAmount` is in the **input token's decimals**; `minOutputAmount`/withdraw `inputAmount` are 18dp shares.
- Headline APR = `effectiveNetAprRay` (LSD yield included). `netAprRay` (AAVE-only) is often negative — never show it as the headline.
- `useLeverageYieldPosition` is vault-level, not per-user. User position = shares × `previewRedeem(vault, 10^18)` price-per-share.
- Read hooks are pre-unwrapped; swap-domain `useQuote`/`useStatus` return raw `Result` — must branch `.ok`.
- `SodaxProvider` config is reference-tracked → hoist to module constant.
- Payload deadline = hub block time + 5 min at **build** time → build right before executing; rebuild after idle.
- Use `mutateAsyncSafe` (never rejects; branch on `.ok`) for imperative chains; treat `USER_REJECTED` as a friendly cancel.
- Relay-stage failures (`RELAY_TIMEOUT`, `TX_SUBMIT_FAILED`…) mean funds may be in flight — show retry/recovery messaging, not a plain error.
- After vaultSwap success also invalidate `['leverageYield','shareBalance']` (hook only invalidates shared xBalances).

## App structure

```
src/
  app/
    layout.tsx            # metadata, viewport (safe-area), Providers
    page.tsx              # single-screen mobile flow (vault list → deposit sheet)
  components/
    providers.tsx         # QueryClient > SodaxProvider > SodaxWalletProvider ('use client')
    wallet/               # connect button, wallet modal (connectors per chain type)
    vaults/               # vault card (APR, TVL, position), vault list
    deposit/              # source picker (chain+token), amount input, quote, confirm sheet, status stepper
    ui/                   # shadcn components
  lib/
    sodax-config.ts       # SodaxOptions + SodaxWalletConfig module constants
    vaults-meta.ts        # display metadata (brand names, icons, descriptions)
    format.ts             # RAY/WAD/bigint formatting helpers
  hooks/                  # custom wrappers (max withdraw, user position value)
```

## Mobile-first UX

- Single-column flow, bottom sheets (shadcn drawer) for pickers and confirmation — thumb-reachable.
- Sticky bottom CTA; button label doubles as validation message ("Enter amount", "Insufficient balance", "Switch network", …).
- Status stepper during deposit: Signed → Relaying → Solving → Done, driven by mutation state + `useStatus`.
- Desktop: same components, centered max-w container with vault grid.
