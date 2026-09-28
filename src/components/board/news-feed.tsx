"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUpRight,
  ChatCircle,
  Heart,
  Repeat,
  X,
  XLogo,
} from "@phosphor-icons/react";
import { ThinkingOrb } from "@/components/ui/thinking-orb";
import { JevMark } from "@/components/jev-mark";
import { DisclosureRow, useDisclosure } from "@/components/board/disclosure";
import { Panel, SectionHeading } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopy } from "@/components/settings-provider";
import { useListingNews } from "@/hooks/use-listing-news";
import { useListingX } from "@/hooks/use-listing-x";
import { useListingPerformance } from "@/hooks/use-listing-performance";
import { useRotatingFeed } from "@/hooks/use-rotating-feed";
import { useSeenPosts } from "@/hooks/use-seen-posts";
import { TOKEN_LISTINGS, type TokenListing } from "@/lib/listings";
import { EASE_LIFT } from "@/lib/motion";
import { formatTimeAgo } from "@/lib/news";
import { formatCount, type Verdict } from "@/lib/x-feed";
import {
  changeDirection,
  formatPercentChange,
  type ChangeDirection,
} from "@/lib/performance";

/** Text colour per direction, matching the board's. */
const TONE: Record<ChangeDirection, string> = {
  up: "text-good",
  down: "text-bad",
  flat: "text-muted-foreground",
};

const LISTING_BY_SYMBOL = new Map(
  TOKEN_LISTINGS.map((listing) => [listing.symbol, listing]),
);

/** The river settles one card after another rather than all at once. */
const LIST = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.03 } },
  gone: { opacity: 0, transition: { duration: 0.12 } },
};
const CARD = {
  hidden: { opacity: 0, y: 8 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE_LIFT } },
  // A rotated-out card fades where it stands while the rest close up under it.
  leave: { opacity: 0, transition: { duration: 0.2, ease: EASE_LIFT } },
};
/** A rotated-in card arrives slower than the first settle: it is news, not layout. */
const ARRIVE = { duration: 0.5, ease: EASE_LIFT };

/** Where Jev's name links: its maker, where the claim can be checked. */
const JEV_URL = "https://typesafe.ai";

/** Cards a collapsible column shows closed, and open. */
const COLLAPSED_LIMIT = 2;
const EXPANDED_LIMIT = 8;

/** Posts lead, because they are the livelier half and the reason to look. */
type Tab = "posts" | "headlines";

/**
 * What is being said about the listings, newest first, in two registers.
 *
 * **Posts** is X: the companies' own accounts and thirty market desks,
 * whitelisted, because a cashtag search returns watchlist spam and
 * copypasta. It leads, since a wire story is usually two hours old by the
 * time Nasdaq carries it and a post is minutes old.
 *
 * **Headlines** is the original river of publisher stories, unchanged.
 *
 * Neither ever shows the article or unfurls a link preview: the words belong
 * to whoever wrote them, and every card leaves the app, which the mark in
 * the corner says. A post additionally carries its author's name, handle and
 * avatar and links to the post itself, which is what X asks of anyone
 * displaying one outside an embed. Its text is never trimmed to fit for the
 * same reason, so the card clamps and the link finishes the sentence.
 *
 * `filter` narrows both tabs to one listing, which the board sets from a row
 * on a desktop. Each list is keyed on the tab and the filter together, so
 * either change plays as one swap rather than twelve independent ones.
 *
 * Silence is not failure. A quiet hour, a stale feed, an expired token and a
 * blocked request all end here as the same calm line, because none of them
 * is something a reader can act on.
 */
