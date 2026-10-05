import { adviceShaped } from "@/lib/advice-shaped";
import { campaignUsd } from "@/lib/campaigns";
import { COPY } from "@/lib/copy";
import { passes } from "@/lib/first-look";
import { STOCK_LISTINGS, TOKEN_LISTINGS } from "@/lib/listings";
import { earlyCloses, marketHolidayNames, newYorkDate, nextOpen, sessionOn, shiftDate, type IsoDate } from "@/lib/market-calendar";
import type { MostHeldResponse } from "@/lib/most-held";
import type { MostBoughtResponse } from "@/lib/social-proof";

/**
 * Berth's own automatic posts on X (@berthmarkets), as pure decisions: when
 * one is due, what it may say and which of the day's sources says it. The
 * database, the token and the request are lib/server/x-autopost; the words
 * are COPY.xAutopost.
 *
 * One post every three days, from the evening cron (Hobby allows no third
 * cron). The sources, in order of preference, the first with something
 * true to say winning:
 *
 * 1. A signup campaign that is active, inside its dates and funded for at
 *    least one more reward, but never two posts in a row (the feed is not
 *    a promotion). When it may not take the slot it may still be the call
 *    to action of a calendar or news post.
 * 2. The market calendar: a holiday or a 1pm close in the next six days.
 * 3. A Marketaux headline about one of the listed companies from the last
 *    three days, read by Jev as reporting something about it (the first
 *    look's own test), quoted verbatim and attributed. Headlines that read as a price move, a rating or
 *    advice are never quoted.
 * 4. A Berth milestone only where the board already publishes it: Most
 *    held's or Most bought's top row of the published week, thresholds and
 *    all.
 *
 * Every post but a campaign's links to the home page, never to a listing:
 * `/?open=` opens the buy drawer, and no headline or social proof may sit
 * one tap from a Buy button.
 *
 * Nothing is invented and nothing about a person is read. A story, a
 * holiday or a week is posted once, ever (`key`).
 */

export const SITE = "https://www.berthmarkets.com";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A post every three days. */
export const AUTOPOST_EVERY_MS = 3 * DAY_MS;
/** A Hobby cron fires anywhere in its hour, so "three days" allows two hours early rather than drift a day. */
export const AUTOPOST_SLACK_MS = 2 * HOUR_MS;
/** How far ahead a holiday or a half day is worth saying. */
export const CALENDAR_AHEAD_DAYS = 6;
/** How old a headline may be. */
export const NEWS_WINDOW_MS = 3 * DAY_MS;
/** A company posted about this recently goes to the back of the queue. */
export const SAME_COMPANY_MS = 7 * DAY_MS;
/** X's limit, and what it counts a link as (t.co). */
export const MAX_POST_LENGTH = 280;
export const LINK_LENGTH = 23;

/** The kill switch: on only when X_AUTOPOST_ENABLED is "1", and only in production, so a dev or preview never posts. */
export function autopostEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.X_AUTOPOST_ENABLED === "1" && env.VERCEL_ENV === "production";
}

/** Whether a post is due: none yet, or the last one went out at least three days (less the slack) ago. */
export function autopostDue(lastPostAt: number | undefined, now: number): boolean {
  return lastPostAt === undefined || now - lastPostAt >= AUTOPOST_EVERY_MS - AUTOPOST_SLACK_MS;
}

export type DraftSource = "campaign" | "calendar" | "news" | "milestone";

export type Draft = {
  source: DraftSource;
  /** Once ever: `calendar:2026-11-26`, `news:<story id>`, `most_held:<week>`, `campaign:<code>:<day>`. */
  key: string;
  /** The listing it is about, when it is about one. */
  symbol?: string;
  body: string;
  cta: string;
  url: string;
};

/** The listed companies (not the funds, not cash), by ticker. */
const COMPANIES: ReadonlyMap<string, string> = new Map(
  STOCK_LISTINGS.filter((listing) => listing.category === "equity").map((listing) => [listing.symbol, listing.name]),
);

export function campaignUrl(code: string): string {
  return `${SITE}/c/${encodeURIComponent(code)}`;
}

/* — length and the copy rules — */

/** The weight twitter-text gives a code point: 1 in the common ranges, 2 elsewhere (CJK, emoji). */
function weight(codePoint: number): number {
  const light =
    codePoint <= 4351 ||
    (codePoint >= 8192 && codePoint <= 8205) ||
    (codePoint >= 8208 && codePoint <= 8223) ||
    (codePoint >= 8242 && codePoint <= 8247);
  return light ? 1 : 2;
}

const URL_PATTERN = /https?:\/\/\S+/g;
/**
 * A web address without its scheme, which X links all the same ("Amazon.com",
 * "foxbusiness.com"): the common top level domains only, as X's own list is
 * long. Each one counts LINK_LENGTH and is a second link.
 */
