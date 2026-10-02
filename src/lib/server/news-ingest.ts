import { SEC_CIK_BY_SYMBOL, TOKEN_LISTINGS, type TokenListing } from "@/lib/listings";
import { looksLikeTickerList } from "@/lib/news";
import { worthIngesting } from "@/lib/news-fold";
import {
  JUDGE_VERSION,
  headlineNamesListing,
  headlineQuestions,
  headlineState,
  headlineVerdict,
  keepHeadline,
  verdictFor,
  type HeadlineAnswers,
} from "@/lib/news-judge";
import {
  EDGAR_SPACING_MS,
  INGEST_MAX_AGE_MS,
  KEEP_STORIES_MS,
  MARKETAUX_ARTICLES_PER_CALL,
  MARKETAUX_LOOKBACK_MS,
  MARKETAUX_OVERLAP_MS,
  MARKETAUX_PER_MINUTE,
  MARKETAUX_REQUESTS_PER_RUN,
  MARKETAUX_SYMBOLS_PER_CALL,
  dailyCap,
  marketauxFetches,
} from "@/lib/news-schedule";
import { utcDay } from "@/lib/x-schedule";
import { cachedVerdict, jevConfigured, type NoulQuestion } from "@/lib/server/jev";
import { fetchEdgar } from "@/lib/server/news-sources/edgar";
import { fetchMarketaux } from "@/lib/server/news-sources/marketaux";
import { fetchNasdaq } from "@/lib/server/news-sources/nasdaq";
import {
  addSource,
  insertStory,
  loadFoldIndex,
  readCursors,
  pruneNews,
  releadStories,
  releaseIngestLease,
  reserveNews,
  saveCursor,
  saveVerdicts,
  settleNews,
  storyTitles,
  takeIngestLease,
  unjudgedStories,
  upsertEvents,
  type FoldIndex,
  type IngestItem,
  type ListingEvent,
  type VerdictRow,
} from "@/lib/server/news-store";
import type { GatheredPosts } from "@/lib/server/x-column";
import type { XPost } from "@/lib/x-feed";

/**
 * One run of the news store's ingestion: every source asked once inside its
 * day's cap, every new item folded into its story, every new story judged
 * once by Jev, and old news pruned. Runs from the two crons (through
 * /api/cron/news, in its own function) and once per New York slot on demand
 * (lib/server/news-read). A source that fails costs its own items and
 * nothing else; the run reports it and goes on.
 *
 * Sources: Nasdaq's headline feeds, Marketaux's news API (David's Basic
 * plan, unless NEWS_MARKETAUX is "off"; a copy of a Nasdaq story folds into
 * it and never leads it, while a story only Marketaux carried is led by its
 * own item), X (its own fetch path, slots and cap untouched; this
 * only mirrors what the X column judged), and SEC EDGAR filings as dated
 * events. Finnhub stays off (no licence).
 *
 * Every dependency is passed in, so a test can run the whole thing against
 * PGlite with no network.
 */

/** The verdict versions the readers ask for: a headline's, and a post's (lib/news-judge). */
export const ARTICLE_VERSION = JUDGE_VERSION;
export const POST_VERSION = `post-${JUDGE_VERSION}`;
export const VERDICT_VERSIONS = [ARTICLE_VERSION, POST_VERSION] as const;

/** A headline question set is about this many input tokens (lib/server/jev, measured). */
export const TOKENS_PER_HEADLINE = 460;
/** At most this many story listings judged a run, newest first; the rest wait for the next run. */
export const JUDGE_PER_RUN = 160;
/** Near misses put to Jev a run, at most. */
export const NEAR_ASKS_PER_RUN = 12;
const SAME_FLOOR = 0.6;
const FOLD_VERSION = "fold-1";
const SAME_EVENT: { same: NoulQuestion } = {
  same: {
    type: "noul",
    instructions:
      "Do `first` and `second` report the same news event: the same announcement, deal, figure or statement, even if worded differently?",
    criteria: {
      true: "The same event, reported twice",
      false: "Different events, or one only comments on or follows from the other",
    },
  },
};

