import { isTooSmallQuoteError } from "@/lib/order-minimum";

/**
 * How a live quote rides out a flapping solver, as data so a table can pin
 * every branch (hooks/use-pour-quote feeds it).
 *
 * The SODAX solver drops every stock route for minutes at a time ("-4 No
 * path was found") while crypto pairs stay fine (reports/core-health
 * 2026-10-08). The quote refreshes every few seconds, so one refusal used to
 * flip a ready drawer to "No route for this pair" until the next answer.
 * Now:
 *
 * - The last good quote for the same pair and amount is kept on screen for
 *   up to HOLD_MS across refusals, and a refusal shows only after
 *   FAILURES_TO_SHOW in a row. "Too small" is a fact about the amount, not
 *   a blip, and shows at once.
 * - A refusal says what it is: a -4 on a stock is the stock market not
 *   answering, a proxy, server or rate limit failure is prices not
 *   answering, anything else is still "no route".
 * - A held quote is for the eyes only. What is signed comes from a quote no
 *   older than the SDK's own refresh (freshForSigning), or is asked again.
 */

/** How long a good quote stays on screen while the solver refuses. */
export const HOLD_MS = 10_000;
/** Refusals in a row before one is shown. */
export const FAILURES_TO_SHOW = 2;
/**
 * The SDK's own tolerance for a quote: dapp-kit's useQuote refreshes every
 * 3 s (getSwapQuoteQueryOptions refetchInterval). The hook reads the live
 * value from the SDK; this is the fallback if it ever stops saying.
 */
export const SDK_QUOTE_REFRESH_MS = 3_000;

/** The solver's "no path" code (SolverIntentErrorCode.NO_PATH_FOUND). */
const NO_PATH = -4;
/** The SDK's and the proxy's catch all (SolverIntentErrorCode.UNKNOWN): fetch failed, body not JSON, upstream unreachable. */
const UNKNOWN = -999;

export type QuoteRefusal =
  /** Under the solver's own floor: fixed in the field. */
  | "tooSmall"
  /** -4 no path: for a stock, its market is not answering (the solver drops stock routes). */
  | "noPath"
  /** The proxy, the server or a rate limit failed: prices are not answering. */
  | "unavailable"
  /** Any other refusal from the solver. */
  | "noRoute";

export type PairKind = "stock" | "crypto";

/** Words in an error body with no code that mean "not now", not "never": auth, rate limits, timeouts. */
const TRANSIENT_WORDS = /unauthori[sz]ed|forbidden|rate.?limit|too many|timed? ?out|timeout|unavailable|unreachable|bad gateway|try again/i;

/**
 * What a failed quote means, and the solver's number for it when it gave one.
 * "unavailable" (a calm "not answering") only for the SDK's and the proxy's
 * -999, a body that is not there at all, or one whose words say auth, rate
 * limit or timeout. A body with words but no code (a 400 or 422 validation
 * answer) is a real refusal: no route.
 */
export function classifyQuoteError(error: unknown): { refusal: QuoteRefusal; code: number | undefined } {
  if (isTooSmallQuoteError(error)) return { refusal: "tooSmall", code: codeOf(error) };
  const code = codeOf(error);
  if (code === NO_PATH) return { refusal: "noPath", code };
  if (code === UNKNOWN) return { refusal: "unavailable", code };
  if (code !== undefined) return { refusal: "noRoute", code };
  const detail = error && typeof error === "object" ? (error as { detail?: unknown }).detail : undefined;
  if (detail === undefined || detail === null) return { refusal: "unavailable", code };
  const words = typeof detail === "string" ? detail : JSON.stringify(detail);
  return { refusal: TRANSIENT_WORDS.test(words) ? "unavailable" : "noRoute", code };
}

/** A stock's -4 that has lasted this long in a row is no longer "a minute": it reads as no route. */
export const PERSISTENT_NO_PATH_MS = 2 * 60 * 1000;

function codeOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const detail = (error as { detail?: unknown }).detail;
  if (!detail || typeof detail !== "object") return undefined;
  const code = (detail as { code?: unknown }).code;
  return typeof code === "number" && Number.isInteger(code) ? code : undefined;
}

export type HoldState = {
  /** The pair and amount this state is about; a new one starts clean. */
  key: string | null;
  /** The last good quote and when it arrived. */
  good?: { quoted: bigint; at: number };
  /** Refusals in a row since the last good quote. */
  failures: number;
  /** The latest refusal. */
  last?: { refusal: QuoteRefusal; code: number | undefined };
  /** When the latest answer, good or not, arrived. */
  lastAt?: number;
  /** When the current run of refusals began (the first refusal since the last good answer). */
  refusingSince?: number;
};

export const EMPTY_HOLD: HoldState = { key: null, failures: 0 };

export type QuoteAnswer =
  | { ok: true; quoted: bigint; at: number }
  | { ok: false; error: unknown; at: number; thrown?: boolean };

