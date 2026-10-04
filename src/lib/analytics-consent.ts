/**
 * Consent for product analytics (lib/analytics), remembered per browser.
 *
 *   ask      no choice yet: the quiet card asks; nothing is sent
 *   granted  Allow: PostHog loads, events and replays (masked) go out
 *   denied   No thanks, or the switch turned off: nothing is sent
 *   signal   the browser sends Do Not Track or Global Privacy Control:
 *            read as no, never asked, and the switch stays off
 *
 * Under ePrivacy (art. 5(3)) reading device details to send even a
 * cookieless count needs consent unless strictly necessary, so "ask" sends
 * nothing at all, the same as "denied".
 *
 * Only the choice is stored ("granted" or "denied"); it is needed to honour
 * the answer. The pure parts are tested; the store at the foot is the one
 * place that touches the browser.
 */

export type ConsentChoice = "granted" | "denied";
export type ConsentState = "ask" | "granted" | "denied" | "signal";

export const CONSENT_STORAGE_KEY = "berth.analytics-consent";

export function parseChoice(raw: string | null | undefined): ConsentChoice | null {
  return raw === "granted" || raw === "denied" ? raw : null;
}

/** What the browser says before anyone is asked. */
export type BrowserSignal = { doNotTrack: boolean; globalPrivacyControl: boolean };

export function consentState(stored: ConsentChoice | null, signal: BrowserSignal): ConsentState {
  if (signal.doNotTrack || signal.globalPrivacyControl) return "signal";
  return stored ?? "ask";
}

/** Only consent sends anything. */
export function sends(state: ConsentState): boolean {
  return state === "granted";
}

/** The card shows only while nothing has been chosen and the browser has not said no. */
export function asks(state: ConsentState): boolean {
  return state === "ask";
}

export type ConsentAction = "allow" | "decline" | "switchOn" | "switchOff";

/** The choice an action stores; a browser signal cannot be overridden from the page. */
export function nextChoice(state: ConsentState, action: ConsentAction): ConsentChoice | null {
  if (state === "signal") return null;
  return action === "allow" || action === "switchOn" ? "granted" : "denied";
}

type NavigatorSignals = { doNotTrack?: string | null; globalPrivacyControl?: boolean; msDoNotTrack?: string | null };

export function readSignal(nav: NavigatorSignals | undefined, win?: { doNotTrack?: string | null }): BrowserSignal {
  const dnt = nav?.doNotTrack ?? nav?.msDoNotTrack ?? win?.doNotTrack ?? null;
  return {
    doNotTrack: dnt === "1" || dnt === "yes",
    globalPrivacyControl: nav?.globalPrivacyControl === true,
  };
}

/* ── the browser store ─────────────────────────────────────────────────── */

const listeners = new Set<() => void>();
let memory: ConsentChoice | null = null;

export function subscribeConsent(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readStored(): ConsentChoice | null {
  try {
    const stored = parseChoice(window.localStorage.getItem(CONSENT_STORAGE_KEY));
    if (stored) return stored;
  } catch {
    // Storage blocked: the session's own answer stands.
  }
  return memory;
}

/** The current state in this browser; "ask" on the server. */
export function readConsent(): ConsentState {
  if (typeof window === "undefined") return "ask";
  return consentState(readStored(), readSignal(window.navigator as NavigatorSignals, window as { doNotTrack?: string | null }));
}

/** Apply an action (the card's buttons, the Settings switch). */
export function chooseConsent(action: ConsentAction): void {
  const choice = nextChoice(readConsent(), action);
  if (!choice) return;
  memory = choice;
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, choice);
  } catch {
    // Storage blocked: remembered for this session only.
  }
  for (const listener of listeners) listener();
}