export type IngestPhase = "morning" | "evening" | "slot" | "refresh";

export type IngestDeps = {
  fetcher?: typeof fetch;
  /** The X column's gathering (lib/server/x-column gatherPosts); absent skips X. */
  gather?: (options: { mayFetch: boolean; fresh: boolean }) => Promise<GatheredPosts>;
  /** Whether X may be asked for new posts in this run (production only). */
  mayFetchX?: boolean;
  listings?: readonly TokenListing[];
  /** EDGAR is asked from these phases. */
  edgarPhases?: readonly IngestPhase[];
  sleep?: (ms: number) => Promise<void>;
};

export type IngestSummary = {
  phase: IngestPhase;
  nasdaq: { requests: number; items: number; added: number; folded: number } | { skipped: string };
  marketaux: { requests: number; items: number; added: number; folded: number } | { skipped: string };
  x: { stories: number; posts: number } | { skipped: string };
  edgar: { requests: number; events: number } | { skipped: string };
  judged: { asked: number; answered: number; kept: number } | { skipped: string };
  near: { asked: number; folded: number };
  pruned?: boolean;
  failures: string[];
  ms: number;
};

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const said = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A run that outlives this is taken to have died, and its lease can be taken. */
export const LEASE_MS = 90_000;
/**
 * Pruning runs after the deadline (it is the last stage) only while this
 * much of the function's time is left beyond it: a cron's run has 45 s to
 * its deadline inside a 60 s function.
 */
export const PRUNE_GRACE_MS = 8_000;

/**
 * One run. Holds the store's one ingest lease for its whole length, so two
 * runs (a cron and a slot, a slot and its refresh) never interleave; a run
 * that finds the lease held does nothing and says so. Each stage is its own
 * failure: a source or a write that fails is reported and the next stage
 * still runs. Every loop checks the deadline.
 */
export async function ingestNews({
  phase,
  now = Date.now(),
  deadline = now + 50_000,
  deps = {},
}: {
  phase: IngestPhase;
  now?: number;
  /** No new item, request or question is started after this. */
  deadline?: number;
  deps?: IngestDeps;
}): Promise<IngestSummary> {
  const started = Date.now();
  const skippedAll = (why: string): IngestSummary => ({
    phase,
    nasdaq: { skipped: why },
    marketaux: { skipped: why },
    x: { skipped: why },
    edgar: { skipped: why },
    judged: { skipped: why },
    near: { asked: 0, folded: 0 },
    failures: [],
    ms: Date.now() - started,
  });
  const leaseAt = Date.now();
  if (!(await takeIngestLease(leaseAt, LEASE_MS))) return skippedAll("another run holds the lease");
  try {
    return await run({ phase, now, deadline, deps, started });
  } finally {
    // Only this run's own lease: one overtaken after LEASE_MS frees nothing.
    await releaseIngestLease(leaseAt).catch(() => undefined);
  }
}

