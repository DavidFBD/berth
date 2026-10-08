"use client";

import { trackOnce } from "@/lib/analytics";
import { useEffect, useId } from "react";
import { CaretRight, ChatCircleText, SidebarSimple } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { TickerTile } from "@/components/board/holdings-list";
import { useCopy } from "@/components/settings-provider";
import { useFirstLook } from "@/hooks/use-first-look";
import { Skeleton } from "@/components/ui/skeleton";
import { newsOf, type FirstLookState } from "@/lib/first-look";
import { formatTimeAgo } from "@/lib/news";
import type { StoryCard } from "@/lib/news-stories";
import { rowName, type TokenListing } from "@/lib/listings";
import { cn } from "@/lib/utils";

/**
 * The first look at one stock (lib/first-look): whether it is in the recent
 * news, with the one headline that says so (a visible News label, title,
 * publisher, time, then "News to read, not advice." straight under it, so
 * beside Buy it reads as news and never as a recommendation), a large
 * move in code's numbers, and a way to the news drawer, where the column's
 * own rules apply. The headline opens the drawer on itself, never the
 * article: the link out lives in the drawer, one step from Buy. Jev decided
 * which line is true and which headline passed; no post text, ever.
 *
 * When nothing passed there is no news line, never "nothing in the news". While the answer comes the place is held; when there is
 * nothing true to say there is no box at all.
 */
