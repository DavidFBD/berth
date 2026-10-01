"use client";

import { ChatCircleText, Newspaper } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { TickerTile } from "@/components/board/holdings-list";
import { useCopy } from "@/components/settings-provider";
import { useFirstLook } from "@/hooks/use-first-look";
import { Skeleton } from "@/components/ui/skeleton";
import type { FirstLookState } from "@/lib/first-look";
import { rowName, type TokenListing } from "@/lib/listings";
import { cn } from "@/lib/utils";

/**
 * The first look at one stock (lib/first-look). Only Berth's fixed lines:
 * whether it is in today's news, a large move in code's numbers, and a quiet
 * way to the news drawer, where the column's own rules apply. No headline or
 * post text, ever, beside Buy. Jev only decided which line is true.
 *
 * "Nothing in today's news" is said only when Jev read every one of today's
 * headlines. While the answer comes the place is held; when there is
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
  /** Opens the news drawer on this listing. */
  onReadNews?: () => void;
}) {
  const words = useCopy().firstLook;
  const name = rowName(listing);
  if (look.kind === "hidden") return null;
  if (look.kind === "loading") {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-border px-4 py-3.5" aria-hidden>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-56" />
      </div>
    );
  }
  const { looked, inNews, movePct } = look.look;

  return (
    <div className="rounded-2xl border border-border px-4 py-3.5 text-[14.5px] leading-snug text-foreground">
      {looked && <p>{inNews ? words.inNews(name) : words.nothingToday(name)}</p>}
      {movePct !== undefined && (
        <p className={cn(looked && "mt-1.5")}>
          {words.move(name, movePct >= 0 ? "rose" : "fell", `${Math.abs(movePct).toFixed(1)}%`)}
        </p>
      )}
      {looked && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{inNews ? words.newsNote : words.credit}</p>}
      {((looked && inNews && onReadNews) || onAsk) && (
        <div className="mt-1.5 -ml-1 flex flex-wrap gap-x-4">
          {looked && inNews && onReadNews && (
            <button
              type="button"
              onClick={onReadNews}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-1 text-[13.5px] text-secondary-foreground outline-none transition-colors duration-150 ease-lift hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Newspaper weight="duotone" aria-hidden className="size-4 text-muted-foreground" />
              {words.readNews}
            </button>
          )}
          {onAsk && (
            <button
              type="button"
              onClick={() => onAsk(words.askPrompt(name))}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-1 text-[13.5px] text-secondary-foreground outline-none transition-colors duration-150 ease-lift hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ChatCircleText weight="duotone" aria-hidden className="size-4 text-muted-foreground" />
              {words.ask(name)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * (c) The first stock, the first days after it lands: what it is in one
 * plain line, today's reading, and one "Got it" that closes it for good.
 */
export function FirstStockCard({
  listing,
  onAsk,
  onReadNews,
  onDismiss,
}: {
  listing: TokenListing;
  onAsk?: (prompt: string) => void;
  onReadNews?: (listing: TokenListing) => void;
  onDismiss: () => void;
}) {
  const copy = useCopy().firstLook;
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
        <p className="mt-2.5 text-[14.5px] leading-[1.55] text-muted-foreground">{copy.firstStockLine(name)}</p>
        {look.kind !== "hidden" && (
          <div className="mt-4">
            <FirstLookReadingView
              listing={listing}
              look={look}
              onAsk={onAsk}
              onReadNews={onReadNews ? () => onReadNews(listing) : undefined}
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
