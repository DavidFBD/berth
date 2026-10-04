/**
 * The staff area's client door (docs/adr/0008-staff-area.md), pure so it
 * can be tested without a browser.
 *
 * A staff page is served only to a request that carries a live staff
 * session cookie. That cookie lasts as long as the Privy token it was
 * minted from (about an hour, renewed while a staff page is open), and it
 * is SameSite=Strict, so a staff member coming back after an hour, or
 * following a link from another site, arrives without one and the server
 * answers the unknown address 404 (next.config, src/proxy.ts). Privy's
 * token lives only in the browser, so the server cannot do better.
 *
 * The 404 page is the same for every address and every visitor. On a
 * /staff address, before first paint, an inline script (DOOR_SCRIPT) hides
 * its words behind a neutral "Loading"; the door then asks POST
 * /api/staff/session with a fresh Privy token. Yes: the page loads again,
 * now with the cookie, and the server's own gate draws the area. No, not
 * signed in, or Privy never ready: the 404's words show, as for anyone.
 * Nothing of the area reaches the browser before the server's gate says
 * yes; the door only mints the cookie the server already checks.
 */

/** The staff area's addresses, as the 404 page tells them apart in the browser. */
export const STAFF_PATH = /^\/staff(\/|$)/;

export function isStaffPath(path: string): boolean {
  return STAFF_PATH.test(path);
}

/** The attribute on <html> that hides the 404's words while the door asks. */
export const DOOR_ATTR = "data-berth-door";
export const DOOR_WAIT = "wait";

/** sessionStorage: the door let this address in a moment ago (the loop guard). */
export const DOOR_MARK_KEY = "berth-staff-door";
/** How long a mark counts: one reload, with room for a slow server. */
export const DOOR_MARK_MS = 20_000;

/** The mark set just before the page loads again with its new cookie. */
export function doorMark(path: string, now: number): string {
  return JSON.stringify({ p: path, t: now });
}

/**
 * Whether the door let this very address in within the last moments. Then
 * the server answered 404 even with a fresh cookie (a staff address that
 * really is missing, or a session that could not be read), so the 404
 * shows and the door does not ask again: no loop.
 */
export function justLetIn(raw: string | null, path: string, now: number): boolean {
  if (!raw) return false;
  try {
    const mark = JSON.parse(raw) as { p?: unknown; t?: unknown };
    return mark.p === path && typeof mark.t === "number" && now >= mark.t && now - mark.t < DOOR_MARK_MS;
  } catch {
    return false;
  }
}

/** What the door does when the 404 page mounts at `path`. */
export function doorStart(path: string, mark: string | null, now: number): "skip" | "guard" | "ask" {
  if (!isStaffPath(path)) return "skip";
  if (justLetIn(mark, path, now)) return "guard";
  return "ask";
}

/**
 * The inline script the 404 page runs before first paint, the same bytes
 * for every address: on a /staff address it hides the 404's words behind
 * "Loading", unless the door has just let this address in. Without
 * JavaScript nothing is hidden. Kept in step with doorStart (a test runs
 * the two against each other).
 */
export const DOOR_SCRIPT = `(function(){try{var p=location.pathname;if(!${STAFF_PATH.toString()}.test(p))return;var m=null,n=Date.now();try{m=JSON.parse(sessionStorage.getItem(${JSON.stringify(DOOR_MARK_KEY)})||"null")}catch(e){}if(m&&m.p===p&&typeof m.t==="number"&&n>=m.t&&n-m.t<${DOOR_MARK_MS})return;document.documentElement.setAttribute(${JSON.stringify(DOOR_ATTR)},${JSON.stringify(DOOR_WAIT)})}catch(e){}})();`;

/** Longest the door waits for Privy before the 404 shows. */
export const DOOR_PRIVY_TIMEOUT_MS = 10_000;

export type KnockDeps = {
  /** A fresh Privy access token, or null. */
  getToken: () => Promise<string | null>;
  /** POST /api/staff/session with the token as a Bearer: the status, or null when the request failed. */
  post: (token: string) => Promise<number | null>;
  sleep: (ms: number) => Promise<void>;
};

/** Pauses before the second and third tries. */
export const KNOCK_BACKOFF_MS = [800, 2_000] as const;

/**
 * Asks for the staff cookie, patiently: a token Privy has not handed over
 * yet, a request that failed, or a server error is tried again, up to
 * three tries. A 404 (not staff, or Privy's API not answering the email
 * proof) is tried once more, then taken as the answer. True when the
 * cookie was set.
 */
export async function knock({ getToken, post, sleep }: KnockDeps): Promise<boolean> {
  let refusals = 0;
  for (let attempt = 0; attempt <= KNOCK_BACKOFF_MS.length; attempt++) {
    if (attempt > 0) await sleep(KNOCK_BACKOFF_MS[attempt - 1]);
    const token = await getToken().catch(() => null);
    if (!token) continue;
    const status = await post(token).catch(() => null);
    if (status !== null && status >= 200 && status < 300) return true;
    if (status !== null && status >= 400 && status < 500) {
      refusals += 1;
      if (refusals >= 2) return false;
    }
  }
  return false;
}

export type DoorStore = { read: () => string | null; write: (value: string | null) => void };

/**
 * Once Privy is ready: "reload" when the cookie is set and the page should
 * load again to be drawn by the server's gate, "open" to show the 404's
 * words. A reload needs the loop guard's mark to have been kept; without
 * storage the 404 shows instead of risking a loop.
 */
export async function doorDecide({
  authenticated,
  path,
  now,
  store,
  ...deps
}: KnockDeps & { authenticated: boolean; path: string; now: () => number; store: DoorStore }): Promise<"open" | "reload"> {
  if (!authenticated || !isStaffPath(path)) return "open";
  if (!(await knock(deps))) return "open";
  store.write(doorMark(path, now()));
  return store.read() === null ? "open" : "reload";
}
