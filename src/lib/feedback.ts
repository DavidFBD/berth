/**
 * The feedback sheet's rulebook, shared by the sheet (components/feedback)
 * and the server (lib/server/feedback, app/api/feedback): how long a
 * message may be, what earns the one time XP, and what context rides along.
 *
 * The context is what the sheet tells the person it sends ("the screen you
 * were on, your device and browser", and the order when it was opened from
 * one). sanitizeContext is the one gate: the server runs it on whatever the
 * browser claims, so nothing else is ever stored. Never an amount, a
 * balance, a wallet address, an email or a name: a path loses its query
 * string and fragment, and any segment that could name someone (a username
 * on /u/, an invite or campaign code, anything shaped like an address, an
 * email or a long token) is replaced by a placeholder.
 */

/** The most a message may hold, in characters, after trimming. */
export const FEEDBACK_MAX_CHARS = 2000;

/** The trimmed length a first message needs to earn feedback_first. */
export const FEEDBACK_XP_MIN_CHARS = 20;

/** Per account: at most this many messages an hour, and this many a day. */
export const FEEDBACK_PER_HOUR = 5;
export const FEEDBACK_PER_DAY = 20;

/** How an order went wrong, when the sheet was opened from one. */
export const FEEDBACK_ORDER_KINDS = ["fill_failed", "unsettled", "outcome_unknown", "error"] as const;
export type FeedbackOrderKind = (typeof FEEDBACK_ORDER_KINDS)[number];

export function isFeedbackOrderKind(value: unknown): value is FeedbackOrderKind {
  return typeof value === "string" && (FEEDBACK_ORDER_KINDS as readonly string[]).includes(value);
}

/**
 * What the sheet knows about an order it was opened from. `ref` is the
 * order's hub transaction, used by the server only to find the order's own
 * internal id on this account; it is never stored.
 */
export type FeedbackOrder = { kind: FeedbackOrderKind; ref?: string | null };

/** What the browser sends beside the message. Every field is untrusted. */
export type FeedbackContextInput = {
  path?: unknown;
  viewport?: unknown;
  userAgent?: unknown;
};

/** What is stored and shown to staff. */
export type FeedbackContext = {
  path: string | null;
  viewport: string | null;
  userAgent: string | null;
  /** The deployed commit, short, set by the server. */
  build?: string | null;
  /** The order's internal id (orders.id) when it is on this account, and how it went wrong. */
  order?: { kind: FeedbackOrderKind; id: string | null } | null;
};

const MAX_PATH = 160;
const MAX_UA = 300;

/** Path segments after these are someone's name or code: replaced whole. */
const NAMED_AFTER: Record<string, string> = { u: ":username", r: ":code", c: ":code", f: ":code" };

/** A segment that could be an address, a hash, an email or a token, never kept. */
function looksPersonal(segment: string): boolean {
  if (segment.includes("@")) return true;
  if (/^0x[0-9a-f]{6,}$/i.test(segment)) return true;
  // Long runs of letters and digits: base58 or bech32 addresses, tokens, ids.
  if (/^[A-Za-z0-9_-]{24,}$/.test(segment)) return true;
  // Mostly digits (a phone number, a long numeric id).
  if ((segment.match(/\d/g)?.length ?? 0) >= 7) return true;
  return false;
}

/**
 * The screen as a bare path: no origin, no query string, no fragment, and
 * no segment that could name someone. Null for anything that is not a path.
 */
export function cleanPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let path = raw.trim();
  if (!path) return null;
  // A full URL keeps only its path.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }
  path = path.split(/[?#]/)[0];
  if (!path.startsWith("/")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    decoded = path;
  }
  const segments = decoded.split("/").slice(1);
  const out: string[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const previous = i > 0 ? segments[i - 1] : null;
    if (previous !== null && i === 1 && NAMED_AFTER[previous] && segment) {
      out.push(NAMED_AFTER[previous]);
    } else if (looksPersonal(segment)) {
      out.push(":id");
    } else {
      out.push(segment.replace(/[^A-Za-z0-9._~:-]/g, ""));
    }
  }
  const clean = `/${out.join("/")}`;
  return clean.length > MAX_PATH ? clean.slice(0, MAX_PATH) : clean;
}

/** "390x844", whole CSS pixels, or null. */
export function cleanViewport(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(raw.trim());
  return match ? `${Number(match[1])}x${Number(match[2])}` : null;
}

/** The user agent, printable and cut short, with anything shaped like an email taken out. */
export function cleanUserAgent(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const flat = raw
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\S+@\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!flat) return null;
  return flat.length > MAX_UA ? flat.slice(0, MAX_UA) : flat;
}