/** The state after one answer from the solver for `key`. */
export function holdReduce(state: HoldState, key: string, answer: QuoteAnswer): HoldState {
  const base: HoldState = state.key === key ? state : { key, failures: 0 };
  if (answer.ok) return { key, good: { quoted: answer.quoted, at: answer.at }, failures: 0, lastAt: answer.at };
  // A throw is the SDK refusing the request itself (an unsupported token):
  // not a blip and not the network, so it reads as no route.
  const last = answer.thrown ? { refusal: "noRoute" as const, code: undefined } : classifyQuoteError(answer.error);
  const refusingSince = base.failures === 0 || base.refusingSince === undefined ? answer.at : base.refusingSince;
  return { ...base, key, failures: base.failures + 1, last, lastAt: answer.at, refusingSince };
}

export type HoldView = {
  /** The quote to show: live, or held across a blip. */
  quoted: bigint | undefined;
  /**
   * True while `quoted` is held: the latest answer was a refusal, or the
   * next answer has been in flight for longer than HOLD_MS.
   */
  held: boolean;
  /** A stock's -4 has lasted past PERSISTENT_NO_PATH_MS: word it as no route. */
  persistent: boolean;
  /** The refusal to show, once it is more than a blip. */
  refusal: QuoteRefusal | undefined;
  /** The solver's number for that refusal. */
  code: number | undefined;
};

/**
 * What the drawer shows for `key` at `now`. `refreshMs` is when the next
 * answer is due after a good one (the SDK's refresh): an answer that has not
 * come HOLD_MS after that is a request hanging, so the quote is marked held,
 * and a held quote shows for HOLD_MS at most.
 */
export function holdView(state: HoldState, key: string | null, now: number, refreshMs = SDK_QUOTE_REFRESH_MS): HoldView {
  const none: HoldView = { quoted: undefined, held: false, persistent: false, refusal: undefined, code: undefined };
  if (key === null || state.key !== key) return none;
  if (state.failures === 0) {
    if (!state.good) return none;
    const inFlight = now - (state.good.at + refreshMs);
    if (inFlight <= HOLD_MS) return { ...none, quoted: state.good.quoted };
    if (inFlight <= 2 * HOLD_MS) return { ...none, quoted: state.good.quoted, held: true };
    return none;
  }
  const last = state.last!;
  if (last.refusal === "tooSmall") return { ...none, refusal: "tooSmall", code: last.code };
  const holding = state.good !== undefined && now - state.good.at <= HOLD_MS;
  if (holding) return { ...none, quoted: state.good!.quoted, held: true };
  const persistent =
    last.refusal === "noPath" && state.refusingSince !== undefined && now - state.refusingSince > PERSISTENT_NO_PATH_MS;
  if (state.failures >= FAILURES_TO_SHOW) return { ...none, refusal: last.refusal, code: last.code, persistent };
  // One refusal and nothing to hold: still "getting a quote".
  return none;
}

/**
 * The quote an order may be built and signed from: the latest answer was
 * good and it is no older than `maxAgeMs` (the SDK's refresh). Undefined
 * means ask again before signing; a held quote never qualifies.
 */
export function freshForSigning(state: HoldState, key: string | null, now: number, maxAgeMs: number): bigint | undefined {
  if (key === null || state.key !== key || state.failures !== 0 || !state.good) return undefined;
  return now - state.good.at <= maxAgeMs ? state.good.quoted : undefined;
}

/** The analytics reason for a refusal (lib/analytics quote_refused). */
export function refusalReason(refusal: QuoteRefusal): string {
  switch (refusal) {
    case "tooSmall":
      return "too_small";
    case "noPath":
      return "no_path";
    case "unavailable":
      return "unavailable";
    case "noRoute":
      return "no_route";
  }
}

/** The solver's number as a short code ("4", "999"), "none" without one. */
export function errorNumber(code: number | undefined): string {
  return code === undefined ? "none" : String(Math.abs(code)).slice(0, 6);
}

/**
 * Which words a shown refusal gets (lib/copy): a stock's -4 is its market
 * not answering, a failed proxy or server is prices not answering, and
 * only a real refusal is "no route".
 */
export function refusalWords(
  refusal: Exclude<QuoteRefusal, "tooSmall">,
  pairKind: PairKind,
  persistent = false,
): "marketQuiet" | "pricesQuiet" | "noRoute" {
  if (refusal === "unavailable") return "pricesQuiet";
  if (refusal === "noPath" && pairKind === "stock" && !persistent) return "marketQuiet";
  return "noRoute";
}

/** The wall clock for answers and the signing check; called from a query or a click, never from render. */
export function quoteClock(): number {
  return Date.now();
}

/* ── the fresh ask before signing ───────────────────────────────────────── */

/** How long the fresh ask before signing may take before it fails closed. */
export const FRESH_ASK_TIMEOUT_MS = 8_000;

