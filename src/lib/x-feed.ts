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
  replies: number;
  /** The listing this was placed against. */
  symbol: string;
  /** That listing's plain name, for the chip on the card. */
  name: string;
  /**
   * Jev's reading of the post, when it gave one: the rubric level in
   * lib/news-judge, coarsened to three words a reader can use. Absent when
   * the keyword rules alone placed it, so the chip never claims a reading
   * that did not happen.
   */
  verdict?: Verdict;
  /**
   * The same story posted by other accounts, folded into this card, its
   * first report (lib/story-groups). Absent when nobody else carried it.
   */
  alsoBy?: { name: string; username: string; url: string }[];
};

export type Verdict = "material" | "fact" | "analysis";

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
  // The second shelf, each handle checked against the API on 2026-09-30
  // (business verified, the company's own). TSMC has no account on X.
  { username: "Google", symbols: ["GOOGL"] },
  { username: "amazon", symbols: ["AMZN"] },
  { username: "Microsoft", symbols: ["MSFT"] },
  { username: "Meta", symbols: ["META"] },
  { username: "circle", symbols: ["CRCL"] },
  { username: "coinbase", symbols: ["COIN"] },
  { username: "PalantirTech", symbols: ["PLTR"] },
  { username: "AMD", symbols: ["AMD"] },
  { username: "intel", symbols: ["INTC"] },
  { username: "AlibabaGroup", symbols: ["BABA"] },
];

/**
 * Wires and market desks, filtered to our names by topic.
 *
 * The second half of this list arrived with Jev (2026-09-22). Before it, a
 * busy squawk desk was a liability: financialjuice and FirstSquawk post
 * hundreds of lines a day and most of them are about nothing we list, or are
 * about us in a way that says nothing. With every post read and placed by
 * lib/news-judge, a firehose is only a larger sample to choose from. Every
 * handle was checked against the API the same day, per the note on
 * CompanySource: Forbes was left out (contributor churn), Kitco and sec_news
 * are near-dead accounts, and NYTBusiness does not exist.
 *
 * Three left on 2026-09-30, when X began billing by the post: over the
 * week's sample (a recency and a relevancy pass of every query, every post
 * judged), barronsonline returned 18 posts and Jev kept 5, FoxBusiness 7
 * and 1, OilandEnergy 24 and 10, and not one of the 49 reached the
 * column's 36 cards. The rule was five posts or more, none on a card and
 * under half kept; the sample is in the x-cost-fix report. Quiet accounts
 * cost nothing (a post is billed, a query is not) and stay.
 */
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
  "AP",
  "ReutersBiz",
  "axios",
  "BBCBusiness",
  "TheEconomist",
  "MarketWatch",
  "FortuneMagazine",
  "FirstSquawk",
  "LiveSquawk",
  "financialjuice",
  "TechCrunch",
  "verge",
  "ElectrekCo",
  "SpaceflightNow",
  "SpaceNews_Inc",
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
    terms: ["$SPCX", "SpaceX", "Starship", "Starlink"],
    query: ["SpaceX", "Starlink"],
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
  {
    symbol: "QQQ",
    // The index, not the exchange. Bare "Nasdaq" matched Benzinga's
    // "TURB Explodes on $3.48M Energy Storage Deal [NASDAQ: $TURB]", which
    // is a penny stock we do not list wearing an exchange's name. The query
    // net can stay broad, because this is what decides.
    terms: ["$QQQ", "Nasdaq 100", "Nasdaq-100", "Nasdaq100"],
    query: ["Nasdaq"],
  },
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
  // The second shelf (2026-09-30). Where a company's plain name is also a
  // common word (Meta, Circle), the fine net takes only the longer name and
  // the products, and Jev's placement reads the rest.
  {
    symbol: "GOOGL",
    terms: ["$GOOGL", "$GOOG", "Alphabet", "Google", "Waymo"],
    query: ["Google"],
  },
  { symbol: "AMZN", terms: ["$AMZN", "Amazon", "AWS"], query: ["Amazon"] },
  { symbol: "MSFT", terms: ["$MSFT", "Microsoft"], query: ["Microsoft"] },
  {
    symbol: "META",
    terms: ["$META", "Meta Platforms", "Facebook", "Instagram", "WhatsApp", "Zuckerberg"],
    // The coarse net may say the bare word: what it drags in, Jev places or
    // drops, and the fine net above never matches "meta" alone.
    query: ["Meta"],
  },
  {
    symbol: "CRCL",
    terms: ["$CRCL", "Circle Internet", "Allaire"],
    query: ["Circle"],
  },
  { symbol: "COIN", terms: ["$COIN", "Coinbase"], query: ["Coinbase"] },
  { symbol: "PLTR", terms: ["$PLTR", "Palantir"], query: ["Palantir"] },
  {
    symbol: "TSM",
    terms: ["$TSM", "TSMC", "Taiwan Semiconductor"],
    query: ["TSMC"],
  },
  {
    symbol: "AMD",
    terms: ["$AMD", "AMD", "Advanced Micro Devices", "Lisa Su"],
    query: ["AMD"],
  },
  { symbol: "INTC", terms: ["$INTC", "Intel"], query: ["Intel"] },
  { symbol: "BABA", terms: ["$BABA", "Alibaba"], query: ["Alibaba"] },
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
 * The press accounts, packed into `from:` groups short enough to leave room
 * for topics. Twenty-seven accounts spell out to about the whole
 * 512-character budget on their own, so they cannot share one query. Two
 * groups, not three: every query costs its ten posts whenever it runs
 * (lib/x-schedule), so a query fewer is a third more turns for the rest.
 *
 * Three groups since 2026-09-30, when the second shelf took the topics
 * from thirteen to twenty four (about 250 characters of topics). Two
 * groups cannot hold them: the accounts' 501 characters plus the topics
 * and filters twice come to more than two queries' 1,024. At 180 the three
 * groups each keep fifty characters of room; at 280 the greedy packer made
 * three press queries anyway, two of them within ten characters of 512.
 */
