import { AsyncLocalStorage } from "node:async_hooks";
import { unstable_cache } from "next/cache";
import {
  RECENT_WINDOW_MS,
  WEEK_WINDOW_MS,
  mergeById,
  refreshSlot,
  refreshSlotsSoFar,
  slotOf,
} from "@/lib/feed-refresh";
import {
  HOLD_MS,
  dedupeStore,
  firstKept,
  readLayer,
  type Layer as StoredLayer,
  type LayerStore,
} from "@/lib/layer-cache";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { decodeEntities } from "@/lib/news";
import {
  JUDGE_VERSION,
  postQuestions,
  postState,
  readPostAnswers,
  type PostAnswers,
} from "@/lib/news-judge";
import { cachedVerdict, jevConfigured } from "@/lib/server/jev";
import {
  COMPANY_SOURCES,
  MAX_AGE_MS,
  authorBaselines,
  avatarAt,
  buildCompanyQuery,
  buildPressQueries,
  looksEmpty,
  looksPromotional,
  newsScore,
  postUrl,
  stripLinks,
  symbolsForText,
  type XPost,
} from "@/lib/x-feed";

/**
 * The X column's server half: searching, placing and judging. The route in
 * app/api/listing-x ranks what this gathers; lib/server/nudge reads it too.
 *
 * What is being said on X about the listings, newest first.
 *
 * The token never reaches the browser: every request is made here, and the
 * result is cached, so one pair of queries serves every visitor.
 *
 * Two sorts of the same four queries (the 512-character limit splits the
 * company tier from thirty press accounts, which themselves split three
 * ways), each on its own clock (lib/feed-refresh):
 *
 * - The week's best, `sort_order=relevancy`, every six hours. Recent search
 *   reaches back seven days, so this is what keeps yesterday's big story in
 *   reach. Until 2026-09-29 it was the only fetch, hourly, and the column
 *   showed the same week's best for days: the top two cards David saw were
 *   33 and 36 hours old and the rotation reached back six days.
 * - The newest, `sort_order=recency` over the last two days, every half
 *   hour. This is what makes the column this morning's.
 * - A refresh from the column's button: only what arrived since the newest
 *   fetch (`start_time`), at most once per five minutes for everyone.
 *
 * Merged by id, the later copy's counts winning, then judged and ranked as
 * one set. The ceiling, reached only if someone opens the column in every
 * slot of every day: 16 week requests and 192 recent ones a day, at most
 * 20,800 posts, about 645,000 a month against the three million cap; a
 * refresh adds at most 1,152 requests a day (450 per fifteen minutes is the
 * rate limit) and returns only new posts. Nothing is fetched in a slot
 * nobody opens.
 *
 * Which accounts, and why not a cashtag search, is argued in lib/x-feed.
 *
 * Then Jev reads what survives the keyword rules (lib/news-judge): it drops
 * the ads and the empty roundups the regexes miss, places a post the keywords
 * could not ("OPEC agrees a deeper cut" is the oil fund's), and its reading
 * of substance replaces the regex guess in the ranking. Only the posts that
 * could reach a card are asked about, and each verdict is cached for two
 * weeks, so a refresh pays for what is new since the last one. With no key,
 * no credit or a slow answer, the column is exactly what it was before.
 *
 * Always 200: a quiet hour, an expired token and a rate limit all reach the
 * reader as the same calm line, because none of them is something a reader
 * can act on. The console gets the reason.
 */

const X_SEARCH = "https://api.x.com/2/tweets/search/recent";
/** How far back the recent layer reaches; older posts need the week layer's strength. */
const RECENT_REACH_MS = 48 * 60 * 60 * 1000;
/** Bump when a layer's shape or its queries change, so old slots are not read back. */
const LAYER_VERSION = "layers-1";

/** The most one request may return, since the call costs the same either way. */
const MAX_RESULTS = 100;



type SearchUser = {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
};

type SearchTweet = {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  public_metrics?: {
    like_count?: number;
    retweet_count?: number;
    quote_count?: number;
    reply_count?: number;
  };
};

type SearchResponse = {
  data?: SearchTweet[];
  includes?: { users?: SearchUser[] };
  errors?: { detail?: string; title?: string }[];
  title?: string;
  detail?: string;
};

export const NAME_BY_SYMBOL: ReadonlyMap<string, string> = new Map(
  TOKEN_LISTINGS.map((listing) => [listing.symbol, listing.name]),
);

/** Which listing an account speaks for, read from the post when it is one of several. */
const SYMBOLS_BY_ACCOUNT = new Map(
  COMPANY_SOURCES.map((source) => [
    source.username.toLowerCase(),
    source.symbols,
  ]),
);

type Tweet = SearchTweet & { author?: SearchUser };

