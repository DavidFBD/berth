"use client";

import { createContext, useContext } from "react";

/**
 * The desktop stage's phone-screen element. Drawers portal into it so their
 * overlays and popups stay inside the phone on lg+ instead of stretching
 * across the whole browser viewport. The screen div only becomes a
 * containing block (transform) and size container at lg, so on mobile the
 * same portal target leaves fixed positioning viewport-relative, exactly as
 * before. Null until the stage mounts.
 */
export const StageScreenContext = createContext<HTMLElement | null>(null);

export function useStageScreen(): HTMLElement | null {
  return useContext(StageScreenContext);
}
