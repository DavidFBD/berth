/**
 * How news items from different sources become one story (lib/server/
 * news-store does the storing). Pure: no fetching, no database, no Jev, so
 * every rule here can be tested against titles written by hand.
 *
 * The same story reaches Berth many times: a wire runs on several Nasdaq
 * symbol feeds at once, the same headline comes from two sources, and a
 * desk posts on X what its site published. A reader should meet it once,
 * from its most primary source, with the others named under it.
 *
 * In order, an item joins a story when:
 *   1. its canonical url is one the story already has;
 *   2. its normalised title is one the story already has;
 *   3. its words are most of a story's words (Jaccard ≥ 0.75), the story is
 *      tagged to one of the same listings and is within two days of it;
 *   4. an X post's words are most of a headline's (≥ 0.6), on the same terms.
 * A pair that shares some words but not most (0.45 up to the floor) is a
 * near miss: lib/server/news-ingest may put it to Jev as one cheap question,
 * and without an answer it stays two stories, which is what it was before.
 */

/** How close two titles' words must be to be one story without asking. */
export const SAME_WORDS = 0.75;
/** A post against a headline: a post rewords more. */
export const POST_WORDS = 0.6;
/** From here up to the floor, Jev may be asked. */
export const NEAR_WORDS = 0.45;
/** Never fold by words or title across more than this. */
export const FOLD_WINDOW_MS = 48 * 60 * 60 * 1000;
/**
 * And never across more than this when the titles are templates of each
 * other: true copies of one story carry the same time to within hours
 * (a wire and its syndications), while a desk's daily template ("Nvidia
 * (NVDA) Stock Sinks As Market Gains: What You Should Know") repeats a day
 * apart. Measured 2026-10-02 (review): day one and day two scored 0.82.
 */
export const SAME_DAY_MS = 12 * 60 * 60 * 1000;

/**
 * A title as a key: lower case, the trailing " - Reuters" or "| CNBC" a
 * syndicated copy carries removed, punctuation gone. Two copies of one
 * headline give the same key.
 */
