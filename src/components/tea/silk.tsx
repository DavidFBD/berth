"use client";

import "@/lib/silk-shader";
import { useMounted } from "@/hooks/use-mounted";
import { useMode } from "@/components/settings-provider";
import { MODES } from "@/lib/copy";

/**
 * Silk palettes from the design system (ui_kits/lsteatime): the app floats
 * on a generative silk field, and the tea inside every cup is one too.
 * The page backdrop's palette now belongs to the active mode (see MODES);
 * the per-cup surfaces below are still the design-system originals.
 */

/** Per-blend tea-surface palettes (CupCard.jsx SILK). */
export const SILK_CUP: Record<string, string> = {
  earlgrey: "#cdc2e8,#a494d4,#8a77c7,#6d59b3",
  breakfast: "#e3c896,#cfa963,#b98a41,#9c6e2c",
  sencha: "#c4dcc0,#9cc79e,#79ad82,#5c9468",
  chamomile: "#f8efc9,#eeda97,#dcbe63,#c2a044",
};

/**
 * The ambient silk field behind the whole app. Fixed to the viewport on
 * mobile; inside the desktop stage's phone screen it pins absolutely so it
 * stays put while the app scrolls. The quiet zone calms the weave near the
 * top where the header and teapot sit (uv y is up). Client-only: custom
 * elements don't exist during SSR, so it mounts after hydration.
 */
export function SilkBackdrop() {
  const mounted = useMounted();
  const { mode } = useMode();
  if (!mounted) return null;
  const silk = (MODES.find((m) => m.id === mode) ?? MODES[0]).silk;
  return (
    <div
      aria-hidden
      className="builders-strength pointer-events-none fixed inset-0 z-0 lg:absolute"
    >
      {/* Keyed by mode: the shader reads its attributes once on mount, so a
          palette change must remount rather than mutate. */}
      <silk-shader
        key={mode}
        colors={silk.colors}
        quiet="0.5,0.94,0.65,0.18"
        speed="0.8"
        scale="1.35"
        glow={String(silk.glow)}
        className="absolute inset-0"
        style={{ opacity: silk.opacity }}
      />
    </div>
  );
}