export type PriceCheck =
  /** The market still clears the minimum the person confirmed: sign that. */
  | { kind: "ok"; minOut: bigint }
  /** The fresh QUOTED amount is below the minimum on screen: show the new figure and ask again. */
  | { kind: "moved"; quoted: bigint }
  /** No fresh answer in time, or a refusal: nothing starts. */
  | { kind: "unavailable" };

/**
 * The rule at the tap and again just before signing. `freshQuoted` is the
 * fresh quote's amount BEFORE slippage. The order stops only when that falls
 * below the confirmed minimum, the "At least" the person saw: then the
 * signed floor could not be met. A move inside the slippage band (fresh
 * quote lower than before, but still at or above the confirmed minimum)
 * proceeds, and the signed minimum stays the confirmed one either way.
 */
export function judgeFresh(confirmed: bigint | undefined, freshQuoted: bigint | undefined): PriceCheck {
  if (confirmed === undefined || freshQuoted === undefined) return { kind: "unavailable" };
  return freshQuoted < confirmed ? { kind: "moved", quoted: freshQuoted } : { kind: "ok", minOut: confirmed };
}

export type FreshAskSlot = { current: { key: string; promise: Promise<bigint | undefined> } | null };

/**
 * The fresh quote an order may be signed from (through `toMin`; the hook
 * passes it through unchanged, the quoted amount judgeFresh compares): the one on
 * hand if its latest answer was good and no older than `maxAgeMs`, else
 * asked again. One ask per key at a time (a re-tap joins it, never cancels
 * it), and none longer than `timeoutMs`: undefined then, which fails closed.
 * A key that changed while asking (an amount edited) gives undefined too.
 */
export function freshMinimum({
  key,
  read,
  refetch,
  toMin,
  slot,
  clock = quoteClock,
  maxAgeMs,
  timeoutMs = FRESH_ASK_TIMEOUT_MS,
}: {
  key: string | null;
  read: () => HoldState;
  refetch: () => Promise<HoldState | undefined>;
  toMin: (quoted: bigint) => bigint | undefined;
  slot: FreshAskSlot;
  clock?: () => number;
  maxAgeMs: number;
  timeoutMs?: number;
}): Promise<bigint | undefined> {
  if (key === null) return Promise.resolve(undefined);
  const onHand = freshForSigning(read(), key, clock(), maxAgeMs);
  if (onHand !== undefined) return Promise.resolve(toMin(onHand));
  if (slot.current && slot.current.key === key) return slot.current.promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });
  const asked = refetch()
    .then((state) => {
      const quoted = freshForSigning(state ?? EMPTY_HOLD, key, clock(), maxAgeMs);
      return quoted === undefined ? undefined : toMin(quoted);
    })
    .catch(() => undefined);
  const promise = Promise.race([asked, deadline]).finally(() => {
    clearTimeout(timer);
    if (slot.current?.promise === promise) slot.current = null;
  });
  slot.current = { key, promise };
  return promise;
}

export type SignPlan =
  /** Sign `minOut`; `check` asks again just before the signature (RunDepositArgs.priceCheck). */
  | { kind: "go"; minOut: bigint; check: (() => Promise<"ok" | "moved" | "unavailable">) | undefined }
  /** The fresh minimum is lower than the one shown: the drawer shows it and waits for a second tap. */
  | { kind: "moved" }
  /** No fresh answer: the drawer toasts quoteRefreshFailed. */
  | { kind: "unavailable" }
  /** The minimum would deliver less than Bitcoin's dust limit (lib/pour-amount belowBtcDust). */
  | { kind: "dust" }
  /** A send hold began while asking (another tab, lib/gas-sponsor): nothing starts. */
  | { kind: "held" };

/**
 * What the drawer signs, decided at the tap. A limit order signs its price's
 * minimum. A market order never signs the minimum on screen as such: the
 * shown figure is only what the person confirmed, and a fresh quote must
 * still clear it (checkPrice), now and again just before the signature.
 */
export async function minimumToSign({
  limitMin,
  shown,
  checkPrice,
  belowDust,
  sendHeld,
}: {
  /** Set for a limit order. */
  limitMin?: bigint;
  /** The "At least" on screen when Buy or Sell was tapped. */
  shown: bigint | undefined;
  checkPrice: (confirmed: bigint | undefined) => Promise<PriceCheck>;
  /** Whether a minimum is under Bitcoin's dust limit for this destination. */
  belowDust?: (minOut: bigint) => boolean;
  /** Whether a send hold is on now, read after the ask. */
  sendHeld: () => boolean;
}): Promise<SignPlan> {
  if (limitMin !== undefined) return sendHeld() ? { kind: "held" } : { kind: "go", minOut: limitMin, check: undefined };
  const checked = await checkPrice(shown);
  if (sendHeld()) return { kind: "held" };
  if (checked.kind === "unavailable") return { kind: "unavailable" };
  if (checked.kind === "moved") return { kind: "moved" };
  if (belowDust?.(checked.minOut)) return { kind: "dust" };
  const confirmed = checked.minOut;
  return { kind: "go", minOut: confirmed, check: async () => (await checkPrice(confirmed)).kind };
}