export function FirstLookReadingView({
  listing,
  look,
  onAsk,
  onReadNews,
}: {
  listing: TokenListing;
  look: FirstLookState;
  /** Opens Ask with a factual question; absent while Ask is locked or off. */
  onAsk?: (prompt: string) => void;
  /** Opens the news drawer on this listing, with `focus` first when the headline was tapped. */
  onReadNews?: (focus?: StoryCard) => void;
}) {
  const copy = useCopy();
  const words = copy.firstLook;
  const name = rowName(listing);
  const opensId = useId();
  // Shown once a page session per listing (lib/analytics): which lines were true, never the words.
  const said = look.kind === "hidden" || look.kind === "loading" ? null : look.look;
  const story = newsOf(said ?? undefined);
  const inNewsShown = story !== undefined;
  const movedShown = said?.movePct !== undefined;
  useEffect(() => {
    if (said) trackOnce(`first-look:${listing.symbol}`, "first_look_shown", { listing: listing.symbol, in_news: inNewsShown, moved: movedShown });
  }, [Boolean(said), listing.symbol, inNewsShown, movedShown]); // eslint-disable-line react-hooks/exhaustive-deps
  if (look.kind === "hidden") return null;
  if (look.kind === "loading") {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-border px-4 py-3.5" aria-hidden>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-56" />
      </div>
    );
  }
  const { movePct } = look.look;
  // Only with its headline (lib/first-look newsOf): today's line, else the week's, else no news line.
  const inNews = story !== undefined;
  const today = inNews && look.look.looked && look.look.inNews;
  const drawer = inNews && onReadNews !== undefined;

  return (
    <div className="rounded-2xl border border-border px-4 py-3.5 text-[14.5px] leading-snug text-foreground">
      {inNews && <p>{today ? words.inNews(name) : words.inNewsWeek(name)}</p>}
      {inNews && (
        <InlineHeadline
          story={story}
          onOpen={drawer ? () => onReadNews(story) : undefined}
          describedBy={opensId}
          label={words.newsLabel}
          byline={copy.newsByline(story.publisher, formatTimeAgo(story.publishedAt))}
        />
      )}
      {inNews && <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{words.newsNote}</p>}
      {movePct !== undefined && (
        <p className={cn(inNews && "mt-2.5")}>
          {words.move(name, movePct >= 0 ? "rose" : "fell", `${Math.abs(movePct).toFixed(1)}%`)}
        </p>
      )}
      {drawer && (
        <span id={opensId} className="sr-only">
          {words.opensPanel}
        </span>
      )}
      {(drawer || onAsk) && (
        <div className="mt-1.5 -ml-1 flex flex-wrap gap-x-4">
          {drawer && (
            <button
              type="button"
              onClick={() => onReadNews()}
              aria-haspopup="dialog"
              aria-describedby={opensId}
              className={QUIET_ACTION}
            >
              <SidebarSimple weight="duotone" mirrored aria-hidden className="size-4 text-muted-foreground" />
              {words.moreNews(name)}
            </button>
          )}
          {onAsk && (
            <button type="button" onClick={() => onAsk(words.askPrompt(name))} className={QUIET_ACTION}>
              <ChatCircleText weight="duotone" aria-hidden className="size-4 text-muted-foreground" />
              {words.ask(name)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const QUIET_ACTION =
  "inline-flex min-h-9 items-center gap-1.5 rounded-full px-1 text-[13.5px] text-secondary-foreground outline-none transition-colors duration-150 ease-lift hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * The one headline, compact: the News label, the title (two lines at most),
 * then publisher and time. A button into the news drawer, never a link out,
 * so it carries no arrow; without a drawer it is plain text.
 */
function InlineHeadline({
  story,
  onOpen,
  describedBy,
  label,
  byline,
}: {
  story: StoryCard;
  onOpen?: () => void;
  describedBy: string;
  label: string;
  byline: string;
}) {
  const body = (
    <>
      <span className="mb-1 flex w-fit items-center rounded-full border border-border px-2 py-px text-[11px] leading-4 font-medium tracking-[0.02em] text-muted-foreground">
        {label}
      </span>
      <span className="line-clamp-2 text-[13.5px] leading-snug font-medium text-foreground">{story.title}</span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{byline}</span>
    </>
  );
  if (!onOpen) return <p className="mt-2.5 border-l-2 border-border pl-3">{body}</p>;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-describedby={describedBy}
      className="group mt-2.5 -mx-1 flex w-[calc(100%+0.5rem)] items-start gap-2 rounded-xl px-1 py-1 text-left outline-none transition-colors duration-150 ease-lift hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="min-w-0 flex-1 border-l-2 border-border pl-3">{body}</span>
      <CaretRight weight="duotone" aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
    </button>
  );
}

/**
 * (c) The first stock, the first days after it lands: what it is in one
 * plain line, the recent reading, and one "Got it" that closes it for good.
 */
export function FirstStockCard({
  listing,
  inWallet = false,
  onAsk,
  onReadNews,
  onDismiss,
}: {
  listing: TokenListing;
  /** It was delivered to the person's own wallet on Robinhood Chain, not to the Berth account. */
  inWallet?: boolean;
  onAsk?: (prompt: string) => void;
  onReadNews?: (listing: TokenListing, focus?: StoryCard) => void;
  onDismiss: () => void;
}) {
  const allCopy = useCopy();
  const copy = allCopy.firstLook;
  const { lookOf } = useFirstLook(listing.symbol);
  const look = lookOf(listing.symbol);
  const name = rowName(listing);
  return (
    <Panel>
      <div className="px-[18px] pt-5 pb-4 lg:px-6 lg:pt-6">
        <div className="flex items-center gap-3">
          <TickerTile symbol={listing.symbol} />
          <h2 className="font-display text-[22px] leading-[1.15] tracking-[-0.022em] text-foreground">{copy.firstStockTitle}</h2>
        </div>
        <p className="mt-2.5 text-[14.5px] leading-[1.55] text-muted-foreground">{inWallet ? allCopy.rhChain.firstStockLine(name) : copy.firstStockLine(name)}</p>
        {look.kind !== "hidden" && (
          <div className="mt-4">
            <FirstLookReadingView
              listing={listing}
              look={look}
              onAsk={onAsk}
              onReadNews={onReadNews ? (focus) => onReadNews(listing, focus) : undefined}
            />
          </div>
        )}
        <Button variant="outline" className="mt-4 h-10 w-full rounded-full text-[14px]" onClick={onDismiss}>
          {copy.dismiss}
        </Button>
      </div>
    </Panel>
  );
}
