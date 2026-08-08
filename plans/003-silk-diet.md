# 003 — Put the silk shader on a diet

- **Status**: TODO
- **Commit**: 7908485
- **Severity**: HIGH
- **Category**: Performance
- **Estimated scope**: src/lib/silk-shader.ts only

## Problem

A signed-in home screen runs up to 5 concurrent WebGL contexts (full-viewport backdrop via tea/silk.tsx:41, three 62px shelf cups via vault-list.tsx:184, one 78px card cup via vault-card.tsx:167), each with its own full-rate rAF loop and a ~30-simplex-evaluations-per-fragment shader. On top of that:

```js
// src/lib/silk-shader.ts:108-114 — current
this._canvas.getContext("webgl", {
  antialias: false, depth: false, stencil: false, alpha: false,
  preserveDrawingBuffer: true,
})
```

`preserveDrawingBuffer: true` forces a backbuffer copy per present on tile-based mobile GPUs (every iPhone); nothing in the file reads pixels back. Nothing pauses when the tab is hidden (only offscreen elements pause, via IntersectionObserver at :149-154). The reduced-motion snapshot at :155/:227-230 samples `matchMedia` once and never listens for changes.

Decision from David (2026-08-08): keep silk in the cups — throttle, don't remove.

## Target

1. `preserveDrawingBuffer: false`.
2. Frame cap at 30fps: in the rAF loop (:231-238), skip draws until ≥33ms since the last draw (keep requesting frames; just don't render). The silk drifts slowly — half rate is imperceptible.
   ```js
   const loop = (ts) => {
     this._raf = 0;
     if (!this._visible || !this.isConnected) return;
     if (ts - this._lastDraw >= 33) {
       this._lastDraw = ts;
       this._draw(performance.now() / 1000 - this._t0);
     }
     this._raf = requestAnimationFrame(loop);
   };
   ```
3. Pause on tab hide: `document.addEventListener("visibilitychange", …)` in `connectedCallback`, removed in `disconnectedCallback`; hidden → cancel rAF, visible → resume (reuse the existing `_visible` plumbing if it fits, otherwise a parallel `_tabVisible` flag ANDed in).
4. Reduced-motion becomes live: `matchMedia("(prefers-reduced-motion: reduce)")` gets a `change` listener that stops/starts the loop (stopped → draw one still frame, exactly the current reduced behavior).

## Repo conventions to follow

- This file is a dependency-free custom element; keep it that way. Listener add/remove symmetry as done for IntersectionObserver at :147-154.

## Boundaries

- Do NOT change the shader source, colors, scale/speed/glow attributes, or the element's public API.
- Do NOT touch the components that mount silk.
- No new dependencies.

## Verification

- **Mechanical**: `pnpm exec tsc --noEmit`, `pnpm lint`.
- **Feel check**: `pnpm shot --mode aurora` before/after — silk backdrop and cup surfaces visually identical in stills. In the browser, watch the silk drift: still smooth (it moves slowly; 30fps is invisible for this material). Switch tabs and return: silk resumes without a jump cut (time base is wall-clock, so it will have "kept flowing" — correct).
- **Done when**: DevTools Performance shows silk draws at ~30Hz, no draws while hidden, and the context is created without preserveDrawingBuffer.