async function run({
  phase,
  now,
  deadline,
  deps,
  started,
}: {
  phase: IngestPhase;
  now: number;
  deadline: number;
  deps: IngestDeps;
  started: number;
}): Promise<IngestSummary> {
  const day = utcDay(now);
  const listings = deps.listings ?? TOKEN_LISTINGS;
  const failures: string[] = [];
  const near = { asked: 0, folded: 0 };
  const timeLeft = () => Date.now() < deadline;
  // As far back as anything is ingested, so an item seen before is always known.
  const index = await loadFoldIndex(now - INGEST_MAX_AGE_MS - 24 * 60 * 60 * 1000);
  const touched = new Set<number>();

  const fold = async (item: IngestItem): Promise<"known" | "added" | "folded"> => {
    if (index.has(item)) return "known";
    const match = index.match(item);
    if (match.kind === "same") {
      await addSource(match.storyId, item);
      index.remember(match.storyId, item);
      touched.add(match.storyId);
      return "folded";
    }
    if (match.kind === "near" && near.asked < NEAR_ASKS_PER_RUN && jevConfigured() && timeLeft()) {
      const titles = await storyTitles(match.storyIds.slice(0, 2));
      for (const [storyId, story] of titles) {
        if (near.asked >= NEAR_ASKS_PER_RUN) break;
        near.asked += 1;
        const pair = [`${story.publisher}: ${story.title}`, `${item.publisher}: ${item.title}`].sort();
        const answers = await cachedVerdict(FOLD_VERSION, { first: pair[0], second: pair[1] }, SAME_EVENT);
        if (answers && answers.same.noul >= SAME_FLOOR) {
          near.folded += 1;
          await addSource(storyId, item);
          index.remember(storyId, item);
          touched.add(storyId);
          return "folded";
        }
      }
    }
    const storyId = await insertStory(item);
    if (item.source === "x") index.postLed.add(storyId);
    index.remember(storyId, item);
    touched.add(storyId);
    return "added";
  };

  const stage = async <T>(name: string, work: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      failures.push(`${name}: ${said(error)}`);
      return fallback;
    }
  };

  // X is asked for new posts only from a reader's slot (lib/server/news-read),
  // never from a cron, so the crons never spend one of its slots.
  // Leads, publisher counts and listings are set once at the end for every
  // story the run touched (releadStories), not once per item.
  const x = deps.gather
    ? await stage("x", () => mirrorX(deps, phase, fold, index, failures, timeLeft, touched), { skipped: "failed" })
    : { skipped: "no gatherer" };

  const nasdaq = timeLeft()
    ? await stage("nasdaq", () => ingestNasdaq({ listings, day, now, fetcher: deps.fetcher, fold, failures, timeLeft }), { skipped: "failed" })
    : { skipped: "out of time" };

  // After Nasdaq, so its copies fold into the licensed story and never lead.
  const marketaux = !marketauxFetches()
    ? { skipped: "off" }
    : timeLeft()
      ? await stage("marketaux", () => ingestMarketaux({ listings, day, now, fetcher: deps.fetcher, fold, failures, timeLeft }), {
          skipped: "failed",
        })
      : { skipped: "out of time" };

  await stage("lead", () => releadStories(touched), undefined);
  touched.clear();

  const edgarPhases = deps.edgarPhases ?? ["morning", "evening", "slot"];
  const edgar = !edgarPhases.includes(phase)
    ? { skipped: `not in a ${phase} run` }
    : timeLeft()
      ? await stage(
          "edgar",
          () => ingestEdgar({ listings, day, now, fetcher: deps.fetcher, sleep: deps.sleep ?? sleepFor, failures, timeLeft }),
          { skipped: "failed" },
        )
      : { skipped: "out of time" };

  const judged = !jevConfigured()
    ? { skipped: "Jev not configured" }
    : timeLeft()
      ? await stage("judge", () => judgeNew({ now, listings, timeLeft }), { skipped: "failed" })
      : { skipped: "out of time" };

  let pruned: boolean | undefined;
  if (phase === "morning" || phase === "evening") {
    if (Date.now() < deadline + PRUNE_GRACE_MS) {
      pruned = await stage("prune", async () => {
        await pruneNews(now - KEEP_STORIES_MS, now - 8 * 24 * 60 * 60 * 1000);
        return true;
      }, false);
    } else {
      // The next cron phase prunes; nothing here is urgent.
      failures.push("prune: out of time, the next cron prunes");
      pruned = false;
    }
  }

  return { phase, nasdaq, marketaux, x, edgar, judged, near, pruned, failures, ms: Date.now() - started };
}

/* — Nasdaq — */

