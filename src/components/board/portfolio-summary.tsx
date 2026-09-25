"use client";

import { useState, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { CaretDown, Check } from "@phosphor-icons/react";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopy, useMoney } from "@/components/settings-provider";
import { PortfolioChart } from "@/components/board/portfolio-chart";
import { usePortfolioHistory } from "@/hooks/use-profile";
import { useStoredChoice } from "@/hooks/use-stored-choice";
import { BENCHMARKS, DEFAULT_BENCHMARK, findBenchmark, type BenchmarkSymbol } from "@/lib/benchmarks";
import { changeDirection, formatPercentChange, type ChangeDirection } from "@/lib/performance";
import { RANGES, type HistoryResult, type Range } from "@/lib/portfolio-history";
import { cn } from "@/lib/utils";

const BENCHMARK_KEY = "berth.portfolio.benchmark";
const RANGE_KEY = "berth.portfolio.range";

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
 */
function BenchmarkChooser({
  value,
  onChange,
}: {
  value: BenchmarkSymbol;
  onChange: (symbol: BenchmarkSymbol) => void;
}) {
  const copy = useCopy();
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`${copy.portfolioCompareWith}: ${copy.benchmarkNames[value]}`}
        className="inline-flex items-baseline gap-0.5 rounded-sm font-medium text-foreground underline decoration-border decoration-1 underline-offset-[3px] outline-none transition-colors duration-150 ease-lift hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:decoration-foreground"
      >
        {copy.benchmarkNames[value]}
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
}: {
  available: readonly Range[];
  value: Range;
  onChange: (range: Range) => void;
}) {
  const copy = useCopy();
  return (
    <div role="group" aria-label={copy.portfolioRangeLabel} className="mt-1.5 flex flex-wrap gap-1">
      {RANGES.filter((range) => available.includes(range)).map((range) => (
        <button
          key={range}
          type="button"
          aria-pressed={range === value}
          onClick={() => onChange(range)}
          className={cn(
            "money rounded-md px-2 py-1 text-[11px] leading-none tabular-nums outline-none transition-colors duration-150 ease-lift focus-visible:ring-3 focus-visible:ring-ring/50",
            range === value
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {copy.portfolioRanges[range]}
        </button>
      ))}
    </div>
  );
}

/**
 * The top of "What you own": the holdings total, one sentence saying what
 * the money did beside the chosen benchmark, the two lines, and the range.
 * Rendered only while the account holds something; the query is not even
 * asked otherwise. Every number is the server's (lib/portfolio-history);
 * this only lays them out and refuses to draw what it was not given.
 */
export function PortfolioSummary({
  total,
  holdsAnything,
}: {
  /** The holdings at live prices, in dollars; undefined while they load. */
  total: number | undefined;
  holdsAnything: boolean;
}) {
  const copy = useCopy();
  const money = useMoney();
  const [storedBenchmark, setBenchmark] = useStoredChoice(BENCHMARK_KEY);
  const [storedRange, setRange] = useStoredChoice(RANGE_KEY);
  const [scrub, setScrub] = useState<number | null>(null);
  const benchmark = findBenchmark(storedBenchmark)?.symbol ?? DEFAULT_BENCHMARK;
  const query = usePortfolioHistory(benchmark, holdsAnything);

  if (!holdsAnything) return null;

  const totalLine =
    total === undefined ? (
      <Skeleton className="h-8 w-28" />
    ) : (
      <div className="money text-2xl leading-8 font-semibold tracking-[-0.02em] tabular-nums text-foreground">
        {money.format(total)}
      </div>
    );

  const data = query.data;
  if (!data) {
    // Loading: the headline and the chart hold their places. An error
    // behaves as a line too short to draw: the total alone, no message.
    if (query.isError) return <div className="px-4 pb-3">{totalLine}</div>;
    return (
      <div className="px-4 pb-3">
        {totalLine}
        <div className="mt-1.5 flex h-10 flex-col justify-center gap-1.5">
          <Skeleton className="h-3.5 w-64 max-w-full" />
          <Skeleton className="h-3.5 w-40" />
        </div>
        <div className="mt-2 h-28 sm:h-36" />
        <div className="mt-1.5 h-[19px]" />
      </div>
    );
  }

  const stored = storedRange as Range | null;
  const range: Range =
    stored && data.available.includes(stored) ? stored : defaultRange(data.available, data.ranges);
  const result = data.ranges[range];

  if (!result || result.days.length < 2 || data.available.length === 0) {
    return (
      <div className="px-4 pb-3">
        {totalLine}
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{copy.portfolioFirstDay}</p>
      </div>
    );
  }

  const shownBenchmark = data.benchmark.symbol as BenchmarkSymbol;
  const stale = query.isPlaceholderData;
  const status = result.benchmarkStatus;
  const withBenchmark = status === "ok" && result.benchmarkPct !== null;

  let headline: ReactNode;
  if (scrub !== null && result.days[scrub]) {
    const day = result.days[scrub];
    headline = (
      <p className="money text-xs leading-5 whitespace-nowrap text-muted-foreground tabular-nums">
        {shortDate(day.day)} <span aria-hidden="true">·</span>{" "}
        <span className="text-foreground">
          {copy.portfolioYou} {money.format(day.value)}
        </span>
        {withBenchmark && day.benchmark !== null && (
          <>
            {" "}
            <span aria-hidden="true">·</span> {copy.benchmarkNames[shownBenchmark]}{" "}
            {money.format(day.benchmark)}
          </>
        )}
      </p>
    );
  } else {
    headline = (
      <p className="text-xs leading-5 text-muted-foreground">
        {copy.portfolioSince(shortDate(result.since ?? result.days[0].day), result.tradingDays)}{" "}
        {result.changePct !== null && (
          <span className="whitespace-nowrap">
            {copy.portfolioYou} <Pct value={result.changePct} dim={stale} />
            {withBenchmark ? "," : "."}
          </span>
        )}{" "}
        {withBenchmark && (
          <>
            {copy.portfolioSameDollarsIn[benchmark]}{" "}
            <BenchmarkChooser value={benchmark} onChange={setBenchmark} />{" "}
            <Pct value={result.benchmarkPct!} dim={stale} />.
          </>
        )}
        {status === "unpriced_orders" || status === "unexplained_balance" ? (
          copy.portfolioNoBenchmark[status]
        ) : status === "no_marks" ? (
          <NoMarks benchmark={benchmark} onChange={setBenchmark} />
        ) : null}
      </p>
    );
  }

  return (
    <div className="px-4 pb-3">
      {totalLine}
      {/* Two lines tall on a phone either way, so the readout replacing the
          sentence never moves the chart. */}
      <div className="mt-1.5 flex min-h-10 items-center">{headline}</div>
      <div className="mt-2">
        <PortfolioChart
          days={result.days}
          withBenchmark={withBenchmark}
          scrubIndex={scrub}
          onScrub={setScrub}
          drawKey={`${range}:${shownBenchmark}`}
        />
      </div>
      <RangeControl
        available={data.available}
        value={range}
        onChange={(next) => {
          setScrub(null);
          setRange(next);
        }}
      />
    </div>
  );
}

/** "No prices for [Gold] yet.", the name still the chooser so another is one tap away. */
function NoMarks({
  benchmark,
  onChange,
}: {
  benchmark: BenchmarkSymbol;
  onChange: (symbol: BenchmarkSymbol) => void;
}) {
  const copy = useCopy();
  // The sentence is copy's; the name inside it becomes the chooser.
  const [before, after = ""] = copy.portfolioNoMarks("\u0000").split("\u0000");
  return (
    <>
      {before}
      <BenchmarkChooser value={benchmark} onChange={onChange} />
      {after}
    </>
  );
}
