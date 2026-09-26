# Berth — session conventions

Architecture and vocabulary live in CONTEXT.md. This file is operational.

## Commands

- `pnpm dev` — dev server (always pnpm, never npm/yarn)
- `pnpm test` — vitest
- `pnpm lint` / `pnpm exec tsc --noEmit` — before every commit
- `pnpm db:push` — apply db/schema.sql to Neon (idempotent, reads .env.local)
- `pnpm listings:verify` — diff the listing registry against the live token
  list and the chain; run before a release and after any SDK bump
- `pnpm privy:config show` — read the Privy app settings; writes are
  dashboard-only (Privy's API answers 405), the script prints what to enter

## Visual verification

Use the repo harness, never an ad-hoc playwright/puppeteer script:

```
pnpm dev &
pnpm shot                               # webkit, iPhone viewport, waits for server
pnpm shot --url http://localhost:3000/dev/board?open=NVDA --settle 12000
pnpm shot --browser chromium --viewport 1280x800
```

Webkit is the default because every iOS browser is WebKit; a change verified
only in Chromium is not verified. If the browser build is missing:
`pnpm exec playwright-core install webkit`. Dev-only galleries (404 in prod):
`/dev/board`, `/dev/account`, `/dev/wallets` (what the wallet SDK reports as
installed in this browser, family by family, beside what the welcome screen
would offer).

## Copy rules

- Plain, exact, calm, adult, unhurried, never clever about money. Names, not
  tickers, wherever a person is reading.
- No dashes as punctuation in user-facing copy (reads as AI). Commas, periods.
- No raw emoji in UI; glyphs are Phosphor duotone or nothing.
  One exception: the assistant buttons carry Claude's, OpenAI's and Grok's
  own marks (`src/components/assistant/provider-marks.tsx`), monochrome in
  currentColor, never in brand colour.
- Every user-facing string lives in `src/lib/copy.ts` as a key on the one
  `Copy` object; never hardcode copy in components. Components read it via
  `useCopy()`; modules without React import `COPY` directly. There is one
  voice; the seam stays so a second could return as a `Partial<Copy>`.
- Rank names come from the brand kit (`public/berth-brand/rank-names.md`);
  XP kinds (`pour_in`, `friend_poured`, …) are database values and keep
  their ids whatever the words say.

## Brand

- Colours, type and the mark are in `public/berth-brand/brand-sheet.md`; the
  tokens live in `src/app/globals.css` (`:root` light, `.dark` dark), the
  fonts in `src/app/layout.tsx` (Archivo display, Public Sans body, IBM Plex
  Mono for numbers). Appearance is light, dark or system via next-themes.
- The accent is for one thing per composition. No gradients, glow or glass.
- Before 2026-09-14 this repo was LSTeaTime, a leveraged staking app in a
  tea-house voice. The tea is gone from the code; git history keeps it.

## Ritual

- thoughts.md is the backlog: strike through what's done with a short status
  note; finished rounds get compressed to one-liners.
- One commit per round of work. Since 2026-09-17 the message is written in
  the Berth register: one plain sentence saying what changed and why, harbour
  imagery allowed, no tea. Push to master after every green round; master
  deploys production at www.berthmarkets.com.
