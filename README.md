# Berth

A brokerage for the money that already lives onchain. Buy US stocks and ETFs
with the stablecoins or Bitcoin you already hold, from any of 20 networks, in
one signature, in your own custody.

Built with Next.js (App Router) · React 19 · Tailwind v4 · shadcn/ui ·
`@sodax/dapp-kit` + `@sodax/wallet-sdk-react` v2.

> The code before 2026-09-14 was LSTeaTime, a leveraged staking app on the
> same rails.

## Development

```bash
pnpm install
cp .env.example .env.local   # optional: WalletConnect project id, Solana RPC
pnpm dev
```

## Commands

- `pnpm dev` — dev server
- `pnpm test` — vitest
- `pnpm lint` — eslint
- `pnpm exec tsc --noEmit` — type check
- `pnpm shot` — visual verification harness (see CLAUDE.md for flags)
- `pnpm listings:verify` — verify the stock and ETF listing set
- `pnpm privy:config show` — inspect the live Privy configuration

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
