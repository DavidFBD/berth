"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { CaretDown, Check } from "@phosphor-icons/react";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopy, useMoney } from "@/components/settings-provider";
import { PortfolioChart, type ChartMarker } from "@/components/board/portfolio-chart";
import { WeekStrip, type StripDay } from "@/components/board/week-strip";
import { HeldMarks } from "@/components/board/held-marks";
import { AvatarWithRank } from "@/components/rank-glyph";
import { useCompareFriends, useFriendWeek, useMySocial } from "@/hooks/use-social";
import { RangeMovers } from "@/components/board/range-movers";
import {
  FRIEND_CHOICE_KEY,
  FRIEND_WEEK_RANGES,
  alignWithFriend,
  type CompareFriend,
  type FriendWeekRange,
} from "@/lib/friend-week";
import { useMoves } from "@/hooks/use-moves";
import { usePortfolioHistory } from "@/hooks/use-profile";
import { useStoredChoice } from "@/hooks/use-stored-choice";
import { BENCHMARKS, DEFAULT_BENCHMARK, findBenchmark, type BenchmarkSymbol } from "@/lib/benchmarks";
import { TOKEN_LISTINGS, rowName } from "@/lib/listings";
import { isTradingDay } from "@/lib/market-calendar";
import { addDays } from "@/lib/marks";
import { changeDirection, formatPercentChange, type ChangeDirection } from "@/lib/performance";
import { cardRanges, pickCardRange, type CardRange, type HistoryPoint } from "@/lib/portfolio-history";
import { pickMove, type StoryMove, type StoryOrder, type StoryPoint } from "@/lib/portfolio-story";
import { cn } from "@/lib/utils";
import { edgeFades, scrollToShow } from "@/lib/chip-scroll";
import { dayLineDate, describeMover, describeYou, type DayFacts } from "@/lib/day-line";

const BENCHMARK_KEY = "berth.portfolio.benchmark";
const RANGE_KEY = "berth.portfolio.range";
/** The friend whose line is drawn instead of a benchmark, by username; empty for none. */
const FRIEND_KEY = FRIEND_CHOICE_KEY;

/** Range labels that are words, set in the body font. */
const WORD_RANGES: ReadonlySet<CardRange> = new Set<CardRange>(["since"]);

const TONE: Record<ChangeDirection, string> = {
  up: "text-good",
  down: "text-bad",
  flat: "text-muted-foreground",
};

/** "Sep 21", from an ISO day, read in UTC so the day never shifts. */
export function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function Pct({ value, dim }: { value: number; dim?: boolean }) {
  const direction = changeDirection(value) ?? "flat";
  return (
    <span className={cn("money", TONE[direction], dim && "opacity-60")}>
      {formatPercentChange(value, 1)}
    </span>
  );
}

/** The picker's value for a friend: never a benchmark symbol. */
const FRIEND_PREFIX = "friend:";

const ITEM =
  "flex cursor-default items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 outline-none select-none data-[highlighted]:bg-muted";

function ItemCheck() {
  return (
    <Menu.RadioItemIndicator keepMounted className="size-4 text-muted-foreground data-[unchecked]:invisible">
      <Check weight="duotone" className="size-4" aria-hidden />
    </Menu.RadioItemIndicator>
  );
}

/**
 * The benchmark's name in the headline, and the way to change it: a button
 * that opens a small menu of the five, and below them the friends who
 * compare their week (lib/friend-week), each with their face. The choice is
 * kept per viewer.
 *
 * `shown` is the benchmark the numbers beside it belong to, so the name and
 * the figure never disagree while a new choice loads; `value` is the choice
 * itself, which the menu checks. With a friend picked the button is their
 * face and username. The button's name is just the visible name, so the
 * sentence reads on naturally; its purpose is its description.
 */
