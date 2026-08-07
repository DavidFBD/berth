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

const STORAGE_KEY = "lsteatime.ref";
const PARAM = "ref";
const CODE_SHAPE = /^[a-z0-9]{6,12}$/;

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
    const code = new URL(window.location.href).searchParams
      .get(PARAM)
      ?.trim()
      .toLowerCase();
    if (!code || !CODE_SHAPE.test(code)) return;
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Storage denied (private mode) or malformed URL: the invite just
    // doesn't stick. Nothing to do.
  }
}

/** Tidies `?ref=` out of the address bar; call after hydration. */
export function stripReferralParam(): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(PARAM)) return;
    url.searchParams.delete(PARAM);
    window.history.replaceState(null, "", url.toString());
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

/** The shareable invite link for a code, on the current origin. */
export function inviteLink(code: string): string {
  const origin =
    typeof window === "undefined"
      ? "https://lsteatime.com"
      : window.location.origin;
  return `${origin}/?${PARAM}=${code}`;
}
