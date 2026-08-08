# 004 — Reduced motion reaches the drawer, the bloom, and the stepper ring

- **Status**: DONE
- **Commit**: 7908485
- **Severity**: HIGH
- **Category**: Accessibility + Purpose
- **Estimated scope**: ui/drawer.tsx, tea-art.tsx, action-stepper.tsx, globals.css

## Problem

1. **Drawer** — the app's primary surface — plays its full 450ms slide-up under `prefers-reduced-motion: reduce`. `src/components/ui/drawer.tsx:131,143` transitions `transform` from `--closed-transform` with no `motion-reduce:` variants anywhere in the file.
2. **Celebration bloom** — `src/components/tea/tea-art.tsx:96-111` — the bloom div has no `data-` hook, so the reduced-motion block at globals.css:807-810 (which only matches `[data-steam-wisp]`) never reaches it; `steam-bloom` still runs `scale(0.6)→scale(1.6)` + 30px travel under reduce.
3. **Stepper ring** — `src/components/flow/action-stepper.tsx:89-96`:
   ```jsx
   <span className="absolute inset-0 rounded-full border-2 border-accent opacity-40"
         style={{ animation: "steam-drift 1.6s var(--ease-tea) infinite" }} />
   ```
   Two defects in one: ungated under reduce, and `steam-drift` (a 3px lateral wobble authored for steam) reads as misalignment, not activity — the audit's clearest purpose-mismatch.

Deliberate non-changes, so nobody "fixes" them later: the PourScene teapot-righting transition and the tea-level creep stay under reduce (they explain state; §6 says reduced ≠ zero). The height accordions under framer's `reducedMotion="user"` also stay (size, not position).

## Target

1. drawer.tsx popup (:131 class list): add `motion-reduce:data-starting-style:transform-none motion-reduce:data-ending-style:transform-none motion-reduce:data-starting-style:opacity-0 motion-reduce:data-ending-style:opacity-0 motion-reduce:duration-200` — under reduce the drawer fades 200ms in place instead of sliding. Overlay (:76): `motion-reduce:duration-200`.
2. Bloom div gets `data-steam-bloom`; globals.css reduced block gains:
   ```css
   [data-steam-bloom] {
     animation-name: steam-bloom-quiet !important;
   }
   ```
   with new keyframes (opacity only, same duration tokens):
   ```css
   @keyframes steam-bloom-quiet {
     0% { opacity: 0; }
     30% { opacity: 0.9; }
     100% { opacity: 0; }
   }
   ```
3. Stepper ring: replace `steam-drift` with a breathe pulse that actually signals "working" — reuse the live-breathe grammar:
   ```jsx
   style={{ animation: "ring-breathe 1.8s var(--ease-tea) infinite" }}
   ```
   ```css
   @keyframes ring-breathe {
     0%, 100% { transform: scale(1); opacity: 0.4; }
     50% { transform: scale(1.12); opacity: 0.15; }
   }
   ```
   and add the ring's selector (give it `data-step-ring`) to the reduced-motion `animation: none` group.

## Repo conventions to follow

- The reduced-motion block lives at the bottom of globals.css (currently :799-814); extend it, don't fork a second block.
- Data-attribute gating exemplar: `[data-pour-rock]` / `[data-steam-wisp]` pattern from the pour round.

## Steps

1. drawer.tsx class additions (popup + overlay).
2. tea-art.tsx: add `data-steam-bloom` to the bloom div.
3. globals.css: `steam-bloom-quiet` + `ring-breathe` keyframes; extend the reduced block with `[data-steam-bloom]` (animation-name swap) and `[data-step-ring]` (none).
4. action-stepper.tsx: `data-step-ring` attribute + animation swap to `ring-breathe`.
5. Delete the now-unused `steam-drift` keyframes if nothing else references them (`grep -rn steam-drift src` must return only globals.css before deleting).

## Boundaries

- Do NOT gate the PourScene transitions or the accordion springs (deliberate, documented above).
- Do NOT alter drawer timing outside `motion-reduce:` variants.

## Verification

- **Mechanical**: `pnpm exec tsc --noEmit`, `pnpm lint`; `grep -n "steam-drift" src -r` → no hits.
- **Feel check**: DevTools Rendering panel → emulate reduced motion: open a drawer (fades in place, still readable), finish a pour (bloom fades without growing), run a deposit (stepper ring holds still). Un-emulate: ring now breathes in place instead of wobbling sideways.
- **Done when**: every infinite or entrance animation on the deposit path is either reduced-motion-gated or opacity-only.
