import { chooseLead } from "@/lib/news-fold";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { mergeBySymbol } from "@/lib/news";
import { decodeEntities } from "@/lib/html-entities";

const LISTING_NAMES: ReadonlyMap<string, string> = new Map(TOKEN_LISTINGS.map((listing) => [listing.symbol, listing.name]));
import type { Verdict } from "@/lib/x-feed";

/**
 * The news column's cards and sections, from stories as the store keeps
 * them (lib/server/news-store). Pure and client safe: the server shapes the
 * cards, the column picks its sections from them, and both are tested here.
 *
 * One card per story, led by its most primary item that this reader may
 * see. An article card shows the verbatim title, the publisher, the time
 * and a link out, never a summary or an image. A post card shows what X
 * asks of a post outside an embed: name, handle, avatar, full text, link.
 */

export type CardSource = "nasdaq" | "x" | "edgar" | "marketaux";

export type StoryCard = {
  /** Stable: the post's own id for a post, so "New to you" carries over; `s<id>` for an article. */
  id: string;
  storyId: number;
  kind: "article" | "post";
  /** An article's title, or a post's text, verbatim. */
  title: string;
  url: string;
  /** An article's publisher, or the post's author's name. */
  publisher: string;
  publishedAt: number;
  /**
   * The listing the card is filed under, and every listing it is about:
   * those Jev kept it for and those it has not judged it for yet (a story
   * tagged to more listings than are judged at once waits for the rest).
   */
  symbol: string;
  name: string;
  symbols: string[];
  /** Jev's reading for `symbol`; absent when Jev has not judged it for that listing. */
  verdict?: Verdict;
  about?: number;
  substance?: number;
  /**
   * Jev's reading for each listing it kept the story for. A reader that asks
   * about one listing takes that listing's reading (`forListing`), never
   * another's: a story material for NVIDIA may be analysis for Apple.
   */
  readings: Record<string, Reading>;
  post?: {
    author: { name: string; username: string; avatarUrl: string };
    likes: number;
    retweets: number;
    quotes: number;
    replies: number;
  };
  /** The other publishers that carried it, as links. */
  alsoReportedBy: { publisher: string; url: string }[];
  /** The X accounts that posted it, as links. */
  alsoOnX: { name: string; username: string; url: string }[];
};

export type Reading = { verdict?: Verdict; about?: number; substance?: number };

/**
 * The card as one listing's reader sees it: filed under `symbol`, with
 * that listing's own reading, or none when Jev has not judged it for that
 * listing. Undefined when the story is not about `symbol` at all.
 */
export function forListing(card: StoryCard, symbol: string, name?: string): StoryCard | undefined {
  if (!card.symbols.includes(symbol)) return undefined;
  if (symbol === card.symbol) return card;
  const reading = card.readings[symbol];
  const out: StoryCard = { ...card, symbol, name: name ?? LISTING_NAMES.get(symbol) ?? symbol };
  delete out.verdict;
  delete out.about;
  delete out.substance;
  if (reading?.verdict) out.verdict = reading.verdict;
  if (reading?.about !== undefined) out.about = reading.about;
  if (reading?.substance !== undefined) out.substance = reading.substance;
  return out;
}

/** A story as lib/server/news-store readStories returns it, structurally. */
export type StoryRecord = {
  id: number;
  kind: "article" | "post";
  leadSourceId: number | null;
  publishedAt: number;
  hidden: boolean;
  sources: {
    id: number;
    source: CardSource;
    sourceId: string;
    publisher: string;
    url: string;
    title: string;
    publishedAt: number;
    raw: Record<string, unknown> | null;
  }[];
  verdicts: { symbol: string; about: number | null; substance: number | null; verdict: Verdict | null; kept: boolean }[];
  unjudged: string[];
};

const RANK: Record<Verdict, number> = { material: 3, fact: 2, analysis: 1 };

/**
 * One story as a card for a reader who may see `visible` sources, or
 * nothing: a hidden story, one with no item this reader may see, or one Jev
 * read and kept for no listing. A story Jev has not judged yet is a card
 * without a verdict, as a headline was before Jev.
 */