async function search(
  query: string,
  sort: "relevancy" | "recency",
  startTime?: number,
): Promise<Tweet[]> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) throw new Error("X_BEARER_TOKEN not set");

  const url = new URL(X_SEARCH);
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", String(MAX_RESULTS));
  url.searchParams.set("sort_order", sort);
  if (startTime !== undefined) {
    // X wants whole seconds, and nothing inside the last ten.
    const when = Math.min(startTime, Date.now() - 15_000);
    url.searchParams.set("start_time", new Date(when).toISOString().replace(/\.\d{3}Z$/, "Z"));
  }
  url.searchParams.set("tweet.fields", "created_at,public_metrics");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "name,username,profile_image_url");

  // Never Next's fetch cache: every call here is already inside a slot's
  // cache entry, and a second, age-based cache is what served stale posts.
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const payload = (await response.json().catch(() => ({}))) as SearchResponse;
  if (!response.ok) {
    const said = payload.detail ?? payload.title ?? `answered ${response.status}`;
    throw new Error(`X ${said}`);
  }

  const users = new Map(
    (payload.includes?.users ?? []).map((user) => [user.id, user]),
  );
  // Carried on the tweet so placement and shaping can stay one pass.
  return (payload.data ?? []).map((tweet) => ({
    ...tweet,
    author: tweet.author_id ? users.get(tweet.author_id) : undefined,
  }));
}

type Job = { tier: "company" | "press"; query: string };

function searchJobs(): Job[] {
  return [
    { tier: "company", query: buildCompanyQuery() },
    ...buildPressQueries().map((query) => ({ tier: "press" as const, query })),
  ];
}

/** One fetch of every query: per job, its posts or why it failed. */
type Layer = StoredLayer<{ tweets: Tweet[] }>;

async function fetchLayer(
  name: string,
  sort: "relevancy" | "recency",
  startTime: number | undefined,
): Promise<Layer> {
  const jobs = searchJobs();
  const fetchedAt = Date.now();
  const settled = await Promise.allSettled(jobs.map((job) => search(job.query, sort, startTime)));
  const results = settled.map((result): Layer["results"][number] =>
    result.status === "fulfilled"
      ? { tweets: result.value }
      : { error: result.reason instanceof Error ? result.reason.message : "X request failed" },
  );
  // One line per real call to X, so the budget can be read off the logs.
  const spans = results.map((result, index) => {
    if (!("tweets" in result)) return `${jobs[index].tier}:failed`;
    const oldest = Math.min(...result.tweets.map((tweet) => Date.parse(tweet.created_at ?? "") || fetchedAt));
    const hours = result.tweets.length ? ((fetchedAt - oldest) / 3_600_000).toFixed(1) : "0";
    return `${jobs[index].tier}:${result.tweets.length}/${hours}h`;
  });
  console.info(`[x-column] X ${name}: ${jobs.length} requests, ${spans.join(" ")}`);
  // Nothing at all came back: do not keep that for the whole slot.
  if (results.every((result) => "error" in result)) {
    throw new Error(results.map((result) => ("error" in result ? result.error : "")).join("; "));
  }
  return { fetchedAt, results };
}

/**
 * Next's data cache as a LayerStore (lib/layer-cache), so an entry can be
 * peeked without fetching. `unstable_cache` keys on its callback's source as
 * well as the key parts, so every read and write goes through the one
 * callback below, and what it runs comes from the request's async context: a
 * peek runs nothing and throws, which `unstable_cache` never keeps, and a
 * put runs its load, which it keeps. Entries outlive their slot (three
 * windows) so the previous slot is still there to fall back on.
 */
class NotKept extends Error {}
const pending = new AsyncLocalStorage<(() => Promise<unknown>) | undefined>();
async function runPending(): Promise<unknown> {
  const load = pending.getStore();
  if (!load) throw new NotKept();
  return load();
}
function dataCacheStore(ttlFor: (key: string[]) => number): LayerStore {
  const read = <T,>(key: string[], ttlMs: number, load: (() => Promise<unknown>) | undefined) =>
    pending.run(load, () =>
      unstable_cache(runPending, ["x-column", LAYER_VERSION, ...key], {
        revalidate: Math.ceil(ttlMs / 1000),
      })(),
    ) as Promise<T>;
  return {
    peek: <T,>(key: string[]) =>
      read<T>(key, ttlFor(key), undefined).catch((error) => {
        if (error instanceof NotKept) return undefined;
        throw error;
      }),
    put: <T,>(key: string[], ttlMs: number, load: () => Promise<T>) => read<T>(key, ttlMs, load),
  };
}

/** How long each kind of entry is kept: three of its windows, or the hold's own. */
function ttlFor(key: string[]): number {
  if (key[0] === "held") return HOLD_MS * 2;
  if (key[0] === "week") return WEEK_WINDOW_MS * 3;
  return RECENT_WINDOW_MS * 3;
}

