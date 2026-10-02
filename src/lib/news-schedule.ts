/**
 * The news store's limits, as pure functions of the environment so they can
 * be tested without one. lib/server/news-ingest obeys them.
 *
 * When it runs: inside the two crons Hobby allows (morning and evening,
 * each chaining to /api/cron/news so their own budgets are untouched), and
 * once per New York slot of lib/x-schedule on demand, claimed in the
 * database by the first reader of the slot, plus one refresh per slot from
 * the column's button. Never more often, whatever the traffic.
 *
 * How much: every source has a hard cap per UTC day, reserved in
 * news_budget before a request is sent, as X's posts are in x_read_budget.
 * X keeps its own cap (`X_DAILY_POST_CAP`) and its own path, unchanged.
 */

export type NewsSource = "nasdaq" | "edgar" | "marketaux" | "jev";

/** Requests a day (Jev: input tokens a day). Generous against expected use, so a cap is a guard, not a throttle. */
export const DEFAULT_CAPS: Readonly<Record<NewsSource, number>> = {
  // 24 feeds a run, about 10 runs a day: 240 expected.
  nasdaq: 400,
  // 20 companies a run, the two crons and the slots: about 100 expected.
  edgar: 300,
  // Its free plan answers 100 a day; this keeps ten in hand.
  marketaux: 90,
  // About $0.04 a day at $0.042 a million.
  jev: 1_000_000,
};

const CAP_ENV: Readonly<Record<NewsSource, string>> = {
  nasdaq: "NASDAQ_DAILY_CALL_CAP",
  edgar: "EDGAR_DAILY_CALL_CAP",
  marketaux: "MARKETAUX_DAILY_REQUEST_CAP",
  jev: "JEV_DAILY_TOKEN_CAP",
};

/** The day's cap for `source`, from its variable when that is a sane number. */
export function dailyCap(source: NewsSource, env: Record<string, string | undefined> = process.env): number {
  const raw = env[CAP_ENV[source]];
  const parsed = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_CAPS[source];
}

/**
 * Who sees what Marketaux gives, from `NEWS_MARKETAUX` (David, 2026-10-02):
 *
 * - "off", the default: never asked, and anything it once gave never shown;
 * - "staff": asked within the free plan's budget, folded and judged like
 *   any source, but its items are shown only to a signed in staff member
 *   (a viewer or an admin, STAFF_VIEWER_IDS or STAFF_ADMIN_IDS, read from
 *   the staff session on the server);
 * - "everyone": shown to all.
 *
 * Its terms license the content for personal, non-commercial use only
 * (reports/marketaux.md), so "everyone" waits for written approval. A story
 * a licensed source also carried stays visible to everyone through that
 * source; a story only Marketaux carried is left out of their responses, the
 * MCP tools and any email. Its sentiment score is never stored or shown.
 */
export type MarketauxMode = "off" | "staff" | "everyone";

export function marketauxMode(env: Record<string, string | undefined> = process.env): MarketauxMode {
  if (!env.MARKETAU_API_KEY) return "off";
  const value = env.NEWS_MARKETAUX?.trim().toLowerCase();
  return value === "staff" || value === "everyone" ? value : "off";
}

/** Whether ingestion asks Marketaux at all. */
export function marketauxFetches(env: Record<string, string | undefined> = process.env): boolean {
  return marketauxMode(env) !== "off";
}

/** The licensed sources, shown to anyone. */
export const LICENSED_SOURCES = ["nasdaq", "x"] as const;

/** The sources one reader may be shown: `staff` is whether this reader is a signed in staff member. */
export function visibleSources(
  { staff = false }: { staff?: boolean } = {},
  env: Record<string, string | undefined> = process.env,
): string[] {
  const mode = marketauxMode(env);
  const marketaux = mode === "everyone" || (mode === "staff" && staff);
  return marketaux ? [...LICENSED_SOURCES, "marketaux"] : [...LICENSED_SOURCES];
}

/** Whether a reader's answer depends on who asks, so it may not be shared through a CDN. */
export function newsVariesByReader(env: Record<string, string | undefined> = process.env): boolean {
  return marketauxMode(env) === "staff";
}

/** Marketaux symbols per request: its free plan answers at most three articles a call. */
export const MARKETAUX_SYMBOLS_PER_CALL = 3;

/**
 * Whether this process may ingest on demand: production on Vercel, or a
 * machine that says so (`NEWS_INGEST_LOCAL=1`, against a local database).
 * .env.local points at production Neon, so a dev server must not write
 * there by visiting the column. The crons are production only anyway.
 */
export function newsIngestAllowedHere(env: Record<string, string | undefined> = process.env): boolean {
  if (env.NEWS_INGEST_LOCAL === "1") return true;
  return env.NODE_ENV === "production" && env.VERCEL_ENV === "production";
}

/** How long kept news lives before it is pruned. */
export const KEEP_STORIES_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Items older than this are not ingested. Two weeks, because a quiet
 * listing's own run reaches that far back on Nasdaq and its card should
 * not go empty where it used to show something.
 */
export const INGEST_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** A filing is a line under "Coming up" for this long after it was filed. */
export const FILING_SHOWN_MS = 7 * 24 * 60 * 60 * 1000;
/** EDGAR asks for at most ten requests a second; this stays under half that. */
export const EDGAR_SPACING_MS = 250;
/**
 * SEC requires a User-Agent naming the caller and a contact
 * (sec.gov/os/accessing-edgar-data). The contact is the support inbox.
 */
export const EDGAR_USER_AGENT = "Berth support@berthmarkets.com";

/** The forms a holder is shown, and what each is called in a line (lib/copy eventFiling). */
export const SHOWN_FORMS: Readonly<Record<string, "report" | "quarterly" | "annual">> = {
  "8-K": "report",
  "6-K": "report",
  "10-Q": "quarterly",
  "10-K": "annual",
  "20-F": "annual",
  // An amendment is the same kind of report, filed again.
  "8-K/A": "report",
  "6-K/A": "report",
  "10-Q/A": "quarterly",
  "10-K/A": "annual",
  "20-F/A": "annual",
};
/** Stored but never shown: insider trades and their notices are noise to a holder. */
export const STORED_FORMS = new Set(["4", "4/A", "144", "144/A"]);
