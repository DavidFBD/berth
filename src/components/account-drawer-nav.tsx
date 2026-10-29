"use client";

import { createContext, useContext } from "react";
import { DRAWER_RETURN_KEY as DRAWER_RETURN_KEY_LOCAL, DRAWER_RETURN_PARAM as DRAWER_RETURN_PARAM_LOCAL, type DrawerView } from "@/lib/drawer-return";
import { stateForUrlReplace } from "@/lib/sheet-history";

/**
 * The account drawer's screens: the first one (who you are, the next step,
 * and a short list of rows), and one second screen per row. Kept apart from
 * the drawer itself so the sections it holds (social, email) can move it
 * without importing it. The return rules live in lib/drawer-return.
 */
export {
  DRAWER_RETURN_KEY,
  DRAWER_RETURN_PARAM,
  DRAWER_VIEWS,
  FROM_DRAWER_PARAM,
  FROM_DRAWER_VALUE,
  isDrawerView,
  type DrawerView,
} from "@/lib/drawer-return";

export type DrawerNav = {
  view: DrawerView;
  show: (view: DrawerView) => void;
  /**
   * Called on a plain left click that leaves the page from inside the drawer
   * (a friend's profile, the friends board), with the path it opens, so Back
   * there lands here again.
   */
  rememberReturn: (target: string) => void;
  /** Bring the add-email flow onto the first screen (a wallet account without one). */
  askEmail: () => void;
};

export const DrawerNavContext = createContext<DrawerNav | null>(null);

export function useDrawerNav(): DrawerNav | null {
  return useContext(DrawerNavContext);
}

/**
 * Where the add-email flow lives is the first screen (a wallet account's
 * drawer); a row elsewhere that offers it asks for it there, then brings
 * it into view and opens it.
 */
export function focusAddEmail(nav: DrawerNav | null, anchor: string) {
  const go = () => {
    const target = document.getElementById(anchor);
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
    target?.querySelector("button")?.click();
  };
  if (nav) {
    nav.askEmail();
    setTimeout(go, 80);
  } else {
    go();
  }
}

/**
 * Forget any way back to the drawer: the mark in this tab and the
 * parameter on this address. For a signed out visit (the welcome screen),
 * where there is no drawer to return to and none must pop open after sign in.
 */
export function clearDrawerReturn() {
  try {
    sessionStorage.removeItem(DRAWER_RETURN_KEY_LOCAL);
  } catch {
    // Storage refused: nothing was kept.
  }
  const url = new URL(window.location.href);
  if (!url.searchParams.has(DRAWER_RETURN_PARAM_LOCAL)) return;
  url.searchParams.delete(DRAWER_RETURN_PARAM_LOCAL);
  window.history.replaceState(stateForUrlReplace(window.history.state), "", url);
}