export function normaliseTitle(title: string): string {
  const suffix = title.match(/\s+[-|–—]\s+([^-|–—]{2,40})$/u);
  const named = suffix && [WIRES, PRESS, AGGREGATORS].some((pattern) => pattern.test(suffix[1].trim()));
  return (named ? title.slice(0, suffix.index) : title)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Query parameters that only say who sent the reader, never which page. */
const TRACKING = /^(utm_|mc_|ref$|ref_|src$|cmpid$|mod$|guccounter|guce_|ncid$|yptr$|\.tsrc$|tsrc$|fbclid$|gclid$|taid$|siteid$|soc_)/i;

/**
 * The page a link is really for: host without "www.", path without a
 * trailing slash, tracking parameters dropped, no fragment. Undefined for
 * something that is not a web address.
 */
export function canonicalUrl(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
  let host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  // One post, one address: twitter.com and its mobile host are x.com, and
  // X's share parameters say only who shared it.
  const isX = /^(mobile\.)?(twitter|x)\.com$/.test(host);
  if (isX) host = "x.com";
  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  const kept = [...parsed.searchParams.entries()]
    .filter(([key]) => !TRACKING.test(key) && !(isX && (key === "s" || key === "t")))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = kept.length ? `?${new URLSearchParams(kept).toString()}` : "";
  return `${host}${path}${query}`;
}

/** Words that say nothing about which story it is. */
const STOPWORDS = new Set(
  "a an and are as at be by for from has have in into is it its of on or over says said than that the their this to up was were will with after new".split(
    " ",
  ),
);

/** The words that identify a story, as a set. Figures and single letters count: "4" is not "5". */
export function titleTokens(title: string): Set<string> {
  return new Set(
    normaliseTitle(title)
      .split(" ")
      .filter((word) => word.length > 0 && (/\d/.test(word) || !STOPWORDS.has(word))),
  );
}

const UP = new Set("rise rises rising rose up gain gains gained jump jumps jumped soar soars soared climb climbs climbed rally rallies rallied surge surges surged higher beat beats raises raised".split(" "));
const DOWN = new Set("fall falls falling fell down drop drops dropped sink sinks sank slide slides slid slip slips slipped plunge plunges plunged tumble tumbles tumbled lower miss misses missed cuts cut".split(" "));

/**
 * Whether two titles cannot be one story whatever their other words: their
 * figures differ, or one says up where the other says down.
 */
export function contradicts(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  const figures = (words: ReadonlySet<string>) => [...words].filter((word) => /\d/.test(word));
  const fa = figures(a);
  const fb = figures(b);
  if (fa.length > 0 && fb.length > 0 && (fa.length !== fb.length || fa.some((word) => !b.has(word)))) return true;
  // The words only one side has: "sinks" here and "rises" there is a contradiction,
  // while "gains" on both sides ("as the market gains") says nothing.
  const onlyA = [...a].filter((word) => !b.has(word));
  const onlyB = [...b].filter((word) => !a.has(word));
  const has = (words: string[], set: ReadonlySet<string>) => words.some((word) => set.has(word));
  return (has(onlyA, UP) && has(onlyB, DOWN)) || (has(onlyA, DOWN) && has(onlyB, UP));
}

/** Shared words over all words, 0 to 1. Two empty sets share nothing. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * How primary a publisher is, lowest first: the company itself or the SEC,
 * then the wires, then the financial press, then everyone else, then the
 * aggregators and stock pickers. The story leads with its most primary
 * item, so "Also reported by" lists the copies, not the original.
 */
const WIRES = /^(reuters|associated press|ap|bloomberg|dow jones|the wall street journal|wall street journal|wsj|financial times|ft)\b/i;
const PRESS = /^(cnbc|barron'?s|marketwatch|the new york times|new york times|the economist|axios|the information|business insider|fortune|forbes|cnn|bbc|nikkei)\b/i;
const AGGREGATORS =
  /^(yahoo|the motley fool|motley fool|zacks|24\/7 ?wall ?st|247wallst|benzinga|seeking alpha|barchart|bnk invest|gurufocus|marketbeat|investorplace|tipranks|insidermonkey|insider monkey|stocktwits|investing\.com|simply wall st|nasdaq)\b/i;

export type LeadCandidate = {
  publisher: string;
  publishedAt: number;
  /** The company's own account, or the SEC. */
  primary?: boolean;
};

export function leadRank(item: LeadCandidate): number {
  if (item.primary) return 0;
  const name = item.publisher.trim();
  if (WIRES.test(name)) return 1;
  if (PRESS.test(name)) return 2;
  if (AGGREGATORS.test(name)) return 4;
  return 3;
}

/** The item a story leads with: the most primary, and of those the first. */
export function chooseLead<T extends LeadCandidate>(items: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const item of items) {
    if (
      !best ||
      leadRank(item) < leadRank(best) ||
      (leadRank(item) === leadRank(best) && item.publishedAt < best.publishedAt)
    ) {
      best = item;
    }
  }
  return best;
}

/** What a story offers an incoming item to be matched against. */
export type FoldTarget = {
  storyId: number;
  urls: readonly string[];
  titleKeys: readonly string[];
  /** The titles of its items, for the word test. */
  titles: readonly string[];
  symbols: readonly string[];
  publishedAt: number;
};

export type FoldItem = {
  title: string;
  url: string;
  symbols: readonly string[];
  publishedAt: number;
  /** An X post rewords more than a headline does. */
  isPost?: boolean;
};

export type FoldMatch =
  | { kind: "same"; storyId: number; by: "url" | "title" | "words" }
  | { kind: "near"; storyIds: number[] }
  | { kind: "new" };

/**
 * Which story an item belongs to, if any, among `targets`. A url match is
 * exact and needs nothing else. The title and word tests need a listing in
 * common, times within twelve hours, and no contradiction (`contradicts`).
 */
export function matchStory(item: FoldItem, targets: readonly FoldTarget[]): FoldMatch {
  const url = canonicalUrl(item.url);
  if (url) {
    const hit = targets.find((target) => target.urls.includes(url));
    if (hit) return { kind: "same", storyId: hit.storyId, by: "url" };
  }
  const key = normaliseTitle(item.title);
  const words = titleTokens(item.title);
  const close = targets.filter(
    (target) =>
      Math.abs(target.publishedAt - item.publishedAt) <= Math.min(FOLD_WINDOW_MS, SAME_DAY_MS) &&
      target.symbols.some((symbol) => item.symbols.includes(symbol)),
  );
  if (key) {
    const hit = close.find((target) => target.titleKeys.includes(key));
    if (hit) return { kind: "same", storyId: hit.storyId, by: "title" };
  }
  const floor = item.isPost ? POST_WORDS : SAME_WORDS;
  let best: { storyId: number; score: number } | undefined;
  const near: { storyId: number; score: number }[] = [];
  for (const target of close) {
    const scores = target.titles.map((title) => {
      const theirs = titleTokens(title);
      return contradicts(words, theirs) ? 0 : jaccard(words, theirs);
    });
    const score = Math.max(0, ...scores);
    if (score >= floor) {
      if (!best || score > best.score) best = { storyId: target.storyId, score };
    } else if (score >= NEAR_WORDS) {
      near.push({ storyId: target.storyId, score });
    }
  }
  if (best) return { kind: "same", storyId: best.storyId, by: "words" };
  if (near.length > 0) {
    return { kind: "near", storyIds: near.sort((a, b) => b.score - a.score).slice(0, 4).map((hit) => hit.storyId) };
  }
  return { kind: "new" };
}

/** A publisher's name from a link, for a source that gives only a domain (Marketaux). */
const PUBLISHER_BY_HOST: Readonly<Record<string, string>> = {
  "reuters.com": "Reuters",
  "apnews.com": "Associated Press",
  "bloomberg.com": "Bloomberg",
  "wsj.com": "The Wall Street Journal",
  "ft.com": "Financial Times",
  "cnbc.com": "CNBC",
  "barrons.com": "Barron's",
  "marketwatch.com": "MarketWatch",
  "fool.com": "The Motley Fool",
  "finance.yahoo.com": "Yahoo Finance",
  "zacks.com": "Zacks",
  "247wallst.com": "24/7 Wall St.",
  "benzinga.com": "Benzinga",
  "seekingalpha.com": "Seeking Alpha",
  "barchart.com": "Barchart",
  "gurufocus.com": "GuruFocus",
  "marketbeat.com": "MarketBeat",
  "investorplace.com": "InvestorPlace",
  "nasdaq.com": "Nasdaq",
  "thestreet.com": "TheStreet",
  "investing.com": "Investing.com",
  "economictimes.indiatimes.com": "The Economic Times",
  "businessinsider.com": "Business Insider",
  "forbes.com": "Forbes",
  "fortune.com": "Fortune",
};

export function publisherFromUrl(url: string, fallback?: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    for (const [domain, name] of Object.entries(PUBLISHER_BY_HOST)) {
      if (host === domain || host.endsWith(`.${domain}`)) return name;
    }
    return fallback?.trim() || host;
  } catch {
    return fallback?.trim() || "";
  }
}

/**
 * Whether an item is worth storing at all, before anything else is spent
 * on it: dated within the last three days (and not in the future), with a
 * title that is a sentence rather than a list of tickers. Advice-shaped
 * titles are stored like any other: the column has always shown a kept
 * analyst call as news, and the surfaces beside a Buy button run
 * lib/advice-shaped themselves (lib/first-look).
 */
export function worthIngesting(
  item: { title: string; publishedAt: number },
  now: number,
  maxAgeMs: number,
  looksLikeTickerList: (title: string) => boolean,
): boolean {
  if (!Number.isFinite(item.publishedAt)) return false;
  if (item.publishedAt > now + 60 * 60 * 1000) return false;
  if (now - item.publishedAt > maxAgeMs) return false;
  return item.title.trim().length > 0 && !looksLikeTickerList(item.title);
}
