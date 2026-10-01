import { dailyPostCap, xFetchAllowedHere } from "@/lib/x-schedule";
import { refreshIfDue, type XJob, type XSearch } from "@/lib/server/x-refresh";
import { lastFetchedAt, readStoredPosts, type StoredTweet, type XUser } from "@/lib/server/x-store";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { decodeEntities } from "@/lib/news";
import {
  JUDGE_VERSION,
  postQuestions,
  postState,
  readPostAnswers,
  type PostAnswers,
} from "@/lib/news-judge";
import { cachedVerdict, cachedVerdictsOnly, jevConfigured } from "@/lib/server/jev";
import { foldStories } from "@/lib/server/story-groups";
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
 * The token never reaches the browser, and neither does the bill. The
 * posts live in the database (lib/server/x-store); every reader (the
 * column, the moves, the nudge, the MCP tools) reads them from there, and
 * only the column's own route may ask X for more, at most once per slot of
 * lib/x-schedule for everyone, each query asking only for what is newer than
 * the last post it saw, inside a hard daily cap on posts read. The rules,
 * and the bill that shaped them, are argued in lib/x-schedule.
 *
 * Each fetch asks X for the most relevant new posts (`sort_order=relevancy`
 * with `since_id`), ten a query: the ones that travelled furthest, rather
 * than the last ten a busy desk happened to post.
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

type SearchResponse = {
  data?: Omit<StoredTweet, "author">[];
  includes?: { users?: XUser[] };
  errors?: { detail?: string; title?: string }[];
  title?: string;
  detail?: string;
};

const search: XSearch = async (query, { sinceId, maxResults }) => {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) throw new Error("X_BEARER_TOKEN not set");

  const url = new URL(X_SEARCH);
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", String(maxResults));
  url.searchParams.set("sort_order", "relevancy");
  if (sinceId) url.searchParams.set("since_id", sinceId);
  url.searchParams.set("tweet.fields", "created_at,public_metrics");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "name,username,profile_image_url");

  // Never Next's fetch cache: what was read is kept in the database, and an
  // age-based second cache is what once served stale posts.
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
};

/** The queries, each under a stable key its `since_id` is kept by. */
export function searchJobs(): XJob[] {
  return [
    { key: "company", tier: "company", query: buildCompanyQuery() },
    ...buildPressQueries().map((query, index) => ({ key: `press-${index}`, tier: "press" as const, query })),
  ];
}

/**
 * One search result as a card, or nothing if it cannot be shown at all.
 *
 * A press post the keywords could not place is still returned, with an empty
 * `symbol`, when Jev is there to place it; `owned` is what a company account
 * may be placed among.
 */
type Candidate = { post: XPost; tier: "company" | "press"; owned?: readonly string[] };

function toCandidate(
  tweet: StoredTweet,
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
 * how many posts from the last five days are kept, `read` is how many of those Jev
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
 * The column's posts, from the database. `mayFetch` is the column's own
 * route only: it lets this request make the slot's fetch when it is due,
 * and `fresh` (the refresh button) one more, inside the day's cap.
 */
export async function gatherPosts({
  fresh = false,
  mayFetch = false,
}: { fresh?: boolean; mayFetch?: boolean } = {}): Promise<GatheredPosts> {
  const now = Date.now();
  const failures: string[] = [];
  // Anywhere but production reads what production fetched (lib/x-schedule).
  if (mayFetch && process.env.X_BEARER_TOKEN && xFetchAllowedHere()) {
    try {
      const jobs = searchJobs();
      const cap = dailyPostCap();
      const slot = await refreshIfDue({ now, jobs, search, cap });
      failures.push(...slot.failures);
      if (fresh && slot.requests === 0) {
        failures.push(...(await refreshIfDue({ now, jobs, search, cap, fresh: true })).failures);
      }
    } catch (error) {
      // The store is down or X is: say so to the console, show what is kept.
      console.warn("[x-column] refresh", error instanceof Error ? error.message : error);
    }
  }

  let stored: Awaited<ReturnType<typeof readStoredPosts>>;
  let updatedAt: number | undefined;
  try {
    [stored, updatedAt] = await Promise.all([readStoredPosts(now - MAX_AGE_MS), lastFetchedAt()]);
  } catch (error) {
    const said = error instanceof Error ? error.message : "store unavailable";
    return { posts: [], substance: undefined, failures: [...failures, said], curation: undefined, updatedAt: undefined };
  }

  const canJudge = jevConfigured();
  const candidates: Candidate[] = [];
  const authors = new Set<string>();
  for (const { tweet, tier } of stored) {
    const author = tweet.author?.username;
    if (author) authors.add(author.toLowerCase());
    const candidate = toCandidate(tweet, tier, canJudge);
    if (candidate) candidates.push(candidate);
  }

  if (!canJudge) {
    const folded = await foldStories(
      candidates.map((candidate) => candidate.post),
      undefined,
    );
    return { posts: folded.posts, substance: undefined, failures, curation: undefined, updatedAt };
  }
  const asked = shortlist(candidates, now);
  const judged = await judge(asked);
  const { read, kept } = judged;
  // One copy of each story (lib/story-groups), after Jev's reading so the
  // pairs it is asked about are only ever posts it kept.
  const { posts, substance, folded } = await foldStories(judged.posts, judged.substance);
  // One line per fetch rather than per read: the reads are many and cost nothing.
  const missing = asked.length - read;
  // A cache-only read (the first look) asked nothing: its misses are not "unanswered".
  if ((mayFetch || missing > 0) && !cachedVerdictsOnly()) {
    (missing > 0 ? console.warn : console.info)(
      `[jev] x-column: asked ${asked.length}, answered ${read}, kept ${kept}, folded ${folded}${missing > 0 ? `, ${missing} unanswered shown by keywords` : ""}`,
    );
  }
  // No line at all when Jev answered for nothing: "read 0, kept 40" would be
  // the keyword rules wearing Jev's name.
  const curation =
    read > 0 ? { seen: stored.length, accounts: authors.size, read, kept } : undefined;
  return { posts, substance, failures, curation, updatedAt };
}
