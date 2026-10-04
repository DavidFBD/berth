"use client";

import { useState, type ReactNode } from "react";
import { CaretRight, Check, Plus } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { TickerTile } from "@/components/board/holdings-list";
import { useCopy, useMoney } from "@/components/settings-provider";
import { useListingPerformance } from "@/hooks/use-listing-performance";
import { useListingPrices } from "@/hooks/use-listing-prices";
import { useFirstLook } from "@/hooks/use-first-look";
import { FIRST_LOOK_SYMBOLS } from "@/lib/first-look";
import { FirstLookReadingView } from "@/components/first-look";
import { STOCK_LISTINGS, rowName, type TokenListing } from "@/lib/listings";
import { changeDirection, formatPercentChange, type ChangeDirection } from "@/lib/performance";
import { cn } from "@/lib/utils";

/**
 * The home's one next step (2026-10-01, the calm home): each state of an
 * account gets one card at the top and one accent in it. Add money while
 * there is none, choose a first stock once there is, and, once the account
 * owns something, a single Buy under what it owns. Everything else on the
 * page comes after it, at a quieter pitch.
 */

/**
 * What the guided path (components/first-path) adds to a step's card: its
 * progress line above the title, and a quiet skip under the action.
 */
export type StepFrame = { eyebrow?: ReactNode; footer?: ReactNode };

/** The card a next step sits in: a heading, a line, then what to do. */
export function StepCard({
  title,
  line,
  children,
  frame,
}: {
  title: string;
  line: ReactNode;
  children: ReactNode;
  frame?: StepFrame;
}) {
  return (
    <Panel>
      <div className="px-[18px] pt-5 pb-4 lg:px-6 lg:pt-6">
        {frame?.eyebrow}
        <h2 className="font-display text-[24px] leading-[1.15] tracking-[-0.022em] text-foreground lg:text-[28px]">{title}</h2>
        <div className="mt-2 text-[14.5px] leading-[1.55] text-muted-foreground">{line}</div>
      </div>
      {children}
      {frame?.footer}
    </Panel>
  );
}

/** The step's one accent: a full width pill. */
export const PRIMARY = "h-11 w-full rounded-full text-[15px] font-medium";

/** A quiet way on, under the accent. */
export function QuietLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mx-auto flex min-h-11 items-center gap-1 rounded-full px-3 text-[13.5px] text-secondary-foreground outline-none transition-colors duration-150 ease-lift hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {children}
      <CaretRight weight="duotone" aria-hidden className="size-3.5 text-muted-foreground" />
    </button>
  );
}

/** Money the account has set aside, which the empty step names instead of calling the account empty. */
export type MoneyAside = { kind: "cash" } | { kind: "vault"; usd: number | undefined };

/**
 * (a) Not enough to spend and nothing held. An email account adds money
 * (card, bank or crypto, in the add-money drawer). A wallet account pays
 * from the wallet it connected, so for it the step is choosing a stock.
 * Money set aside (parked cash, an earlier vault position) is named, and
 * pointed at in its own row just below rather than offered twice.
 */
export function AddMoneyStep({
  walletAccount,
  onAddMoney,
  onBrowse,
  aside,
  frame,
  title: titleOverride,
  note,
}: {
  /** A quiet line under the action (a campaign's rules, inside the guided path). */
  note?: ReactNode;
  walletAccount: boolean;
  onAddMoney: () => void;
  onBrowse: () => void;
  aside?: MoneyAside;
  /** The guided path's progress line and skip (components/first-path). */
  frame?: StepFrame;
  /** The guided path names the step itself. */
  title?: string;
}) {
  const copy = useCopy().calmHome;
  const money = useMoney();
  const title = titleOverride ?? (walletAccount ? copy.walletAddTitle : aside ? copy.addTitleCash : copy.addTitle);
  const line =
    aside?.kind === "vault"
      ? copy.vaultLine(aside.usd === undefined ? undefined : money.format(aside.usd))
      : aside?.kind === "cash"
        ? walletAccount
          ? copy.walletCashLine
          : copy.firstFromCash
        : walletAccount
          ? copy.walletAddLine
          : copy.addLine;
  return (
    <StepCard title={title} line={line} frame={frame}>
      <div className="flex flex-col gap-1 px-[18px] pb-3 lg:px-6 lg:pb-4">
        {walletAccount ? (
          <Button className={PRIMARY} onClick={onBrowse}>
            {copy.walletAddAction}
          </Button>
        ) : (
          <>
            <Button className={PRIMARY} onClick={onAddMoney}>
              <Plus weight="bold" aria-hidden className="size-4" />
              {copy.addAction}
            </Button>
            <QuietLink onClick={onBrowse}>{copy.browse}</QuietLink>
          </>
        )}
        {note}
      </div>
    </StepCard>
  );
}

/** Four well known names, in the registry's own words; nothing is chosen for the person. */
/** The first look's examples (lib/first-look), so the names offered and the names looked at never drift apart. */
const PICK_SYMBOLS = FIRST_LOOK_SYMBOLS;
const PICKS: readonly TokenListing[] = PICK_SYMBOLS.map((symbol) =>
  STOCK_LISTINGS.find((listing) => listing.symbol === symbol),
).filter((listing): listing is TokenListing => listing !== undefined);

const TONE: Record<ChangeDirection, string> = {
  up: "text-good",
  down: "text-bad",
  flat: "text-muted-foreground",
};

/**
 * (b) Money to spend, nothing owned yet. A short choice of names, then one
 * accent that buys the one chosen; until one is, it says so. Every other
 * stock and fund is one tap away on the board.
 */
