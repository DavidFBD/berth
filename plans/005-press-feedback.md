# 005 — Press feedback on everything tappable

- **Status**: DONE
- **Commit**: 7908485
- **Severity**: MEDIUM
- **Category**: Physicality & origin + Interruptibility
- **Estimated scope**: ui/button.tsx + ~12 component files, class-level edits only

## Problem

Outside `<Button>`, tap targets have hover-only or color-only feedback. On mobile WebKit (`:hover` is sticky/false on touch), that means no press affordance at all. Verified sites:

*No `:active` at all:* settings-drawer.tsx:56 (mode cards), :104 (currency chips); account-button.tsx:118 (settings row), :300 (FundButton); wallet/connect-button.tsx:36; vault-card.tsx:312 (APR disclosure); tea-service.tsx:71, 142, 186, 321, 355 (primary-styled invite submit!), 382, 446, 472, 520, 648; tea/teapot-module.tsx:84, 211; flow/deposit-drawer.tsx:419, 469; flow/withdraw-drawer.tsx:400, 515.

*Color-only `:active`:* flow/token-picker.tsx:343, 387, 421; flow/deposit-drawer.tsx:358; flow/withdraw-drawer.tsx:449; wallet/wallet-drawer.tsx:216, 401.

And `ui/button.tsx:7` presses and releases on the same symmetric 150ms `transition-all` — the audit wants the press to snap and the release to settle.

## Target

Three press recipes, as reusable class strings:

- **Chips, tiles, icon buttons** (mode cards, currency chips, avatar tiles, flip/copy/disclosure buttons, teapot module buttons):
  `active:scale-[0.96] transition-[transform,background-color,border-color,box-shadow,color,opacity] duration-150 ease-lift`
- **Full-width rows** (token/holdings/wallet rows, settings row, ledger row, invite rows, FundButton):
  keep/add `active:bg-muted`, plus `active:scale-[0.99] transition-[transform,background-color,color] duration-150 ease-lift`
- **Primary-styled non-Button CTAs** (tea-service.tsx:355 invite submit): same as Button's press: `active:translate-y-px active:scale-[0.985]` + the asymmetric transition below.

**button.tsx asymmetric press** — replace `transition-all` with explicit properties and split transform timing (press snaps at 60ms, release settles at 200ms):

```
transition-[color,background-color,border-color,box-shadow,opacity] duration-150 ease-lift
[transition:transform_200ms_var(--ease-settle),color_150ms_var(--ease-lift),background-color_150ms_var(--ease-lift),border-color_150ms_var(--ease-lift),box-shadow_150ms_var(--ease-lift),opacity_150ms_var(--ease-lift)]
active:[transition:transform_60ms_var(--ease-lift)]
```

(Use ONE arbitrary `[transition:…]` for the base — do not stack it with `transition-[…]` utilities, they'd fight. The active variant only overrides transform timing.)

## Repo conventions to follow

- Press value bands: 0.96 for small targets, 0.985–0.99 for large surfaces (matches ui/button.tsx).
- `ease-lift` / `ease-settle` utilities from plan 001; if 001 is not applied, STOP.

## Steps

1. button.tsx per Target (single arbitrary transition, active override).
2. Sweep the "no active" list, applying the matching recipe; keep each element's existing classes and only append motion classes.
3. Sweep the "color-only" list, appending the row recipe's transform parts.

## Boundaries

- Class-level edits only; no markup or handler changes.
- Do NOT add press feedback to disabled states (`disabled:` styles already zero out pointer events — leave them).
- Skip elements that are really links styled as text (lore link, "prefer own wallet") — text does not squash.

## Verification

- **Mechanical**: `pnpm exec tsc --noEmit`, `pnpm lint`.
- **Feel check**: on the iPhone viewport (`pnpm shot` is static — use the browser), thumb every drawer: every tappable thing visibly acknowledges the press within ~1 frame, and buttons release with a soft settle rather than snapping back at press speed. Nothing squashes harder than the shelf cups (0.96).
- **Done when**: no interactive element in the audit list responds to touch with color-only or nothing.
