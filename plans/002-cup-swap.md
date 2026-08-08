# 002 — Make the cup swap interruptible and cheap

- **Status**: DONE
- **Commit**: 7908485
- **Severity**: HIGH
- **Category**: Interruptibility + Purpose & frequency + Performance
- **Estimated scope**: vaults/vault-list.tsx only

## Problem

`src/components/vaults/vault-list.tsx:115-134` — switching cups is the app's core repeated gesture, and it is serialized:

```jsx
<AnimatePresence initial={false} mode="wait">
  {active && (
    <motion.div
      key={active.vault}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 34 }}
      className="overflow-hidden"
    >
```

`mode="wait"` + `key={active.vault}` means an Earl Grey → Sencha tap collapses a ~250px card to zero height (layout pass every spring frame), waits, then expands the new one — roughly double duration, the page below reflows twice, and mid-flight taps queue instead of retargeting. Open→close deserves the height spring; A→B does not.

Also in this file: `duration-300` on the cup dim/undim (:171, :207) sits at the ceiling for tap feedback, and `whileTap={{ scale: 0.93 }}` (:167) squashes ~5× harder than the house press value (`active:scale-[0.985]` in ui/button.tsx).

(Note: an audit claim that the silk-shader ResizeObserver reallocates per frame during this spring was checked and rejected — the cup canvas has fixed pixel size; the parent height clip does not resize it.)

## Target

Two nested layers with different jobs:

- **Outer** (open/close only): the existing height spring, but keyed on a constant (`key="cup-slot"`), so it only runs when `active` flips between null and set. Spring: `SPRING_SHELF` from src/lib/motion.ts (plan 001).
- **Inner** (A→B swap): a directional slide-fade between cards, fully interruptible:
  ```jsx
  <AnimatePresence initial={false} mode="popLayout" custom={dir}>
    <motion.div
      key={active.vault}
      custom={dir}
      variants={{
        enter: (d) => ({ opacity: 0, transform: `translateX(${d * 14}px)` }),
        center: { opacity: 1, transform: "translateX(0px)" },
        exit: (d) => ({ opacity: 0, transform: `translateX(${d * -14}px)` }),
      }}
      initial="enter" animate="center" exit="exit"
      transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
    >
      <VaultCard ... />
  ```
  `dir` = sign(newIndex − oldIndex) tracked with a ref of the previous selected index; slides toward the tapped cup. Uses the full `transform` string (hardware-accelerated), not the `x` shorthand.
- Cup dim/undim: `duration-300` → `duration-200 ease-lift` (:171 and :207).
- `whileTap={{ scale: 0.93 }}` → `whileTap={{ scale: 0.96 }}`.

## Repo conventions to follow

- Springs from src/lib/motion.ts (plan 001). Easing arrays in JS mirror `--ease-lift` = cubic-bezier(0.23, 1, 0.32, 1).
- Directional-slide exemplar to imitate: none exists yet — this becomes the exemplar for plan 008's drawer steps.

## Steps

1. Add `const prevIndex = useRef(-1)` beside the selection state; compute `dir` on selection change (default 1 when no previous).
2. Restructure the JSX into outer (constant key, height) + inner (vault key, popLayout slide) per Target.
3. Swap the two `duration-300` classes and the whileTap value.

## Boundaries

- Do NOT touch VaultCard internals or the silk shader.
- Do NOT change what renders — same card, same data, motion only.
- Depends on plan 001 (SPRING_SHELF, ease-lift utility). If 001 is not yet applied, STOP.

## Verification

- **Mechanical**: `pnpm exec tsc --noEmit`, `pnpm lint` clean.
- **Feel check**: on the dev tea table (or with mock vaults), tap Earl Grey → Sencha rapidly several times mid-animation: the card must retarget instantly, never fully collapse between cups, never queue. Tap the same cup to close: height spring still plays. The slide direction matches travel direction along the shelf.
- **Done when**: A→B swap never animates height; only open/close does; rapid taps feel instant.
