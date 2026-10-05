"use client";

import { useId, useState, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { CaretDown, Check } from "@phosphor-icons/react";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopy, useMoney } from "@/components/settings-provider";
import { PortfolioChart, type ChartMarker } from "@/components/board/portfolio-chart";
import { WeekStrip, type StripDay } from "@/components/board/week-strip";
import { usePortfolioHistory } from "@/hooks/use-profile";
import { useStoredChoice } from "@/hooks/use-stored-choice";
import { BENCHMARKS, DEFAULT_BENCHMARK, findBenchmark, type BenchmarkSymbol } from "@/lib/benchmarks";
import { TOKEN_LISTINGS, rowName } from "@/lib/listings";
import { isTradingDay } from "@/lib/market-calendar";
import { addDays } from "@/lib/marks";
import { changeDirection, formatPercentChange, type ChangeDirection } from "@/lib/performance";
import { RANGES, type HistoryPoint, type HistoryResult, type Range } from "@/lib/portfolio-history";
import type { StoryMove, StoryOrder, StoryPoint } from "@/lib/portfolio-story";
import { cn } from "@/lib/utils";

const BENCHMARK_KEY = "berth.portfolio.benchmark";
const RANGE_KEY = "berth.portfolio.range";

/** Range labels that are words, set in the body font. */
const WORD_RANGES: ReadonlySet<Range> = new Set<Range>(["since", "all"]);

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

/** Which range opens: a month when there is one, else the longest there is. */
function defaultRange(available: readonly Range[], ranges: Partial<Record<Range, HistoryResult>>): Range {
  if (available.includes("1m")) return "1m";
  let best: Range | undefined;
  for (const range of available) {
    if (!best || (ranges[range]?.days.length ?? 0) > (ranges[best]?.days.length ?? 0)) best = range;
  }
  return best ?? "since";
}

/**
 * The benchmark's name in the headline, and the way to change it: a button
 * that opens a small menu of the five. The choice is kept per viewer.
 *
 * `shown` is the benchmark the numbers beside it belong to, so the name and
 * the figure never disagree while a new choice loads; `value` is the choice
 * itself, which the menu checks. The button's name is just the visible name,
 * so the sentence reads on naturally; its purpose is its description.
 */
