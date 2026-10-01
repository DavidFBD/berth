# Berth

Wall Street, in your wallet.

Buy US stocks with the crypto you hold, and keep them in your own wallet.
Berth is software, not a broker. Choose what to pay with (stablecoins, ETH,
SOL or Bitcoin, on more than 20 networks), sign once in your own wallet, and
independent solvers fill the order through SODAX. What you buy lands with
you. Each stock is a token that tracks a share, issued by a third party, and
it can be bought and sold any day, weekends included.
Berth never holds your keys or your funds. Not available in the United States
or where local law or sanctions forbid it.

What it does, live and coming: [docs/product/features.md](docs/product/features.md).

Built with Next.js (App Router), React 19, Tailwind v4, shadcn/ui,
`@sodax/dapp-kit` and `@sodax/wallet-sdk-react` v2.

> The code before 2026-09-14 was LSTeaTime, a leveraged staking app on the
> same rails.

## Development

```bash
pnpm install
cp .env.example .env.local   # optional: WalletConnect project id, Solana RPC
pnpm dev
```

## Commands

- `pnpm dev`: dev server
- `pnpm test`: vitest
- `pnpm lint`: eslint
- `pnpm exec tsc --noEmit`: type check
- `pnpm shot`: visual verification harness (see CLAUDE.md for flags)
- `pnpm listings:verify`: verify the stock and ETF listing set
- `pnpm privy:config show`: inspect the live Privy configuration

## Project docs

- [docs/product/features.md](docs/product/features.md): what Berth does, and how to say it
- [CONTEXT.md](CONTEXT.md): the domain glossary and architecture
- [docs/build-context.md](docs/build-context.md): verified SDK API cheat sheet (hook signatures, flow order, gotchas). Read this before touching integration code; it corrects several places where the public docs lag the shipped 2.0.0 packages.
- [PLAN.md](PLAN.md): the original plan from the leveraged staking days, kept for history

## Structure

```
src/
  app/               # pages (home, /u profiles, /assistants, /privacy, /terms), API routes, the MCP server
  components/
    providers.tsx    # SodaxProvider > QueryClientProvider > SodaxWalletProvider
    board/           # the board, holdings, the portfolio chart, the news column
    flow/            # buy and sell drawers, token picker, status stepper
    wallet/          # multi-chain wallet connect
    vaults/          # earlier leveraged vault positions, withdraw only
  hooks/             # holdings, quotes, order orchestration
  lib/               # listings, copy (every user-facing string), sodax config, server modules
```
