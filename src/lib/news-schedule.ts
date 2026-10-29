/**
 * The news store's limits, as pure functions of the environment so they can
 * be tested without one. lib/server/news-ingest obeys them.
 *
 * When it runs: inside the morning cron (chaining to /api/cron/news so its
 * own budget is untouched; the evening cron no longer gathers news), and
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
  // One feed per listing a run, reserved all together: 45 a run (the stocks and funds, not cash), about
  // 10 runs a day, 450 expected. 800 allows 17 runs, so a busy day still completes.
  // Nasdaq publishes no rate limit for its keyless feeds.
  nasdaq: 800,
  // One request per company with a CIK (40 of the 45) each run in the two
  // crons and the slots, about 10 runs a day: 400 expected, so 600. Spaced at
  // 250 ms (EDGAR_SPACING_MS), 4 a second against the SEC's 10, whatever the cap.
  edgar: 600,
  // Its Basic plan allows 2,500 a day (headers, 2026-10-02); this keeps 500 in hand.
  // About 12 a run (45 listings, 4 a call), so 2,000 is a guard, never a throttle.
  marketaux: 2000,
  // About $0.04 a day at $0.042 a million.
  jev: 1_000_000,
};

const CAP_ENV: Readonly<Record<NewsSource, string>> = {
  nasdaq: "NASDAQ_DAILY_CALL_CAP",
  edgar: "EDGAR_DAILY_CALL_CAP",
  marketaux: "MARKETAUX_DAILY_CAP",
  jev: "JEV_DAILY_TOKEN_CAP",
};

/** Older names still read when the current one is unset (round 1 shipped MARKETAUX_DAILY_REQUEST_CAP). */
const CAP_ENV_FALLBACK: Partial<Record<NewsSource, string>> = {
  marketaux: "MARKETAUX_DAILY_REQUEST_CAP",
};

/** The day's cap for `source`, from its variable when that is a sane number. */
export function dailyCap(source: NewsSource, env: Record<string, string | undefined> = process.env): number {
  const fallback = CAP_ENV_FALLBACK[source];
  const current = env[CAP_ENV[source]];
  const raw = current !== undefined && current.trim() !== "" ? current : fallback ? env[fallback] : undefined;
  const parsed = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_CAPS[source];
}

/**
 * Who sees what Marketaux gives, from `NEWS_MARKETAUX` (David, 2026-10-02,
 * on his own paid Basic plan: "enable marketaux for all users"):
 *
 * - "everyone", the default once its key is set (`marketauxKey`): asked within its
 *   own daily cap, folded and judged by Jev like any source, shown to all;
 * - "staff": asked the same way, but a story only Marketaux carried is shown
 *   only to a signed in staff member (a viewer or an admin, read from the
 *   staff session on the server), and is left out of every other reader,
 *   the MCP tools and any email;
 * - "off": never asked, and anything it once gave never shown.
 *
 * Any other value reads as "off", so a typo never widens what is shown. In
 * every mode a story a licensed source also carried stays visible through
 * that source, and Marketaux never leads it. Kept from it: title, link,
 * publisher, time and matched listings, never its description, snippet,
 * image or sentiment score.
 */
export type MarketauxMode = "off" | "staff" | "everyone";

/**
 * Marketaux's key. The variable is MARKETAU_API_KEY (as it was first set);
 * the natural spelling MARKETAUX_API_KEY is read too, so either works.
 */
export function marketauxKey(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.MARKETAU_API_KEY?.trim() || env.MARKETAUX_API_KEY?.trim() || undefined;
}

export function marketauxMode(env: Record<string, string | undefined> = process.env): MarketauxMode {
  if (!marketauxKey(env)) return "off";
  const value = (env.NEWS_MARKETAUX ?? "").trim().toLowerCase();
  if (value === "") return "everyone";
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

/**
 * Marketaux, per request: up to four listings, twenty articles (the Basic
 * plan's most a call). Four keeps a busy listing from crowding a thin one
 * out of the page, since each run asks only since the last one.
 */
export const MARKETAUX_SYMBOLS_PER_CALL = 4;
export const MARKETAUX_ARTICLES_PER_CALL = 20;
/** Its per-minute limit (x-ratelimit-limit), reserved per minute like the daily cap. */
export const MARKETAUX_PER_MINUTE = 30;
/** A group asks for articles since it was last fully heard, never further back than this. */
export const MARKETAUX_LOOKBACK_MS = 24 * 60 * 60 * 1000;
/**
 * And this far before that, again: Marketaux may index an article some
 * time after its stamp. What is asked twice costs only "known" items.
 */
export const MARKETAUX_OVERLAP_MS = 2 * 60 * 60 * 1000;
/** Requests one run may send, first pages and pages back together, under the caps: 12 first pages for 45 listings and 12 pages back, within the 30 a minute. */
export const MARKETAUX_REQUESTS_PER_RUN = 24;

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
