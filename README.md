# Leveraged Staked Yield

Mobile-first app for depositing **any SODAX-supported asset from any SODAX-supported network** into SODAX **leveraged staked-yield vaults** (ERC-4626 vaults on the Sonic hub: leveraged weETH, wstETH, and JitoSOL).

Built with Next.js (App Router) · React 19 · Tailwind v4 · shadcn/ui · `@sodax/dapp-kit` + `@sodax/wallet-sdk-react` v2.

## How it works

Vault shares (`lsoda*`) are solver-tradeable tokens, so a deposit is an intent-based cross-chain swap: your input asset on the source chain is swapped by the SODAX solver into vault shares, delivered to your derived hub wallet on Sonic. One signature on the source chain; the SDK handles intent creation, relay, and solver notification. Withdrawals are the mirror flow and need no approval.

> ⚠️ SODAX has no testnet — every transaction moves real mainnet value.

## Development

```bash
pnpm install
cp .env.example .env.local   # optional: WalletConnect project id, Solana RPC
pnpm dev
```

## Project docs

- [PLAN.md](PLAN.md) — implementation plan and UX flows
- [docs/build-context.md](docs/build-context.md) — verified SDK API cheat sheet (hook signatures, flow order, gotchas). Read this before touching integration code; it corrects several places where the public docs lag the shipped 2.0.0 packages.

## Structure

```
src/
  app/               # layout (providers, viewport), single-screen page
  components/
    providers.tsx    # SodaxProvider > QueryClientProvider > SodaxWalletProvider
    wallet/          # connect button + multi-chain wallet drawer
    vaults/          # vault cards (APR, TVL, position)
    flow/            # deposit/withdraw drawers, token picker, status stepper
  hooks/             # position aggregation, action orchestration
  lib/               # sodax config, chain/token helpers, formatting, vault meta
```