export function toCard(
  story: StoryRecord,
  visible: readonly string[],
  names: ReadonlyMap<string, string>,
): StoryCard | undefined {
  if (story.hidden) return undefined;
  const sources = story.sources.filter((source) => visible.includes(source.source));
  if (sources.length === 0) return undefined;

  const kept = story.verdicts.filter((verdict) => verdict.kept && names.has(verdict.symbol));
  const best = [...kept].sort(
    (a, b) =>
      (b.verdict ? RANK[b.verdict] : 0) - (a.verdict ? RANK[a.verdict] : 0) ||
      (b.about ?? 1) - (a.about ?? 1) ||
      a.symbol.localeCompare(b.symbol),
  )[0];
  const unjudged = story.unjudged.filter((symbol) => names.has(symbol) && !story.verdicts.some((v) => v.symbol === symbol));
  const symbol = best?.symbol ?? unjudged[0];
  if (!symbol) return undefined;

  const lead =
    sources.find((source) => source.id === story.leadSourceId) ??
    chooseLead(
      sources.map((source) => ({ ...source, primary: (source.raw as { primary?: boolean } | null)?.primary === true })),
    )!;
  const others = sources.filter((source) => source.id !== lead.id);
  const seenPublishers = new Set([lead.publisher.trim().toLowerCase()]);
  const alsoReportedBy: StoryCard["alsoReportedBy"] = [];
  for (const source of others) {
    if (source.source === "x") continue;
    const key = source.publisher.trim().toLowerCase();
    if (!key || seenPublishers.has(key)) continue;
    seenPublishers.add(key);
    alsoReportedBy.push({ publisher: source.publisher, url: source.url });
  }
  const alsoOnX: StoryCard["alsoOnX"] = [];
  for (const source of others) {
    if (source.source !== "x") continue;
    const author = (source.raw as { author?: { name?: string; username?: string } } | null)?.author;
    if (!author?.username || alsoOnX.some((other) => other.username === author.username)) continue;
    alsoOnX.push({ name: author.name ?? source.publisher, username: author.username, url: source.url });
  }

  const card: StoryCard = {
    id: lead.source === "x" ? lead.sourceId : `s${story.id}`,
    storyId: story.id,
    kind: lead.source === "x" ? "post" : "article",
    // Decoded once here, for every reader of a card: the column, the first look, the tools.
    title: decodeEntities(lead.title),
    url: lead.url,
    publisher: lead.publisher,
    publishedAt: lead.publishedAt,
    symbol,
    name: names.get(symbol)!,
    symbols: [...new Set([...kept.map((verdict) => verdict.symbol), ...unjudged])],
    readings: Object.fromEntries(
      kept.map((verdict) => [
        verdict.symbol,
        {
          ...(verdict.verdict ? { verdict: verdict.verdict } : {}),
          ...(verdict.about !== null ? { about: verdict.about } : {}),
          ...(verdict.substance !== null ? { substance: verdict.substance } : {}),
        },
      ]),
    ),
    alsoReportedBy,
    alsoOnX,
  };

  if (best?.verdict) card.verdict = best.verdict;
  if (best?.about !== null && best?.about !== undefined) card.about = best.about;
  if (best?.substance !== null && best?.substance !== undefined) card.substance = best.substance;
  if (lead.source === "x") {
    const raw = (lead.raw ?? {}) as {
      author?: { name: string; username: string; avatarUrl: string };
      likes?: number;
      retweets?: number;
      quotes?: number;
      replies?: number;
    };
    // A post without its author's face and handle cannot be shown at all.
    if (!raw.author?.username || !raw.author.avatarUrl) return undefined;
    card.post = {
      author: raw.author,
      likes: raw.likes ?? 0,
      retweets: raw.retweets ?? 0,
      quotes: raw.quotes ?? 0,
      replies: raw.replies ?? 0,
    };
  }
  return card;
}

export function toCards(
  stories: readonly StoryRecord[],
  visible: readonly string[],
  names: ReadonlyMap<string, string>,
): StoryCard[] {
  return stories
    .map((story) => toCard(story, visible, names))
    .filter((card): card is StoryCard => card !== undefined)
    .sort((a, b) => b.publishedAt - a.publishedAt);
}

/** How long a story counts for "For what you own". */
export const OWNED_WINDOW_MS = 36 * 60 * 60 * 1000;
/** At most this many under "For what you own". */
export const OWNED_LIMIT = 5;

/** Whether a reading is news for an owner: Jev read it as a new fact or material. */
function newsReading(reading: Reading | undefined): boolean {
  return reading?.verdict === "material" || reading?.verdict === "fact";
}

/** The listings a card is news for an owner of, by each listing's own reading, recently. */
export function ownerNewsFor(card: StoryCard, now: number): string[] {
  if (now - card.publishedAt > OWNED_WINDOW_MS) return [];
  return card.symbols.filter((symbol) => newsReading(card.readings[symbol]));
}

/**
 * "For what you own": at most five stories about held listings from the
 * last 36 hours, material first, then new facts, then newest, each filed
 * under the held listing it is news for and carrying that listing's own
 * reading. Never ranked by popularity.
 */
export function ownedStories(cards: readonly StoryCard[], held: readonly string[], now: number): StoryCard[] {
  const seen = new Set<number>();
  const mine: StoryCard[] = [];
  for (const card of cards) {
    if (seen.has(card.storyId)) continue;
    const symbols = ownerNewsFor(card, now).filter((symbol) => held.includes(symbol));
    if (symbols.length === 0) continue;
    // The held listing it reads as most important for.
    const best = [...symbols].sort((a, b) => RANK[card.readings[b].verdict!] - RANK[card.readings[a].verdict!])[0];
    const filed = forListing(card, best);
    if (!filed) continue;
    seen.add(card.storyId);
    mine.push(filed);
  }
  return mine
    .sort((a, b) => (b.verdict ? RANK[b.verdict] : 0) - (a.verdict ? RANK[a.verdict] : 0) || b.publishedAt - a.publishedAt)
    .slice(0, OWNED_LIMIT);
}

