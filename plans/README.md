# Animation plans — 2026-08-08 audit round

Produced by the improve-animations audit (commit 7908485). Target: 9/10 motion
quality on mobile WebKit, no new dependencies, silk kept but throttled
(David's call).

| # | Plan | Severity | Status |
| --- | --- | --- | --- |
| 001 | [Motion tokens into Tailwind, easing roles split](001-motion-tokens.md) | HIGH | DONE |
| 002 | [Cup swap interruptible and cheap](002-cup-swap.md) | HIGH | DONE |
| 003 | [Silk shader diet](003-silk-diet.md) | HIGH | DONE |
| 004 | [Reduced motion completeness](004-reduced-motion.md) | HIGH | DONE |
| 005 | [Press feedback everywhere](005-press-feedback.md) | MEDIUM | DONE |
| 006 | [Toast and celebration polish](006-toast-polish.md) | MEDIUM | DONE |
| 007 | [Liquid rise glides](007-liquid-rise.md) | MEDIUM | DONE |
| 008 | [Delight pack](008-delight-pack.md) | MEDIUM | DONE |

## Execution order and dependencies

001 first — it creates `ease-lift`/`ease-drawer` utilities and `src/lib/motion.ts`,
which 002, 005, 006 consume. 003 and 004 are independent. 007 is independent.
008 last (it borrows 002's directional-slide pattern and 001's conventions).

Recommended: 001 → 002 → 003 → 004 → 005 → 006 → 007 → 008.

## Settled decisions the audit respects (do not re-open)

- Aurora shooting star and LSD hue drift stay (theme identity; both
  reduced-motion gated). 001 only fixes the LSD keyframe's filter list.
- The live-dot beside earned figures stays (documented decision in globals.css).
- PourScene keeps its teapot-righting transition and tea creep under reduced
  motion — they explain state.
- Silk shader stays in the shelf cups (throttled by 003, not removed).

## Other plans

| Plan | Status |
| --- | --- |
| [In-app chat: your assistant, inside Berth](in-app-chat.md) | PLAN (2026-09-26) |