/**
 * The one gate between what the browser sends and what is stored: only the
 * three named fields, each cleaned; any other field is dropped.
 */
export function sanitizeContext(raw: unknown): FeedbackContext {
  const input = (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}) as FeedbackContextInput;
  return {
    path: cleanPath(input.path),
    viewport: cleanViewport(input.viewport),
    userAgent: cleanUserAgent(input.userAgent),
  };
}

/** What the browser sends for an order, or null: a known kind, and a hub transaction hash or nothing. */
export function readFeedbackOrder(raw: unknown): FeedbackOrder | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { kind, ref } = raw as { kind?: unknown; ref?: unknown };
  if (!isFeedbackOrderKind(kind)) return null;
  const hash = typeof ref === "string" && /^0x[0-9a-fA-F]{64}$/.test(ref) ? ref.toLowerCase() : null;
  return { kind, ref: hash };
}

/** The message as stored: trimmed; null when empty or longer than the cap. */
export function cleanBody(raw: unknown): { ok: true; body: string } | { ok: false; error: "empty" | "too_long" } {
  if (typeof raw !== "string") return { ok: false, error: "empty" };
  // Postgres refuses NUL and lone surrogates; drop them rather than fail.
  const body = raw.replace(/\u0000/g, "").toWellFormed().replace(/\r\n?/g, "\n").trim();
  if (!body) return { ok: false, error: "empty" };
  if (body.length > FEEDBACK_MAX_CHARS) return { ok: false, error: "too_long" };
  return { ok: true, body };
}

/** Whether a message earns the one time XP (if the account has not had it). */
export function qualifiesForXp(body: string): boolean {
  return body.trim().length >= FEEDBACK_XP_MIN_CHARS;
}

/** The first words of a message, on one line, cut at a word near `max`. */
export function excerpt(body: string, max = 140): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?]+$/, "")}…`;
}

/** What the sheet reads back from the server. */
export type FeedbackResponse = {
  ok: true;
  id: string;
  /** XP this message earned: feedback_first's amount, or 0. */
  awarded: number;
};

/** Why a send did not go, as the sheet words it. */
export type FeedbackRefusal = "signed_out" | "too_many" | "too_long" | "empty" | "failed";

/**
 * The board's one gentle ask (components/board/feedback-prompt-line), said
 * once per account through the notices (lib/server/notices): a fixed id,
 * never text, so closing it writes one account_notices row like any other.
 */
export const FEEDBACK_PROMPT_ID = "feedback-first-buy";

/** How long after the first completed buy the ask waits: a day, so it is about the buy, not the moment. */
export const FEEDBACK_PROMPT_DELAY_MS = 24 * 60 * 60 * 1000;

export type FeedbackPromptAccount = {
  /** The ask was closed, on any device. */
  closed: boolean;
  /** When the first completed buy of a stock or fund completed, epoch ms; null without one. */
  firstBuyAt: number | null;
  /** The account has sent feedback, ever (a feedback row, or feedback_first already paid). */
  sentFeedback: boolean;
};

/**
 * Whether the board asks this account how its first buy went: a completed
 * buy at least a day old, no feedback ever sent, and never closed. Once
 * feedback is sent, or the ask closed, it never comes back.
 */
export function feedbackPromptDue(account: FeedbackPromptAccount, now = Date.now()): boolean {
  if (account.closed || account.sentFeedback) return false;
  if (account.firstBuyAt === null || !Number.isFinite(account.firstBuyAt)) return false;
  return now - account.firstBuyAt >= FEEDBACK_PROMPT_DELAY_MS;
}