async function ingestNasdaq({
  listings,
  day,
  now,
  fetcher,
  fold,
  failures,
  timeLeft,
}: {
  listings: readonly TokenListing[];
  day: string;
  now: number;
  fetcher?: typeof fetch;
  fold: (item: IngestItem) => Promise<"known" | "added" | "folded">;
  failures: string[];
  timeLeft: () => boolean;
}): Promise<IngestSummary["nasdaq"]> {
  const cap = dailyCap("nasdaq");
  if (!(await reserveNews("nasdaq", day, listings.length, cap))) return { skipped: `day's cap of ${cap} reached` };
  let requests = 0;
  let items = 0;
  let added = 0;
  let folded = 0;
  try {
    const results = await Promise.allSettled(
      listings.map((listing) => {
        requests += 1;
        return fetchNasdaq(listing, fetcher);
      }),
    );
    const gathered: IngestItem[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") gathered.push(...result.value);
      else failures.push(`nasdaq: ${result.reason instanceof Error ? result.reason.message : "feed failed"}`);
    }
    // Oldest first, so the first copy of a story leads until a more primary one arrives.
    gathered.sort((a, b) => a.publishedAt - b.publishedAt);
    for (const item of gathered) {
      if (!timeLeft()) {
        failures.push("nasdaq: out of time, the rest wait for the next run");
        break;
      }
      if (!worthIngesting(item, now, INGEST_MAX_AGE_MS, looksLikeTickerList)) continue;
      items += 1;
      const outcome = await fold(item);
      if (outcome === "added") added += 1;
      if (outcome === "folded") folded += 1;
    }
  } finally {
    await settleNews("nasdaq", day, { reserved: listings.length, used: requests, requests }).catch(() => undefined);
  }
  return { requests, items, added, folded };
}

/* — Marketaux — */

/** One group's place in its window this run. */
type GroupAsk = {
  key: string;
  group: string[];
  since: number;
  /** Paging back: the next page's published_before. Absent: the newest page. */
  before?: number;
  /** The window's upper end: what `covered_to` becomes once its last page is in. */
  top: number;
  coveredTo?: number;
};

/**
 * Marketaux, four listings a request, newest first, twenty a page. Every
 * request is reserved before it is sent against the day's cap, the
 * minute's limit (news_budget, the minute as the key) and the run's share,
 * and the run stops at any of them or at the deadline.
 *
 * Each group asks only for what was published since it was last fully
 * heard (news_cursors, less a two hour overlap, a day at most). A full page
 * whose window holds more (meta.found) pages back with published_before set
 * to the oldest article returned, until the window is covered; only then
 * does the group's `covered_to` move. A run stopped on the way leaves the
 * cursor where it was, and the next run resumes it before asking anything
 * newer. A group whose request fails keeps its cursor too. The groups start
 * at a different one each hour, so a run stopped early never starves the
 * same listings.
 */
