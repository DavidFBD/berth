"use client";

import { track } from "@/lib/analytics";
import { useEffect, useId, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowClockwise,
  ArrowUpRight,
  CaretDown,
  ChatCircle,
  Heart,
  Repeat,
  X,
  XLogo,
} from "@phosphor-icons/react";
import { ThinkingOrb } from "@/components/ui/thinking-orb";
import { DisclosureRow, useDisclosure } from "@/components/board/disclosure";
import { Panel, SectionHeading } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopy } from "@/components/settings-provider";
import { useNews } from "@/hooks/use-news";
import { useMostHeld } from "@/hooks/use-most-held";
import type { MostHeldResponse } from "@/lib/most-held";
import { useListingPerformance } from "@/hooks/use-listing-performance";
import { useRotatingFeed } from "@/hooks/use-rotating-feed";
import { useSeenPosts } from "@/hooks/use-seen-posts";
import { TOKEN_LISTINGS, type TokenListing } from "@/lib/listings";
import { EASE_LIFT } from "@/lib/motion";
import { formatTimeAgo } from "@/lib/news";
import { heldEvents, ownedState, pinnedRiver, type EventCard, type StoryCard } from "@/lib/news-stories";
import { formatCount, type Verdict } from "@/lib/x-feed";
import { changeDirection, formatPercentChange, type ChangeDirection } from "@/lib/performance";

/** Text colour per direction, matching the board's. */
const TONE: Record<ChangeDirection, string> = {
  up: "text-good",
  down: "text-bad",
  flat: "text-muted-foreground",
};

const LISTING_BY_SYMBOL = new Map(TOKEN_LISTINGS.map((listing) => [listing.symbol, listing]));

const LIST = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.03 } },
  gone: { opacity: 0, transition: { duration: 0.12 } },
};
const CARD = {
  hidden: { opacity: 0, y: 8 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE_LIFT } },
  leave: { opacity: 0, transition: { duration: 0.2, ease: EASE_LIFT } },
};
const ARRIVE = { duration: 0.5, ease: EASE_LIFT };

const COLLAPSED_LIMIT = 2;
const EXPANDED_LIMIT = 8;

