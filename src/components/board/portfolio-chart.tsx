"use client";

import { useRef, type PointerEvent } from "react";
import type { HistoryPoint } from "@/lib/portfolio-history";
import { cn } from "@/lib/utils";

/**
 * Two lines in dollars: the account's money each day, and the same dollars
 * placed in a benchmark on the same days (lib/portfolio-history). The first
 * is the composition's one accent; the second is quiet and dashed. No fill,
 * no grid, no axis: the headline above states the numbers, so the drawing
 * is hidden from assistive technology.
 *
 * The viewBox is stretched to the box (`preserveAspectRatio` off) and the
 * strokes do not scale, so one path serves a phone and a desktop. What
 * would distort under that stretch, the end dots and the scrub hairline,
 * are HTML laid over the drawing at percentages instead.
 *
 * Scrub: a pointer or a finger moving across picks the nearest day and
 * hands its index up; the parent swaps its headline for that day's
 * readout. `touch-action: pan-y` keeps a vertical swipe scrolling the page.
 */

const WIDTH = 100;
const HEIGHT = 100;
/** Share of the spread added above and below, so no line touches the edge. */
const PAD = 0.08;
/** The narrowest the box may be, as a share of its midpoint, each way. */
const MIN_HALF_SPAN = 0.015;

export type ChartScale = { lo: number; hi: number };

/**
 * The vertical range: both lines' spread plus 8%, but never narrower than
 * ±1.5% around the middle, so a few quiet days are drawn as quiet.
 */
export function chartScale(days: readonly HistoryPoint[]): ChartScale | undefined {
  const values: number[] = [];
  for (const day of days) {
    if (Number.isFinite(day.value)) values.push(day.value);
    if (day.benchmark !== null && Number.isFinite(day.benchmark)) values.push(day.benchmark);
  }
  if (values.length === 0) return undefined;
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = (hi - lo) * PAD;
  lo -= pad;
  hi += pad;
  const mid = (lo + hi) / 2;
  const minHalf = Math.abs(mid) * MIN_HALF_SPAN || 1;
  if ((hi - lo) / 2 < minHalf) {
    lo = mid - minHalf;
    hi = mid + minHalf;
  }
  return { lo, hi };
}

const xAt = (index: number, count: number) => (count <= 1 ? WIDTH : (index / (count - 1)) * WIDTH);
const yAt = (value: number, scale: ChartScale) =>
  HEIGHT - ((value - scale.lo) / (scale.hi - scale.lo)) * HEIGHT;

/** A path through the values; a null is a gap, and the line picks up after it. */
export function linePath(values: readonly (number | null)[], scale: ChartScale): string {
  let path = "";
  let pen = false;
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      pen = false;
      return;
    }
    const x = xAt(index, values.length).toFixed(3);
    const y = yAt(value, scale).toFixed(3);
    path += `${pen ? "L" : "M"}${x} ${y}`;
    pen = true;
  });
  return path;
}

function Dot({ x, y, className }: { x: number; y: number; className: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("pointer-events-none absolute size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full", className)}
      style={{ left: `${x}%`, top: `${y}%` }}
    />
  );
}

export function PortfolioChart({
  days,
  withBenchmark,
  scrubIndex,
  onScrub,
  drawKey,
}: {
  days: readonly HistoryPoint[];
  /** Draw the benchmark's line; off when its status is not ok. */
  withBenchmark: boolean;
  scrubIndex: number | null;
  onScrub: (index: number | null) => void;
  /** Changes when the range or the benchmark does, so the lines draw in again. */
  drawKey: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const shown = withBenchmark ? days : days.map((day) => ({ ...day, benchmark: null }));
  const scale = chartScale(shown);
  if (!scale || days.length < 2) return <div className="h-28 sm:h-36" />;

  const count = days.length;
  const valuePath = linePath(
    days.map((day) => day.value),
    scale,
  );
  const benchmarkValues = shown.map((day) => day.benchmark);
  const benchmarkPath = withBenchmark ? linePath(benchmarkValues, scale) : "";
  const last = days[count - 1];
  const lastBenchmark = withBenchmark ? benchmarkValues[count - 1] : null;

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const share = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    onScrub(Math.round(share * (count - 1)));
  };
  const leave = () => onScrub(null);

  return (
    <div
      ref={box}
      className="relative h-28 cursor-crosshair touch-pan-y select-none sm:h-36"
      onPointerDown={pick}
      onPointerMove={pick}
      onPointerLeave={leave}
      onPointerUp={(event) => {
        if (event.pointerType !== "mouse") leave();
      }}
      onPointerCancel={leave}
    >
      {/* The draw-in: a reveal from the left, replayed per range and
          benchmark by the key, and switched off for reduced motion. */}
      <div key={drawKey} data-chart-draw className="absolute inset-0">
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          fill="none"
          overflow="visible"
          className="absolute inset-0 size-full"
        >
          {benchmarkPath && (
            <path
              d={benchmarkPath}
              stroke="var(--muted-foreground)"
              strokeWidth={1.25}
              strokeDasharray="3 3"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path
            d={valuePath}
            stroke="var(--primary)"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {lastBenchmark !== null && (
          <Dot x={WIDTH} y={yAt(lastBenchmark, scale)} className="bg-muted-foreground" />
        )}
        <Dot x={WIDTH} y={yAt(last.value, scale)} className="bg-primary" />
      </div>
      {scrubIndex !== null && scrubIndex < count && (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-muted-foreground/45"
            style={{ left: `${xAt(scrubIndex, count)}%` }}
          />
          {withBenchmark && benchmarkValues[scrubIndex] !== null && (
            <Dot
              x={xAt(scrubIndex, count)}
              y={yAt(benchmarkValues[scrubIndex]!, scale)}
              className="bg-muted-foreground"
            />
          )}
          <Dot
            x={xAt(scrubIndex, count)}
            y={yAt(days[scrubIndex].value, scale)}
            className="bg-primary"
          />
        </>
      )}
    </div>
  );
}
