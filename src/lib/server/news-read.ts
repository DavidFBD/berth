import { after } from "next/server";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { FILING_SHOWN_MS, SHOWN_FORMS, newsIngestAllowedHere, visibleSources } from "@/lib/news-schedule";
import {
  OWNED_LIMIT,
  OWNED_WINDOW_MS,
  ownerNewsFor,
  riverOf,
  toCards,
  type EventCard,
  type NewsColumnResponse,
  type StoryCard,
} from "@/lib/news-stories";
import { MAX_ATTEMPTS_PER_SLOT, REFRESH_AFTER_MS, RETRY_AFTER_MS, currentSlot, utcDay } from "@/lib/x-schedule";
import { ingestNews, VERDICT_VERSIONS, type IngestPhase } from "@/lib/server/news-ingest";
import {
  claimNewsSlot,
  finishNewsSlot,
  lastIngestAt,
  newsSlotSettled,
  readEvents,
  readStories,
} from "@/lib/server/news-store";
import { gatherPosts } from "@/lib/server/x-column";
import { xFetchAllowedHere } from "@/lib/x-schedule";

/**
 * Every reader's door to the news store: the column (app/api/news), the
 * headlines (lib/server/listing-news, for the first look and the MCP
 * tools), the moves and the nudge. None of them asks Jev or a source: they
 * read the verdicts ingestion stored. The one exception is the column's
 * first request in a New York slot, which claims that slot's ingest and
 * runs it after its own answer is sent (`requestIngest`).
 */

export const NAMES: ReadonlyMap<string, string> = new Map(TOKEN_LISTINGS.map((listing) => [listing.symbol, listing.name]));

const DAY_MS = 24 * 60 * 60 * 1000;
/** The river reaches back as far as a post may be shown (lib/x-feed MAX_AGE_MS); one listing's own run, two weeks. */
const RIVER_WINDOW_MS = 5 * DAY_MS;
const LISTING_WINDOW_MS = 14 * DAY_MS;

const FEED_LIMIT = 12;
const PER_SYMBOL_LIMIT = 2;
const SYMBOL_LIMIT = 8;
const RESERVE = 24;
const SYMBOL_RESERVE = 8;

/** Cards readable by this reader since `sinceMs`. `staff` widens what may be seen (lib/news-schedule visibleSources). */
export async function readCards({
  sinceMs,
  symbol,
  staff = false,
}: {
  sinceMs: number;
  symbol?: string;
  staff?: boolean;
}): Promise<{
  cards: StoryCard[];
  read: Record<string, number>;
  judgedToday: { read: number; kept: number };
  /** Per listing over the whole window: stories Jev judged for it, and kept. */
  counts: Record<string, { read: number; kept: number }>;
  now: number;
}> {
  const now = Date.now();
  const stories = await readStories({ sinceMs, versions: VERDICT_VERSIONS, symbol });
  const visible = visibleSources({ staff });
  const read: Record<string, number> = {};
  // The credit line counts the last 24 hours, so it never vanishes at midnight while the chips stay.
  const todayStart = now - DAY_MS;
  let readToday = 0;
  let keptToday = 0;
  const counts: Record<string, { read: number; kept: number }> = {};
  for (const story of stories) {
    if (!story.sources.some((source) => visible.includes(source.source))) continue;
    if (story.verdicts.length === 0) continue;
    for (const verdict of story.verdicts) {
      const count = (counts[verdict.symbol] ??= { read: 0, kept: 0 });
      count.read += 1;
      if (verdict.kept) count.kept += 1;
    }
    if (now - story.publishedAt <= OWNED_WINDOW_MS) {
      for (const symbolRead of new Set(story.verdicts.map((verdict) => verdict.symbol))) {
        read[symbolRead] = (read[symbolRead] ?? 0) + 1;
      }
    }
    if (story.publishedAt >= todayStart) {
      readToday += 1;
      if (story.verdicts.some((verdict) => verdict.kept)) keptToday += 1;
    }
  }
  return { cards: toCards(stories, visible, NAMES), read, judgedToday: { read: readToday, kept: keptToday }, counts, now };
}

function eventCards(events: Awaited<ReturnType<typeof readEvents>>): EventCard[] {
  return events
    .filter((event) => NAMES.has(event.symbol) && event.kind === "filing")
    .map((event) => {
      const form = String(event.detail.form ?? "");
      return {
        symbol: event.symbol,
        name: NAMES.get(event.symbol)!,
        kind: "filing" as const,
        day: event.day,
        form,
        report: SHOWN_FORMS[form],
        url: typeof event.detail.url === "string" ? event.detail.url : undefined,
      };
    })
    .filter((event) => event.report !== undefined);
}