export function NewsFeed({
  filter,
  onClearFilter,
  limit: limitProp,
  fill = false,
  collapsible = false,
}: {
  filter?: TokenListing | null;
  onClearFilter?: () => void;
  /**
   * Fewer cards at once, for the welcome screen, where the column is a
   * window on the market beside the way in and not the page. The cards past
   * the limit join the rotation rather than being dropped.
   */
  limit?: number;
  /**
   * Take the height the grid row gives it instead of setting it. With
   * `contain: size` the column contributes nothing to the row's height, so
   * the row is as tall as its neighbour (the board) and the column fills
   * exactly that, clipping at its bottom edge. Only where the column sits
   * beside something in the same row: from 1280px. Below that it stacks,
   * and a contained column would collapse to nothing.
   */
  fill?: boolean;
  /**
   * Two cards, then "More posts" (or headlines) opens eight. The board's
   * column, where the news is one section among several.
   */
  collapsible?: boolean;
}) {
  const copy = useCopy();
  const [tab, setTab] = useState<Tab>("posts");
  const [open, toggle, listId] = useDisclosure("news");
  const limit = collapsible ? (open ? EXPANDED_LIMIT : COLLAPSED_LIMIT) : limitProp;
  const news = useListingNews(filter?.symbol);
  const posts = useListingX(filter?.symbol);
  const performance = useListingPerformance();
  // Posts turn slowly through everything Jev kept this refresh; headlines
  // and the loading state stand still.
  const shownPosts = limit ? posts.items.slice(0, limit) : posts.items;
  const reservePosts = limit ? [...posts.items.slice(limit), ...posts.reserve] : posts.reserve;
  const river = useRotatingFeed(shownPosts, reservePosts, tab === "posts");
  // "New" on the cards this browser has not been shown before (lib/seen-posts).
  const seen = useSeenPosts(
    posts.items.concat(posts.reserve),
    river.visible,
    tab === "posts",
    river.node,
  );
  const headlines = limit ? news.items.slice(0, limit) : news.items;
  const verdictWord: Record<Verdict, string> = {
    material: copy.jevVerdictMaterial,
    fact: copy.jevVerdictFact,
    analysis: copy.jevVerdictAnalysis,
  };
  const count = (value: number) => value.toLocaleString("en-US");

  const showing = tab === "posts" ? posts : news;
  const tabs: { id: Tab; label: string }[] = [
    { id: "posts", label: copy.newsTabPosts },
    { id: "headlines", label: copy.newsTabHeadlines },
  ];

  /** The listing tile's figures, shared by both kinds of card. */
  const movement = (symbol: string) => {
    const listing = LISTING_BY_SYMBOL.get(symbol);
    const moved = listing ? performance.performanceOf(listing) : undefined;
    return { moved, direction: changeDirection(moved?.changePct) };
  };

  return (
    <Panel
      surface="sheet"
      className={
        fill ? "xl:flex xl:h-full xl:flex-col xl:overflow-hidden xl:[contain:size]" : undefined
      }
    >
      <SectionHeading
        title={copy.newsTitle}
        hint={tab === "posts" ? copy.postsHint : copy.newsHint}
        more={
          tab === "posts" && posts.curation ? (
            <>
              <p className="mt-1.5">{copy.jevAbout}</p>
              <p className="mt-1.5 text-muted-foreground">
                {copy.jevCuration(
                  count(posts.curation.seen),
                  count(posts.curation.accounts),
                  count(posts.curation.read),
                  count(posts.curation.kept),
                )}
              </p>
              <a
                href={JEV_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex items-center gap-0.5 font-medium text-foreground underline-offset-2 hover:underline"
              >
                {copy.jevLinkLabel}
                <ArrowUpRight className="size-3" aria-hidden />
              </a>
            </>
          ) : undefined
        }
        action={
          <div
            role="tablist"
            aria-label={copy.newsTabsLabel}
            className="flex shrink-0 gap-0.5 rounded-full bg-muted p-0.5"
          >
            {tabs.map((entry) => {
              const active = entry.id === tab;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(entry.id)}
                  className={`relative rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors duration-150 ease-lift ${
                    active
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="news-tab"
                      transition={{ duration: 0.22, ease: EASE_LIFT }}
                      className="absolute inset-0 rounded-full bg-background shadow-xs"
                    />
                  )}
                  <span className="relative">{entry.label}</span>
                </button>
              );
            })}
          </div>
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
              className="flex items-center gap-2 px-4 pb-2.5"
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {tab === "posts" && posts.curation && (
        <div className="flex items-center gap-1.5 px-4 pb-3 text-[11px]">
          {/* A 20px slot either way: Jev's still mark, or an orb while the feed is being fetched. */}
          {posts.isFetching ? (
            <ThinkingOrb state="searching" size={20} decorative />
          ) : (
            <span className="flex size-5 items-center justify-center" aria-hidden>
              <JevMark className="size-3.5 text-foreground" />
            </span>
          )}
          <span className="font-medium text-foreground">{copy.jevCuratedBy}</span>
        </div>
      )}

      {showing.isLoading ? (
        <ul className="divide-y divide-border border-t border-border">
          {/* As many as will show, up to three, so nothing jumps when they land. */}
          {Array.from({ length: Math.min(limit ?? 3, 3) }, (_, row) => row).map((row) => (
            <li key={row} className="flex items-start gap-3 px-4 py-3">
              <Skeleton
                className={`size-11 shrink-0 ${tab === "posts" ? "rounded-full" : "rounded-lg"}`}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </li>
          ))}
        </ul>
      ) : showing.items.length === 0 ? (
        <p className="border-t border-border px-4 py-4 text-sm text-muted-foreground">
          {tab === "posts"
            ? filter
              ? copy.postsEmptyFor(filter.name)
              : copy.postsEmpty
            : filter
              ? copy.newsEmptyFor(filter.name)
              : copy.newsEmpty}
        </p>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.ul
            key={`${tab}:${filter?.symbol ?? "all"}`}
            variants={LIST}
            initial="hidden"
            animate="shown"
            exit="gone"
            id={listId}
            className="divide-y divide-border border-t border-border"
            ref={tab === "posts" ? river.ref : undefined}
            {...(tab === "posts" ? river.handlers : {})}
          >
            {tab === "posts" ? (
              // popLayout lets the leaving card step out of the flow at once,
              // so the column never grows by one while it turns.
              <AnimatePresence mode="popLayout" initial={false}>
                {river.visible.map((post) => {
                  const { moved, direction } = movement(post.symbol);
                  return (
                    <motion.li
                      key={post.id}
                      data-post-id={post.id}
                      variants={CARD}
                      exit="leave"
                      layout="position"
                      transition={{ layout: ARRIVE }}
                    >
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-3 px-4 py-3 transition-[background-color] duration-150 ease-lift hover:bg-muted/60"
                      >
                        {/* Name, handle and face travel with the post, and
                            the whole card opens the original. That is what
                            X asks of a post shown outside an embed. */}
                        {/* A plain img on purpose: these are 73px files
                            already served from X's own CDN, there are about
                            two dozen distinct ones, and routing them through
                            next/image would buy nothing but a per-image
                            charge on every optimisation. */}
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
                          {/* At 390px the row runs out. The handle gives
                              way first, down to nothing, then the name; the
                              time and the mark never do, because the time is
                              the column's honesty about age. */}
                          <p className="flex min-w-0 items-baseline text-xs">
                            <span className="mr-1.5 min-w-0 shrink truncate font-medium text-foreground">
                              {post.author.name}
                            </span>
                            {/* The handle carries its own trailing space
                                and there is no gap before the time, so a
                                handle squeezed to nothing leaves nothing
                                behind. */}
                            <span className="min-w-0 truncate text-muted-foreground [flex-shrink:100000]">
                              {copy.postsHandle(post.author.username)}
                              {"\u00a0"}
                            </span>
                            <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                              {formatTimeAgo(post.publishedAt)}
                            </span>
                            {/* Ink, not accent, and a word rather than a
                                chip: the Jev verdict below is the card's
                                one badge, and this only says the reader
                                has not met the post yet. */}
                            {seen.isNew(post.id) && (
                              <span
                                title={copy.postNewToYouLabel}
                                className="ml-1.5 shrink-0 text-[10.5px] font-medium text-foreground"
                              >
                                {copy.postNewToYou}
                              </span>
                            )}
                          </p>
                          {/* Verbatim, and clamped rather than cut: editing
                              a post to fit is not ours to do. */}
                          <p className="mt-1 line-clamp-5 text-sm leading-snug whitespace-pre-line text-foreground">
                            {post.text}
                          </p>
                          {/* Wraps rather than squeezes: at a narrow column
                              the counts drop to their own line instead of
                              crushing the listing's name to nothing. */}
                          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px]">
                            <p className="flex items-center gap-1.5">
                              <span className="text-foreground/70">
                                {post.name}
                              </span>
                              {moved?.changePct !== undefined && direction && (
                                <span className={`money ${TONE[direction]}`}>
                                  {formatPercentChange(moved.changePct, 1)}
                                </span>
                              )}
                              {post.verdict && (
                                <span
                                  title={copy.jevVerdictLabel(verdictWord[post.verdict])}
                                  aria-label={copy.jevVerdictLabel(verdictWord[post.verdict])}
                                  className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-px text-[10.5px] text-muted-foreground"
                                >
                                  <JevMark className="size-2.5" />
                                  {verdictWord[post.verdict]}
                                </span>
                              )}
                            </p>
                            {/* How far the post carried, in X's own order.
                                Quiet on purpose: it is context for the post
                                above it, not a scoreboard, so it sits in the
                                muted tone and a count of zero is simply
                                absent rather than written as "0". The figures
                                are as fresh as the cache, up to an hour. */}
                            <span
                              className="flex shrink-0 items-center gap-2 text-muted-foreground"
                              aria-label={copy.postsMetrics(
                                formatCount(post.replies),
                                formatCount(post.retweets),
                                formatCount(post.likes),
                              )}
                            >
                              {[
                                { icon: ChatCircle, value: post.replies },
                                { icon: Repeat, value: post.retweets },
                                { icon: Heart, value: post.likes },
                              ].map(({ icon: Glyph, value }, index) =>
                                value > 0 ? (
                                  <span
                                    key={index}
                                    aria-hidden="true"
                                    className="flex items-center gap-1"
                                  >
                                    <Glyph className="size-3.5" />
                                    <span className="money">
                                      {formatCount(value)}
                                    </span>
                                  </span>
                                ) : null,
                              )}
                            </span>
                          </div>
                        </div>
                        <XLogo
                          aria-label={copy.postsSourceLabel}
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        />
                      </a>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            ) : (
              headlines.map((item) => {
                  const { moved, direction } = movement(item.symbol);
                  return (
                    <motion.li key={item.url} variants={CARD}>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-3 px-4 py-3 transition-[background-color] duration-150 ease-lift hover:bg-muted/60"
                      >
                        {/* The ticker, in the face the app reserves for
                            numbers, tinted by how the listing moved. It says
                            at a glance which of twelve stories is about the
                            thing you hold. */}
                        <span
                          aria-hidden="true"
                          className="money flex size-11 shrink-0 flex-col items-center justify-center rounded-lg bg-muted text-[10.5px] leading-none font-semibold tracking-tight"
                        >
                          <span className="text-foreground/80">
                            {item.symbol}
                          </span>
                          {moved?.changePct !== undefined && direction && (
                            <span
                              className={`mt-0.5 text-[8.5px] ${TONE[direction]}`}
                            >
                              {formatPercentChange(moved.changePct, 1)}
                            </span>
                          )}
                        </span>

                        <div className="min-w-0 flex-1">
                          {/* Two lines, then it stops: a river of headlines
                              is for scanning, and the publisher's page has
                              the rest. */}
                          <p className="line-clamp-2 text-sm leading-snug font-medium text-foreground">
                            {item.title}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            <span className="text-foreground/70">
                              {item.name}
                            </span>
                            {/* Punctuation, not copy: the separator belongs
                                to the layout, the words on either side to
                                lib/copy. */}
                            <span aria-hidden="true"> · </span>
                            {copy.newsByline(
                              item.source,
                              formatTimeAgo(item.publishedAt),
                            )}
                          </p>
                        </div>
                        <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      </a>
                    </motion.li>
                  );
                })
            )}
          </motion.ul>
        </AnimatePresence>
      )}
      {collapsible &&
        !showing.isLoading &&
        (tab === "posts" ? posts.items.length + posts.reserve.length : news.items.length) > COLLAPSED_LIMIT && (
          <DisclosureRow
            open={open}
            onToggle={toggle}
            controls={listId}
            label={tab === "posts" ? copy.newsMorePosts : copy.newsMoreHeadlines}
          />
        )}
    </Panel>
  );
}