function BenchmarkChooser({
  value,
  shown,
  friend,
  friends,
  onChange,
  onFriend,
}: {
  value: BenchmarkSymbol;
  shown: BenchmarkSymbol;
  /** The friend whose line is drawn instead of a benchmark, if any. */
  friend: CompareFriend | null;
  friends: readonly CompareFriend[];
  onChange: (symbol: BenchmarkSymbol) => void;
  onFriend: (handle: string) => void;
}) {
  const copy = useCopy();
  const hintId = useId();
  return (
    <Menu.Root>
      <span id={hintId} hidden>
        {copy.portfolioChooserHint}
      </span>
      <Menu.Trigger
        aria-describedby={hintId}
        className="inline-flex items-baseline gap-0.5 rounded-sm font-medium text-foreground underline decoration-border decoration-1 underline-offset-[3px] outline-none transition-colors duration-150 ease-lift hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:decoration-foreground"
      >
        {friend ? (
          <>
            <AvatarWithRank avatarId={friend.avatarId} level={friend.level} size={16} className="mr-1 self-center" />
            <span data-ph-mask>{friend.handle}</span>
          </>
        ) : (
          copy.benchmarkNames[shown]
        )}
        <CaretDown weight="duotone" className="size-3 self-center" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={16} className="z-50">
          <Menu.Popup className="min-w-48 origin-[var(--transform-origin)] rounded-xl border border-border bg-popover p-1 text-sm text-popover-foreground shadow-raised outline-none transition-[opacity,transform] duration-150 ease-lift data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0">
            <Menu.RadioGroup
              value={friend ? `${FRIEND_PREFIX}${friend.handle}` : value}
              onValueChange={(next) => {
                const picked = String(next);
                if (picked.startsWith(FRIEND_PREFIX)) {
                  onFriend(picked.slice(FRIEND_PREFIX.length));
                  return;
                }
                const found = findBenchmark(picked);
                if (found) onChange(found.symbol);
              }}
            >
              <Menu.Group>
                <Menu.GroupLabel className="px-2.5 pt-1.5 pb-1 text-[11px] text-muted-foreground">
                  {copy.portfolioCompareWith}
                </Menu.GroupLabel>
                {BENCHMARKS.map((benchmark) => (
                  <Menu.RadioItem key={benchmark.symbol} value={benchmark.symbol} closeOnClick className={ITEM}>
                    {copy.benchmarkNames[benchmark.symbol]}
                    <ItemCheck />
                  </Menu.RadioItem>
                ))}
              </Menu.Group>
              {friends.length > 0 && (
                <Menu.Group data-ph-mask className="mt-1 border-t border-border pt-1">
                  <Menu.GroupLabel className="px-2.5 pt-1.5 pb-1 text-[11px] text-muted-foreground">
                    {copy.portfolioFriendsGroup}
                  </Menu.GroupLabel>
                  {friends.map((person) => (
                    <Menu.RadioItem
                      key={person.handle}
                      value={`${FRIEND_PREFIX}${person.handle}`}
                      closeOnClick
                      className={ITEM}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <AvatarWithRank avatarId={person.avatarId} level={person.level} size={20} />
                        <span className="truncate">{person.handle}</span>
                      </span>
                      <ItemCheck />
                    </Menu.RadioItem>
                  ))}
                </Menu.Group>
              )}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * Under the chart and attached to it: 1W and First buy always, 14D, 30D
 * and 90D once the record reaches back that far (lib/portfolio-history
 * cardRanges). One row; on a narrow screen it scrolls inside its pill, the
 * selected chip scrolled into view and the edge with chips past it faded.
 */
function RangeControl({
  offered,
  value,
  onChange,
  sinceFrom,
}: {
  offered: readonly CardRange[];
  value: CardRange;
  onChange: (range: CardRange) => void;
  /** When since first buy starts on a later snapshot, that day: the chip names it. */
  sinceFrom: string | null;
}) {
  const copy = useCopy();
  const row = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const element = row.current;
    if (!element) return;
    const next = edgeFades(element);
    setFade((current) => (current.start === next.start && current.end === next.end ? current : next));
  }, []);
  // The selected chip in view, sideways only (never scrollIntoView, which
  // could move the page), on every change and whenever the row resizes.
  useEffect(() => {
    const element = row.current;
    if (!element) return;
    const show = () => {
      const chip = element.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (chip) element.scrollLeft = scrollToShow(element, { left: chip.offsetLeft, width: chip.offsetWidth });
      measure();
    };
    show();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(show);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [value, offered.length, measure]);
  const mask =
    fade.start || fade.end
      ? `linear-gradient(to right, ${fade.start ? "transparent, #000 20px" : "#000"}, ${fade.end ? "#000 calc(100% - 20px), transparent" : "#000"})`
      : undefined;
  return (
    // A pill group: the active range is the ink chip, so the board's one
    // accent is never spent on a filter. The pill keeps its border; only
    // the chips inside it scroll and fade.
    <div className="inline-flex max-w-full shrink-0 rounded-full border border-border bg-card p-0.5">
      <div
        ref={row}
        role="group"
        aria-label={copy.portfolioRangeLabel}
        onScroll={measure}
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
        className="flex min-w-0 flex-nowrap gap-0.5 overflow-x-auto overscroll-x-contain rounded-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {offered.map((range) => (
          <button
            key={range}
            type="button"
            aria-pressed={range === value}
            onClick={() => onChange(range)}
            className={cn(
              // Numbers in the money font; "First buy" and "All" are words.
              WORD_RANGES.has(range) ? "" : "money tabular-nums",
              "inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-xs leading-none font-medium outline-none transition-colors duration-150 ease-lift focus-visible:ring-3 focus-visible:ring-ring/50",
              range === value
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {range === "since" && sinceFrom
              ? copy.portfolioRangeSince(shortDate(sinceFrom))
              : copy.portfolioRanges[range]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The legend's small line: solid for the account, dashed for the benchmark. */
function Swatch({ dashed }: { dashed?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mr-1.5 inline-block w-4 translate-y-[-3px] border-t-[1.75px]",
        dashed ? "border-dashed border-faint" : "border-foreground",
      )}
    />
  );
}

/** The held marks inside the "Your portfolio" group: inline on wide screens, last and full width, indented past the swatch, on a phone. */
const MARKS_IN_GROUP = "order-last basis-full pl-[22px] pt-0.5 sm:order-none sm:basis-auto sm:pl-0 sm:pt-0 sm:self-center";

/** A listing's name as a person reads it, from its symbol. */
function nameOf(symbol: string): string {
  const listing = TOKEN_LISTINGS.find((entry) => entry.symbol === symbol);
  return listing ? rowName(listing) : symbol;
}

/** "Thursday, September 24", for a screen reader. */
function longDayName(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The market days after `day`, `count` of them: a first week's empty slots. */
function nextMarketDays(day: string, count: number): string[] {
  const out: string[] = [];
  for (let next = addDays(day, 1); out.length < count; next = addDays(next, 1)) {
    if (isTradingDay(next)) out.push(next);
  }
  return out;
}

/** "+$0.42", "−$0.05", "$0.00": a change in money, signed, a true minus for a loss. */
function useSignedMoney() {
  const money = useMoney();
  return (usd: number) => {
    if (Math.abs(usd) < 0.005) return money.format(0);
    return `${usd > 0 ? "+" : "−"}${money.format(Math.abs(usd))}`;
  };
}

/** A small mono figure inside a sentence. */
function Figure({ children }: { children: ReactNode }) {
  return <span className="money whitespace-nowrap tabular-nums text-foreground">{children}</span>;
}

/** "2.5%": a size after "up" or "down", unsigned, one decimal. */
function size(pct: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(Math.abs(pct)) + "%";
}

/**
 * The day's two sentences (lib/day-line), in words: the portfolio's move and
 * the holding that moved most. Each comes with the figures it says, so the
 * line can set them in the money font.
 */
function useDaySentences() {
  const copy = useCopy();
  const money = useMoney();
  const signed = useSignedMoney();
  return (facts: DayFacts, today: boolean): { you: string; mover: string | null; figures: string[] } => {
    const figures: string[] = [];
    const say = (pct: number | null, usd: number | null, direction: "up" | "down") => {
      const out = {
        pct: pct === null ? null : size(pct),
        usd: usd === null ? null : money.format(usd),
        usdSigned: usd === null ? null : signed(direction === "up" ? usd : -usd),
      };
      for (const figure of [out.pct, out.pct ? out.usdSigned : out.usd]) if (figure) figures.push(figure);
      return out;
    };
    const youPart = describeYou(facts);
    const you =
      youPart.kind === "unknown"
        ? copy.portfolioDayUnknown
        : copy.portfolioDayYou({
            direction: youPart.kind,
            ...(youPart.kind === "flat"
              ? { pct: null, usd: null, usdSigned: null }
              : say(youPart.pct, youPart.usd, youPart.kind)),
            today,
            fromBuy: facts.fromBuy === true,
          });
    const moverPart = describeMover(facts);
    const mover = moverPart
      ? copy.portfolioDayMover({
          name: nameOf(moverPart.symbol),
          direction: moverPart.direction,
          ...say(moverPart.pct, moverPart.usd, moverPart.direction),
          today,
        })
      : null;
    return { you, mover, figures };
  };
}

/** A sentence with the figures it says set in the money font. */
function Figured({ text, figures }: { text: string; figures: readonly string[] }) {
  const wanted = [...new Set(figures)].sort((a, b) => b.length - a.length);
  if (wanted.length === 0) return <>{text}</>;
  const escaped = wanted.map((figure) => figure.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`));
  return (
    <>
      {parts.map((part, index) => (wanted.includes(part) ? <Figure key={index}>{part}</Figure> : part))}
    </>
  );
}

/**
 * Under the week strip: what happened on the day marked, or on the latest
 * day when none is. The day's change with buys and sells set aside, the
 * holding that moved most, the orders that landed, and a large move in the
 * news when there is one. Facts only, in the order they happened to the
 * money; nothing here suggests doing anything.
 */
function DayLine({
  point,
  orders,
  move,
  today,
}: {
  point: StoryPoint;
  orders: readonly StoryOrder[];
  move: StoryMove | null;
  today: boolean;
}) {
  const copy = useCopy();
  const money = useMoney();
  const sentences = useDaySentences();
  const shownOrders = orders.slice(0, 2);
  // Each part keeps its own words together; the line breaks between parts.
  const parts: { key: string; node: ReactNode }[] = [];
  // Nothing held and nothing moved: say that, not that a figure is missing.
  const empty = point.value <= 0 && !point.mover && (point.change == null || Math.abs(point.change) < 0.005);
  const top = point.mover ?? point.top ?? null;
  if (empty) {
    parts.push({ key: "empty", node: copy.portfolioNothingHeld });
  } else {
    // The portfolio's move, then the holding that moved most: a flat day
    // still names it, so "flat" never sits beside a loss unexplained.
    const { you, mover, figures } = sentences(point, today);
    parts.push({ key: "you", node: <Figured text={you} figures={figures} /> });
    if (mover) parts.push({ key: "top", node: <Figured text={mover} figures={figures} /> });
  }
  for (const order of shownOrders) {
    parts.push({
      key: `${order.at}:${order.symbol}`,
      node: (
        <>
          {order.direction === "buy" ? copy.portfolioBought(nameOf(order.symbol)) : copy.portfolioSold(nameOf(order.symbol))}
          {order.usd !== null && (
            <>
              , <Figure>{money.format(order.usd)}</Figure>
            </>
          )}
          {order === shownOrders.at(-1) && orders.length > shownOrders.length && (
            <> {copy.portfolioMoreOrders(orders.length - shownOrders.length)}</>
          )}
        </>
      ),
    });
  }
  if (move) {
    parts.push({
      key: "move",
      node: (
        <>
          {/* The mover's figure is already said when it is the same listing. */}
          {move.symbol !== top?.symbol && (
            <>
              {nameOf(move.symbol)} <Figure>{formatPercentChange(move.changePct, 1)}</Figure>.{" "}
            </>
          )}
          <a
            href={move.post.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={copy.moveReadPost(move.post.name)}
            className="rounded-sm underline decoration-border underline-offset-[3px] outline-none hover:text-foreground hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {copy.moveInTheNews(move.post.name)}
          </a>
        </>
      ),
    });
  }
  return (
    // Short sentences, so the line wraps like prose and never strands a separator.
    <p className="mt-3 min-h-10 text-[13px] leading-5 text-muted-foreground">
      <span className="whitespace-nowrap text-foreground">{today ? copy.portfolioToday : dayLineDate(point.day)}.</span>
      {parts.map((part) => (
        <span key={part.key}>
          {" "}
          {part.node}.
        </span>
      ))}
    </p>
  );
}

/** The strip's days from story points: names, labels and which is today. */
function useStripDays(points: readonly StoryPoint[], liveDay: string | null): StripDay[] {
  const copy = useCopy();
  const sentences = useDaySentences();
  return points.map((point) => {
    const today = point.day === liveDay;
    const moverName = point.mover ? nameOf(point.mover.symbol) : null;
    const date = today ? copy.portfolioToday : longDayName(point.day);
    if (point.value <= 0 && !point.mover && (point.change == null || Math.abs(point.change) < 0.005)) {
      return { ...point, moverName, today, label: `${date}. ${copy.portfolioNothingHeld}.` };
    }
    const { you, mover } = sentences(point, today);
    return { ...point, moverName, today, label: copy.portfolioDayAria(date, you, mover) };
  });
}

/** A point as the chart draws it, in its unit, with the dollars for the readout. */
type ChartPoint = HistoryPoint & {
  /** The account's dollars at this point; null for an origin whose cost is unknown. */
  dollars: number | null;
  /** The 0% point at the first buy, before its first close. */
  origin: boolean;
};

/**
 * The chart's points: the returns so far when `percent` (with an origin at
 * 0% when the window counts from the first buy), else the dollar values.
 */
function buildChart(
  days: readonly StoryPoint[],
  { percent, origin, withBenchmark }: { percent: boolean; origin: boolean; withBenchmark: boolean },
): ChartPoint[] {
  const points: ChartPoint[] = days.map((point) => ({
    day: point.day,
    value: percent ? point.returnPct! : point.value,
    benchmark: percent ? (point.benchmarkReturnPct ?? null) : point.benchmark,
    dollars: point.value,
    origin: false,
  }));
  if (!origin) return points;
  const first = days[0];
  return [
    {
      day: first.day,
      value: 0,
      benchmark: withBenchmark ? 0 : null,
      dollars: first.change != null ? first.value - first.change : null,
      origin: true,
    },
    ...points,
  ];
}

/**
 * One marker per point the orders landed on: a buy when any was a buy. With
 * an origin, the orders that landed on the first close are drawn on it,
 * where the money went in.
 */
function markersFor(points: readonly ChartPoint[], orders: readonly StoryOrder[]): ChartMarker[] {
  const index = new Map<string, number>();
  points.forEach((point, at) => {
    if (!index.has(point.day)) index.set(point.day, at);
  });
  const kinds = new Map<number, ChartMarker["kind"]>();
  for (const order of orders) {
    const at = index.get(order.day);
    if (at === undefined) continue;
    if (kinds.get(at) !== "buy") kinds.set(at, order.direction);
  }
  return [...kinds].map(([at, kind]) => ({ index: at, kind }));
}

/**
 * Under the account's figure: the account's money beside the same money
 * in a chosen benchmark, as a legend (the chooser is the benchmark's name),
 * the two lines with the orders on them, the last seven market days, a
 * line on the day in hand, and the range. Rendered only while the account
 * holds something; the query is not even asked otherwise. Every number is
 * the server's (lib/portfolio-history, lib/portfolio-story); this only lays
 * them out and refuses to draw what it was not given.
 *
 * On the first day there is one point, so the line runs from what was paid
 * to what it is worth now, with the strip's first tile and six to come.
 */
export function PortfolioSummary({ holdsAnything }: { holdsAnything: boolean }) {
  const copy = useCopy();
  const money = useMoney();
  const [storedBenchmark, setBenchmark] = useStoredChoice(BENCHMARK_KEY);
  const [storedRange, setRange] = useStoredChoice(RANGE_KEY);
  const [scrub, setScrub] = useState<number | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const benchmark = findBenchmark(storedBenchmark)?.symbol ?? DEFAULT_BENCHMARK;
  const query = usePortfolioHistory(benchmark, holdsAnything);

  const data = query.data;
  const since = data?.ranges.since;
  // The live point, when today's is one: the strip and the day line call it Today.
  const liveDay =
    data?.todaySource && data.todaySource.value !== "stored" ? (since?.days.at(-1)?.day ?? null) : null;
  const stripSource: readonly StoryPoint[] = since && since.days.length > 0 ? since.days : [];
  const stripDays = useStripDays(stripSource.slice(-7), liveDay);
  // Large moves in the news, already read for the board (/api/moves): the
  // one on a day on the line in a listing held then, if any.
  const moves = useMoves();
  const move = pickMove([...moves.values()], stripSource, (day, symbol) =>
    Boolean(stripSource.find((point) => point.day === day)?.held?.includes(symbol)),
  );

  // The range on show, once there is data to choose it from: the one the
  // viewer last picked while it is offered, else First buy.
  const offered = data ? cardRanges(data.available, data.ranges) : [];
  const range: CardRange | null = data ? pickCardRange(storedRange, offered) : null;
  const result = data && range ? data.ranges[range] : undefined;

  // Compare with friends (lib/friend-week): a friend picked in the chooser,
  // while they still compare, is drawn instead of the benchmark, over the
  // card's own window only.
  const [storedFriend, setFriend] = useStoredChoice(FRIEND_KEY);
  // Asked only while the viewer's own switch is on: off, there is nobody to offer.
  const mine = useMySocial(holdsAnything, { prompt: false });
  const friends = useCompareFriends(holdsAnything && mine.data?.shareWeek === true);
  const friend = (storedFriend && friends.find((person) => person.handle === storedFriend)) || null;
  const friendRange: FriendWeekRange | null =
    friend && range && (FRIEND_WEEK_RANGES as readonly string[]).includes(range) ? (range as FriendWeekRange) : null;
  const friendFrom = friendRange && result && result.days.length >= 2 ? result.days[0].day : null;
  const friendWeek = useFriendWeek(friend?.handle ?? null, friendRange, friendFrom);

  if (!holdsAnything) return null;

  if (!data) {
    // Loading: the legend and the chart hold their places. An error
    // behaves as a line too short to draw: nothing, no message.
    if (query.isError) return null;
    return (
      <div className="mt-4">
        <Skeleton className="h-4 w-56 max-w-full" />
        <div className="mt-2 h-[150px] lg:h-[160px]" />
        <div className="mt-1 h-8" />
      </div>
    );
  }
  if (!range) return null;

  // In the first seven market days the strip shows the days to come, empty.
  // Only an account whose record reaches its first buy is in its first seven days.
  const firstWeek =
    stripSource.length > 0 && stripSource.length < 7 && !since?.rebasedFrom && !since?.recordFrom;
  const slots = firstWeek ? nextMarketDays(stripSource.at(-1)!.day, 7 - stripSource.length) : [];
  const stripHeading = firstWeek ? copy.portfolioFirstWeek(stripSource.length) : copy.portfolioWeekLabel;
  const allOrders = since?.orders ?? result?.orders ?? [];
  const ordersOn = (day: string) => allOrders.filter((order) => order.day === day);
  const moveOn = (day: string) => (move && move.day === day ? move : null);
  const pin = (day: string) => setPinned((current) => (current === day ? null : day));

  if (!result || result.days.length < 2 || data.available.length === 0) {
    const first = since?.days.length === 1 ? since.days[0] : undefined;
    if (!first || first.change == null) {
      return <p className="mt-4 text-xs leading-5 text-muted-foreground">{copy.portfolioFirstDayWait}</p>;
    }
    return (
      <FirstDay
        point={first}
        today={first.day === liveDay}
        strip={
          <WeekStrip
            days={stripDays}
            slots={slots}
            heading={stripHeading}
            active={hover ?? pinned}
            pinned={pinned}
            onHover={setHover}
            onPin={pin}
          />
        }
        dayLine={<DayLine point={first} orders={ordersOn(first.day)} move={moveOn(first.day)} today={first.day === liveDay} />}
      />
    );
  }

  const days = result.days;
  const shownBenchmark = data.benchmark.symbol as BenchmarkSymbol;
  const stale = query.isPlaceholderData;
  const status = result.benchmarkStatus;
  // The line is the return so far, both sides from the same start, so a
  // buy is never a step up. Where that return cannot be told the line is
  // dollars, as it was, with the reason said below the legend.
  const percent = result.changePct !== null && days.every((point) => point.returnPct != null);
  // A friend's line, when one is picked: both lines from 0% on the first
  // close they share (lib/friend-week alignWithFriend), percent only.
  const aligned = friend && percent ? alignWithFriend(days, friendWeek.week) : null;
  const withBenchmark = !friend && status === "ok" && result.benchmarkPct !== null;
  const withLine = aligned !== null || withBenchmark;
  // Since first buy counts from the buy itself: an origin at 0% before the
  // first close, where the first buy's mark sits. Beside a friend both
  // lines count from the shared close instead.
  const origin = !aligned && percent && range === "since" && !result.rebasedFrom && days[0].fromBuy === true;
  const chart: ChartPoint[] = aligned
    ? aligned.points.map((point) => ({
        day: point.day,
        value: point.you,
        benchmark: point.friend,
        dollars: days.find((entry) => entry.day === point.day)?.value ?? null,
        origin: false,
      }))
    : buildChart(days, { percent, origin, withBenchmark });
  // The two figures in the legend: each line's last value.
  const youPct = aligned ? aligned.points.at(-1)!.you : result.changePct;
  const otherPct = aligned
    ? (aligned.points.findLast((point) => point.friend !== null)?.friend ?? null)
    : withBenchmark
      ? result.benchmarkPct
      : null;
  const indexOf = new Map(chart.flatMap((point, index) => (point.origin ? [] : [[point.day, index] as const])));
  // The day in hand, from either side: the line's scrub, then the strip's
  // hover, then its pick. The strip and the day line always show it; the
  // line marks it only when it is one of the range's points (a 1W range
  // can start after the strip's first day).
  const markedDay = (scrub !== null ? (chart[scrub]?.day ?? null) : null) ?? hover ?? pinned;
  const marked = scrub ?? (markedDay !== null ? (indexOf.get(markedDay) ?? null) : null);
  const chooser = (
    <BenchmarkChooser
      value={benchmark}
      shown={shownBenchmark}
      friend={friend}
      friends={friends}
      onChange={(symbol) => {
        setFriend("");
        setBenchmark(symbol);
      }}
      onFriend={setFriend}
    />
  );
  // The other line's name in the readout: the friend's username, or the benchmark's.
  const otherName = friend ? friend.handle : copy.benchmarkNames[shownBenchmark];
  // In a reason's sentence the name is plain text: the legend holds the chooser.
  const named = `${copy.benchmarkArticle[shownBenchmark]}${copy.benchmarkNames[shownBenchmark]}`;

  const scrubbed = marked !== null ? chart[marked] : undefined;
  const figure = (value: number) => (percent ? formatPercentChange(value, 1) : money.format(value));
  const readout = scrubbed && (
    // Over the legend, never instead of it: the legend keeps its height,
    // hidden, so nothing below moves.
    // Anchored to the bottom: on a narrow screen a second line grows up into
    // the space above the legend, never down over the line.
    // Each separator rides with the part after it, so a wrap never strands one.
    <p className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-baseline gap-x-1.5 text-[13px] leading-5 text-muted-foreground">
      <span className="whitespace-nowrap">
        {scrubbed.origin
          ? copy.portfolioWhenBought
          : scrubbed.day === liveDay
            ? copy.portfolioToday
            : shortDate(scrubbed.day)}
      </span>
      <span className="whitespace-nowrap text-foreground">
        <span aria-hidden="true" className="mr-1.5 text-muted-foreground">
          ·
        </span>
        {copy.portfolioYou} <span className="money tabular-nums">{figure(scrubbed.value)}</span>
        {/* On a percent line the dollars ride along, so the money is never out of sight. */}
        {percent && scrubbed.dollars !== null && (
          <>
            , <span className="money tabular-nums">{money.format(scrubbed.dollars)}</span>
          </>
        )}
      </span>
      {withLine && scrubbed.benchmark !== null && (
        <>
          <span className="whitespace-nowrap">
            <span aria-hidden="true" className="mr-1.5">
              ·
            </span>
            {otherName}{" "}
            <span className="money tabular-nums">{figure(scrubbed.benchmark)}</span>
          </span>
        </>
      )}
    </p>
  );

  let reason: string | null = null;
  if (friend) {
    // Beside a friend: over which days (the first close both lines have), or why their line is not drawn.
    if (aligned && (range === "since" || aligned.anchor > days[0].day)) reason = copy.portfolioFriendFrom(shortDate(aligned.anchor));
    else if (percent && !aligned && !friendWeek.loading) reason = copy.portfolioFriendNone(friend.handle);
  } else if (status === "unpriced_orders" || status === "unexplained_balance") {
    reason = copy.portfolioNoBenchmark[status](named);
  } else if (status === "no_marks") {
    reason = copy.portfolioNoMarks(copy.benchmarkNames[shownBenchmark]);
  } else if (result.rebasedFrom) {
    reason = copy.portfolioRebased(shortDate(result.rebasedFrom));
  } else if (result.recordFrom) {
    reason = copy.portfolioRecordStarts(shortDate(result.recordFrom));
  }
  // The line fell back to dollars for a reason not said above (a sell with
  // no quantity or no close that day): say so.
  if (!percent && reason === null) reason = copy.portfolioNoReturn;

  const legend = (
    <p
      className={cn(
        "flex w-full flex-wrap items-baseline gap-x-[18px] gap-y-1 text-[13px] leading-5 text-foreground",
        readout && "invisible",
      )}
    >
      {/* One group: label, its marks, then the percent. On a phone the marks
          drop to their own line under the label, indented to its text. */}
      <span className="flex flex-wrap items-baseline gap-x-1.5 sm:flex-nowrap sm:whitespace-nowrap">
        <span className="whitespace-nowrap">
          <Swatch />
          {copy.portfolioYou}
        </span>
        <HeldMarks held={stripSource.at(-1)?.held} className={MARKS_IN_GROUP} />
        {youPct !== null && <Pct value={youPct} dim={stale} />}
      </span>
      {/* The benchmark's name is the chooser in every state, so another is
          always one tap away, with or without its line drawn. */}
      <span className="whitespace-nowrap">
        <Swatch dashed />
        {chooser}
        {otherPct !== null && (
          <>
            {" "}
            <Pct value={otherPct} dim={stale} />
          </>
        )}
      </span>
    </p>
  );

  // The day in hand: the one marked from either side, else the latest.
  const latest = stripSource.at(-1) ?? days.at(-1)!;
  const shownDay = markedDay ?? latest.day;
  const shownPoint = stripSource.find((point) => point.day === shownDay) ?? days.find((point) => point.day === shownDay) ?? latest;

  return (
    <div data-ph-mask className="mt-5 lg:mt-[22px]">
      <div className="relative flex min-h-5 items-center">
        {legend}
        {readout}
      </div>
      {/* Why the benchmark's line is missing or starts late, when it is. */}
      {reason && <p className="mt-1 text-xs leading-5 text-muted-foreground">{reason}</p>}
      {/* Beside the founder's line (lib/server/social/founder): one line, never a call to buy. */}
      {friend?.founder && (
        <p data-founder-note className="mt-1 text-xs leading-5 text-muted-foreground">
          {copy.social.founderHoldsNote}
        </p>
      )}
      <div className="mt-2">
        <PortfolioChart
          days={chart}
          unit={percent ? "pct" : "usd"}
          withBenchmark={withLine}
          scrubIndex={marked}
          onScrub={setScrub}
          drawKey={`${range}:${friend && aligned ? `friend:${friend.handle}` : shownBenchmark}`}
          markers={markersFor(chart, result.orders ?? [])}
        />
      </div>
      {range !== "1w" ? (
        // Past a week the strip gives way to what moved the range most.
        <RangeMovers
          since={shortDate(result.since ?? days[0].day)}
          contributions={result.contributions}
          changeUsd={result.changeUsd}
          orders={result.orders}
          // Since first buy counts from nothing, so its first day's trades are in it; any other range starts from its first close.
          tradesAfter={range === "since" && !result.rebasedFrom ? null : (result.since ?? days[0].day)}
          nameOf={nameOf}
        />
      ) : stripDays.length > 0 && (
        <WeekStrip
          days={stripDays}
          slots={slots}
          heading={stripHeading}
          active={markedDay}
          pinned={pinned}
          onHover={setHover}
          onPin={pin}
        />
      )}
      <DayLine
        point={shownPoint}
        orders={ordersOn(shownPoint.day)}
        move={moveOn(shownPoint.day)}
        today={shownPoint.day === liveDay}
      />
      {/* The caption and the range share a row while both fit; the range wraps under it otherwise. */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5">
        <span className="text-[12.5px] text-muted-foreground">
          {percent ? copy.portfolioReturnCaption : copy.portfolioSameDays}
          {/* The percentages are dollar returns; in another currency, say so. */}
          {money.converted && `. ${copy.inUsDollars}`}
        </span>
        <RangeControl
          offered={offered}
          value={range}
          sinceFrom={data.ranges.since?.rebasedFrom ?? null}
          onChange={(next) => {
            setScrub(null);
            setHover(null);
            setRange(next);
          }}
        />
      </div>
    </div>
  );
}

/**
 * The first day: one point, so the line runs from what was paid, fee
 * included, to what it is worth now, with the buy marked where it starts.
 * The honest note says the daily values start after the next close.
 */
function FirstDay({
  point,
  today,
  strip,
  dayLine,
}: {
  point: StoryPoint;
  today: boolean;
  strip: ReactNode;
  dayLine: ReactNode;
}) {
  const copy = useCopy();
  const money = useMoney();
  const [scrub, setScrub] = useState<number | null>(null);
  const paid = point.value - (point.change ?? 0);
  // In percent like every other line: from 0% at the buy to the return now.
  const percent = point.changePct != null;
  const days: StoryPoint[] = [
    { day: point.day, value: percent ? 0 : paid, benchmark: null },
    { day: point.day, value: percent ? point.changePct! : point.value, benchmark: null },
  ];
  const dollars = [paid, point.value];
  const scrubbed = scrub !== null ? days[scrub] : undefined;
  return (
    <div data-ph-mask className="mt-5 lg:mt-[22px]">
      <div className="relative flex min-h-5 items-center">
        <p className={cn("flex w-full flex-wrap items-baseline gap-x-[18px] gap-y-1 text-[13px] leading-5 text-foreground", scrubbed && "invisible")}>
          <span className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="whitespace-nowrap">
              <Swatch />
              {copy.portfolioYou}
            </span>
            <HeldMarks held={point.held} className={MARKS_IN_GROUP} />
            {point.changePct != null && <Pct value={point.changePct} />}
            <span className="text-muted-foreground">{copy.portfolioSinceBuy}</span>
          </span>
        </p>
        {scrubbed && (
          <p className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-baseline gap-x-1.5 text-[13px] leading-5 text-muted-foreground">
            <span className="whitespace-nowrap">
              {scrub === 0 ? copy.portfolioWhenBought : today ? copy.portfolioToday : copy.portfolioNow}
            </span>
            <span className="whitespace-nowrap text-foreground">
              <span aria-hidden="true" className="mr-1.5 text-muted-foreground">
                ·
              </span>
              {copy.portfolioYou}{" "}
              {percent && (
                <>
                  <span className="money tabular-nums">{formatPercentChange(scrubbed.value, 1)}</span>,{" "}
                </>
              )}
              <span className="money tabular-nums">{money.format(dollars[scrub!])}</span>
            </span>
          </p>
        )}
      </div>
      <div className="mt-2">
        <PortfolioChart
          days={days}
          unit={percent ? "pct" : "usd"}
          withBenchmark={false}
          scrubIndex={scrub}
          onScrub={setScrub}
          drawKey="first-day"
          markers={[{ index: 0, kind: "buy" }]}
        />
      </div>
      {strip}
      {dayLine}
      <p className="mt-2 text-[12.5px] leading-5 text-muted-foreground">{copy.portfolioFirstDay}</p>
    </div>
  );
}
