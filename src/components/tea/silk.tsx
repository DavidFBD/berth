"use client";

import "@/lib/silk-shader";
import { useMounted } from "@/hooks/use-mounted";

/**
 * Silk palettes from the design system (ui_kits/lsteatime): the app floats
 * on a generative silk field, and the tea inside every cup is one too.
 */

/** Page-backdrop palettes, morning and evening (index.html SILK_BG). */
export const SILK_BG = {
  morning: "#f4eee0,#e9dcc4,#dcd2e8,#f8f2e3",
  evening: "#251f18,#2f2820,#363049,#453a2c",
} as const;

/** Per-blend tea-surface palettes (CupCard.jsx SILK). */
export const SILK_CUP: Record<string, string> = {
  earlgrey: "#cdc2e8,#a494d4,#8a77c7,#6d59b3",
  breakfast: "#e3c896,#cfa963,#b98a41,#9c6e2c",
  sencha: "#c4dcc0,#9cc79e,#79ad82,#5c9468",
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
  if (!mounted) return null;
  return (
    <div
      aria-hidden
      className="builders-strength pointer-events-none fixed inset-0 z-0 lg:absolute"
    >
      <silk-shader
        colors={SILK_BG.morning}
        quiet="0.5,0.94,0.65,0.18"
        speed="0.8"
        scale="1.35"
        glow="0.5"
        className="absolute inset-0 opacity-60 dark:hidden"
      />
      <silk-shader
        colors={SILK_BG.evening}
        quiet="0.5,0.94,0.65,0.18"
        speed="0.8"
        scale="1.35"
        glow="0.3"
        className="absolute inset-0 hidden opacity-55 dark:block"
      />
    </div>
  );
}
