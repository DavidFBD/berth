"use client";

import { useRef, type PointerEvent } from "react";
import type { HistoryPoint } from "@/lib/portfolio-history";
import { cn } from "@/lib/utils";

/**
 * Two lines in dollars: the account's money each day, and the same dollars
 * placed in a benchmark on the same days (lib/portfolio-history). The first
 * is ink, since the board's one accent is Ask; the second is quiet and dashed. No fill,
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
 * The week strip under the chart (week-strip) shares the same index, so a
 * day picked there is the day marked here.
 *
 * Orders sit on the account's line as small marks: an ink dot in a ring of
 * the card for a buy, a hollow ink ring for a sell. Never the accent, never
 * green or red: an order is a fact, not a verdict.
 */

/** An order on the line: the index of the point it landed on. */
export type ChartMarker = { index: number; kind: "buy" | "sell" };

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

/** A buy: an ink dot ringed in the card. A sell: a hollow ink ring. */
function OrderMark({ x, y, kind }: { x: number; y: number; kind: ChartMarker["kind"] }) {
  return (
    <span
      aria-hidden="true"
      data-order-mark={kind}
      className={cn(
        "pointer-events-none absolute size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px]",
        kind === "buy" ? "border-card bg-foreground ring-1 ring-foreground" : "border-foreground bg-card",
      )}
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
  markers = [],
}: {
  days: readonly HistoryPoint[];
  /** Draw the benchmark's line; off when its status is not ok. */
  withBenchmark: boolean;
  scrubIndex: number | null;
  onScrub: (index: number | null) => void;
  /** Changes when the range or the benchmark does, so the lines draw in again. */
  drawKey: string;
  /** Orders on the account's line, at most one per point. */
  markers?: readonly ChartMarker[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const shown = withBenchmark ? days : days.map((day) => ({ ...day, benchmark: null }));
  const scale = chartScale(shown);
  if (!scale || days.length < 2) return <div className="h-[150px] lg:h-[190px]" />;

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
      // Blocked, not masked: the line's shape is the account's value over time (lib/analytics).
      data-ph-block
      className="relative h-[150px] cursor-crosshair touch-pan-y select-none lg:h-[190px]"
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
            stroke="var(--foreground)"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {lastBenchmark !== null && (
          <Dot x={WIDTH} y={yAt(lastBenchmark, scale)} className="bg-muted-foreground" />
        )}
        <Dot x={WIDTH} y={yAt(last.value, scale)} className="bg-foreground" />
        {markers
          .filter((marker) => marker.index >= 0 && marker.index < count)
          .map((marker) => (
            <OrderMark
              key={marker.index}
              kind={marker.kind}
              x={xAt(marker.index, count)}
              y={yAt(days[marker.index].value, scale)}
            />
          ))}
      </div>
      {scrubIndex !== null && scrubIndex < count && (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-muted-foreground/90"
            style={{ left: `${xAt(scrubIndex, count)}%` }}
          />
          {withBenchmark && benchmarkValues[scrubIndex] !== null && (
            <Dot
              x={xAt(scrubIndex, count)}
              y={yAt(benchmarkValues[scrubIndex]!, scale)}
              className="bg-muted-foreground"
            />
          )}
          {/* An order's mark already sits on that point, and says more. */}
          {!markers.some((marker) => marker.index === scrubIndex) && (
            <Dot
              x={xAt(scrubIndex, count)}
              y={yAt(days[scrubIndex].value, scale)}
              className="bg-foreground"
            />
          )}
        </>
      )}
    </div>
  );
}