export function FirstBuyStep({
  readyUsd,
  loading = false,
  onBuy,
  onBrowse,
  onAsk,
  onReadNews,
  frame,
  unfunded = false,
  title,
  note,
}: {
  /** The guided path's progress line and skip (components/first-path). */
  frame?: StepFrame;
  /** The money step was set aside and nothing spendable is known: say so rather than claim money. */
  unfunded?: boolean;
  /** The guided path names the step itself. */
  title?: string;
  /** A quiet line under the action (the guided path's XP line, a campaign's rules). */
  note?: ReactNode;
  /** Opens Ask with a factual question about the chosen name; absent while Ask is locked or off. */
  onAsk?: (prompt: string) => void;
  /** Opens the news drawer on a listing, from the first look's quiet link. */
  onReadNews?: (listing: TokenListing) => void;
  /** Spendable money the oracle prices; undefined when only unpriced crypto proved there is some. */
  readyUsd: number | undefined;
  /** While the funds are read: the line's place is held. */
  loading?: boolean;
  onBuy: (listing: TokenListing) => void;
  onBrowse: () => void;
}) {
  const copy = useCopy();
  const money = useMoney();
  const prices = useListingPrices();
  const performance = useListingPerformance();
  const [chosen, setChosen] = useState<TokenListing | null>(null);
  const { lookOf } = useFirstLook();
  const line = unfunded ? (
    copy.firstPath.firstUnfunded
  ) : loading ? (
    <Skeleton className="h-4 w-56 max-w-full" />
  ) : readyUsd === undefined ? (
    copy.calmHome.firstReadyUnpriced
  ) : (
    // The balance it names stays out of a replay (lib/analytics).
    <span data-ph-mask>{copy.calmHome.firstReady(money.format(readyUsd))}</span>
  );

  return (
    <StepCard title={title ?? copy.calmHome.firstTitle} line={line} frame={frame}>
      <div data-ph-mask role="radiogroup" aria-label={copy.calmHome.pickLabel} className="divide-y divide-border border-y border-border">
        {PICKS.map((listing) => {
          const price = prices.priceOf(listing);
          const moved = performance.performanceOf(listing);
          const direction = changeDirection(moved?.changePct);
          const checked = chosen?.address === listing.address;
          return (
            <button
              key={listing.address}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => setChosen(listing)}
              className={cn(
                "flex w-full items-center gap-3 px-[18px] py-3 text-left outline-none transition-colors duration-150 ease-lift hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset lg:px-6",
                checked && "bg-muted/70",
              )}
            >
              <TickerTile symbol={listing.symbol} />
              <span className="min-w-0 flex-1">
                <span title={listing.name} className="block truncate text-[14.5px] leading-snug font-medium text-foreground">
                  {rowName(listing)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  <span className="money">{listing.symbol}</span>
                  {(() => {
                    const look = lookOf(listing.symbol);
                    return look.kind === "shown" && look.look.looked && look.look.inNews ? copy.firstLook.rowInNews : null;
                  })()}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="money block text-sm tabular-nums text-foreground">
                  {price === undefined ? <Skeleton className="h-4 w-14" /> : money.format(price)}
                </span>
                {moved?.changePct !== undefined && (
                  <span className={cn("money block text-xs tabular-nums", TONE[direction ?? "flat"])}>
                    {formatPercentChange(moved.changePct)}
                  </span>
                )}
              </span>
              {/* A radio's own mark, in ink: the accent stays on the buy. */}
              <span
                aria-hidden
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border",
                  checked ? "border-foreground bg-foreground text-background" : "border-input",
                )}
              >
                {checked && <Check weight="bold" className="size-3" />}
              </span>
            </button>
          );
        })}
      </div>
      {/* Once a name is chosen: today's reading about it, before the buy (lib/first-look). */}
      {chosen && lookOf(chosen.symbol).kind !== "hidden" && (
        <div className="px-[18px] pt-4 lg:px-6">
          <FirstLookReadingView
            listing={chosen}
            look={lookOf(chosen.symbol)}
            onAsk={onAsk}
            onReadNews={onReadNews ? () => onReadNews(chosen) : undefined}
          />
        </div>
      )}
      <div className="flex flex-col gap-1 px-[18px] pt-4 pb-3 lg:px-6 lg:pb-4">
        {/* Until a name is chosen the button is a quiet outline that says
            so; the accent arrives with the choice, on the one thing to do. */}
        <Button
          variant={chosen ? "default" : "outline"}
          className={cn(PRIMARY, !chosen && "disabled:opacity-100 text-muted-foreground")}
          disabled={!chosen}
          onClick={() => chosen && onBuy(chosen)}
        >
          {chosen ? copy.calmHome.firstBuy(rowName(chosen)) : copy.calmHome.firstChoose}
        </Button>
        <QuietLink onClick={onBrowse}>{copy.calmHome.seeAll(STOCK_LISTINGS.length)}</QuietLink>
        {note}
      </div>
    </StepCard>
  );
}

/** (c) Under what the account owns: the one accent, which opens every stock and fund. */
export function BuyMoreButton({ onOpen, quiet = false }: { onOpen: () => void; quiet?: boolean }) {
  const copy = useCopy().calmHome;
  return (
    // Quiet (an outline) while the guided path holds the one accent.
    <Button variant={quiet ? "outline" : "default"} className={PRIMARY} onClick={onOpen}>
      <Plus weight="bold" aria-hidden className="size-4" />
      {copy.buyAction}
    </Button>
  );
}

/** While the account's stage is not yet known and none is remembered: the card's place, held. */
export function NextStepSkeleton() {
  return (
    <Panel>
      <div className="flex flex-col gap-3 px-[18px] py-5 lg:px-6 lg:py-6">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-4 w-64 max-w-full" />
        <Skeleton className="mt-2 h-11 w-full rounded-full" />
      </div>
    </Panel>
  );
}