export const BARE_DOMAIN =
  /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.(?:com|net|org|io|co|ai|app|dev|news|info|biz|us|uk|ca|de|fr|nl|eu|jp|cn|in|au|tv|me|xyz|gg|fm|ly|so|to)\b(?:\/\S*)?/gi;

/** The length X counts: every link, with or without its scheme, as LINK_LENGTH; everything else by twitter-text's weights. */
export function postLength(text: string): number {
  let length = 0;
  const bare = text
    .replace(URL_PATTERN, () => {
      length += LINK_LENGTH;
      return "";
    })
    .replace(BARE_DOMAIN, () => {
      length += LINK_LENGTH;
      return "";
    });
  for (const char of bare) length += weight(char.codePointAt(0)!);
  return length;
}

const DASH_PUNCTUATION = /\s[-‐-―]\s|[–—―]|--/;
const EMOJI = /\p{Extended_Pictographic}/u;

/** What is wrong with a finished post, if anything: too long, a dash as punctuation, an emoji, "buy", a cashtag. */
export function postProblems(text: string): string[] {
  const problems: string[] = [];
  if (postLength(text) > MAX_POST_LENGTH) problems.push("too long");
  const words = text.replace(URL_PATTERN, "");
  if (DASH_PUNCTUATION.test(words)) problems.push("dash");
  if (EMOJI.test(words)) problems.push("emoji");
  if (/\$[A-Za-z]/.test(words)) problems.push("cashtag");
  if (/\bbuy(s|ing)?\b/i.test(words.replace(/“[^”]*”/g, ""))) problems.push("buy");
  if ((text.match(URL_PATTERN) ?? []).length + (words.match(BARE_DOMAIN) ?? []).length !== 1) problems.push("one link");
  return problems;
}

/** The post as it goes out: body, call to action, one link. */
export function composePost(draft: Pick<Draft, "body" | "cta" | "url">): string {
  return `${draft.body} ${draft.cta} ${draft.url}`;
}

/* — the calendar — */

/** "Thursday 26 November". */
export function dayName(date: IsoDate): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

/** A holiday or a 1pm close in the next CALENDAR_AHEAD_DAYS New York days, soonest first. */
export function calendarDrafts(now: number): Draft[] {
  const today = newYorkDate(new Date(now));
  const drafts: Draft[] = [];
  for (let offset = 1; offset <= CALENDAR_AHEAD_DAYS; offset += 1) {
    const date = shiftDate(today, offset);
    const holiday = marketHolidayNames(Number(date.slice(0, 4))).get(date);
    if (holiday) {
      const reopens = newYorkDate(nextOpen(new Date(`${date}T23:59:00Z`)));
      drafts.push({
        source: "calendar",
        key: `calendar:${date}`,
        body: COPY.xAutopost.holiday(dayName(date), holiday, dayName(reopens)),
        cta: COPY.xAutopost.seeIt,
        url: SITE,
      });
    } else if (earlyCloses(Number(date.slice(0, 4))).has(date) && sessionOn(date)?.early) {
      drafts.push({
        source: "calendar",
        key: `calendar:${date}`,
        body: COPY.xAutopost.halfDay(dayName(date)),
        cta: COPY.xAutopost.seeIt,
        url: SITE,
      });
    }
  }
  return drafts;
}

/* — news — */

/** A story as lib/server/news-store readStories returns it, the parts read here. */
export type NewsStory = {
  id: number;
  hidden: boolean;
  sources: { source: string; publisher: string; title: string; url: string; publishedAt: number }[];
  verdicts: { symbol: string; verdict: "material" | "fact" | "analysis" | null; about: number | null; kept: boolean }[];
};

const MOVE_WORDS =
  /\b(soar|soars|soared|surge|surges|surged|plunge|plunges|plunged|tumble|tumbles|tumbled|skyrocket\w*|rall(y|ies|ied)|slump\w*|crash\w*|rocket\w*|sink|sinks|sank|jump|jumps|jumped|climb\w*|slide|slides|slid|rebound\w*|rise|rises|rose|fall|falls|fell|gain|gains|gained|drop|drops|dropped|spike\w*|sell-?off|selloff|all-time high|record high|price target|upgrade\w*|downgrade\w*|outperform\w*|underperform\w*|overweight|underweight|analyst\w*|rating|bull\w*|bear\w*|forecast\w*|predict\w*|should you|top pick|millionaire)\b/i;

/**
 * The headline as it may be quoted, or null: the publisher's own suffix
 * (" - Reuters") taken off, and never one with a dash left in it, an emoji,
 * quotes, a ticker, a cashtag, a handle, a link, a percentage, a dollar
 * figure, a price move or rating, talk of the stock or its investors, a
 * web address (X would link it), or advice. Verbatim otherwise.
 */