/**
 * What the first section says for an owner. Each is true of what was read:
 *   stories    there is news about something they own;
 *   quiet      Jev read stories about some of their holdings in the window
 *              and none is news: `symbols` are those it read about,
 *              `unread` those it has read nothing about yet;
 *   unread     Jev has read nothing about their holdings yet.
 * `read` is, per listing, how many stories Jev judged in the window. A
 * store that could not be read is none of these: the column says so.
 */
export type OwnedState =
  | { kind: "stories"; stories: StoryCard[] }
  | { kind: "quiet"; symbols: string[]; unread: string[] }
  | { kind: "unread" };

export function ownedState({
  cards,
  held,
  read,
  now,
}: {
  cards: readonly StoryCard[];
  held: readonly string[];
  read: Readonly<Record<string, number>>;
  now: number;
}): OwnedState {
  const stories = ownedStories(cards, held, now);
  if (stories.length > 0) return { kind: "stories", stories };
  const symbols = held.filter((symbol) => (read[symbol] ?? 0) > 0);
  if (symbols.length === 0) return { kind: "unread" };
  return { kind: "quiet", symbols, unread: held.filter((symbol) => !symbols.includes(symbol)) };
}

/** The river: one card per story, newest first, with room kept for more than one name. */
export function riverOf(
  cards: readonly StoryCard[],
  { limit, perSymbol, exclude = [] }: { limit: number; perSymbol: number; exclude?: readonly number[] },
): StoryCard[] {
  const skip = new Set(exclude);
  return mergeBySymbol(
    cards.filter((card) => !skip.has(card.storyId)),
    { limit, perSymbol, keyOf: (card) => String(card.storyId) },
  );
}

/** A dated event line's facts (lib/server/news-store listing_events), for the column and the MCP tools. */
export type EventCard = {
  symbol: string;
  name: string;
  kind: "filing" | "earnings";
  /** YYYY-MM-DD. */
  day: string;
  /** For a filing: what kind of report (lib/news-schedule SHOWN_FORMS). */
  report?: "report" | "quarterly" | "annual";
  form?: string;
  url?: string;
};

/** "Coming up": at most three event lines about held listings, soonest future first, then the latest filings. */
export function heldEvents(events: readonly EventCard[], held: readonly string[], today: string, max = 3): EventCard[] {
  const mine = events.filter((event) => held.includes(event.symbol));
  const ahead = mine.filter((event) => event.day >= today && event.kind !== "filing").sort((a, b) => a.day.localeCompare(b.day));
  const filed = mine.filter((event) => event.kind === "filing").sort((a, b) => b.day.localeCompare(a.day));
  // One line per listing and kind: three 8-Ks in a week are one fact to a holder.
  const seen = new Set<string>();
  return [...ahead, ...filed]
    .filter((event) => {
      const key = `${event.symbol}:${event.kind}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
}

export type NewsColumnResponse = {
  /** "Across Berth": the river, ranked, then the cards the column rotates in. */
  stories: StoryCard[];
  reserve: StoryCard[];
  /** Every listing's news for an owner from the last 36 hours, at most five each; the column keeps the held ones. */
  owned: StoryCard[];
  /** Per listing, how many stories Jev judged in the last 36 hours: the quiet day's honesty. */
  read: Record<string, number>;
  /** Filings and dates, newest first; the column keeps the held ones. */
  events: EventCard[];
  /** What Jev read and kept today (New York), across every source. Absent when it read none. */
  judged?: { read: number; kept: number };
  /** When the store last took in news, epoch ms. */
  updatedAt?: number;
  /** The refresh button started the slot's extra ingest; its news lands on a later read. */
  refreshing?: boolean;
  /** Present only when the store could not be read. Never the database's own words. */
  reason?: string;
};

/**
 * The column pointed at one listing with a headline the reader tapped
 * (components/first-look): that card, taken out of the river and the
 * reserve, to sit first while only the cards after it rotate. The column's
 * own card for the story when it has one, else the focus as given.
 */
export function pinnedRiver({
  stories,
  reserve,
  focus,
}: {
  stories: readonly StoryCard[];
  reserve: readonly StoryCard[];
  focus: StoryCard | undefined;
}): { pin?: StoryCard; river: StoryCard[]; reserve: StoryCard[] } {
  if (!focus) return { river: [...stories], reserve: [...reserve] };
  const pin = stories.concat(reserve).find((card) => card.storyId === focus.storyId) ?? focus;
  return {
    pin,
    river: stories.filter((card) => card.storyId !== focus.storyId),
    reserve: reserve.filter((card) => card.storyId !== focus.storyId),
  };
}
