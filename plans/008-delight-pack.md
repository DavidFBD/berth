# 008 — The delight pack: drawer steps, theme switch, ticking total, shelf stagger

- **Status**: DONE
- **Commit**: 7908485
- **Severity**: MEDIUM (additive)
- **Category**: Missed opportunities
- **Estimated scope**: deposit-drawer.tsx, withdraw-drawer.tsx, settings-provider.tsx (or settings-drawer.tsx), tea/table-total.tsx, vaults/vault-list.tsx

## Problem / Target, per seam

### A. Drawer steps hard-cut
`flow/deposit-drawer.tsx:331-354` and `flow/withdraw-drawer.tsx:334-361` swap form → stepper → steeping tracker via bare ternaries inside a drawer that smoothly resizes — content teleports inside a gliding shell. Target: wrap the three branches in a keyed, directional fade-through:

```jsx
<AnimatePresence initial={false} mode="popLayout">
  <motion.div
    key={step /* "form" | "stepper" | "steeping" */}
    initial={{ opacity: 0, transform: "translateY(10px)", filter: "blur(2px)" }}
    animate={{ opacity: 1, transform: "translateY(0px)", filter: "blur(0px)" }}
    exit={{ opacity: 0, transform: "translateY(-10px)", filter: "blur(2px)" }}
    transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
  >
```

The 2px blur masks the crossfade double-exposure (AUDIT §7). Steps only ever advance forward here, so a single direction is correct.

### B. Theme switch teleports
`settings-drawer.tsx:59-64` → `setMode` swaps ~50 CSS custom properties in one frame. Target: progressive enhancement via the View Transitions API where the mode class is applied (settings-provider.tsx):

```ts
const apply = () => setMode(id);
if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  document.startViewTransition(apply);
} else {
  apply();
}
```

Default crossfade only — no custom ::view-transition CSS. Safari 18+/Chrome get a soft wash; others keep the cut.

### C. The grand total snaps
`tea/table-total.tsx:100-113` renders `≈ {money.format(total)}` and `+{money.formatPrecise(earnedUsd)}` as static spans that jump on refetch — right when the user is watching after a pour. Target: reuse the ticking machinery from vault-card (`useTickingValue`, src/hooks/use-ticking-value.ts) if an aggregate per-year rate is available in scope; otherwise a 250ms eased count-up between old and new values (rAF, ease-lift curve, tabular-nums already guaranteed by `.money`). Do NOT add a live-dot (motion lives next to money; the header already has the label).

### D. Shelf first-mount stagger
`vaults/vault-list.tsx:82-95` — three cups appear at once. Target: each ShelfCup wrapper gets an entrance
`initial={{ opacity: 0, transform: "translateY(8px)" }}` → `animate={{ opacity: 1, transform: "translateY(0px)" }}`, `transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1], delay: index * 0.06 }}` — first mount only (it will replay on remount; the shelf mounts once per session, acceptable). Stagger must not gate interaction: pointer events stay live throughout.

## Repo conventions to follow

- Full `transform` strings, not x/y shorthands (hardware acceleration; matches plan 002).
- Easing array `[0.23, 1, 0.32, 1]` mirrors `--ease-lift`.
- Copy rule: no new user-facing strings anywhere in this plan.

## Boundaries

- Do NOT reorder or restructure drawer content beyond wrapping the branches.
- Do NOT animate the drawer shell (Base UI owns it).
- B must never break theme switching where the API is missing — feature-detect exactly as written.
- Depends on plan 001 conventions only (no token edits here).

## Verification

- **Mechanical**: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`.
- **Feel check**: run a deposit end-to-end on dev: form → brewing → steeping each hand off with a soft directional wash, no double-exposed text (the blur mask working); switch themes in settings on Safari/Chrome: colors wash over ~¼s instead of snapping; sign in and watch the shelf: cups arrive left-to-right in a quick ripple that never blocks tapping.
- **Done when**: all four seams animate; reduced-motion path for B confirmed (cut, not crossfade).