/** The column: the river, every listing's owner news, the quiet day's counts and the filings. Never throws. */
export async function loadNewsColumn({
  symbol,
  staff = false,
}: { symbol?: string | null; staff?: boolean } = {}): Promise<NewsColumnResponse> {
  const wanted = symbol?.toUpperCase();
  if (wanted && !NAMES.has(wanted)) return { stories: [], reserve: [], owned: [], read: {}, events: [], reason: `no listing called ${wanted}` };
  const now = Date.now();
  try {
    const [{ cards, read, judgedToday }, events, updatedAt] = await Promise.all([
      readCards({ sinceMs: now - (wanted ? LISTING_WINDOW_MS : RIVER_WINDOW_MS), symbol: wanted, staff }),
      readEvents(utcDay(now - FILING_SHOWN_MS), utcDay(now + 90 * DAY_MS)).catch(() => []),
      lastIngestAt().catch(() => undefined),
    ]);
    const mine = wanted ? cards.filter((card) => card.symbols.includes(wanted)) : cards;
    // Analysis is never left out, only ranked under what reports something.
    const ranked = [...mine.filter((card) => card.verdict !== "analysis"), ...mine.filter((card) => card.verdict === "analysis")];
    const visible = wanted ? SYMBOL_LIMIT : FEED_LIMIT;
    const river = riverOf(ranked, { limit: visible + (wanted ? SYMBOL_RESERVE : RESERVE), perSymbol: wanted ? SYMBOL_LIMIT : PER_SYMBOL_LIMIT });
    const perSymbol = new Map<string, number>();
    const owned = cards.filter((card) => {
      // By each listing's own reading (lib/news-stories forListing).
      const symbols = ownerNewsFor(card, now).filter((one) => (perSymbol.get(one) ?? 0) < OWNED_LIMIT);
      if (symbols.length === 0) return false;
      for (const one of symbols) perSymbol.set(one, (perSymbol.get(one) ?? 0) + 1);
      return true;
    });
    const payload: NewsColumnResponse = {
      stories: river.slice(0, visible),
      reserve: river.slice(visible),
      owned,
      read,
      events: eventCards(events),
      updatedAt,
    };
    if (judgedToday.read > 0) payload.judged = judgedToday;
    return payload;
  } catch (error) {
    // The database's own words stay in the server log, never in a public answer.
    console.warn("[news] column", error instanceof Error ? error.message : error);
    return { stories: [], reserve: [], owned: [], read: {}, events: [], reason: "store unavailable" };
  }
}

/* — on demand — */

/** Slots this instance has seen settled, so a settled slot costs no database read. */
const settledHere = new Set<string>();
const STALE_CLAIM_MS = 2 * 60 * 1000;
/** The function's own limit is 60 s; the run stops starting stages before it. */
const RUN_MS = 45_000;

/**
 * The column's first request in a New York slot claims that slot's ingest
 * and runs it after the answer is sent; `fresh` (the refresh button) claims
 * the slot's one refresh, only if the last ingest is a quarter hour old.
 * Production only (lib/news-schedule newsIngestAllowedHere).
 */
export async function requestIngest({ fresh = false, now = Date.now() }: { fresh?: boolean; now?: number } = {}): Promise<boolean> {
  if (!newsIngestAllowedHere()) return false;
  const slot = currentSlot(now).key;
  const claim = fresh ? `${slot}:refresh` : slot;
  if (settledHere.has(claim)) return false;
  try {
    if (await newsSlotSettled("ingest", claim, MAX_ATTEMPTS_PER_SLOT)) {
      settledHere.add(claim);
      return false;
    }
    if (fresh) {
      const last = await lastIngestAt();
      if (last !== undefined && now - last < REFRESH_AFTER_MS) return false;
    }
    const claimed = await claimNewsSlot("ingest", claim, now, {
      retryAfterMs: RETRY_AFTER_MS,
      staleMs: STALE_CLAIM_MS,
      maxAttempts: MAX_ATTEMPTS_PER_SLOT,
    });
    if (!claimed) return false;
  } catch (error) {
    console.warn("[news] slot claim", error instanceof Error ? error.message : error);
    return false;
  }
  after(() => runClaimed(claim, fresh ? "refresh" : "slot"));
  return true;
}

/** Runs one claimed ingest and finishes its slot, whatever throws. */
export async function runClaimed(claim: string, phase: IngestPhase): Promise<void> {
  let ok = false;
  let requests = 0;
  try {
    const summary = await ingestNews({
      phase,
      deadline: Date.now() + RUN_MS,
      deps: { gather: gatherPosts, mayFetchX: xFetchAllowedHere() },
    });
    requests = ["nasdaq", "edgar"].reduce((sum, key) => {
      const part = summary[key as "nasdaq" | "edgar"];
      return sum + ("requests" in part ? part.requests : 0);
    }, 0);
    // A run that found another holding the lease did nothing: its slot may try again.
    ok = !("skipped" in summary.nasdaq && summary.nasdaq.skipped === "another run holds the lease");
    console.info("[news] ingest", claim, JSON.stringify(summary));
  } catch (error) {
    console.warn("[news] ingest failed", claim, error instanceof Error ? error.message : error);
  } finally {
    await finishNewsSlot("ingest", claim, { ok, requests }).catch(() => undefined);
    if (ok) settledHere.add(claim);
  }
}

/** One listing's filings from the last week, newest first (EDGAR, public domain), for the MCP tools. */
export async function loadFilings(symbol: string, now = Date.now()): Promise<EventCard[]> {
  const events = await readEvents(utcDay(now - FILING_SHOWN_MS), utcDay(now));
  return eventCards(events).filter((event) => event.symbol === symbol);
}