const store = dedupeStore(dataCacheStore(ttlFor));

/**
 * One search result as a card, or nothing if it cannot be shown at all.
 *
 * A press post the keywords could not place is still returned, with an empty
 * `symbol`, when Jev is there to place it; `owned` is what a company account
 * may be placed among.
 */
type Candidate = { post: XPost; tier: "company" | "press"; owned?: readonly string[] };

function toCandidate(
  tweet: SearchTweet & { author?: SearchUser },
  tier: "company" | "press",
  canJudge: boolean,
): Candidate | undefined {
  const author = tweet.author;
  if (!author?.username || !author.profile_image_url) return undefined;
  const publishedAt = tweet.created_at ? Date.parse(tweet.created_at) : Number.NaN;
  if (!Number.isFinite(publishedAt)) return undefined;
  if (looksPromotional(tweet.text) || looksEmpty(tweet.text)) return undefined;


  const text = stripLinks(decodeEntities(tweet.text));
  if (!text) return undefined;
  const mentioned = symbolsForText(text);
  let symbol: string | undefined;
  let owned: readonly string[] | undefined;
  if (tier === "company") {
    owned = SYMBOLS_BY_ACCOUNT.get(author.username.toLowerCase()) ?? [];
    // An issuer speaking for two of our funds is placed by what it said.
    symbol = owned.find((candidate) => mentioned.includes(candidate)) ?? owned[0];
  } else {
    // Without Jev, a wire is only ever about a listing if it named one.
    symbol = mentioned[0];
  }
  if (!symbol && !canJudge) return undefined;
  const name = symbol ? NAME_BY_SYMBOL.get(symbol) : undefined;
  if (symbol && !name) return undefined;

  const post: XPost = {
    id: tweet.id,
    text,
    publishedAt,
    author: {
      name: author.name,
      username: author.username,
      avatarUrl: avatarAt(author.profile_image_url),
    },
    url: postUrl(author.username, tweet.id),
    likes: tweet.public_metrics?.like_count ?? 0,
    retweets: tweet.public_metrics?.retweet_count ?? 0,
    quotes: tweet.public_metrics?.quote_count ?? 0,
    replies: tweet.public_metrics?.reply_count ?? 0,
    symbol: symbol ?? "",
    name: name ?? "",
  };
  return { post, tier, owned };
}

/**
 * How many per listing are worth asking Jev about, and how many unplaced
 * wire posts besides. A column shows at most eight of one name, so the ninth
 * best by the free heuristic was never going to be read.
 */
const JUDGE_PER_SYMBOL = 8;
const JUDGE_UNPLACED = 30;

function shortlist(candidates: readonly Candidate[], now: number): Candidate[] {
  const baselines = authorBaselines(candidates.map((candidate) => candidate.post));
  // Nothing past the oldest a card may be is worth a question.
  const ranked = candidates.filter(({ post }) => now - post.publishedAt <= MAX_AGE_MS).sort(
    (a, b) => newsScore(b.post, baselines, now) - newsScore(a.post, baselines, now),
  );
  const counts = new Map<string, number>();
  return ranked.filter(({ post }) => {
    const key = post.symbol || "";
    const count = counts.get(key) ?? 0;
    if (count >= (key ? JUDGE_PER_SYMBOL : JUDGE_UNPLACED)) return false;
    counts.set(key, count + 1);
    return true;
  });
}

/**
 * Jev's pass over the shortlist: what to drop, where to place, how to weigh.
 * A post Jev did not answer for keeps its keyword placement, or goes if it
 * had none.
 */
async function judge(
  candidates: readonly Candidate[],
): Promise<{ posts: XPost[]; substance: Map<string, number>; read: number; kept: number }> {
  const questions = postQuestions();
  const substance = new Map<string, number>();
  let read = 0;
  let kept = 0;
  const judged = await Promise.all(
    candidates.map(async (candidate) => {
      const answers = (await cachedVerdict(
        JUDGE_VERSION,
        postState(candidate.post),
        questions,
      )) as PostAnswers | undefined;
      if (!answers) return candidate.post.symbol ? candidate.post : undefined;
      read += 1;
      const verdict = readPostAnswers(answers, candidate.tier, candidate.owned);
      if (!verdict.keep) return undefined;
      const symbol = verdict.symbol ?? candidate.post.symbol;
      const name = symbol ? NAME_BY_SYMBOL.get(symbol) : undefined;
      if (!symbol || !name) return undefined;
      substance.set(candidate.post.id, verdict.weight);
      kept += 1;
      return { ...candidate.post, symbol, name };
    }),
  );
  return {
    posts: judged.filter((post): post is XPost => post !== undefined),
    substance,
    read,
    kept,
  };
}

