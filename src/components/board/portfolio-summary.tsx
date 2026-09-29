"use client";

import { useId, useState } from "react";
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

/**
 * Under the account's figure: the account's money beside the same dollars
 * in a chosen benchmark, as a legend (the chooser is the benchmark's name),
 * the two lines, and the range. Rendered only while the account holds
 * something; the query is not even asked otherwise. Every number is the
 * server's (lib/portfolio-history); this only lays them out and refuses to
 * draw what it was not given.
 */
export function PortfolioSummary({ holdsAnything }: { holdsAnything: boolean }) {
  const copy = useCopy();
  const money = useMoney();
  const [storedBenchmark, setBenchmark] = useStoredChoice(BENCHMARK_KEY);
  const [storedRange, setRange] = useStoredChoice(RANGE_KEY);
  const [scrub, setScrub] = useState<number | null>(null);
  const benchmark = findBenchmark(storedBenchmark)?.symbol ?? DEFAULT_BENCHMARK;
  const query = usePortfolioHistory(benchmark, holdsAnything);

  if (!holdsAnything) return null;

  const data = query.data;
  if (!data) {
    // Loading: the legend and the chart hold their places. An error
    // behaves as a line too short to draw: nothing, no message.
    if (query.isError) return null;
    return (
      <div className="mt-4">
        <Skeleton className="h-4 w-56 max-w-full" />
        <div className="mt-2 h-[150px] lg:h-[190px]" />
        <div className="mt-1 h-8" />
      </div>
    );
  }

  const stored = storedRange as Range | null;
  const range: Range =
    stored && data.available.includes(stored) ? stored : defaultRange(data.available, data.ranges);
  const result = data.ranges[range];

  if (!result || result.days.length < 2 || data.available.length === 0) {
    return <p className="mt-4 text-xs leading-5 text-muted-foreground">{copy.portfolioFirstDay}</p>;
  }

  const shownBenchmark = data.benchmark.symbol as BenchmarkSymbol;
  const stale = query.isPlaceholderData;
  const status = result.benchmarkStatus;
  const withBenchmark = status === "ok" && result.benchmarkPct !== null;
  const chooser = (
    <BenchmarkChooser value={benchmark} shown={shownBenchmark} onChange={setBenchmark} />
  );
  // In a reason's sentence the name is plain text: the legend holds the chooser.
  const named = `${copy.benchmarkArticle[shownBenchmark]}${copy.benchmarkNames[shownBenchmark]}`;

  const scrubbed = scrub !== null ? result.days[scrub] : undefined;
  const readout = scrubbed && (
    // Over the legend, never instead of it: the legend keeps its height,
    // hidden, so nothing below moves.
    <p className="absolute inset-0 flex flex-wrap content-center items-baseline gap-x-1.5 text-[13px] leading-5 text-muted-foreground">
      <span className="whitespace-nowrap">{shortDate(scrubbed.day)}</span>
      <span aria-hidden="true">·</span>
      <span className="whitespace-nowrap text-foreground">
        {copy.portfolioYou}{" "}
        <span className="money tabular-nums">{money.format(scrubbed.value)}</span>
      </span>
      {withBenchmark && scrubbed.benchmark !== null && (
        <>
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap">
            {copy.benchmarkNames[shownBenchmark]}{" "}
            <span className="money tabular-nums">{money.format(scrubbed.benchmark)}</span>
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

  return (
    <div className="mt-5 lg:mt-[22px]">
      <div className="relative flex min-h-5 items-center">
        {legend}
        {readout}
      </div>
      {/* Why the benchmark's line is missing or starts late, when it is. */}
      {reason && <p className="mt-1 text-xs leading-5 text-muted-foreground">{reason}</p>}
      <div className="mt-2">
        <PortfolioChart
          days={result.days}
          withBenchmark={withBenchmark}
          scrubIndex={scrub}
          onScrub={setScrub}
          drawKey={`${range}:${shownBenchmark}`}
        />
      </div>
      <div className="mt-2.5 flex flex-col items-start gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <span className="text-[12.5px] text-muted-foreground">{copy.portfolioSameDays}</span>
        <RangeControl
          available={data.available}
          value={range}
          sinceFrom={data.ranges.since?.rebasedFrom ?? null}
          onChange={(next) => {
            setScrub(null);
            setRange(next);
          }}
        />
      </div>
    </div>
  );
}
