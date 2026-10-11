/**
 * The account drawer's way back from a page it opened (a friend's profile,
 * the friends board). Pure, so the rules are tested without a browser; the
 * drawer and the pages it opens only read and write through these.
 *
 * Leaving: on a plain left click the drawer writes a mark into this tab's
 * sessionStorage (its screen, its scroll, the page it opened, when) and puts
 * `?account=<screen>` on the home's own history entry, so browser back
 * lands on an address that asks for the drawer.
 *
 * Coming back: the home opens the drawer only when the address asks AND a
 * fresh mark for that screen is in this tab. The mark is spent on use; the
 * parameter is taken off the address either way. A new tab, a copied link,
 * a signed out visit or an old mark never open anything.
 */

export type DrawerView = "main" | "avatar" | "rewards" | "friends" | "money" | "notifications" | "ai" | "settings";

export const DRAWER_VIEWS: readonly DrawerView[] = ["main", "avatar", "rewards", "friends", "money", "notifications", "ai", "settings"];

export function isDrawerView(value: string | null | undefined): value is DrawerView {
  return typeof value === "string" && (DRAWER_VIEWS as readonly string[]).includes(value);
}

/** The search parameter that reopens the drawer on a screen. */
export const DRAWER_RETURN_PARAM = "account";
/**
 * An email's own way to the drawer: `?open=friends` opens it on Friends once
 * signed in. Unlike `?account=`, it needs no mark, because the person comes
 * from outside the app; opening a drawer shows them only their own account.
 */
export const DRAWER_LINK_PARAM = "open";
export const DRAWER_LINK_VIEW: DrawerView = "friends";
/** Where the mark lives, in sessionStorage (this tab only). */
export const DRAWER_RETURN_KEY = "berth.drawer-return";
/** On a page opened from the drawer: Back goes back to it, when the mark agrees. */
export const FROM_DRAWER_PARAM = "from";
export const FROM_DRAWER_VALUE = "account";
/** A mark older than this is a visit that never came back; it opens nothing. */
export const RETURN_TTL_MS = 30 * 60_000;

export type ReturnMark = {
  view: DrawerView;
  scroll: number;
  /** The path the drawer opened, e.g. /u/marta or /friends. */
  target: string;
  at: number;
};

/** Only a plain left click leaves a mark: a new tab or window must not inherit a way back it never took. */
export function isPlainClick(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented?: boolean;
}): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.defaultPrevented;
}

export function writeMark(mark: ReturnMark): string {
  return JSON.stringify(mark);
}

/** The mark, or null when there is none, it is malformed, or it has gone stale. */
export function readMark(raw: string | null, now: number): ReturnMark | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ReturnMark>;
    if (!isDrawerView(parsed.view)) return null;
    if (typeof parsed.scroll !== "number" || !Number.isFinite(parsed.scroll) || parsed.scroll < 0) return null;
    if (typeof parsed.target !== "string" || !parsed.target.startsWith("/")) return null;
    if (typeof parsed.at !== "number" || now - parsed.at > RETURN_TTL_MS || parsed.at > now + 60_000) return null;
    return { view: parsed.view, scroll: parsed.scroll, target: parsed.target, at: parsed.at };
  } catch {
    return null;
  }
}

/**
 * What the home does with `?account=` on mount. `open` only for a signed in
 * account, an address that names a screen, and a fresh mark for that same
 * screen; `strip` whenever the parameter is there at all; `spend` whenever
 * there is a mark: the home mounting again is the mark's one chance, and a
 * mark it does not use (an exit by the address bar) is dead.
 */
export function resolveReturn({
  param,
  mark,
  signedIn,
}: {
  param: string | null;
  mark: ReturnMark | null;
  signedIn: boolean;
}): { open: { view: DrawerView; scroll: number } | null; strip: boolean; spend: boolean } {
  const strip = param !== null;
  const open = signedIn && isDrawerView(param) && mark !== null && mark.view === param ? { view: param, scroll: mark.scroll } : null;
  return { open, strip, spend: mark !== null };
}

/**
 * Whether a page opened from the drawer offers "Back" (to the drawer) or its
 * usual way home. Back needs the page's own `?from=account` and a fresh mark
 * in this tab naming this very page; a copied address carries the first and
 * never the second.
 */
export function backMode({ from, mark, path }: { from: string | null; mark: ReturnMark | null; path: string }): "drawer" | "home" {
  if (from !== FROM_DRAWER_VALUE || !mark) return "home";
  return samePath(mark.target, path) ? "drawer" : "home";
}

function samePath(a: string, b: string): boolean {
  const clean = (p: string) => {
    let value = p.split("?")[0].replace(/\/+$/, "");
    try {
      value = decodeURIComponent(value);
    } catch {
      // Leave it as typed.
    }
    return value.toLowerCase();
  };
  return clean(a) === clean(b);
}

/**
 * The screen a drawer opens on: a deep link (an assistant, the email nudge)
 * wins over a pending return, and a return is spent once the drawer it
 * opened has closed, so later opens start on the first screen.
 */
export type ReturnState = { view: DrawerView; scroll: number | null };

export const NO_RETURN: ReturnState = { view: "main", scroll: null };

export function initialScreen({
  assistant,
  focusEmail,
  friends = false,
  money = false,
  pending,
}: {
  assistant: boolean;
  focusEmail: boolean;
  /** Opened from the social notice: the profile and friends screen, where its switch lives. */
  friends?: boolean;
  /** A wallet account's Add money: the wallets screen, with the wallet's own address on Base. */
  money?: boolean;
  pending: ReturnState;
}): ReturnState {
  if (assistant) return { view: "ai", scroll: null };
  if (friends) return { view: "friends", scroll: null };
  if (money) return { view: "money", scroll: null };
  if (focusEmail) return NO_RETURN;
  return pending;
}

/** What an email's `?open=` asks of the drawer: its screen, or nothing, and the parameter always leaves the address. */
export function resolveLink(param: string | null): { open: DrawerView | null; strip: boolean } {
  return { open: param === DRAWER_LINK_VIEW ? DRAWER_LINK_VIEW : null, strip: param !== null };
}

/**
 * What waits for the person in the account drawer, as the header pill's dot
 * says it: only what asks for their answer. Today that is friend requests;
 * a count of friends or XP is news, not a need.
 */
export function waitingInDrawer({ requests }: { requests: number | null | undefined }): number {
  return typeof requests === "number" && Number.isFinite(requests) && requests > 0 ? Math.floor(requests) : 0;
}