async function ingestMarketaux({
  listings,
  day,
  now,
  fetcher,
  fold,
  failures,
  timeLeft,
}: {
  listings: readonly TokenListing[];
  day: string;
  now: number;
  fetcher?: typeof fetch;
  fold: (item: IngestItem) => Promise<"known" | "added" | "folded">;
  failures: string[];
  timeLeft: () => boolean;
}): Promise<IngestSummary["marketaux"]> {
  const symbols = listings.filter((listing) => listing.kind === "stock").map((listing) => listing.symbol);
  const groups: string[][] = [];
  for (let start = 0; start < symbols.length; start += MARKETAUX_SYMBOLS_PER_CALL) {
    groups.push(symbols.slice(start, start + MARKETAUX_SYMBOLS_PER_CALL).sort());
  }
  if (groups.length === 0) return { skipped: "no listings" };
  const offset = Math.floor(now / (60 * 60 * 1000)) % groups.length;
  const ordered = [...groups.slice(offset), ...groups.slice(0, offset)];

  const askedAt = Date.now();
  const floor = now - MARKETAUX_LOOKBACK_MS;
  const cursors = await readCursors("marketaux", ordered.map((group) => group.join(",")));
  let active: GroupAsk[] = ordered.map((group) => {
    const key = group.join(",");
    const cursor = cursors.get(key) ?? {};
    const since = Math.max(floor, (cursor.coveredTo ?? 0) - MARKETAUX_OVERLAP_MS);
    const resuming = cursor.pagingTop !== undefined && cursor.pagingBefore !== undefined && cursor.pagingBefore > since;
    return resuming
      ? { key, group, since, before: cursor.pagingBefore, top: cursor.pagingTop!, coveredTo: cursor.coveredTo }
      : { key, group, since, top: askedAt, coveredTo: cursor.coveredTo };
  });

  const cap = dailyCap("marketaux");
  let dayReserved = 0;
  let requests = 0;
  const minutes = new Map<string, { reserved: number; sent: number }>();
  let items = 0;
  let added = 0;
  let folded = 0;
  let stopped: string | undefined;
  try {
    while (active.length > 0 && !stopped) {
      // One round: the next page of every group still open, reserved one by one, sent together.
      const round: GroupAsk[] = [];
      for (const ask of active) {
        if (requests + round.length >= MARKETAUX_REQUESTS_PER_RUN) stopped = `run's share of ${MARKETAUX_REQUESTS_PER_RUN} reached`;
        else if (!timeLeft()) stopped = "out of time";
        else if (!(await reserveNews("marketaux", day, 1, cap))) stopped = `day's cap of ${cap} reached`;
        if (stopped) break;
        dayReserved += 1;
        const minute = new Date().toISOString().slice(0, 16);
        if (!(await reserveNews("marketaux-minute", minute, 1, MARKETAUX_PER_MINUTE))) {
          stopped = "minute's limit reached";
          break;
        }
        const count = minutes.get(minute) ?? { reserved: 0, sent: 0 };
        count.reserved += 1;
        count.sent += 1;
        minutes.set(minute, count);
        round.push(ask);
      }
      // Stopped part way: the groups not reached this round still wait.
      const waiting = active.slice(round.length);
      if (round.length === 0) break;
      requests += round.length;
      const results = await Promise.allSettled(
        round.map((ask) => fetchMarketaux(ask.group, ask.since, { beforeMs: ask.before, fetcher })),
      );
      const next: GroupAsk[] = [];
      for (const [index, result] of results.entries()) {
        const ask = round[index];
        if (result.status === "rejected") {
          failures.push(`marketaux ${ask.key}: ${said(result.reason)}`);
          continue;
        }
        const page = result.value;
        let heard = true;
        for (const item of [...page.items].sort((a, b) => a.publishedAt - b.publishedAt)) {
          if (!timeLeft()) {
            heard = false;
            failures.push(`marketaux ${ask.key}: out of time, the rest wait for the next run`);
            break;
          }
          if (!worthIngesting(item, now, INGEST_MAX_AGE_MS, looksLikeTickerList)) continue;
          items += 1;
          const outcome = await fold(item);
          if (outcome === "added") added += 1;
          if (outcome === "folded") folded += 1;
        }
        // Not every item folded: ask this page again next run.
        if (!heard) continue;
        const full = page.returned >= MARKETAUX_ARTICLES_PER_CALL && page.found > page.returned && page.oldestAt !== undefined;
        // A second past the oldest, so one stamped the same second is not lost; never later than this page's own bound.
        // Whole seconds, as Marketaux reads a time.
        let before = full ? Math.floor(page.oldestAt! / 1000) * 1000 + 1000 : undefined;
        if (before !== undefined && ask.before !== undefined && before >= ask.before) before = ask.before - 1000;
        if (before !== undefined && before > ask.since) {
          await saveCursor("marketaux", ask.key, { coveredTo: ask.coveredTo, pagingTop: ask.top, pagingBefore: before });
          next.push({ ...ask, before });
          continue;
        }
        // The window is covered.
        await saveCursor("marketaux", ask.key, { coveredTo: ask.top });
        // A resumed window ended before this run began: what came since is next.
        if (ask.top < askedAt) next.push({ ...ask, since: Math.max(floor, ask.top - MARKETAUX_OVERLAP_MS), before: undefined, top: askedAt, coveredTo: ask.top });
      }
      active = [...next, ...waiting];
    }
    if (stopped && active.length > 0) failures.push(`marketaux: ${stopped}, ${active.length} of ${ordered.length} groups wait`);
  } finally {
    await settleNews("marketaux", day, { reserved: dayReserved, used: requests, requests }).catch(() => undefined);
    for (const [minute, count] of minutes) {
      await settleNews("marketaux-minute", minute, { reserved: count.reserved, used: count.sent, requests: count.sent }).catch(() => undefined);
    }
  }
  if (requests === 0) return { skipped: stopped ?? "nothing to ask" };
  return { requests, items, added, folded };
}

