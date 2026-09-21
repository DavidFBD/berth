import { TOKEN_LISTINGS } from "@/lib/listings";
import { decodeEntities } from "@/lib/news";
import {
  COMPANY_SOURCES,
  avatarAt,
  buildCompanyQuery,
  buildPressQueries,
  looksEmpty,
  looksPromotional,
  postUrl,
  rankPosts,
  symbolsForText,
  type XPost,
} from "@/lib/x-feed";

/**
 * What is being said on X about the listings, newest first.
 *
 * The token never reaches the browser: every request is made here, and the
 * result is cached, so one pair of queries serves every visitor.
 *
 * The budget, which is the point. Two queries per refresh (the 512-character
 * limit forbids one), six hours apart, is eight calls a day: about 240 a
 * month against a rate limit of 450 every fifteen minutes. Each asks for 100
 * posts, so around 24,000 posts a month against a three million cap, under
 * one percent. Nothing is fetched at all on a day nobody opens the app,
 * because the cache fills on demand rather than on a timer.
 *
 * What buys that is freshness, knowingly. `sort_order=relevancy` over recent
 * search's seven-day window returns the week's best posts rather than the
 * last hour's, for the same one call, so a post that carried well stays in
 * the column for days instead of being pushed out by whatever was posted
 * most recently. Ranking is by engagement, not by clock: see rankPosts.
 *
 * Which accounts, and why not a cashtag search, is argued in lib/x-feed.
 *
 * Always 200: a quiet hour, an expired token and a rate limit all reach the
 * reader as the same calm line, because none of them is something a reader
 * can act on. The console gets the reason.
 */

const X_SEARCH = "https://api.x.com/2/tweets/search/recent";
/**
 * Six hours. The window being searched is seven days wide, so a shorter
 * cache would spend calls re-reading mostly the same week.
 */
const REVALIDATE_SECONDS = 6 * 60 * 60;

/** The most one request may return, since the call costs the same either way. */
const MAX_RESULTS = 100;

/** How many cards the column carries, and how many any one name may take. */
const FEED_LIMIT = 12;
const PER_SYMBOL_LIMIT = 2;
/** Asking about one listing is a different question: show its own run. */
const SYMBOL_LIMIT = 8;

export type ListingXResponse = {
  items: XPost[];
  /** Present only when something degraded, for the console. */
  reason?: string;
};

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
  };
};

type SearchResponse = {
  data?: SearchTweet[];
  includes?: { users?: SearchUser[] };
  errors?: { detail?: string; title?: string }[];
  title?: string;
  detail?: string;
};

const NAME_BY_SYMBOL = new Map(
  TOKEN_LISTINGS.map((listing) => [listing.symbol, listing.name]),
);

/** Which listing an account speaks for, read from the post when it is one of several. */
const SYMBOLS_BY_ACCOUNT = new Map(
  COMPANY_SOURCES.map((source) => [
    source.username.toLowerCase(),
    source.symbols,
  ]),
);

async function search(query: string): Promise<SearchTweet[]> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) throw new Error("X_BEARER_TOKEN not set");

  const url = new URL(X_SEARCH);
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", String(MAX_RESULTS));
  // The week's best rather than the last hour's, for the same one call.
  url.searchParams.set("sort_order", "relevancy");
  url.searchParams.set("tweet.fields", "created_at,public_metrics");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "name,username,profile_image_url");

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    next: { revalidate: REVALIDATE_SECONDS },
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
  })) as (SearchTweet & { author?: SearchUser })[];
}

/** One search result as a card, or nothing if it cannot be placed. */
function toPost(
  tweet: SearchTweet & { author?: SearchUser },
  tier: "company" | "press",
): XPost | undefined {
  const author = tweet.author;
  if (!author?.username || !author.profile_image_url) return undefined;
  const publishedAt = tweet.created_at ? Date.parse(tweet.created_at) : Number.NaN;
  if (!Number.isFinite(publishedAt)) return undefined;
  if (looksPromotional(tweet.text) || looksEmpty(tweet.text)) return undefined;


  const text = decodeEntities(tweet.text);
  const mentioned = symbolsForText(text);
  let symbol: string | undefined;
  if (tier === "company") {
    const owned = SYMBOLS_BY_ACCOUNT.get(author.username.toLowerCase()) ?? [];
    // An issuer speaking for two of our funds is placed by what it said.
    symbol = owned.find((candidate) => mentioned.includes(candidate)) ?? owned[0];
  } else {
    // A wire is only ever about a listing if it named one.
    symbol = mentioned[0];
  }
  const name = symbol ? NAME_BY_SYMBOL.get(symbol) : undefined;
  if (!symbol || !name) return undefined;

  return {
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
    symbol,
    name,
  };
}

export async function GET(request: Request): Promise<Response> {
  const wanted = new URL(request.url).searchParams.get("symbol")?.toUpperCase();
  if (wanted && !NAME_BY_SYMBOL.has(wanted)) {
    return Response.json({ items: [], reason: `no listing called ${wanted}` });
  }

  const jobs: { tier: "company" | "press"; query: string }[] = [
    { tier: "company", query: buildCompanyQuery() },
    ...buildPressQueries().map((query) => ({ tier: "press" as const, query })),
  ];

  const results = await Promise.allSettled(jobs.map((job) => search(job.query)));

  const gathered: XPost[] = [];
  const failures: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      failures.push(
        result.reason instanceof Error ? result.reason.message : "X request failed",
      );
      return;
    }
    for (const tweet of result.value) {
      const post = toPost(tweet, jobs[index].tier);
      if (post && (!wanted || post.symbol === wanted)) gathered.push(post);
    }
  });

  const payload: ListingXResponse = {
    items: rankPosts(gathered, {
      limit: wanted ? SYMBOL_LIMIT : FEED_LIMIT,
      perSymbol: wanted ? SYMBOL_LIMIT : PER_SYMBOL_LIMIT,
    }),
  };
  if (failures.length > 0) payload.reason = [...new Set(failures)].join("; ");
  return Response.json(payload);
}