const FROM_GROUP_CHARS = 180;

export function groupSources(press: readonly string[]): string[][] {
  const groups: string[][] = [];
  let group: string[] = [];
  const width = (names: readonly string[]) =>
    names.map((name) => `from:${name}`).join(" OR ").length + 2;
  for (const name of press) {
    if (group.length > 0 && width([...group, name]) > FROM_GROUP_CHARS) {
      groups.push(group);
      group = [];
    }
    group.push(name);
  }
  if (group.length > 0) groups.push(group);
  return groups;
}

/**
 * Press queries, packed into as few requests as the length limit allows.
 * Splitting by topic rather than by account keeps every wire eligible for
 * every name, which is what makes the quiet listings appear at all. Each
 * group of accounts gets the full set of topics.
 */
export function buildPressQueries(
  topics: readonly Topic[] = TOPICS,
  press: readonly string[] = PRESS_SOURCES,
): string[] {
  const queries: string[] = [];
  for (const group of groupSources(press)) {
    const from = `(${group.map((name) => `from:${name}`).join(" OR ")})`;
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
  }
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
  /\bwebcast\b/i,
  /\bjoin us\b/i,
  /\bregister\b/i,
  /\brsvp\b/i,
  /\bsave your seat\b/i,
  // "Join Tony Kim, BlackRock's Head of Global Technology Funds, and SpaceX
  // CFO Bret Johnsen, for a live conversation" is an event invitation
  // wearing a news sentence, and iShares posts them often enough to take a
  // fund's only slot.
  /\bjoin\b[\s\S]{0,90}?\bfor a (live|conversation|discussion|panel)\b/i,
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

/**
 * The post's words, without the link furniture.
 *
 * Every url in a post arrives as a t.co shortener, and in our card it is dead
 * text: the whole card is one link to the post, so a url inside it cannot be
 * clicked, and an anchor cannot be nested in an anchor anyway. It is noise
 * that can do nothing.
 *
 * `display_url` was the obvious alternative and does not help: Reuters
 * publishes reut.rs/3VlS4OT, which reads no better than t.co/U3bSDVd5tt, and
 * Reuters routinely repeats the same shortener twice in one post, so the raw
 * text often ends in the same dead link printed twice.
 *
 * So they come out. X's own embed does not render the raw shortener either,
 * the card opens the post where every link is live, and no word the author
 * wrote is touched. What is removed is a pointer, not a sentence.
 */
export function stripLinks(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A count as a reader would say it: 264, 1.2K, 27.7K, 1.4M. Under a thousand
 * stays exact, because rounding a small number reads as evasion, and a whole
 * thousand loses its decimal so it is "5K" and never "5.0K".
 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0";
  if (value < 1_000) return String(Math.round(value));
  const [scaled, suffix] =
    value < 1_000_000 ? [value / 1_000, "K"] : [value / 1_000_000, "M"];
  const rounded = Math.round(scaled * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}${suffix}`;
}

export function postUrl(username: string, id: string): string {
  return `https://x.com/${username}/status/${id}`;
}

/**
 * How much a post carried, as one number. A repost is a stronger signal than
 * a like, because it costs the sender something: their own timeline. A quote
 * costs them a sentence as well.
 */
export function engagementScore(post: {
  likes: number;
  retweets: number;
  quotes: number;
}): number {
  return post.likes + post.retweets * 3 + post.quotes * 2;
}

/**
 * What each author normally gets, from the sample already in hand. No extra
 * request: the two searches return up to 200 posts, which is several days of
 * most of these accounts.
 *
 * This is the fix for the column's real defect. Raw engagement ranks FAME,
 * not news: @saylor's throwaway line scores thirty-seven thousand and a wire
 * desk's genuine scoop scores fifteen hundred, so sorting by it simply lists
 * our accounts in order of following, every refresh, forever. Measured
 * against the author's own median, a wire at three times its normal reach is
 * visibly a scoop and a five-million-follower account posting a slogan is
 * visibly a slow day.
 *
 * An author with fewer than three posts in the sample gets no baseline and
 * scores neutrally, because one post is not a median and an ETF issuer that
 * speaks twice a month would otherwise be judged on a sample of one.
 */
const BASELINE_MIN_POSTS = 3;

export function authorBaselines(
  posts: readonly XPost[],
): Map<string, number> {
  const byAuthor = new Map<string, number[]>();
  for (const post of posts) {
    const key = post.author.username.toLowerCase();
    const scores = byAuthor.get(key) ?? [];
    scores.push(engagementScore(post));
    byAuthor.set(key, scores);
  }
  const baselines = new Map<string, number>();
  for (const [author, scores] of byAuthor) {
    if (scores.length < BASELINE_MIN_POSTS) continue;
    const sorted = [...scores].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
    // A median of zero would divide the ranking by nothing.
    baselines.set(author, Math.max(median, 1));
  }
  return baselines;
}

/** How far above its author's own normal a post reached. 1 is normal. */
export function relativeReach(
  post: XPost,
  baselines: Map<string, number>,
): number {
  const baseline = baselines.get(post.author.username.toLowerCase());
  if (baseline === undefined) return 1;
  return engagementScore(post) / baseline;
}

/**
 * Age, as a multiplier. Half a day halves a post's standing, so this
 * morning's news of the same substance and reach as last night's clearly
 * wins, and a post needs four times its author's normal reach to hold level
 * with a fresh one a day later. It was three days until 2026-09-24 and a day
 * until 2026-09-29, when David had been reading the same posts for days: the
 * column now takes in new posts several times a trading day (lib/x-schedule),
 * so there is usually something fresh for this to prefer. This is the dial
 * to turn if the column feels stale or feels twitchy.
 */
export const HALF_LIFE_MS = 12 * 60 * 60 * 1000;

export function recencyWeight(publishedAt: number, now: number): number {
  const age = Math.max(0, now - publishedAt);
  return 2 ** (-age / HALF_LIFE_MS);
}

/**
 * How long a post stays eligible at all. Inside two days any post may rank;
 * past that only a very strong one (see `STRONG_STANDING`), and nothing past
 * five days, however far it carried. Without the cut the rotation's reserve
 * turned week-old posts back in, because recent search reaches back seven
 * days and the decay alone never quite reaches zero.
 */
export const FRESH_WINDOW_MS = 48 * 60 * 60 * 1000;
export const MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;
/**
 * Reach times substance, before age: four times the author's normal reach on
 * a plain report, or two and a half on material news. The level of a story
 * people are still reading two days on.
 */
export const STRONG_STANDING = 4;

/** Whether a post may still be shown, from its age and its ageless standing. */
export function stillCurrent(publishedAt: number, standing: number, now: number): boolean {
  const age = now - publishedAt;
  if (age <= FRESH_WINDOW_MS) return true;
  return age <= MAX_AGE_MS && standing >= STRONG_STANDING;
}

/**
 * Newest first, for the cards on screen. The ranking decides WHICH posts are
 * shown; once chosen, a reader expects the latest at the top, as in any
 * timeline, and a strong post from yesterday sitting above this hour's reads
 * as stale even when it deserved its place.
 */
export function newestFirst<T extends { publishedAt: number }>(posts: readonly T[]): T[] {
  return [...posts].sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * Whether a post says anything. Engagement and newsworthiness are different
 * axes and no amount of arithmetic on the first will produce the second, so
 * this is the one crude reading of the text itself.
 *
 * A figure is the tell. "Strategy has acquired 950 BTC and repurchased $174M"
 * and "the 10-year yield climbed above 5%" both carry one; "The only clarity
 * you need is Bitcoin" and "A little more orange" are slogans from the same
 * accounts on the same week, and a column called In the news should prefer
 * the former even when the latter was liked twenty times more.
 *
 * Deliberately gentle, and a multiplier rather than a filter: it reorders the
 * column, it never silences an account.
 */
const FIGURE = /\$\s?\d|\d+(\.\d+)?\s?%|\b\d{2,}\b/;
const SLOGAN_CHARS = 80;

export function substanceWeight(text: string): number {
  if (FIGURE.test(text)) return 1.25;
  return text.trim().length < SLOGAN_CHARS ? 0.55 : 1;
}

/**
 * One post's standing in the column: how far it reached for its own author,
 * faded by age, weighted by whether it said anything.
 */
export function newsScore(
  post: XPost,
  baselines: Map<string, number>,
  now: number,
  /** Jev's reading of the post, when it gave one; replaces the regex guess. */
  substance?: number,
): number {
  return standingOf(post, baselines, substance) * recencyWeight(post.publishedAt, now);
}

/** Reach times substance: a post's standing before age is counted. */
export function standingOf(
  post: XPost,
  baselines: Map<string, number>,
  substance?: number,
): number {
  return relativeReach(post, baselines) * (substance ?? substanceWeight(post.text));
}

export function rankPosts(
  posts: readonly XPost[],
  {
    limit,
    perSymbol,
    now = Date.now(),
    substance,
  }: {
    limit: number;
    perSymbol: number;
    now?: number;
    /** Per post id, from lib/news-judge. Posts missing from it use the heuristic. */
    substance?: ReadonlyMap<string, number>;
  },
): XPost[] {
  const seen = new Set<string>();
  const unique: XPost[] = [];
  for (const post of posts) {
    if (!post.id || seen.has(post.id)) continue;
    seen.add(post.id);
    unique.push(post);
  }
  // Baselines from every post in hand, the stale ones too: an author's normal
  // is measured over the week, whatever is still shown.
  const baselines = authorBaselines(unique);
  const current = unique.filter((post) =>
    stillCurrent(post.publishedAt, standingOf(post, baselines, substance?.get(post.id)), now),
  );
  const scored = new Map(
    current.map((post) => [
      post,
      newsScore(post, baselines, now, substance?.get(post.id)),
    ]),
  );
  current.sort(
    (a, b) => (scored.get(b) ?? 0) - (scored.get(a) ?? 0) || b.publishedAt - a.publishedAt,
  );

  const room = Math.max(limit, 0);
  const counts = new Map<string, number>();
  const taken = new Set<XPost>();
  const kept: XPost[] = [];
  for (const post of current) {
    if (kept.length >= room) break;
    const count = counts.get(post.symbol) ?? 0;
    if (count >= perSymbol) continue;
    counts.set(post.symbol, count + 1);
    taken.add(post);
    kept.push(post);
  }
  const fillCap = perSymbol * 2;
  for (const post of current) {
    if (kept.length >= room) break;
    if (taken.has(post)) continue;
    const count = counts.get(post.symbol) ?? 0;
    if (count >= fillCap) continue;
    counts.set(post.symbol, count + 1);
    kept.push(post);
  }
  return kept;
}