/** The time now, again every half minute, so the ages keep up with a column left open. */
function useClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** An ISO day in the reader's own long form: "Tuesday, September 29". */
function longDate(day: string): string {
  // English, as the sentence around it is.
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

const PAD = "px-[18px] lg:px-6";

/**
 * What is being written about the listings, as one list of stories: each
 * story once, from its most primary source, with who else reported it
 * (lib/news-stories). For someone who owns something, three sections:
 *
 *   For what you own   at most five stories about holdings from the last
 *                      36 hours, material first; or the quiet day's line,
 *                      naming the holdings Jev found nothing about.
 *   Coming up          dated lines about holdings, written by code: SEC
 *                      filings now, "Recently filed" while that is all
 *                      there is.
 *   Across Berth       everything else, as the river always was.
 *
 * Someone who owns nothing sees only the river. `held` never leaves the
 * browser: the route answers the same for everyone and the sections are
 * chosen here.
 *
 * A headline shows its title, publisher and time and links out; never the
 * article, a summary or an image. A post shows what X asks of a post
 * outside an embed: name, handle, avatar, full text, a link. Neither ever
 * sits beside a Buy button.
 */
export function NewsFeed({
  filter,
  focus,
  onClearFilter,
  limit: limitProp,
  fill = false,
  collapsible = false,
  held,
  mostHeld: mostHeldOverride,
}: {
  filter?: TokenListing | null;
  /**
   * A headline to show first while the column is pointed at its listing: the
   * one the first look showed and the reader tapped (components/first-look).
   * Pinned only when the column itself returned that story (lib/news-stories pinnedRiver).
   */
  focus?: StoryCard | null;
  onClearFilter?: () => void;
  /** Fewer cards at once in the river; the rest join the rotation. */
  limit?: number;
  /** Take the height the grid row gives it (see the board's column, from 1280px). */
  fill?: boolean;
  /** Two cards, then "More stories" opens eight. */
  collapsible?: boolean;
  /** The listings this person holds, cash aside; absent or empty for someone who owns nothing. */
  held?: readonly string[];
  /** Stands in for app/api/most-held, for the dev gallery. */
  mostHeld?: MostHeldResponse;
}) {
  const copy = useCopy();
  // A listing's own view: when the news is pointed at one listing, a quiet
  // line with its rounded share from Most held (lib/most-held), only while
  // the listing is one of the five the last published week carries (the
  // card's own rows, nothing past them). Here, never beside a Buy.
  const fetchedMostHeld = useMostHeld();
  const heldIn = filter ? (mostHeldOverride ?? fetchedMostHeld).rows.find((row) => row.symbol === filter.symbol)?.oneIn : undefined;
  const [open, toggle, listId] = useDisclosure("news");
  const sectionId = useId();
  const limit = collapsible ? (open ? EXPANDED_LIMIT : COLLAPSED_LIMIT) : limitProp;
  const news = useNews(filter?.symbol);
  const performance = useListingPerformance();
  const now = useClock();
  const [pressed, setPressed] = useState<{ at: number; updatedAt?: number } | null>(null);
  const refreshing = news.isRefreshing;
  const refresh = () => {
    track("news_refresh_tapped", {});
    setPressed({ at: Date.now(), updatedAt: news.data.updatedAt });
    void news.refresh();
  };

  const owner = !filter && held !== undefined && held.length > 0;
  const owned = useMemo(
    () => (owner ? ownedState({ cards: news.data.owned, held: held!, read: news.data.read, now }) : undefined),
    // `now` moves every half minute; the state may move with it.
    [owner, news.data.owned, news.data.read, held, now],
  );
  const shownOwned = owned?.kind === "stories" ? owned.stories : [];
  const events = owner ? heldEvents(news.data.events, held!, new Date(now).toISOString().slice(0, 10)) : [];
  const ownedIds = new Set(shownOwned.map((card) => card.storyId));
  const pinned = filter && focus && focus.symbol === filter.symbol && !news.isLoading ? focus : undefined;
  const { pin, river: riverRest, reserve: reserveAll } = pinnedRiver({
    stories: news.data.stories.filter((card) => !ownedIds.has(card.storyId)),
    reserve: news.data.reserve.filter((card) => !ownedIds.has(card.storyId)),
    focus: pinned,
  });
  const riverAll = pin ? [pin, ...riverRest] : riverRest;
  // The pinned card stays first: only the cards after it rotate.
  const room = limit && pin ? Math.max(limit - 1, 0) : limit;
  const shownRiver = room ? riverRest.slice(0, room) : riverRest;
  const reserve = room ? [...riverRest.slice(room), ...reserveAll] : reserveAll;
  const { visible: turning, ref: riverRef, handlers: riverHandlers, node: riverNode } = useRotatingFeed(shownRiver, reserve, true);
  const rotated = pin ? [pin, ...turning] : turning;
  // Focus moves to the story the reader tapped, once it is on screen, so a
  // screen reader starts there and reads "The story you opened" first; Tab
  // goes on to its link.
  const pinId = pin?.storyId;
  useEffect(() => {
    if (pinId === undefined || !riverNode) return;
    const timer = window.setTimeout(() => {
      riverNode.querySelector<HTMLElement>("[data-focused]")?.focus({ preventScroll: false });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [pinId, riverNode]);
  const seen = useSeenPosts(riverAll.concat(reserveAll), rotated, true, riverNode);

  const updatedAt = news.data.updatedAt;
  const upToDate =
    pressed !== null && !refreshing && updatedAt !== undefined && updatedAt === pressed.updatedAt && now - pressed.at < 60_000;
  const verdictWord: Record<Verdict, string> = {
    material: copy.newsVerdictMaterial,
    fact: copy.newsVerdictFact,
    analysis: copy.newsVerdictAnalysis,
  };
  const count = (value: number) => value.toLocaleString("en-US");
  const nameOf = (symbol: string) => LISTING_BY_SYMBOL.get(symbol)?.name ?? symbol;
  const judged = news.data.judged;

  const verdictChip = (verdict: Verdict) => (
    <span
      title={copy.newsVerdictLabel(verdictWord[verdict])}
      className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-px text-[10.5px] text-muted-foreground"
    >
      <span aria-hidden="true">{verdictWord[verdict]}</span>
      <span className="sr-only">{copy.newsVerdictLabel(verdictWord[verdict])}</span>
    </span>
  );
  const movement = (symbol: string) => {
    const listing = LISTING_BY_SYMBOL.get(symbol);
    const moved = listing ? performance.performanceOf(listing) : undefined;
    return { moved, direction: changeDirection(moved?.changePct) };
  };
  const card = (story: StoryCard) =>
    story.kind === "post" && story.post ? (
      <PostCard story={story} now={now} isNew={seen.isNew(story.id)} movement={movement(story.symbol)} verdictChip={verdictChip} />
    ) : (
      <ArticleCard story={story} now={now} isNew={seen.isNew(story.id)} movement={movement(story.symbol)} verdictChip={verdictChip} />
    );
  const subheading = (id: string, text: string) => (
    <h3 id={id} className={`${PAD} pt-4 pb-2 text-xs font-medium text-muted-foreground`}>
      {text}
    </h3>
  );
  const failed = news.data.failed === true;

  return (
    <Panel
      surface="sheet"
      className={fill ? "xl:flex xl:h-full xl:flex-col xl:overflow-hidden xl:[contain:size]" : undefined}
    >
      <SectionHeading
        title={copy.newsTitle}
        hint={copy.newsStoriesHint}
        more={
          judged ? (
            <>
              <p className="mt-1.5">{copy.newsAboutStories}</p>
              <p className="mt-1.5 text-muted-foreground">{copy.newsReadKept(count(judged.read), count(judged.kept))}</p>
            </>
          ) : undefined
        }
        action={
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            data-news-refresh
            aria-label={refreshing ? copy.newsRefreshing : copy.newsRefresh}
            title={copy.newsRefresh}
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 ease-lift hover:bg-muted hover:text-foreground disabled:hover:bg-transparent"
          >
            {refreshing ? (
              <ThinkingOrb state="searching" size={20} decorative />
            ) : (
              <ArrowClockwise weight="duotone" className="size-4" aria-hidden />
            )}
          </button>
        }
      />

      <div className="empty:hidden">
        <AnimatePresence initial={false}>
          {filter && (
            <motion.div
              key={filter.symbol}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: EASE_LIFT }}
              className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${PAD} pb-2.5`}
            >
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                {copy.newsFilteredTo(filter.name)}
              </span>
              {onClearFilter && (
                <motion.button
                  type="button"
                  onClick={onClearFilter}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  className="flex items-center gap-0.5 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  <X className="size-3" />
                  {copy.newsShowAll}
                </motion.button>
              )}
              {heldIn !== undefined && (
                <p data-most-held-line className="basis-full text-xs text-muted-foreground">
                  {copy.mostHeldRow(heldIn)}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Announced once, when a refresh the reader asked for comes back; the
          line itself ticks every half minute and is not live. */}
      <span className="sr-only" aria-live="polite">
        {pressed !== null && !refreshing && updatedAt !== undefined
          ? (upToDate ? copy.newsUpToDate : copy.newsUpdated)(formatTimeAgo(updatedAt, now))
          : ""}
      </span>
      {(judged || updatedAt !== undefined) && (
        <div className={`flex min-h-5 items-center gap-1.5 ${PAD} pb-3 text-[11px]`}>
          {news.isFetching && !refreshing && <ThinkingOrb state="searching" size={20} decorative />}
          {updatedAt !== undefined && (
            <span className="ml-auto shrink-0 text-muted-foreground">
              {(upToDate ? copy.newsUpToDate : copy.newsUpdated)(formatTimeAgo(updatedAt, now))}
            </span>
          )}
        </div>
      )}

      {news.isLoading ? (
        <ul className="divide-y divide-border border-t border-border">
          {Array.from({ length: Math.min(limit ?? 3, 3) }, (_, row) => row).map((row) => (
            <li key={row} className={`flex items-start gap-3 ${PAD} py-3`}>
              <Skeleton className="size-11 shrink-0 rounded-lg" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </li>
          ))}
        </ul>
      ) : failed ? (
        // Said once, in place of every section: an outage is never a quiet day.
        <p className={`border-t border-border ${PAD} py-4 text-sm text-muted-foreground`}>{copy.newsUnavailable}</p>
      ) : (
        <>
          {owner && owned && (
            <section aria-labelledby={`${sectionId}-owned`} className="border-t border-border" data-news-section="owned">
              {subheading(`${sectionId}-owned`, copy.newsForWhatYouOwn)}
              {owned.kind === "stories" ? (
                <ul className="divide-y divide-border border-t border-border">
                  {owned.stories.map((story) => (
                    <li key={story.id} data-post-id={story.id}>
                      {card(story)}
                    </li>
                  ))}
                </ul>
              ) : owned.kind === "quiet" ? (
                <div className={`${PAD} pb-4`}>
                  <p className="text-sm font-medium text-foreground">{copy.quietDayTitle}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {copy.quietDayBody(owned.symbols.map(nameOf))}
                    {owned.unread.length > 0 && <> {copy.quietDayNotRead(owned.unread.map(nameOf))}</>}
                  </p>
                </div>
              ) : (
                <p className={`${PAD} pb-4 text-sm text-muted-foreground`}>{copy.quietDayUnjudged}</p>
              )}
            </section>
          )}

          {events.length > 0 && (
            <section aria-labelledby={`${sectionId}-events`} className="border-t border-border" data-news-section="events">
              {subheading(`${sectionId}-events`, events.some((event) => event.kind !== "filing") ? copy.newsComingUp : copy.newsRecentlyFiled)}
              <ul className={`${PAD} flex flex-col gap-2 pb-4`}>
                {events.map((event) => (
                  <EventLine key={`${event.symbol}:${event.kind}:${event.day}`} event={event} />
                ))}
              </ul>
            </section>
          )}

          <section
            aria-labelledby={owner ? `${sectionId}-river` : undefined}
            aria-label={owner ? undefined : copy.newsTitle}
            className={owner ? "border-t border-border" : undefined}
          >
            {owner && subheading(`${sectionId}-river`, copy.newsAcrossBerth)}
            {riverAll.length === 0 ? (
              <p className={`border-t border-border ${PAD} py-4 text-sm text-muted-foreground`}>
                {filter ? copy.newsEmptyFor(filter.name) : copy.newsEmpty}
              </p>
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                <motion.ul
                  key={filter?.symbol ?? "all"}
                  variants={LIST}
                  initial="hidden"
                  animate="shown"
                  exit="gone"
                  id={listId}
                  className="divide-y divide-border border-t border-border"
                  ref={riverRef}
                  {...riverHandlers}
                >
                  <AnimatePresence mode="popLayout" initial={false}>
                    {rotated.map((story) => (
                      <motion.li
                        key={story.id}
                        data-post-id={story.id}
                        data-focused={pin && story.storyId === pin.storyId ? "" : undefined}
                        // Focusable from code only: focus lands here, and its first words say what it is.
                        tabIndex={pin && story.storyId === pin.storyId ? -1 : undefined}
                        className={pin && story.storyId === pin.storyId ? "bg-muted/50 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset" : undefined}
                        variants={CARD}
                        exit="leave"
                        layout="position"
                        transition={{ layout: ARRIVE }}
                      >
                        {pin && story.storyId === pin.storyId && <span className="sr-only">{copy.newsOpenedStory}</span>}
                        {card(story)}
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </motion.ul>
              </AnimatePresence>
            )}
          </section>
        </>
      )}
      {collapsible && !news.isLoading && riverAll.length + reserveAll.length > COLLAPSED_LIMIT && (
        <DisclosureRow open={open} onToggle={toggle} controls={listId} label={copy.newsMoreStories} />
      )}
    </Panel>
  );
}

type CardProps = {
  story: StoryCard;
  now: number;
  isNew: boolean;
  movement: { moved: { changePct?: number } | undefined; direction: ChangeDirection | undefined };
  verdictChip: (verdict: Verdict) => React.ReactNode;
};

/** A dated line, written by code from EDGAR's record, and a link to the filing itself. */
function EventLine({ event }: { event: EventCard }) {
  const copy = useCopy();
  if (event.kind !== "filing" || !event.report) return null;
  return (
    <li className="text-sm text-foreground">
      {copy.eventFiling(event.name, event.report, longDate(event.day))}
      {event.url && (
        <>
          {" "}
          <a
            href={event.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {copy.eventReadOnSec}
            <ArrowUpRight className="size-3" aria-hidden />
          </a>
        </>
      )}
    </li>
  );
}

/** An article: the verbatim title as the link, the publisher and time, and who else reported it. */
function ArticleCard({ story, now, isNew, movement, verdictChip }: CardProps) {
  const copy = useCopy();
  const [others, setOthers] = useState(false);
  const othersId = useId();
  const { moved, direction } = movement;
  return (
    <div className={`flex items-start gap-3 ${PAD} py-4`}>
      <span
        aria-hidden="true"
        className="money flex size-11 shrink-0 flex-col items-center justify-center rounded-lg bg-muted text-[10.5px] leading-none font-semibold tracking-tight"
      >
        <span className="text-foreground/80">{story.symbol}</span>
        {moved?.changePct !== undefined && direction && (
          <span className={`mt-0.5 text-[8.5px] ${TONE[direction]}`}>{formatPercentChange(moved.changePct, 1)}</span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <a
          href={story.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track("news_story_opened", { listing: story.symbol, source_kind: story.kind })}
          className="group flex items-start gap-2 text-sm leading-snug font-medium text-foreground"
        >
          <span className="line-clamp-2 min-w-0 flex-1 underline-offset-2 group-hover:underline">{story.title}</span>
          <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        </a>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          <p className="min-w-0">
            <span className="text-foreground/70">{story.name}</span>
            <span aria-hidden="true"> · </span>
            {copy.newsByline(story.publisher, formatTimeAgo(story.publishedAt, now))}
          </p>
          {story.verdict && verdictChip(story.verdict)}
          {isNew && (
            <span title={copy.postNewToYouLabel} className="shrink-0 text-[10.5px] font-medium text-foreground">
              {copy.postNewToYou}
            </span>
          )}
        </div>
        {story.alsoReportedBy.length > 0 && (
          <div className="mt-1.5 text-[11px] text-muted-foreground">
            <button
              type="button"
              aria-expanded={others}
              aria-controls={othersId}
              onClick={() => setOthers((value) => !value)}
              className="hit-y inline-flex items-center gap-0.5 hover:text-foreground"
            >
              {copy.alsoReportedBy(story.alsoReportedBy.length)}
              <CaretDown className={`size-3 transition-transform duration-150 ${others ? "rotate-180" : ""}`} aria-hidden />
            </button>
            {others && (
              <ul id={othersId} className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {story.alsoReportedBy.map((other) => (
                  <li key={other.url}>
                    <a
                      href={other.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground/80 underline underline-offset-2 hover:text-foreground"
                    >
                      {other.publisher}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {story.alsoOnX.length > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
            <span>{copy.alsoOnX}</span>
            {story.alsoOnX.map((account, index) => (
              <span key={account.url}>
                <a
                  href={account.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground/80 underline underline-offset-2 hover:text-foreground"
                >
                  {account.name}
                </a>
                {index < story.alsoOnX.length - 1 ? "," : ""}
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

/** A post, as X asks a post outside an embed to be shown: name, handle, face, full text, the whole card a link. */
function PostCard({ story, now, isNew, movement, verdictChip }: CardProps) {
  const copy = useCopy();
  const post = story.post!;
  const { moved, direction } = movement;
  return (
    <>
    <a
      href={story.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track("news_story_opened", { listing: story.symbol, source_kind: story.kind })}
      className={`flex items-start gap-3 ${PAD} py-4 transition-[background-color] duration-150 ease-lift hover:bg-muted/60`}
    >
      {/* A plain img on purpose: small files already on X's own CDN. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={post.author.avatarUrl}
        alt=""
        width={44}
        height={44}
        loading="lazy"
        className="size-11 shrink-0 rounded-full bg-muted object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-baseline text-xs">
          <span className="mr-1.5 min-w-0 shrink truncate font-medium text-foreground">{post.author.name}</span>
          <span className="min-w-0 truncate text-muted-foreground [flex-shrink:100000]">
            {copy.postsHandle(post.author.username)}
            {" "}
          </span>
          <span className="shrink-0 whitespace-nowrap text-muted-foreground">{formatTimeAgo(story.publishedAt, now)}</span>
          {isNew && (
            <span title={copy.postNewToYouLabel} className="ml-1.5 shrink-0 text-[10.5px] font-medium text-foreground">
              {copy.postNewToYou}
            </span>
          )}
        </p>
        {/* Verbatim, and clamped rather than cut: editing a post to fit is not ours to do. */}
        <p className="mt-1 line-clamp-5 text-sm leading-normal whitespace-pre-line text-foreground">{story.title}</p>
        {story.alsoOnX.length > 0 && (
          <p className="mt-1 text-[11px] text-muted-foreground">{copy.postsAlsoBy(story.alsoOnX.map((other) => other.name))}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px]">
          <p className="flex items-center gap-1.5">
            <span className="text-foreground/70">{story.name}</span>
            {moved?.changePct !== undefined && direction && (
              <span className={`money ${TONE[direction]}`}>{formatPercentChange(moved.changePct, 1)}</span>
            )}
            {story.verdict && verdictChip(story.verdict)}
          </p>
          <span
            className="flex shrink-0 items-center gap-2 text-muted-foreground"
            aria-label={copy.postsMetrics(formatCount(post.replies), formatCount(post.retweets), formatCount(post.likes))}
          >
            {[
              { icon: ChatCircle, value: post.replies },
              { icon: Repeat, value: post.retweets },
              { icon: Heart, value: post.likes },
            ].map(({ icon: Glyph, value }, index) =>
              value > 0 ? (
                <span key={index} aria-hidden="true" className="flex items-center gap-1">
                  <Glyph className="size-3.5" />
                  <span className="money">{formatCount(value)}</span>
                </span>
              ) : null,
            )}
          </span>
        </div>
      </div>
      <XLogo aria-label={copy.postsSourceLabel} className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
    </a>
    {/* Outside the card's own link, which nothing may sit inside: the
        publishers that carried the same story, each its own link. */}
    {story.alsoReportedBy.length > 0 && (
      <p className={`-mt-2.5 flex flex-wrap items-center gap-x-1.5 ${PAD} pb-4 pl-[74px] text-[11px] text-muted-foreground lg:pl-[80px]`}>
        <span>{copy.alsoReportedByPrefix}</span>
        {story.alsoReportedBy.map((other, index) => (
          <span key={other.url}>
            <a href={other.url} target="_blank" rel="noopener noreferrer" className="text-foreground/80 underline underline-offset-2 hover:text-foreground">
              {other.publisher}
            </a>
            {index < story.alsoReportedBy.length - 1 ? "," : ""}
          </span>
        ))}
      </p>
    )}
    </>
  );
}
