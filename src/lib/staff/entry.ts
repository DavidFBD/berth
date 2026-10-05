/**
 * The account drawer's quiet Staff entry (docs/adr/0008-staff-area.md),
 * pure so it can be tested without a browser. The server decides: POST
 * /api/account/staff answers `{ staff: true }` only for an account on a
 * staff list, and `{}` for everyone else. Anything other than exactly
 * that yes (a refusal, a miss, a malformed body) hides the entry.
 */

/** Whether an answer from /api/account/staff is the one yes. */
export function isStaffAnswer(data: unknown): boolean {
  return typeof data === "object" && data !== null && (data as { staff?: unknown }).staff === true;
}

/**
 * What the drawer shows: nothing; a plain link to /staff (an email
 * session, which the area's door can turn into a staff session); or, for
 * a wallet sign in, the entry that explains the area opens only after an
 * email code and offers that sign in. A wallet session never opens it.
 */
export type StaffEntryView = "hidden" | "link" | "email-first";

export function staffEntryView(staff: boolean | undefined, session: "email" | "wallet"): StaffEntryView {
  if (staff !== true) return "hidden";
  return session === "email" ? "link" : "email-first";
}

/** Where the entry leads. */
export const STAFF_HOME = "/staff";

/** The longest the wallet session's staff sign in holds its Privy session before it gives up. */
export const STAFF_SIGN_IN_TIMEOUT_MS = 20_000;

/** `work`, or a rejection once `ms` has passed: a hung Privy or network call never holds on forever. */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * The wallet session's staff sign in after the code is typed: Privy's
 * login with it, a fresh token, and that token traded at POST
 * /api/staff/session, the whole of it inside `timeoutMs`. True only for
 * the server's yes; a refusal, an error or a hang all read as false, so
 * the caller always gets an answer and always lets go.
 */
export async function openStaffSession(deps: {
  login: () => Promise<unknown>;
  getToken: () => Promise<string | null>;
  post: (token: string, signal: AbortSignal) => Promise<{ ok: boolean }>;
  timeoutMs?: number;
}): Promise<boolean> {
  const controller = new AbortController();
  const timeoutMs = deps.timeoutMs ?? STAFF_SIGN_IN_TIMEOUT_MS;
  try {
    return await withTimeout(
      (async () => {
        await deps.login();
        const token = await deps.getToken();
        if (!token) return false;
        return (await deps.post(token, controller.signal)).ok;
      })(),
      timeoutMs,
    );
  } catch {
    return false;
  } finally {
    controller.abort();
  }
}

/**
 * The flow's phase when a page is shown: one restored from the back and
 * forward cache (after the trip to /staff) starts closed, never still
 * holding a sign in that page left behind.
 */
export function phaseOnPageShow<P extends string>(persisted: boolean, phase: P): P | "closed" {
  return persisted ? "closed" : phase;
}
