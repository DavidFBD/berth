# 006 — Toast and celebration polish

- **Status**: TODO
- **Commit**: 7908485
- **Severity**: MEDIUM
- **Category**: Physicality + Easing + Cohesion
- **Estimated scope**: xp-toast.tsx, tea-service.tsx (rank chip)

## Problem

`src/components/xp-toast.tsx`:

- :111-113 and :168-170 — icons enter from literal nothing: `initial={{ rotate: -90, scale: 0 }}` with no opacity ramp. AUDIT: never scale(0).
- :105, :144 — container entrances at scale 0.6 / 0.7 (audit band for entrances is 0.9–0.97; celebrations get leeway, not 0.6).
- :154-161 — the level-up card's steam wisps loop with `ease: "easeOut"`, so each repetition decelerates then restarts at full speed — a visible pulse at the seam. The house steam rule (globals.css comment: "linear rise, opacity does the easing") says linear.
- :187 — one stagger member has `transition={{ delay: 0.32 }}` with no curve while its four siblings use tuned springs.

`src/components/tea-service.tsx:615-619` — the always-visible header rank chip re-pops on EVERY xp change, with the bounciest spring in the app:

```jsx
<motion.span key={profile.data?.xp ?? -1} initial={{ scale: 1.25 }} animate={{ scale: 1 }}
  transition={{ type: "spring", stiffness: 500, damping: 15 }}>
```

The ambient chrome out-bounces the celebration it reacts to (level-up card itself: 360/20).

## Target

- Icons: `initial={{ rotate: -90, scale: 0.4, opacity: 0 }}` → `animate={{ rotate: 0, scale: 1, opacity: 1 }}` (springs unchanged).
- XpPill container: `initial={{ scale: 0.85, y: 10, opacity: 0 }}`. LevelUpCard container: `initial={{ scale: 0.88, y: 14, opacity: 0 }}`.
- Wisps: `ease: "linear"` (keep the opacity keyframe array `[0, 0.8, 0]` — that IS the easing).
- :187: `transition={{ type: "spring", stiffness: 300, damping: 24, delay: 0.32 }}` (matches its sibling at :179).
- Rank chip: key on rank identity, not raw xp — `key={rank.level}` (or the equivalent rank object identity in scope) so it pops only when the rank actually changes; spring softens to `SPRING_POP` (480/24) from src/lib/motion.ts; `initial={{ scale: 1.12 }}`.

## Repo conventions to follow

- Springs from src/lib/motion.ts (plan 001). Celebration stagger ladder stays (0.08 → 0.1 → 0.18 → 0.25 → 0.32).

## Boundaries

- Do NOT change toast queueing/announcement logic, only motion values.
- Do NOT touch the Privy-overlay wait logic.
- Depends on plan 001 for SPRING_POP.

## Verification

- **Mechanical**: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`.
- **Feel check**: trigger an XP award (dev): pill materializes from 85% + fade (no born-from-nothing icon); level-up wisps loop without a rhythm hiccup (watch 3 full cycles); earn XP twice without ranking up: the header chip must NOT re-pop the second time; rank up: it pops once.
- **Done when**: no `scale: 0` under src/components, chip pops on rank change only.
