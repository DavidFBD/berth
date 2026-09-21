"use client";

import { useEffect, useState } from "react";

/**
 * Where a drawer comes from, which is a question about the canvas and not
 * about the drawer.
 *
 * On a phone a sheet rising from the bottom edge is right: it starts where
 * the thumb is and the action lands under it. On a desktop the same sheet is
 * a mobile pattern on the wrong canvas. Anchored to the bottom of a 900px
 * viewport it puts the primary button most of a screen below the row that
 * opened it, it covers the board the order is about, and it crowds a form
 * into a narrow strip while two thirds of the page sits empty.
 *
 * So above Tailwind's `lg`, where home.tsx stops being one phone-width
 * column and becomes two, a drawer arrives from the right instead. Right
 * rather than left because the board is the centre column and funds are the
 * left one: a right-hand sheet covers the news, which is the one thing
 * nobody needs mid-purchase, and leaves both the prices and the money
 * visible.
 *
 * This has to be matchMedia rather than a Tailwind variant, because Base UI
 * takes the direction as a prop and decides the axis, the transforms and the
 * swipe gesture from it, none of which CSS can switch. That is safe here for
 * one specific reason: a drawer opens on a tap, long after hydration, so the
 * query has always resolved by the time anything is rendered and there is no
 * first-paint flash to manage.
 */
const SIDE_SHEET_QUERY = "(min-width: 64rem)";

export type DrawerSide = "down" | "right";

export function useDrawerSide(): DrawerSide {
  // Starts at "down" so the server and the first client paint agree; a
  // desktop corrects itself in the same tick, before any drawer is open.
  const [side, setSide] = useState<DrawerSide>("down");

  useEffect(() => {
    const media = window.matchMedia(SIDE_SHEET_QUERY);
    const apply = () => setSide(media.matches ? "right" : "down");
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  return side;
}