/**
 * Every judged post the searches returned this refresh, placed and, where Jev
 * answered, weighted. Unranked: the column and the nudge each rank for
 * themselves. Judged over the whole feed rather than per listing, so a
 * listing's own page, the column and the nudge share one set of verdicts.
 */
/**
 * What this refresh looked at, for the column's "Curated by Jev" line. Every
 * figure is a count of something that happened, never an estimate: `seen` is
 * what X returned across the week's window, `read` is how many of those Jev
 * actually answered for (the shortlist, not the lot), `kept` is what survived.
 */
export type Curation = { seen: number; accounts: number; read: number; kept: number };

/** What one gathering of the X column returns; callers that need it twice pass it along. */
export type GatheredPosts = {
  posts: XPost[];
  substance: Map<string, number> | undefined;
  failures: string[];
  curation: Curation | undefined;
  /** When the newest of the fetches behind this was made, epoch ms. */
  updatedAt: number | undefined;
};

/**
 * The column's posts, from the week layer, the recent layer and, when
 * `fresh` asks and the throttle allows, a refresh since the recent layer.
 */
export async function gatherPosts({ fresh = false }: { fresh?: boolean } = {}): Promise<GatheredPosts> {
  const now = Date.now();
  const weekSlot = slotOf(now, WEEK_WINDOW_MS);
  const recentSlot = slotOf(now, RECENT_WINDOW_MS);
  const [week, recent] = await Promise.all([
    readLayer({
      store,
      key: ["week", String(weekSlot)],
      ttlMs: ttlFor(["week"]),
      now,
      fetch: () => fetchLayer("week", "relevancy", undefined),
      previous: [["week", String(weekSlot - 1)]],
    }),
    readLayer({
      store,
      key: ["recent", String(recentSlot)],
      ttlMs: ttlFor(["recent"]),
      now,
      fetch: () => fetchLayer("recent", "recency", recentSlot * RECENT_WINDOW_MS - RECENT_REACH_MS),
      previous: [["recent", String(recentSlot - 1)], ["recent", String(recentSlot - 2)]],
    }),
  ]);
  const layers: (Layer | { failed: string })[] = [week, recent];
  const recentAt = "failed" in recent ? undefined : recent.fetchedAt;
  const refreshKey = (slot: number) => ["refresh", String(recentSlot), String(slot)];
  const refresh = refreshSlot({ now, fresh, recentFetchedAt: recentAt });
  if (refresh !== undefined) {
    // A minute's overlap, so a post made while the recent layer was being
    // fetched is not missed; the merge drops the doubles.
    const since = (recentAt ?? now - RECENT_WINDOW_MS) - 60_000;
    layers.push(
      await readLayer({
        store,
        key: refreshKey(refresh),
        ttlMs: ttlFor(["refresh"]),
        now,
        fetch: () => fetchLayer("refresh", "recency", since),
      }),
    );
  } else {
    // Whoever pressed last, everyone reads: the column's poll, the nudge,
    // the moves and the MCP tools. A peek per slot so far, never a fetch.
    const latest = await firstKept<{ tweets: Tweet[] }>(store, refreshSlotsSoFar(now).map(refreshKey));
    if (latest) layers.push(latest);
  }

  const jobs = searchJobs();
  const failures: string[] = [];
  const perJob = jobs.map(() => [] as Tweet[][]);
  for (const layer of layers) {
    if ("failed" in layer) {
      failures.push(layer.failed);
      continue;
    }
    layer.results.forEach((result, index) => {
      if ("error" in result) failures.push(result.error);
      else perJob[index]?.push(result.tweets);
    });
  }
  const fetched = layers.flatMap((layer) => ("failed" in layer ? [] : [layer.fetchedAt]));
  const updatedAt = fetched.length ? Math.max(...fetched) : undefined;

  const canJudge = jevConfigured();
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const authors = new Set<string>();
  perJob.forEach((tweetLayers, index) => {
    for (const tweet of mergeById(tweetLayers)) {
      // The same post comes back from more than one press query.
      if (seen.has(tweet.id)) continue;
      seen.add(tweet.id);
      const author = tweet.author?.username;
      if (author) authors.add(author.toLowerCase());
      const candidate = toCandidate(tweet, jobs[index].tier, canJudge);
      if (candidate) candidates.push(candidate);
    }
  });

  if (!canJudge) {
    return {
      posts: candidates.map((candidate) => candidate.post),
      substance: undefined,
      failures,
      curation: undefined,
      updatedAt,
    };
  }
  const { posts, substance, read, kept } = await judge(shortlist(candidates, now));
  // No line at all when Jev answered for nothing: "read 0, kept 40" would be
  // the keyword rules wearing Jev's name.
  const curation =
    read > 0 ? { seen: seen.size, accounts: authors.size, read, kept } : undefined;
  return { posts, substance, failures, curation, updatedAt };
}
