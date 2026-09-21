/**
 * Pure core of the X column: who is worth listening to about our listings,
 * how to ask X for them, and how to place a post against a listing.
 *
 * No fetching and no React here.
 *
 * Why a whitelist rather than a search. The obvious approach, searching the
 * cashtags, does not survive contact with the platform: a query for $NVDA,
 * $TSLA and $AAPL sorted by relevance came back as watchlist spam, newsletter
 * ads, and one identical "Good morning, traders" post from five different
 * accounts within the same minute. `is:verified` no longer filters for
 * anything, verification being a purchase. The only durable signal is the
 * author, so the author is what we pick.
 *
 * Two tiers, because they fail differently. The company tier is the listing's
 * own voice and is authoritative but quiet: Strategy announces a 950 BTC
 * purchase, and an ETF issuer says nothing for a week. The press tier is
 * reliably busy but says nothing about our names unless it is asked to, so it
 * is filtered by topic on the way in AND on the way out. Together they cover
 * the board; either alone leaves half of it dark.
 *
 * What this costs, because it is the design's other axis. X refuses a
 * recent-search query over 512 characters (measured: a combined query came to
 * 769 and was refused with a 400), so the two tiers cannot share one request,
 * and two requests is the floor. Against that, recent search reaches back a
 * full SEVEN DAYS, so asking it for the week's best posts costs exactly the
 * same as asking it for the last hour's. That is the whole trick: sorted by
 * relevance rather than recency, two requests a refresh buy a week of good
 * posts, and the column can then be refreshed a few times a day instead of
 * every quarter hour. Freshness is the thing being spent, deliberately: a
 * post worth reading is worth reading on Thursday, and a post that is merely
 * recent is what a cashtag search already proved worthless.
 *
 * Rights standing, in the same spirit as the Nasdaq note in the headlines
 * route. X permits display outside an embed provided the author's name,
 * handle and avatar travel with the post, the X mark is near it, and the card
 * links back to the original. The card built from this module does all four,
 * and the text is displayed as written: trimming a post to fit is itself a
 * violation, so the layout clamps and the card links out rather than editing
 * anyone's words. https://developer.x.com/en/developer-terms/display-requirements
 */

/** One post, as the app carries it. */
export type XPost = {
  id: string;
  /** Verbatim, exactly as posted. Never edited to fit. */
  text: string;
  /** Epoch milliseconds. */
  publishedAt: number;
  author: {
    name: string;
    /** Without the @. */
    username: string;
    avatarUrl: string;
  };
  /** Canonical link to the post itself. */
  url: string;
  likes: number;
  retweets: number;
  quotes: number;
  /** The listing this was placed against. */
  symbol: string;
  /** That listing's plain name, for the chip on the card. */
  name: string;
};

/**
 * An account that speaks for a listing. Handles are verified against the API
 * rather than guessed: @INVESCO is a football stadium with 41 followers, and
 * the asset manager is @InvescoUS.
 */
export type CompanySource = {
  username: string;
  /** Listings this account speaks for, most likely first. */
  symbols: readonly string[];
};

export const COMPANY_SOURCES: readonly CompanySource[] = [
  { username: "nvidia", symbols: ["NVDA"] },
  { username: "Apple", symbols: ["AAPL"] },
  { username: "Tesla", symbols: ["TSLA"] },
  { username: "SpaceX", symbols: ["SPCX"] },
  { username: "gamestop", symbols: ["GME"] },
  { username: "Strategy", symbols: ["MSTR"] },
  { username: "saylor", symbols: ["MSTR"] },
  { username: "MicronTech", symbols: ["MU"] },
  { username: "SanDisk", symbols: ["SNDK"] },
  { username: "StateStreetETFs", symbols: ["SPY"] },
  { username: "InvescoUS", symbols: ["QQQ"] },
  // One issuer, two of our funds: which one a post is about is read from the
  // post, and falls back to the first.
  { username: "iShares", symbols: ["SGOV", "SLV"] },
  { username: "USCFInvestments", symbols: ["USO"] },
];

/** Wires and market desks, filtered to our names by topic. */
export const PRESS_SOURCES: readonly string[] = [
  "Reuters",
  "business",
  "markets",
  "CNBC",
  "WSJ",
  "FinancialTimes",
  "YahooFinance",
  "unusual_whales",
  "DeItaone",
  "Investingcom",
  "Benzinga",
  "StockMKTNewz",
];

/**
 * What makes a post about a listing. `not` exists because the obvious term
 * is sometimes the wrong one: a Treasury ETF is not the Treasury Secretary,
 * and that false match was in the first sample of live results.
 */
