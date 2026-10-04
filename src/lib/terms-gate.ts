/**
 * Whether an order drawer may open, or the terms sheet comes first
 * (components/terms-sheet). Pure, so the one rule that matters is a unit
 * test: a buy waits for the current terms to be accepted; a sell or a
 * withdraw never waits on them. A person may always leave without
 * accepting.
 *
 * - `loading`: the account's answer is not in yet.
 * - `due`: the current version (lib/legal-version TERMS_VERSION) is not
 *   accepted, or the answer could not be read.
 * - `accepted`: it is.
 */

export type TermsState = "loading" | "due" | "accepted";

export type TermsGate =
  /** Open the order drawer. */
  | "drawer"
  /** Show the terms sheet first. */
  | "sheet"
  /** Hold a beat: the answer is on its way (a buy only). */
  | "wait";

export function termsGate(kind: "buy" | "sell", state: TermsState, sellSkipped: boolean): TermsGate {
  if (state === "accepted") return "drawer";
  if (kind === "buy") return state === "loading" ? "wait" : "sheet";
  // A sell never waits: asked once a visit, and on with or without a yes.
  return state === "due" && !sellSkipped ? "sheet" : "drawer";
}

/**
 * Whether the server's answer counts as accepted. Fails open: only a real
 * answer, or no session to ask with (401, 403), can say due. A server
 * error, or a request that never came back (`status` null), lets the
 * person through, so an infrastructure failure never blocks a buy.
 */
export function acceptedFromAnswer(status: number | null, data: { accepted?: unknown } | null): boolean {
  if (status === 200 && data && typeof data.accepted === "boolean") return data.accepted;
  if (status === 401 || status === 403) return false;
  return true;
}

/**
 * The gate for one opening of a drawer, decided once (M1 of the review):
 * `latched` is what this opening already showed, `live` what termsGate
 * says now. Once the order drawer is showing it stays, whatever answer
 * arrives later, so a late answer never closes a drawer mid order. A sheet
 * gives way to the drawer once the terms are accepted (or a sell is let
 * through), and holds while the answer is read again. A wait takes
 * whatever comes.
 */
export function latchGate(latched: TermsGate | null, live: TermsGate): TermsGate {
  if (latched === "drawer") return "drawer";
  if (latched === "sheet" && live === "wait") return "sheet";
  return live;
}

/**
 * The last check, at the moment a buy is confirmed and before the wallet
 * is asked to sign: a person who signed in inside an open buy drawer has
 * not been asked yet, and the drawer is never closed on them (latchGate).
 * `check` reads acceptance afresh and fails open (acceptedFromAnswer);
 * `ask` shows the short terms over the drawer and answers true on Accept,
 * false on Not now. True means go on with the same order. A sell never
 * calls this.
 */
export async function confirmBuy({ check, ask }: { check: () => Promise<boolean>; ask: () => Promise<boolean> }): Promise<boolean> {
  const accepted = await check().catch(() => true);
  if (accepted) return true;
  return ask();
}

/** How long the read at confirm may take before it lets the person through. */
export const CONFIRM_READ_TIMEOUT_MS = 3_000;

/**
 * The read at confirm, bounded: the session's own answer when it already
 * knows the current version is accepted (no request at all), else the
 * fresh read, which fails open after `timeoutMs` or on any error.
 */
export async function readAtConfirm(
  known: boolean | undefined,
  read: () => Promise<boolean>,
  timeoutMs: number = CONFIRM_READ_TIMEOUT_MS,
): Promise<boolean> {
  if (known === true) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), timeoutMs);
  });
  try {
    return await Promise.race([read().catch(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
