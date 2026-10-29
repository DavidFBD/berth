# Berth — session conventions

Architecture and vocabulary live in CONTEXT.md. This file is operational.

## Commands

- `pnpm dev` — dev server (always pnpm, never npm/yarn)
- `pnpm test` — vitest
- `pnpm verify` — the ship gate (see Shipping); records a pass the ship
  guard checks before any push to master
- `pnpm lint` / `pnpm exec tsc --noEmit` — before every commit
- `pnpm smoke:quotes` — the live quote smoke: 16 quick pairs and a crypto
  control asked of the real solver through the production proxy, quotes
  only. `--full` runs the whole matrix, `--base <url>` another deployment,
  `--direct` api.sodax.com. Exit 0 pass, 2 solver side (only stock routes
  refused with -4 while the control quoted), 1 anything else
- `pnpm db:push` — apply db/schema.sql to Neon (idempotent, reads .env.local)
- `pnpm listings:verify` — diff the listing registry against the live token
  list and the chain; run before a release and after any SDK bump,
  together with `pnpm smoke:quotes --full`
- `pnpm privy:config show` — read the Privy app settings; writes are
  dashboard-only (Privy's API answers 405), the script prints what to enter

## Shipping

Master is production. Every ship, by an agent or by hand, passes this list.
A push to master from a Claude session is refused by the ship guard
(`.claude/settings.json` → `scripts/ship-guard.mjs`) unless `pnpm verify`
passed on that exact tree. A push it cannot resolve is refused too (a shell
variable or substitution in the path or ref, `git -C $X`, `bash -c`,
`eval`, `command`, a subshell, a ref that does not exist): push from a
literal path with a literal ref. It lets things through only when it
crashes itself, and logs that in `.git/berth-verify/guard-crashes.log`. It
guards Claude sessions only, and only from session start (a session already
running when `.claude/settings.json` changes is unguarded until restart).

1. Work on a branch in a worktree under `~/Github/_scratch-berth/<name>`.
   A round that touches the money journey (quote, build, approve, sign,
   track, holdings, sell) adds or updates a test for what it changed, and
   every bug that reached production gets a regression test with its fix.
2. Review before ship. Above 400 changed lines (lockfile, docs, public and
   `.md` excluded) the Opus lenses read it; above 1500 `pnpm verify` refuses
   without `--reviewed`, which means the lenses ran and their blockers and
   majors are fixed. Prefer splitting. A pull request is never merged on
   GitHub the day it opens without that review; `gh pr merge` asks David.
3. Merge `origin/master` into the branch, commit, then `pnpm verify`. It
   checks, stopping at the first failure: committed tree, master merged in,
   size, schema, terms version, SDK bump (runs `pnpm listings:verify`), the
   Privy patch, tsc, lint, `pnpm test`, and the live quote smoke
   `pnpm smoke:quotes`. A failing pair is asked again after 20 s; one that
   then quotes is reported as flapping and passes. If the smoke is red
   only because the solver refuses stock routes (-4) while the crypto
   control quotes, verify says SOLVER SIDE and stops; ship anyway only if
   nothing on the quote path changed, with `pnpm verify --solver-down-ack`
   (logged in `.git/berth-verify/overrides.log`), and tell the SODAX
   solver team. Verify refuses the ack when the branch touches the quote
   path (listings, sodax-config, the quote hook and lib, the smoke, the
   proxy, `@sodax/*` or `@privy-io/*` in package.json or the lockfile).
   Any other red smoke stops the ship. The smoke asks production's proxy,
   so it proves the solver and today's proxy, not this branch's proxy
   changes: step 6 is the check for those. Verify also refuses untracked
   files that are not gitignored, and records nothing if HEAD or the tree
   moved while it ran.
4. Schema before code. If `db/schema.sql` changed, `pnpm db:push` runs
   before the ship (symlink the main checkout's `.env.local` into the
   worktree, remove it after). db:push records the schema it applied;
   verify refuses a changed schema that was not pushed. Prefer additive,
   idempotent changes (`if not exists`, nullable or defaulted columns), so
   the code still live keeps running against the new schema; a drop or a
   tightened constraint ships a round after the code stops needing it.
5. Squash-ship from a detached worktree:
   `git worktree add --detach ../ship origin/master`,
   `git merge --squash <branch>`, `git -c commit.gpgsign=false commit`,
   `git push origin HEAD:master`, remove the ship worktree. The squash has
   the verified branch's tree, so the guard lets it through; if master
   moved meanwhile, merge again and verify again.
6. After the deploy is Ready, smoke production within 10 minutes:
   `pnpm smoke:quotes` (it asks www.berthmarkets.com's proxy by default),
   and open a buy drawer on the site to see a quote. The quote canary
   (`/api/cron/canary`, from `.github/workflows/quote-canary.yml`, every 30
   minutes from 13:30 to 20:30 UTC on weekdays) keeps asking after that and
   emails staff admins after two failing runs in a row; its runs are on
   /staff/health under Quotes. It needs the `CRON_SECRET` repository
   secret on GitHub, with Vercel's value. **Actions minutes**: GitHub bills
   each job rounded up to a whole minute, so the canary costs about 15 runs
   a weekday, roughly 330 minutes a month; `checks.yml` adds 4 to 5
   minutes per pull request or master push. The free private plan has
   2,000 a month, and when they run out both CI and the canary stop
   silently: check the remaining minutes in GitHub's billing settings
   before adding another scheduled workflow. A broken money journey is rolled back first and
   debugged second: promote the previous deployment in Vercel, then
   `git revert` on master. One floor on that, David's call 2026-10-29:
   once a New stocks email has been sent, never promote a deployment
   from before the release that added it (the email's unsubscribe link
   and Settings switch do not exist there, so opt outs would fail). Set
   `EMAIL_NEW_LISTINGS=off` in Vercel and redeploy to stop sending, then
   fix forward.

Standing rules that close past misses:

- **SDK and Privy bumps** (`@sodax/*`, `@privy-io/*`) ship alone, never
  inside a feature round, with `pnpm listings:verify` (verify runs it) and
  `pnpm smoke:quotes --full` before and after the bump, both green (a
  solver side red before the bump is retried, not waved through), with the
  smoke's summary line pasted into the commit body.
- **Terms version** (`src/lib/legal-version.ts`) is bumped at most once a
  week and only with David's yes in chat: every bump asks every account to
  accept again. Batch legal edits on a branch; verify refuses a bump
  without `--terms-bump-approved`.
- **Automated public output** (X posts, emails to many, anything Berth
  says in public without a person pressing send) ships switched off, with
  its preview (`pnpm x:preview` for X) read by David before the switch is
  set.
- **The checks are not edited to pass.** eslint, tsconfig, vitest config,
  CI, `package.json`, the smoke (`scripts/smoke-quotes.mjs`,
  `src/lib/quote-smoke.ts`), `scripts/db-push.mjs`,
  `scripts/check-privy-patch.mjs`, `.claude/settings*.json` and the guard
  scripts need David's yes before any edit. The guard asks on an Edit or
  Write to them, and on a Bash write it can see (`>`, `>>`, `tee`,
  `sed -i` into the path). It cannot see every Bash write (a script, an
  interpreter, a variable path), so the rule is the agent's to keep, not
  the guard's to enforce. A failing test is fixed in the code, or in the
  test only when the test itself is wrong (a wall clock date, say), and the
  commit says which.
- `BERTH_SHIP_OVERRIDE="<reason>"` as the leading assignment of the push or
  `gh pr merge` (a reason of 3 characters or more) passes the guard and is
  logged in `.git/berth-verify/overrides.log`, as are verify's
  `--reviewed`, `--terms-bump-approved` and `--solver-down-ack`. The log is
  local to the clone. Agents use the override only when David said so in
  chat, for that one push.

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

## Resource rules

The Mac this runs on has 16 GB. A Next dev server, a vitest run and a
Playwright browser each take gigabytes, so these are rules, not advice:

1. Before starting a dev server, check the port (`lsof -i :3000`, or the
   port you were given). If one is already running there, reuse it.
2. Run a dev server only while actively verifying a change, and stop it
   (by its own pid) when verification is done. Delete `.next` afterwards.
3. Playwright is headless only, and every browser and context is closed
   right after each screenshot or test. `pnpm shot` closes its browser on
   success, failure and interrupt.
4. For longer preview sessions, prefer `pnpm build && pnpm exec next start`
   over `next dev`.
5. A dev server running for more than 60 minutes gets restarted.
6. At the end of every task, run
   `ps -axo pid,rss,etime,command | grep -E "next|node|playwright|chrom" | grep -v grep`
   and kill any process you started that is still running.
7. `pnpm dev` caps the dev server's heap at 3 GB (`NODE_OPTIONS`), and
   vitest is capped at 3 workers in `vitest.config.mts`. Run tests as
   `pnpm test`, not `pnpm test -- --maxWorkers=3` (the flag after `--` is
   read as a file filter).
8. At most 3 agents work at once, and no more than one of them builds or
   runs a dev server at a time where it can be avoided.

## Copy rules

- Plain, exact, calm, adult, unhurried, never clever about money. Names, not
  tickers, wherever a person is reading.
- No dashes as punctuation in user-facing copy (reads as AI). Commas, periods.
- No raw emoji in UI; glyphs are Phosphor duotone or nothing. The hairline
  line figures on the 404 and error states are drawings, not glyphs (see Brand).
  Four exceptions: the assistant buttons carry Claude's, OpenAI's and Grok's
  own marks (`src/components/assistant/provider-marks.tsx`), a listing's
  ticker tile carries the listed company's own mark where one is pinned
  (`src/components/company-marks.tsx`, `LISTING_MARK_BY_SYMBOL` in
  `src/lib/listings.ts`), falling back to the lettered tile otherwise,
  the footer and Settings links to Berth's own X account carry X's mark
  (`src/components/x-mark.tsx`), and the welcome page's Colosseum badge has
  Superteam Netherlands' "st" beside it
  (`src/components/superteam-mark.tsx`). All are monochrome in
  currentColor, never in brand colour, with one exception: the Superteam NL
  mark keeps its Dutch flag in colour, David's call 2026-10-05.
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
  fonts in `src/app/layout.tsx` (Inter Tight headings at weight 400 with
  tight tracking, Inter body, IBM Plex Mono for numbers, Archivo only for
  the wordmark). Appearance is light, dark or system via next-themes.
- Since 2026-09-29 (the Seline pass): warm stone canvas, flat white cards
  with one hairline and no shadow, pill buttons, the active chip of a
  segmented control in ink. Berth's blue stays the one accent.
- The accent is for one thing per composition. No gradients, glow, grain
  or glass.
- The one animated status element allowed is the thinking orb
  (`src/components/ui/thinking-orb.tsx`, MIT `thinking-orbs`), in ink or
  muted only, and only while something is actually working.
- One exception to "only the orb animates", David's call 2026-10-09: Lucas
  Marques' hairline line figures (MIT, `@lucasmarkes/hairline`) are allowed
  on the 404 and error states, today the Plug on `src/app/not-found.tsx`
  (`src/components/plug-figure.tsx`). Monochrome in ink and stone tokens, no
  accent, and pointer-reactive only: never moving on their own, never a
  status, held still under prefers-reduced-motion. Not near money.
- A second exception, David's call 2026-10-11: the one level-up takeover
  (`src/components/level-up-takeover.tsx`, rules in `src/lib/level-up.ts`).
  When a rank is reached the person's face opens at the centre of the
  screen with two rings of the new rank's glyph spreading out in ink, the
  rank's name and any creature it unlocked settle in, and everything has
  stopped in under two seconds; then it is a still card closed by Nice, Esc
  or a tap outside. Once per rung per account, never over a signing window
  or an open order drawer (it waits for them to close), no confetti, glow
  or gradient, the accent only on Nice, and no motion at all under
  prefers-reduced-motion. Nothing else may take the screen this way.
- A third exception, David's call 2026-10-29: money figures that change while
  in view (the account total and the order drawer's quote) roll their digits
  to the new value, under 300 ms, up when rising and down when falling, ink
  only, no colour flash, never on first paint, never idle, and instantly under
  prefers-reduced-motion (`src/components/ui/rolling-number.tsx`, adapted from
  SmoothUI, MIT).
- Before 2026-09-14 this repo was LSTeaTime, a leveraged staking app in a
  tea-house voice. The tea is gone from the code; git history keeps it.

## Ritual

- thoughts.md is the backlog: strike through what's done with a short status
  note; finished rounds get compressed to one-liners.
- One commit per round of work. Since 2026-09-17 the message is written in
  the Berth register: one plain sentence saying what changed and why, harbour
  imagery allowed, no tea. Push to master after every green round (green
  means `pnpm verify` passed, see Shipping); master deploys production at
  www.berthmarkets.com.