/* — EDGAR — */

async function ingestEdgar({
  listings,
  day,
  now,
  fetcher,
  sleep,
  failures,
  timeLeft,
}: {
  listings: readonly TokenListing[];
  day: string;
  now: number;
  fetcher?: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  failures: string[];
  timeLeft: () => boolean;
}): Promise<IngestSummary["edgar"]> {
  const companies = listings.filter((listing) => SEC_CIK_BY_SYMBOL[listing.symbol]);
  const cap = dailyCap("edgar");
  if (!(await reserveNews("edgar", day, companies.length, cap))) return { skipped: `day's cap of ${cap} reached` };
  const since = utcDay(now - 14 * 24 * 60 * 60 * 1000);
  const events: ListingEvent[] = [];
  let requests = 0;
  try {
    for (const listing of companies) {
      if (!timeLeft()) break;
      if (requests > 0) await sleep(EDGAR_SPACING_MS);
      requests += 1;
      try {
        events.push(...(await fetchEdgar(listing.symbol, since, fetcher)));
      } catch (error) {
        failures.push(`edgar ${listing.symbol}: ${said(error)}`);
      }
    }
    await upsertEvents(events);
  } finally {
    await settleNews("edgar", day, { reserved: companies.length, used: requests, requests }).catch(() => undefined);
  }
  return { requests, events: events.length };
}

/* — Jev, once per story and listing — */

/** Questions asked at once; the deadline is checked between batches. */
const JUDGE_BATCH = 24;

async function judgeNew({
  now,
  listings,
  timeLeft,
}: {
  now: number;
  listings: readonly TokenListing[];
  timeLeft: () => boolean;
}): Promise<IngestSummary["judged"]> {
  const names = new Map(listings.map((listing) => [listing.symbol, listing.name]));
  const pending = (await unjudgedStories(ARTICLE_VERSION, now - INGEST_MAX_AGE_MS, JUDGE_PER_RUN)).filter((row) =>
    names.has(row.symbol),
  );
  const questions = headlineQuestions();
  let asked = 0;
  let answered = 0;
  let kept = 0;
  // Each question is paid for out of the day's token cap as it is asked
  // (lib/server/jev cachedVerdict); past the cap the rest wait unjudged.
  for (let start = 0; start < pending.length && timeLeft(); start += JUDGE_BATCH) {
    const batch = pending.slice(start, start + JUDGE_BATCH);
    asked += batch.length;
    const verdicts: VerdictRow[] = [];
    await Promise.all(
      batch.map(async (row) => {
        const answers = (await cachedVerdict(
          ARTICLE_VERSION,
          headlineState({ title: row.title, source: row.publisher }, row.symbol, names.get(row.symbol)!),
          questions,
        )) as HeadlineAnswers | undefined;
        if (!answers) return;
        answered += 1;
        const keep = keepHeadline(answers, headlineNamesListing(row.title, row.symbol));
        if (keep) kept += 1;
        verdicts.push({
          storyId: row.storyId,
          symbol: row.symbol,
          version: ARTICLE_VERSION,
          about: answers.about.noul,
          substance: answers.substance.score,
          verdict: headlineVerdict(answers),
          kept: keep,
          tokens: TOKENS_PER_HEADLINE,
        });
      }),
    );
    await saveVerdicts(verdicts);
  }
  if (answered < pending.length) console.warn(`[news] judged ${answered} of ${pending.length}, the rest wait`);
  return { asked, answered, kept };
}

