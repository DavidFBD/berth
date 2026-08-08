# 001 — Wire the motion tokens into Tailwind and split the easing roles

- **Status**: TODO
- **Commit**: 7908485
- **Severity**: HIGH
- **Category**: Easing & duration + Cohesion & tokens
- **Estimated scope**: globals.css, ui/drawer.tsx, ui/badge.tsx, tea-service.tsx, action-stepper.tsx, new src/lib/motion.ts, delete 4 dead ui files

## Problem

The motion tokens live in `:root` (src/app/globals.css:119-123), not in `@theme`, so Tailwind v4 never generates `ease-tea` / `ease-settle` utilities. Consequences, all verified:

- ~50 `transition-*` utility usages across 20 files silently run on Tailwind's default 150ms/default curve; `--duration-sip` is referenced zero times anywhere.
- `src/components/ui/drawer.tsx:76,131,164` hand-types three cubic-beziers; the one at :131 `cubic-bezier(0.22,1,0.36,1)` is character-for-character `--ease-settle`, and :76 `cubic-bezier(0.32,0.72,0,1)` is the iOS drawer curve that deserves a token.
- `--ease-tea: cubic-bezier(0.33, 0, 0.15, 1)` has a flat start (y1=0: ~2.8% progress at 8.5% time). Fine for loops (pot-rock, steam-drift, live-breathe), wrong for entrances/exits and state flips, where it reads as lag. There is no strong ease-out token for UI state changes (`--ease-settle` is close but reads as the "landing" curve).
- Five framer-motion spring configs are hand-typed; `{stiffness:340, damping:34}` is pasted verbatim in 4 files (tea-service.tsx:137,546; account-button.tsx:267; vault-card.tsx:342) with a fifth gratuitous variant `320/34` at vault-list.tsx:122 doing the same accordion job.
- `src/components/tea-service.tsx:118-121` animates `width` (layout property) over 500ms on the XP bar:
  ```jsx
  className="h-full rounded-full bg-primary transition-[width] duration-500"
  style={{ width: `${Math.round(rank.progress * 100)}%` }}
  ```
- `src/components/flow/action-stepper.tsx:70-73` gives the small step connector the 450ms drawer-scale duration + flat-start ease.
- `src/app/globals.css:637-641` `lsd-hue-drift` animates `filter` from an implicit `saturate(1.4) contrast(1.04)` to `hue-rotate(360deg)` — mismatched filter lists interpolate discretely per spec.
- `src/components/ui/dialog.tsx`, `select.tsx`, `sheet.tsx`, `tabs.tsx` have zero imports outside ui/ (dead shadcn boilerplate) and carry their own animation defects.

## Target

1. Easing tokens live in the `@theme inline` block so Tailwind generates `ease-*` utilities, with a new strong ease-out for UI state changes:
   ```css
   /* inside @theme inline */
   --ease-tea: cubic-bezier(0.33, 0, 0.15, 1);     /* loops and on-screen morphs only */
   --ease-lift: cubic-bezier(0.23, 1, 0.32, 1);    /* entrances, exits, state flips */
   --ease-settle: cubic-bezier(0.22, 1, 0.36, 1);  /* long landings (drawer panel, pot righting) */
   --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);  /* iOS drawer overlay curve */
   ```
   Duration tokens stay in `:root` (style-prop consumers), but add a comment that class-side durations must be 150/200/300/450/900 only.
2. `src/lib/motion.ts` (new) exports the shared springs:
   ```ts
   export const SPRING_SHELF = { type: "spring", stiffness: 340, damping: 34 } as const; // accordions
   export const SPRING_POP = { type: "spring", stiffness: 480, damping: 24 } as const;   // celebratory pops
   export const SPRING_CUP = { type: "spring", stiffness: 420, damping: 26 } as const;   // cup lift on shelf
   ```
   All accordion call sites (incl. vault-list 320/34) use SPRING_SHELF; xp-toast's local POP moves here.
3. drawer.tsx uses `ease-drawer` (overlay) and `ease-settle` (panel) utilities instead of arbitrary values.
4. XP bar: track gets `overflow-hidden`; bar becomes full-width with `transition-transform duration-300 ease-lift` and `style={{ transform: `translateX(-${100 - Math.round(rank.progress*100)}%)` }}`.
5. Stepper connector: `transitionDuration: "200ms"`, easing `var(--ease-lift)`.
6. lsd-hue-drift keyframes spell the full filter list at both ends:
   ```css
   from { filter: saturate(1.4) contrast(1.04) hue-rotate(0deg); }
   to   { filter: saturate(1.4) contrast(1.04) hue-rotate(360deg); }
   ```
7. Delete `src/components/ui/dialog.tsx`, `select.tsx`, `sheet.tsx`, `tabs.tsx` (and any orphaned deps in package.json stay — no dependency edits).
8. badge.tsx `transition-all` → `transition-[color,background-color,border-color,box-shadow]`. tea-service.tsx:158 avatar tiles `transition-all` → `transition-[box-shadow,opacity,transform]`. action-stepper.tsx:79 dots `transition-all` → `transition-[color,background-color,border-color]`. (button.tsx is handled by plan 005 — do not touch it here.)

## Repo conventions to follow

- Tokens block: src/app/globals.css:118-124 ("Motion — tea, not espresso" comment stays with the :root durations).
- Correct token consumption exemplar: tea-art.tsx:108 `animation: "steam-bloom var(--duration-steep) var(--ease-settle) both"`.

## Steps

1. globals.css: add the four `--ease-*` lines to `@theme inline` (keep `--ease-tea`/`--ease-settle` ALSO in :root during the same edit? No — `@theme` emits :root vars itself; delete the :root copies).
2. Create src/lib/motion.ts with the three springs.
3. Replace spring literals in tea-service.tsx (:137, :546), account-button.tsx (:267), vault-card.tsx (:342), vault-list.tsx (:122 → SPRING_SHELF, :169 → SPRING_CUP), xp-toast.tsx (:99 POP → SPRING_POP import).
4. drawer.tsx: `ease-[cubic-bezier(0.32,0.72,0,1)]` → `ease-drawer`; `ease-[cubic-bezier(0.22,1,0.36,1)]` → `ease-settle`. Leave `ease-[cubic-bezier(0.45,1.005,0,1.005)]` (:164) — vendored content-fade curve, unique on purpose.
5. XP bar rework in tea-service.tsx per Target 4.
6. Stepper connector per Target 5; stepper dots + badge + avatar tiles per Target 8.
7. lsd-hue-drift keyframe fix per Target 6.
8. `git rm` the four dead ui files; run tsc to prove nothing imported them.

## Boundaries

- Do NOT touch button.tsx (plan 005 owns it) or xp-toast spring VALUES other than the POP hoist (plan 006 owns behavior).
- Do NOT rename `--ease-tea`/`--ease-settle` — existing style-prop consumers keep working because @theme emits the same var names.
- No new dependencies.

## Verification

- **Mechanical**: `pnpm exec tsc --noEmit` clean; `pnpm lint` clean; `grep -rn "cubic-bezier" src/components` returns only drawer.tsx:164; `grep -rn "stiffness" src/components` returns only lib/motion.ts imports.
- **Feel check**: open a drawer (unchanged feel — same curves via tokens); watch the XP bar in the tea service after an award: fills with a fast-start glide, no layout shimmer of neighboring text; LSD mode hue actually drifts continuously.
- **Done when**: `ease-tea`, `ease-lift`, `ease-settle`, `ease-drawer` are real utilities (check built CSS or use one and see it apply), dead files gone, springs single-sourced.