export type Topic = {
  symbol: string;
  /**
   * The fine net, applied locally to text we already hold. Free, so it can
   * afford to be thorough.
   */
  terms: readonly string[];
  /**
   * The coarse net, sent to X. Defaults to `terms`. It exists because the
   * query has a 512-character budget and matching does not: asking the wires
   * for "oil" and then deciding locally whether the post is really about the
   * oil fund costs one word of query and catches every phrasing, where
   * spelling out "oil prices OR crude OR OPEC OR Brent" spends forty
   * characters to catch fewer. Keep these broad and few.
   */
  query?: readonly string[];
  not?: readonly string[];
};

export const TOPICS: readonly Topic[] = [
  { symbol: "NVDA", terms: ["$NVDA", "NVIDIA"], query: ["NVIDIA"] },
  { symbol: "AAPL", terms: ["$AAPL", "Apple"], query: ["Apple"] },
  { symbol: "TSLA", terms: ["$TSLA", "Tesla"], query: ["Tesla"] },
  {
    symbol: "SPCX",
    terms: ["$SPCX", "SpaceX", "Starship"],
    query: ["SpaceX"],
  },
  { symbol: "GME", terms: ["$GME", "GameStop"], query: ["GameStop"] },
  {
    symbol: "MSTR",
    terms: ["$MSTR", "MicroStrategy", "Saylor"],
    query: ["Saylor"],
  },
  { symbol: "MU", terms: ["$MU", "Micron"], query: ["Micron"] },
  { symbol: "SNDK", terms: ["$SNDK", "Sandisk"], query: ["Sandisk"] },
  { symbol: "SPY", terms: ["$SPY", "S&P 500"], query: ['"S&P 500"'] },
  { symbol: "QQQ", terms: ["$QQQ", "Nasdaq"], query: ["Nasdaq"] },
  {
    symbol: "SGOV",
    terms: ["$SGOV", "T-bill", "T-bills", "Treasury"],
    // A Treasury fund is not the Treasury Secretary, and the first live
    // sample matched him twice in twelve results.
    not: ["Treasury Secretary", "Treasury Department"],
    query: ["Treasury"],
  },
  {
    symbol: "USO",
    terms: ["$USO", "oil", "crude", "OPEC", "Brent"],
    query: ["oil"],
  },
  { symbol: "SLV", terms: ["$SLV", "silver"], query: ["silver"] },
];

/**
 * Applied to every query. Retweets and replies are removed at the API rather
 * than after, because they are most of what even a good account posts:
 * @saylor's last ten posts were seven retweets.
 */
export const BASE_FILTERS = "-is:retweet -is:reply lang:en";

/** X refuses a recent-search query longer than this. */
export const MAX_QUERY_CHARS = 512;

/** Quoted only where the term is not a single bare word or a cashtag. */
function queryTerm(term: string): string {
  if (term.startsWith("$") || term.startsWith('"')) return term;
  return /^[A-Za-z0-9]+$/.test(term) ? term : `"${term}"`;
}

export function buildCompanyQuery(
  sources: readonly CompanySource[] = COMPANY_SOURCES,
): string {
  const from = sources.map((source) => `from:${source.username}`).join(" OR ");
  return `(${from}) ${BASE_FILTERS}`;
}

/**
 * Press queries, packed into as few requests as the length limit allows.
 * Splitting by topic rather than by account keeps every wire eligible for
 * every name, which is what makes the quiet listings appear at all.
 */
export function buildPressQueries(
  topics: readonly Topic[] = TOPICS,
  press: readonly string[] = PRESS_SOURCES,
): string[] {
  const from = `(${press.map((name) => `from:${name}`).join(" OR ")})`;
  const queries: string[] = [];
  let bucket: string[] = [];

  const render = (pieces: readonly string[]) =>
    `${from} (${pieces.join(" OR ")}) ${BASE_FILTERS}`;
  const flush = () => {
    if (bucket.length > 0) queries.push(render(bucket));
    bucket = [];
  };

  for (const topic of topics) {
    const piece = (topic.query ?? topic.terms).map(queryTerm).join(" OR ");
    if (bucket.length > 0 && render([...bucket, piece]).length > MAX_QUERY_CHARS) {
      flush();
    }
    bucket.push(piece);
  }
  flush();
  return queries;
}

/** Whether `text` says `term`, on a word boundary where that means anything. */
function mentions(text: string, term: string): boolean {
  const haystack = text.toLowerCase();
  const needle = term.toLowerCase();
  if (!/^[a-z0-9]+$/.test(needle)) return haystack.includes(needle);
  return new RegExp(`\\b${needle}\\b`).test(haystack);
}