/* — X, mirrored — */

/** The X post id at the end of a post's link. */
export function postIdOf(url: string): string | undefined {
  return url.match(/\/status\/(\d+)/)?.[1];
}

function postItem(post: XPost, primary: boolean): IngestItem {
  return {
    source: "x",
    sourceId: post.id,
    title: post.text,
    url: post.url,
    publisher: post.author.name,
    publishedAt: post.publishedAt,
    symbols: post.symbol ? [post.symbol] : [],
    taggedBy: "jev",
    primary,
    raw: {
      author: post.author,
      likes: post.likes,
      retweets: post.retweets,
      quotes: post.quotes,
      replies: post.replies,
    },
  };
}

/**
 * What the X column judged, into the store: each kept post (and the copies
 * story-groups folded into it) as a story with its verdict, and each post
 * Jev read and dropped as a story kept false, so the store's counts are
 * true. X itself is asked only as the column always asked it.
 */
async function mirrorX(
  deps: IngestDeps,
  phase: IngestPhase,
  fold: (item: IngestItem) => Promise<"known" | "added" | "folded">,
  index: FoldIndex,
  failures: string[],
  timeLeft: () => boolean,
  touched: Set<number>,
): Promise<IngestSummary["x"]> {
  const fromReader = phase === "slot" || phase === "refresh";
  const gathered = await deps.gather!({ mayFetch: fromReader && deps.mayFetchX === true, fresh: phase === "refresh" });
  failures.push(...gathered.failures.map((failure) => `x: ${failure}`));
  let stories = 0;
  let posts = 0;
  const company = gathered.companyIds ?? new Set<string>();
  const keptVerdicts: VerdictRow[] = [];
  for (const post of gathered.posts) {
    if (!timeLeft()) break;
    if (!post.symbol) continue;
    const item = postItem(post, company.has(post.id));
    const outcome = await fold(item);
    posts += 1;
    const storyId = index.known.get(`x:${post.id}`);
    if (storyId === undefined) continue;
    if (outcome === "added") stories += 1;
    for (const other of post.alsoBy ?? []) {
      const id = postIdOf(other.url);
      if (!id || index.has({ source: "x", sourceId: id })) continue;
      const copy: IngestItem = {
        ...item,
        sourceId: id,
        url: other.url,
        publisher: other.name,
        primary: false,
        raw: { author: { name: other.name, username: other.username } },
      };
      await addSource(storyId, copy);
      index.remember(storyId, copy);
      touched.add(storyId);
      posts += 1;
    }
    // A post's own reading belongs only to a story it leads; folded into an
    // article's story, the article's verdict stands. Written every run, so a
    // post once dropped and now kept reads as kept.
    if (!index.postLed.has(storyId)) continue;
    const weight = gathered.substance?.get(post.id);
    keptVerdicts.push({
      storyId,
      symbol: post.symbol,
      version: POST_VERSION,
      about: null,
      substance: weight === undefined ? null : Math.round(((weight - 0.4) / 0.3) * 100) / 100,
      verdict: weight === undefined ? null : verdictFor(weight),
      kept: true,
    });
  }
  await saveVerdicts(keptVerdicts);
  const droppedVerdicts: VerdictRow[] = [];
  for (const post of gathered.dropped ?? []) {
    if (!timeLeft()) break;
    if (!post.symbol) continue;
    const item = postItem(post, company.has(post.id));
    if (index.has(item)) continue;
    // Its own story, never folded into: a dropped post must not lead anything.
    const storyId = await insertStory(item);
    index.known.set(`x:${post.id}`, storyId);
    touched.add(storyId);
    droppedVerdicts.push({ storyId, symbol: post.symbol, version: POST_VERSION, about: null, substance: null, verdict: null, kept: false });
  }
  // Never over a kept reading.
  await saveVerdicts(droppedVerdicts, { replace: false });
  return { stories, posts };
}
