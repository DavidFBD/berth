# 007 — The tea level glides instead of ticking

- **Status**: DONE
- **Commit**: 7908485
- **Severity**: MEDIUM
- **Category**: Performance + Missed opportunity
- **Estimated scope**: tea-art.tsx (CupArt + PourScene)

## Problem

During the pour, the one element the scene is about — the tea level — moves in discrete 400ms React steps while everything around it eases:

```js
// src/components/tea/tea-art.tsx:460-467 — current
const timer = setInterval(() => setCreep((f) => f + (0.88 - f) * 0.05), 400);
```

Each tick re-renders CupArt and rewrites SVG geometry (`teaTop` flows into gradient y1/y2, rect y, three ellipse cy). On success the level snaps ~0.6 → 1.0 in one frame.

## Target

Draw the tea at full-cup geometry once, inside the existing clip, wrapped in a `<g>` whose CSS transform translates it down by the empty fraction — then let a CSS transition interpolate level changes:

- In CupArt: `fullTop = botY - (botY - topY - 3)` (i.e. fill = 1). All tea elements (gradient rect, the three surface ellipses) use `fullTop` in place of `teaTop`. The group:
  ```jsx
  <g clipPath={`url(#cup${id})`}>
    <g style={{
      transform: `translateY(${(1 - f) * (botY - topY - 3)}px)`,
      transition: prevFill.current !== f ? "transform 700ms var(--ease-tea)" : undefined,
    }}>
      …tea elements at fullTop…
    </g>
  </g>
  ```
  (SVG user units == px for CSS transforms on SVG elements; the userSpaceOnUse gradient travels with the transformed group. Simpler acceptable variant: always declare the transition — there is no first-paint flash because there is no prior transform to transition from.)
- The tea-ring stain stays OUTSIDE the sliding group (it marks porcelain, not liquid) and keeps using the computed `teaTop`.
- The silk overlay (HTML, not SVG) must follow: keep `top` at the FULL level position and add `transform: translateY(px((1-f)*(botY-topY-3)))` with the same 700ms transition; do not animate `top`.
- PourScene: interval widens to 900ms (`--duration-steep` rhythm); CSS now interpolates between ticks so the level rises continuously. On `done`, fill = 1 rides the same transition.
- `--ease-tea` is correct here (continuous morphing motion, its home turf).

## Repo conventions to follow

- Token consumption: `var(--ease-tea)` in style strings, exemplar tea-art.tsx:108.
- WebKit note in file (silk lives outside the svg) stays true — only transforms move, no re-clipping.

## Boundaries

- Do NOT change fill semantics (0–1 clamp, teaTop math for the ring/showRing).
- Do NOT touch SteamPlume, TeapotArt, the stream, or the pour anchors.
- Visual identity: stills must be pixel-close to current at any given fill.

## Verification

- **Mechanical**: `pnpm exec tsc --noEmit`, `pnpm lint`; `pnpm shot --url http://localhost:3000/dev/tea` before/after — cup stills at each fill visually identical (surface ellipse sits at the same y).
- **Feel check**: watch "Pour, in progress" on /dev/tea for 10s: the level must rise continuously, no 400ms stairs; flip to done (reload the done section): the top-up glides rather than snaps. Check a silk cup on /lore: surface highlight still hugs the tea line.
- **Done when**: no visible stepping in the pour; React re-renders during pour drop to ≤1/900ms.