/** Every listing a post is about, in registry order. */
export function symbolsForText(
  text: string,
  topics: readonly Topic[] = TOPICS,
): string[] {
  const found: string[] = [];
  for (const topic of topics) {
    if (topic.not?.some((term) => mentions(text, term))) continue;
    if (topic.terms.some((term) => mentions(text, term))) found.push(topic.symbol);
  }
  return found;
}

/**
 * Posts that are advertising rather than news. Even a wire account runs
 * these: CNBC's "COMING UP: Tune in at 8 a.m. ET" is a schedule note, and
 * nobody holding Apple is better off for having read it.
 */
const PROMOTIONAL = [
  /\bcoming up\b/i,
  /\btune in\b/i,
  /\bwatch live\b/i,
  /\blive now\b/i,
  /\bsubscribe\b/i,
  /\bsign up\b/i,
  /\bwebinar\b/i,
  /\blink in bio\b/i,
  /\bgiveaway\b/i,
  /\bpromo code\b/i,
  /\buse code\b/i,
];

export function looksPromotional(text: string): boolean {
  return PROMOTIONAL.some((pattern) => pattern.test(text));
}

/**
 * A post carrying no words of its own: a bare link, or a link and a handle.
 * It renders as an empty card, since the card never unfurls a preview.
 */
export function looksEmpty(text: string): boolean {
  const words = text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[@#$]\w+/g, " ")
    .trim();
  return words.length < 12;
}

/**
 * X serves a 48px avatar by default, which is soft on a retina screen. The
 * size lives in the filename, and `_bigger` is 73px for the same request.
 */
export function avatarAt(profileImageUrl: string): string {
  return profileImageUrl.replace(/_normal(\.\w+)$/, "_bigger$1");
}

export function postUrl(username: string, id: string): string {
  return `https://x.com/${username}/status/${id}`;
}

/**
 * How much a post carried, as one number. A repost is a stronger signal than
 * a like, because it costs the sender something: their own timeline. A quote
 * costs them a sentence as well.
 *
 * Deliberately NOT divided by the author's following. Normalising would rank
 * a small account's one viral post above a wire's genuine scoop, and breadth
 * across the listings is already guaranteed by the per-symbol cap below, so
 * the raw figure is the honest one.
 */
export function engagementScore(post: {
  likes: number;
  retweets: number;
  quotes: number;
}): number {
  return post.likes + post.retweets * 3 + post.quotes * 2;
}

/**
 * The column's running order: what carried furthest first, with room kept
 * for more than one listing.
 *
 * Two passes, as the headline river does it, but scored rather than timed. A
 * straight engagement sort is Tesla and NVIDIA forever, because an ETF
 * issuer posting about Treasury bills will never out-like Elon Musk; the
 * `perSymbol` cap gives every listing its turn first, and the remaining room
 * then goes to whatever carried furthest regardless of name.
 *
 * The second pass keeps a cap of its own, at twice the first. Without one it
 * undoes the first: @saylor and @SpaceX score twenty to thirty-seven
 * thousand where a wire's best scores fifteen hundred, so "fill the rest by
 * score" means eight more posts from the same two accounts, and a column
 * about thirteen listings becomes a column about two.
 *
 * Ties break on recency, so a quiet week still reorders rather than freezing.
 */
export function rankPosts(
  posts: readonly XPost[],
  { limit, perSymbol }: { limit: number; perSymbol: number },
): XPost[] {
  const seen = new Set<string>();
  const unique: XPost[] = [];
  for (const post of posts) {
    if (!post.id || seen.has(post.id)) continue;
    seen.add(post.id);
    unique.push(post);
  }
  unique.sort(
    (a, b) =>
      engagementScore(b) - engagementScore(a) || b.publishedAt - a.publishedAt,
  );

  const room = Math.max(limit, 0);
  const counts = new Map<string, number>();
  const taken = new Set<XPost>();
  const kept: XPost[] = [];
  for (const post of unique) {
    if (kept.length >= room) break;
    const count = counts.get(post.symbol) ?? 0;
    if (count >= perSymbol) continue;
    counts.set(post.symbol, count + 1);
    taken.add(post);
    kept.push(post);
  }
  const fillCap = perSymbol * 2;
  for (const post of unique) {
    if (kept.length >= room) break;
    if (taken.has(post)) continue;
    const count = counts.get(post.symbol) ?? 0;
    if (count >= fillCap) continue;
    counts.set(post.symbol, count + 1);
    kept.push(post);
  }
  return kept;
}