function BenchmarkChooser({
  value,
  shown,
  onChange,
}: {
  value: BenchmarkSymbol;
  shown: BenchmarkSymbol;
  onChange: (symbol: BenchmarkSymbol) => void;
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
        {copy.benchmarkNames[shown]}
        <CaretDown weight="duotone" className="size-3 self-center" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={16} className="z-50">
          <Menu.Popup className="min-w-48 origin-[var(--transform-origin)] rounded-xl border border-border bg-popover p-1 text-sm text-popover-foreground shadow-raised outline-none transition-[opacity,transform] duration-150 ease-lift data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0">
            <Menu.Group>
              <Menu.GroupLabel className="px-2.5 pt-1.5 pb-1 text-[11px] text-muted-foreground">
                {copy.portfolioCompareWith}
              </Menu.GroupLabel>
              <Menu.RadioGroup
                value={value}
                onValueChange={(next) => {
                  const found = findBenchmark(String(next));
                  if (found) onChange(found.symbol);
                }}
              >
                {BENCHMARKS.map((benchmark) => (
                  <Menu.RadioItem
                    key={benchmark.symbol}
                    value={benchmark.symbol}
                    closeOnClick
                    className="flex cursor-default items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 outline-none select-none data-[highlighted]:bg-muted"
                  >
                    {copy.benchmarkNames[benchmark.symbol]}
                    <Menu.RadioItemIndicator keepMounted className="size-4 text-muted-foreground data-[unchecked]:invisible">
                      <Check weight="duotone" className="size-4" aria-hidden />
                    </Menu.RadioItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Under the chart and attached to it: only the ranges the data fills. */
function RangeControl({
  available,
  value,
  onChange,
  sinceFrom,
}: {
  available: readonly Range[];
  value: Range;
  onChange: (range: Range) => void;
  /** When since first buy starts on a later snapshot, that day: the chip names it. */
  sinceFrom: string | null;
}) {
  const copy = useCopy();
  return (
    // A pill group: the active range is the ink chip, so the board's one
    // accent is never spent on a filter.
    <div role="group" aria-label={copy.portfolioRangeLabel} className="inline-flex flex-wrap gap-0.5 rounded-full border border-border bg-card p-0.5">
      {RANGES.filter((range) => available.includes(range)).map((range) => (
        <button
          key={range}
          type="button"
          aria-pressed={range === value}
          onClick={() => onChange(range)}
          className={cn(
            // Numbers in the money font; "First buy" and "All" are words.
            WORD_RANGES.has(range) ? "" : "money tabular-nums",
            "inline-flex h-7 items-center rounded-full px-3 text-xs leading-none font-medium outline-none transition-colors duration-150 ease-lift focus-visible:ring-3 focus-visible:ring-ring/50",
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

/** A listing's name as a person reads it, from its symbol. */
function nameOf(symbol: string): string {
  const listing = TOKEN_LISTINGS.find((entry) => entry.symbol === symbol);
  return listing ? rowName(listing) : symbol;
}

/** "Thu, Sep 24", from an ISO day, read in UTC. */
function dayName(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
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
  const signed = useSignedMoney();
  // The day's pick is the holding that moved most in percent, told with its dollars.
  const top = point.mover ?? point.top ?? null;
  // One holding moving the whole day says it once.
  const sameAsTop = top !== null && point.change != null && Math.abs(top.usd - point.change) < 0.005;
  const shownOrders = orders.slice(0, 2);
  // Each part keeps its own words together; the line breaks between parts.
  const parts: { key: string; node: ReactNode }[] = [];
  if (point.change == null) {
    parts.push({ key: "unknown", node: copy.portfolioDayUnknown });
  } else {
    if (!sameAsTop || point.fromBuy) {
      parts.push({
        key: "you",
        node: (
          <>
            {point.fromBuy ? copy.portfolioFromBuy : copy.portfolioYou} <Figure>{signed(point.change)}</Figure>
          </>
        ),
      });
    }
    if (top) {
      parts.push({
        key: "top",
        node: (
          <>
            {nameOf(top.symbol)}{" "}
            {top.pct !== null && (
              <>
                <Figure>{formatPercentChange(top.pct, 1)}</Figure>,{" "}
              </>
            )}
            <Figure>{signed(top.usd)}</Figure>
          </>
        ),
      });
    }
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
      <span className="whitespace-nowrap text-foreground">{today ? copy.portfolioToday : dayName(point.day)}.</span>
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
  const signed = useSignedMoney();
  return points.map((point) => {
    const today = point.day === liveDay;
    const moverName = point.mover ? nameOf(point.mover.symbol) : null;
    const pct = point.changePct;
    const change =
      point.change == null || pct == null
        ? null
        : Math.abs(pct) < 0.05
          ? copy.portfolioDayFlat
          : (pct > 0 ? copy.portfolioDayUp : copy.portfolioDayDown)(
              formatPercentChange(Math.abs(pct), 1),
              signed(Math.abs(point.change)),
            );
    const date = today ? copy.portfolioToday : longDayName(point.day);
    return { ...point, moverName, today, label: copy.portfolioDayAria(date, change, moverName) };
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
  const stripSource = since && since.days.length > 0 ? since.days : [];
  const stripDays = useStripDays(stripSource.slice(-7), liveDay);

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

  const stored = storedRange as Range | null;
  const range: Range =
    stored && data.available.includes(stored) ? stored : defaultRange(data.available, data.ranges);
  const result = data.ranges[range];

  // In the first seven market days the strip shows the days to come, empty.
  const firstWeek = stripSource.length > 0 && stripSource.length < 7;
  const slots = firstWeek ? nextMarketDays(stripSource.at(-1)!.day, 7 - stripSource.length) : [];
  const stripHeading = firstWeek ? copy.portfolioFirstWeek(stripSource.length) : copy.portfolioWeekLabel;
  const allOrders = since?.orders ?? result?.orders ?? [];
  const ordersOn = (day: string) => allOrders.filter((order) => order.day === day);
  const moveOn = (day: string) => (data.move && data.move.day === day ? data.move : null);
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
  const withBenchmark = status === "ok" && result.benchmarkPct !== null;

  // The line is the return so far, both sides from the same start, so a
  // buy is never a step up. Where that return cannot be told the line is
  // dollars, as it was, with the reason said below the legend.
  const percent = result.changePct !== null && days.every((point) => point.returnPct != null);
  // Since first buy counts from the buy itself: an origin at 0% before the
  // first close, where the first buy's mark sits.
  const origin = percent && range === "since" && !result.rebasedFrom && days[0].fromBuy === true;
  const chart = buildChart(days, { percent, origin, withBenchmark });
  const indexOf = new Map(chart.flatMap((point, index) => (point.origin ? [] : [[point.day, index] as const])));
  const fromStrip = hover ?? pinned;
  const marked = scrub ?? (fromStrip !== null ? (indexOf.get(fromStrip) ?? null) : null);
  const markedDay = marked !== null ? chart[marked]?.day ?? null : null;
  const chooser = (
    <BenchmarkChooser value={benchmark} shown={shownBenchmark} onChange={setBenchmark} />
  );
  // In a reason's sentence the name is plain text: the legend holds the chooser.
  const named = `${copy.benchmarkArticle[shownBenchmark]}${copy.benchmarkNames[shownBenchmark]}`;

  const scrubbed = marked !== null ? chart[marked] : undefined;
  const figure = (value: number) => (percent ? formatPercentChange(value, 1) : money.format(value));
  const readout = scrubbed && (
    // Over the legend, never instead of it: the legend keeps its height,
    // hidden, so nothing below moves.
    // Anchored to the bottom: on a narrow screen a second line grows up into
    // the space above the legend, never down over the line.
    <p className="absolute inset-x-0 bottom-0 flex flex-wrap items-baseline gap-x-1.5 text-[13px] leading-5 text-muted-foreground">
      <span className="whitespace-nowrap">
        {scrubbed.origin
          ? copy.portfolioWhenBought
          : scrubbed.day === liveDay
            ? copy.portfolioToday
            : shortDate(scrubbed.day)}
      </span>
      <span aria-hidden="true">·</span>
      <span className="whitespace-nowrap text-foreground">
        {copy.portfolioYou} <span className="money tabular-nums">{figure(scrubbed.value)}</span>
        {/* On a percent line the dollars ride along, so the money is never out of sight. */}
        {percent && scrubbed.dollars !== null && (
          <>
            , <span className="money tabular-nums">{money.format(scrubbed.dollars)}</span>
          </>
        )}
      </span>
      {withBenchmark && scrubbed.benchmark !== null && (
        <>
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap">
            {copy.benchmarkNames[shownBenchmark]}{" "}
            <span className="money tabular-nums">{figure(scrubbed.benchmark)}</span>
          </span>
        </>
      )}
    </p>
  );

  let reason: string | null = null;
  if (status === "unpriced_orders" || status === "unexplained_balance") {
    reason = copy.portfolioNoBenchmark[status](named);
  } else if (status === "no_marks") {
    reason = copy.portfolioNoMarks(copy.benchmarkNames[shownBenchmark]);
  } else if (result.rebasedFrom) {
    reason = copy.portfolioRebased(shortDate(result.rebasedFrom));
  } else if (result.recordFrom) {
    reason = copy.portfolioRecordStarts(shortDate(result.recordFrom));
  }

  const legend = (
    <p
      className={cn(
        "flex flex-wrap items-baseline gap-x-[18px] gap-y-1 text-[13px] leading-5 text-foreground",
        readout && "invisible",
      )}
    >
      <span className="whitespace-nowrap">
        <Swatch />
        {copy.portfolioYou}
        {result.changePct !== null && (
          <>
            {" "}
            <Pct value={result.changePct} dim={stale} />
          </>
        )}
      </span>
      {/* The benchmark's name is the chooser in every state, so another is
          always one tap away, with or without its line drawn. */}
      <span className="whitespace-nowrap">
        <Swatch dashed />
        {chooser}
        {withBenchmark && (
          <>
            {" "}
            <Pct value={result.benchmarkPct!} dim={stale} />
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
      <div className="mt-2">
        <PortfolioChart
          days={chart}
          unit={percent ? "pct" : "usd"}
          withBenchmark={withBenchmark}
          scrubIndex={marked}
          onScrub={setScrub}
          drawKey={`${range}:${shownBenchmark}`}
          markers={markersFor(chart, result.orders ?? [])}
        />
      </div>
      {stripDays.length > 0 && (
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
      <div className="mt-2 flex flex-col items-start gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <span className="text-[12.5px] text-muted-foreground">
          {percent ? copy.portfolioReturnCaption : copy.portfolioSameDays}
          {/* The percentages are dollar returns; in another currency, say so. */}
          {money.converted && `. ${copy.inUsDollars}`}
        </span>
        <RangeControl
          available={data.available}
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
        <p className={cn("text-[13px] leading-5 text-foreground", scrubbed && "invisible")}>
          <Swatch />
          {copy.portfolioYou}
          {point.changePct != null && (
            <>
              {" "}
              <Pct value={point.changePct} />
            </>
          )}{" "}
          <span className="text-muted-foreground">{copy.portfolioSinceBuy}</span>
        </p>
        {scrubbed && (
          <p className="absolute inset-0 flex items-baseline gap-x-1.5 text-[13px] leading-5 text-muted-foreground">
            <span className="whitespace-nowrap">
              {scrub === 0 ? copy.portfolioWhenBought : today ? copy.portfolioToday : copy.portfolioNow}
            </span>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap text-foreground">
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