export function quotableHeadline(title: string, symbol: string, publisher: string): string | null {
  let line = title.replace(/\s+/g, " ").trim();
  const suffix = line.match(/\s[-–—|]\s([^-–—|]{1,60})$/);
  if (suffix && suffix[1].trim().toLowerCase() === publisher.trim().toLowerCase()) line = line.slice(0, suffix.index).trim();
  if (line.length < 20) return null;
  if (DASH_PUNCTUATION.test(line) || /[|–—]/.test(line)) return null;
  if (EMOJI.test(line)) return null;
  if (/["“”]/.test(line)) return null;
  if (/[$@#%]|https?:|www\./i.test(line) || new RegExp(BARE_DOMAIN.source, "i").test(line)) return null;
  if (/\b(NASDAQ|NYSE)\s*:/i.test(line)) return null;
  if ((line.match(/\b[A-Z]{1,5}\b/g) ?? []).some((word) => TICKERS.has(word))) return null;
  // Company news, never commentary on the stock.
  if (/\b(stocks?|shares?|investors?|valuation|portfolio)\b/i.test(line)) return null;
  if (MOVE_WORDS.test(line)) return null;
  if (adviceShaped(line)) return null;
  return line;
}

const RANK = { material: 2, fact: 1, analysis: 0 } as const;

/** Every listing's ticker, and the class without its letter (GOOGL, GOOG): a person reads names, not these. */
const TICKERS: ReadonlySet<string> = new Set(
  TOKEN_LISTINGS.flatMap((listing) => (listing.symbol.length === 5 ? [listing.symbol, listing.symbol.slice(0, 4)] : [listing.symbol])).filter(
    // A company that goes by its letters in everyday speech ("AMD") is named, not tickered.
    (ticker) => !TOKEN_LISTINGS.some((listing) => listing.shortName === ticker),
  ),
);

/** A publisher known only by its web address ("foxbusiness.com"): X would link it, a second link to someone else's site, so it is never quoted. */
export function namedPublisher(publisher: string): boolean {
  return !/\.[a-z]{2,}$/i.test(publisher.trim()) && !new RegExp(BARE_DOMAIN.source, "i").test(publisher);
}

/**
 * The quotable Marketaux headlines of the last NEWS_WINDOW_MS, best first:
 * material before fact, then how surely the story is about the company,
 * then the newest; a company posted about in the last week after the rest.
 * `marketauxVisible` is whether the public may see Marketaux at all
 * (lib/news-schedule visibleSources): if not, there is no Marketaux source.
 */
export function newsDrafts({
  stories,
  now,
  marketauxVisible,
  recentSymbols = new Set(),
}: {
  stories: readonly NewsStory[];
  now: number;
  marketauxVisible: boolean;
  recentSymbols?: ReadonlySet<string>;
}): Draft[] {
  if (!marketauxVisible) return [];
  const found: (Draft & { rank: number; about: number; at: number })[] = [];
  for (const story of stories) {
    if (story.hidden) continue;
    const source = story.sources
      .filter((item) => item.source === "marketaux" && now - item.publishedAt <= NEWS_WINDOW_MS && item.publishedAt <= now)
      .sort((a, b) => b.publishedAt - a.publishedAt)[0];
    if (!source) continue;
    const verdicts = story.verdicts
      .filter((verdict) => verdict.kept && verdict.verdict && COMPANIES.has(verdict.symbol))
      .sort((a, b) => RANK[b.verdict!] - RANK[a.verdict!] || (b.about ?? 0) - (a.about ?? 0));
    for (const verdict of verdicts) {
      const name = COMPANIES.get(verdict.symbol)!;
      const item = {
        title: source.title,
        url: source.url,
        publishedAt: source.publishedAt,
        source: source.publisher,
        symbol: verdict.symbol,
        name,
        verdict: verdict.verdict!,
        ...(verdict.about !== null && { about: verdict.about }),
      };
      if (!passes(item)) continue;
      const headline = quotableHeadline(source.title, verdict.symbol, source.publisher);
      if (!headline || !source.publisher.trim() || !namedPublisher(source.publisher)) continue;
      found.push({
        source: "news",
        key: `news:${story.id}`,
        symbol: verdict.symbol,
        body: COPY.xAutopost.news(name, source.publisher.trim(), headline),
        cta: COPY.xAutopost.seeIt,
        url: SITE,
        rank: RANK[verdict.verdict!],
        about: verdict.about ?? 0,
        at: source.publishedAt,
      });
      break;
    }
  }
  return found
    .sort(
      (a, b) =>
        Number(recentSymbols.has(a.symbol!)) - Number(recentSymbols.has(b.symbol!)) ||
        b.rank - a.rank ||
        b.about - a.about ||
        b.at - a.at,
    )
    .map(({ source, key, symbol, body, cta, url }): Draft => ({ source, key, symbol, body, cta, url }));
}

/* — milestones — */

/** "19 October", from a week's Monday label. */
export function weekName(label: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${label}T00:00:00Z`));
}

/** The published weeks' top rows, Most held first. Only what the board already shows, so only what passed its thresholds. */
export function milestoneDrafts({
  mostHeld,
  mostBought,
}: {
  mostHeld?: MostHeldResponse | null;
  mostBought?: MostBoughtResponse | null;
}): Draft[] {
  const drafts: Draft[] = [];
  const held = mostHeld?.rows[0];
  const heldName = held && STOCK_LISTINGS.find((listing) => listing.symbol === held.symbol)?.name;
  if (held && heldName && mostHeld?.week) {
    drafts.push({
      source: "milestone",
      key: `most_held:${mostHeld.week}`,
      symbol: held.symbol,
      body: COPY.xAutopost.mostHeld(weekName(mostHeld.week), heldName, held.oneIn),
      cta: COPY.xAutopost.seeIt,
      url: SITE,
    });
  }
  const bought = mostBought?.rows[0];
  const boughtName = bought && STOCK_LISTINGS.find((listing) => listing.symbol === bought.symbol)?.name;
  if (bought && boughtName && mostBought?.week) {
    drafts.push({
      source: "milestone",
      key: `most_bought:${mostBought.week}`,
      symbol: bought.symbol,
      body: COPY.xAutopost.mostBought(weekName(mostBought.week), boughtName, bought.people, bought.plus),
      cta: COPY.xAutopost.seeIt,
      url: SITE,
    });
  }
  return drafts;
}

/* — the campaign — */

/** A signup campaign that may be posted right now (lib/server/x-autopost readLiveCampaign decides that). */
export type LiveCampaign = {
  code: string;
  amountUsd: number;
  /** How long the new account must still use Berth. */
  stayDays: number;
  /** Places left, when it can be said exactly; null otherwise. */
  placesLeft: number | null;
  endsAt: Date | null;
};

/** "31 October": the campaign's last day in New York, the instant before it ends. */
export function campaignEndDay(endsAt: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "America/New_York" }).format(
    new Date(endsAt.getTime() - 1),
  );
}

export function campaignDraft(campaign: LiveCampaign, now: number): Draft {
  return {
    source: "campaign",
    key: `campaign:${campaign.code}:${new Date(now).toISOString().slice(0, 10)}`,
    body: COPY.xAutopost.campaign(
      campaignUsd(campaign.amountUsd),
      campaign.stayDays,
      campaign.placesLeft,
      campaign.endsAt ? campaignEndDay(campaign.endsAt) : null,
    ),
    cta: COPY.xAutopost.campaignLink,
    url: campaignUrl(campaign.code),
  };
}

/** A calendar or news draft with the campaign as its call to action instead. */
export function withCampaignCta(draft: Draft, campaign: LiveCampaign): Draft {
  return {
    ...draft,
    cta: COPY.xAutopost.campaignCta(campaignUsd(campaign.amountUsd), campaign.stayDays),
    url: campaignUrl(campaign.code),
  };
}

/* — the choice — */

export type Choice = { draft: Draft; text: string; campaignCode: string | null };

/**
 * The day's post, or null: the first source in order of preference with a
 * draft never posted (`used`) whose finished text keeps every rule.
 * `lastSource` is the last post's source: a campaign never takes two slots
 * in a row. A calendar or news post carries the campaign as its call to
 * action when one is live and it still fits, and its own otherwise.
 */
export function choosePost({
  campaign,
  calendar,
  news,
  milestones,
  used,
  lastSource,
  now,
}: {
  campaign: LiveCampaign | null;
  calendar: readonly Draft[];
  news: readonly Draft[];
  milestones: readonly Draft[];
  used: ReadonlySet<string>;
  lastSource: DraftSource | null;
  now: number;
}): Choice | null {
  const ordered: Draft[] = [];
  if (campaign && lastSource !== "campaign") ordered.push(campaignDraft(campaign, now));
  ordered.push(...calendar, ...news, ...milestones);
  for (const draft of ordered) {
    if (used.has(draft.key)) continue;
    if (campaign && draft.source !== "campaign" && (draft.source === "calendar" || draft.source === "news")) {
      const promoted = withCampaignCta(draft, campaign);
      const text = composePost(promoted);
      if (postProblems(text).length === 0) return { draft: promoted, text, campaignCode: campaign.code };
    }
    const text = composePost(draft);
    if (postProblems(text).length === 0) {
      return { draft, text, campaignCode: draft.source === "campaign" ? campaign!.code : null };
    }
  }
  return null;
}
