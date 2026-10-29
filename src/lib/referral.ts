/**
 * The client half of referrals: catching a friend's code off the URL and
 * holding it until an account exists to bind it to.
 *
 * The whole app hides behind AuthGate, so the code MUST be captured at first
 * paint — before sign-in — and replayed on the profile sync that creates the
 * account. localStorage is the pocket it waits in; the server only ever binds
 * it to a row created in that same request, so a stale pocketed code on an
 * existing account is ignored, not honoured.
 */

import { normalizeInviteCode } from "@/lib/invite-code";
import { stateForUrlReplace } from "@/lib/sheet-history";

const STORAGE_KEY = "lsteatime.ref";
const PARAM = "ref";

/**
 * Reads `?ref=` off the landing URL into storage. Module-scope-callable
 * (same pattern as installLogCapture): no-op on the server and when the
 * param is absent. Pocketing and URL-tidying are split on purpose — a
 * replaceState this early gets overwritten when the Next router hydrates
 * with the original URL, so stripReferralParam runs in an effect instead.
 */
export function captureReferralFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    const code = new URL(window.location.href).searchParams.get(PARAM);
    if (code) pocketReferralCode(code);
  } catch {
    // Malformed URL: the invite just doesn't stick. Nothing to do.
  }
}

/**
 * Puts a code in the pocket directly — the `/r/CODE` landing calls this
 * with its path segment, no query param involved (WhatsApp taught us that
 * query strings don't always survive the trip). The rulebook decides what
 * fits the pocket: a code the mint can't produce is refused here, so the
 * welcome screen never promises a seat the server would ignore.
 */
export function pocketReferralCode(raw: string): void {
  if (typeof window === "undefined") return;
  const code = normalizeInviteCode(raw);
  if (!code) return;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Storage denied (private mode): the invite just doesn't stick.
  }
}

/** Tidies `?ref=` out of the address bar; call after hydration. */
export function stripReferralParam(): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(PARAM)) return;
    url.searchParams.delete(PARAM);
    window.history.replaceState(stateForUrlReplace(window.history.state), "", url.toString());
  } catch {
    // A visible ?ref= is cosmetic; nothing worth breaking over.
  }
}

/** The code waiting to be claimed, if any. */
export function pendingReferralCode(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Called after a successful profile sync: whatever was pocketed has now
 * either bound (fresh account) or been rightly ignored (existing account) —
 * either way it's spent.
 */
export function clearPendingReferral(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same private-mode story; nothing to clear anyway.
  }
}

/**
 * The shareable invite link for a code, on the current origin. Path-based
 * (`/r/CODE`) rather than `?ref=`: link sanitizers and chat apps strip query
 * params often enough that the code now travels as part of the path. The
 * old query shape stays accepted for links already in the wild.
 */
export function inviteLink(code: string): string {
  const origin =
    typeof window === "undefined"
      ? "https://www.berthmarkets.com"
      : window.location.origin;
  return `${origin}/r/${code}`;
}
