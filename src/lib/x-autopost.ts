import { campaignUsd } from "@/lib/campaigns";
import { COPY } from "@/lib/copy";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { earlyCloses, marketHolidayNames, newYorkDate, nextOpen, sessionOn, shiftDate, type IsoDate } from "@/lib/market-calendar";

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
 * 1. A signup campaign that is active, inside its dates, funded for at
 *    least one more reward and ticked "Announce on X" by staff (off by
 *    default: a money link is never posted unless staff chose to), but never two posts in a row (the feed is not
 *    a promotion). When it may not take the slot it may still be the call
 *    to action of a calendar post.
 * 2. The market calendar: a holiday or a 1pm close in the next six days.
 *
 * Every post carries a call to action and one link, so no post names a
 * stock, a fund or a company (David, 2026-10-08). Berth naming a listing
 * beside a link or "see it on Berth" reads as a financial promotion of that
 * listing, which is what the 6 Oct post (a quoted headline on one company
 * and a link) was. Until 8 Oct there were two more sources, a headline about
 * a listed company and the board's Most held and Most bought; both named a
 * listing and both are gone. A fixed line without a link ("NVIDIA was in
 * the news today") was the other choice: it still has Berth pick one
 * company to put in front of its followers on a day of its choosing, and
 * gives them nothing to read, so a post that names nothing is the safer one.
 * `postRefusals` holds that line on the finished text, whatever a template
 * says, and refuses any post that repeats a publisher's headline.
 *
 * Nothing is invented and nothing about a person is read. A holiday or a
 * campaign's day is posted once, ever (`key`).
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

/** Where a post came from. "news" and "milestone" are only in the log, from before 2026-10-08: they named a listing and are drafted no more. */
export type DraftSource = "campaign" | "calendar" | "news" | "milestone";

export type Draft = {
  source: Extract<DraftSource, "campaign" | "calendar">;
  /** Once ever: `calendar:2026-11-26`, `campaign:<code>:<day>`. */
  key: string;
  body: string;
  cta: string;
  url: string;
};

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

/* — the guard — */

/**
 * Every way a person might read a listing in a post: its ticker (and the
 * class without its letter, GOOG for GOOGL), its name, its short name and
 * its issuer's name without the wrapper ("Micron Technology").
 */
const LISTING_TICKERS: ReadonlySet<string> = new Set(
  TOKEN_LISTINGS.flatMap((listing) => (listing.symbol.length === 5 ? [listing.symbol, listing.symbol.slice(0, 4)] : [listing.symbol])),
);
const LISTING_NAMES: readonly string[] = [
  ...new Set(
    TOKEN_LISTINGS.flatMap((listing) => [listing.name, listing.shortName, listing.issuerName.split(" • ")[0]])
      .filter((name): name is string => Boolean(name && name.trim()))
      .map((name) => name.trim().toLowerCase()),
  ),
];
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NAME_PATTERN = new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...LISTING_NAMES].sort((a, b) => b.length - a.length).map(escape).join("|")})(?![\\p{L}\\p{N}])`, "iu");

/** The listing a post names, by ticker (as written, in capitals) or by name (any case), or null. */
export function namedListing(text: string): string | null {
  const words = text.replace(URL_PATTERN, " ");
  const ticker = (words.match(/\$?\b[A-Z]{1,5}\b/g) ?? []).map((word) => word.replace("$", "")).find((word) => LISTING_TICKERS.has(word));
  if (ticker) return ticker;
  return words.match(NAME_PATTERN)?.[0] ?? null;
}

/** A call to action: Berth's own (COPY.xAutopost) and the usual ones in any words. */
const CTA_PATTERN =
  /\b(see it|see (?:them|more)|on berth|join|sign up|signup|open an account|this link|link in|tap|click|get started|download|how it works|find out|learn more|check (?:it|out)|trade|invest|own (?:it|some)|start (?:now|today))\b/i;

export function hasCallToAction(text: string): boolean {
  const words = text.replace(URL_PATTERN, " ");
  return (
    CTA_PATTERN.test(words) ||
    [COPY.xAutopost.seeIt, COPY.xAutopost.campaignLink].some((cta) => words.toLowerCase().includes(cta.toLowerCase().replace(/[.:]$/, "")))
  );
}

export function hasLink(text: string): boolean {
  return /https?:\/\//i.test(text) || new RegExp(BARE_DOMAIN.source, "i").test(text.replace(URL_PATTERN, " "));
}

const normalised = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .split(/[^\p{L}\p{N}&]+/u)
    .filter(Boolean);

/** How many words of a headline in a row make a quote of it. */
export const HEADLINE_RUN_WORDS = 7;

/**
 * Whether a post repeats a headline word for word: the whole headline (at
 * four words or more), or HEADLINE_RUN_WORDS of its words in a row,
 * ignoring case and punctuation.
 */
export function quotesHeadline(text: string, headlines: readonly string[]): boolean {
  const post = ` ${normalised(text.replace(URL_PATTERN, " ")).join(" ")} `;
  for (const headline of headlines) {
    const words = normalised(headline);
    if (words.length < 4) continue;
    if (post.includes(` ${words.join(" ")} `)) return true;
    for (let i = 0; i + HEADLINE_RUN_WORDS <= words.length; i += 1) {
      if (post.includes(` ${words.slice(i, i + HEADLINE_RUN_WORDS).join(" ")} `)) return true;
    }
  }
  return false;
}

/**
 * Why a finished post must not go out, or nothing: it names a listing and
 * carries a link or a call to action (the two never meet), it quotes
 * something in quotation marks, or it repeats a publisher's headline.
 * lib/server/x-autopost runs it on the exact text about to be sent, with
 * the recent stories' headlines, and a refused post is logged as a skip.
 */
export function postRefusals(text: string, headlines: readonly string[] = []): string[] {
  const refusals: string[] = [];
  const listing = namedListing(text);
  if (listing && (hasLink(text) || hasCallToAction(text))) refusals.push(`names ${listing} beside a link or call to action`);
  if (/[\u201c\u201d"]/.test(text)) refusals.push("quotes something");
  if (quotesHeadline(text, headlines)) refusals.push("repeats a headline");
  return refusals;
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

/** A calendar draft with the campaign as its call to action instead. */
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
 * in a row. A calendar post carries the campaign as its call to action when
 * one is live and it still fits, and its own otherwise.
 */
export function choosePost({
  campaign,
  calendar,
  used,
  lastSource,
  now,
}: {
  campaign: LiveCampaign | null;
  calendar: readonly Draft[];
  used: ReadonlySet<string>;
  lastSource: DraftSource | null;
  now: number;
}): Choice | null {
  const ordered: Draft[] = [];
  if (campaign && lastSource !== "campaign") ordered.push(campaignDraft(campaign, now));
  ordered.push(...calendar);
  for (const draft of ordered) {
    if (used.has(draft.key)) continue;
    if (campaign && draft.source === "calendar") {
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
