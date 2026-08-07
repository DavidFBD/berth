# LSTeaTime — session conventions

Architecture and vocabulary live in CONTEXT.md. This file is operational.

## Commands

- `pnpm dev` — dev server (always pnpm, never npm/yarn)
- `pnpm test` — vitest
- `pnpm lint` / `pnpm exec tsc --noEmit` — before every commit
- `pnpm db:push` — apply db/schema.sql to Neon (idempotent, reads .env.local)

## Visual verification

Use the repo harness, never an ad-hoc playwright/puppeteer script:

```
pnpm dev &
pnpm shot --mode aurora                 # webkit, iPhone viewport, waits for server
pnpm shot --browser chromium --viewport 1280x800
```

Webkit is the default because every iOS browser is WebKit; a change verified
only in Chromium is not verified. If the browser build is missing:
`pnpm exec playwright-core install webkit`.

## Copy rules

- No dashes as punctuation in user-facing copy (reads as AI). Commas, periods.
- No raw emoji in UI; glyphs are Phosphor duotone or nothing.
- Every user-facing string lives in a mode's voice in `src/lib/copy.ts`;
  never hardcode copy in components. One deliberate exception: the rewards
  panel (tea-service.tsx) is theme-agnostic by design, ranks and rewards read
  the same in every parlour.

## Ritual

- thoughts.md is the backlog: strike through what's done with a short status
  note; finished rounds get compressed to one-liners.
- One commit per round of work, message written in the tea voice
  (see `git log --oneline` for the register).
