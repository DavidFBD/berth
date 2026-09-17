/**
 * Pure core of the performance strip: how a run of daily closes becomes a
 * line, how a percentage becomes a direction and a word, and how a batch of
 * history requests is cut to fit what the upstream will answer.
 *
 * No fetching and no React here, so every rule below is testable offline.
 */

import { isTradingDay } from "@/lib/market-calendar";

/** Which way a change points, once a flat band has been applied. */
export type ChangeDirection = "up" | "down" | "flat";

/**
 * Below this, in percent, a move is called flat rather than up or down.
 * A Treasury fund drifts a basis point a day; painting that green would
 * dress up noise as performance.
 */
export const FLAT_BAND_PCT = 0.05;

export function changeDirection(
  changePct: number | undefined,
  flatBandPct = FLAT_BAND_PCT,
): ChangeDirection | undefined {
  if (changePct === undefined || !Number.isFinite(changePct)) return undefined;
  if (Math.abs(changePct) < flatBandPct) return "flat";
  return changePct > 0 ? "up" : "down";
}

/**
 * A change as a person reads it: "+2.14%", "-3.70%", "0.00%". Zero carries
 * no sign, because a plus on nothing reads as a gain that did not happen.
 */
export function formatPercentChange(changePct: number, digits = 2): string {
  if (!Number.isFinite(changePct)) return "";
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    signDisplay: "exceptZero",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(changePct / 100);
}

/**
 * An SVG path through a run of values, scaled to the box.
 *
 * Oldest value at the left, newest at the right; y is inverted because SVG
 * counts downward and a rising price must rise. A run with no spread at all
 * draws through the middle rather than dividing by zero. Half the stroke is
 * inset top and bottom so the extremes are not clipped by the viewBox.
 *
 * Returns undefined for anything that cannot be a line (fewer than two
 * points, or a value that isn't finite), which the caller renders as no
 * sparkline rather than as a broken one.
 */
export function sparklinePath(
  values: readonly number[],
  width: number,
  height: number,
  strokeWidth = 1,
): string | undefined {
  if (values.length < 2 || width <= 0 || height <= 0) return undefined;
  if (values.some((value) => !Number.isFinite(value))) return undefined;

  const inset = strokeWidth / 2;
  const usableHeight = Math.max(height - strokeWidth, 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min;

  const round = (value: number) => Math.round(value * 100) / 100;
  const stepX = width / (values.length - 1);

  return values
    .map((value, index) => {
      const x = round(index * stepX);
      const y = round(
        spread === 0
          ? height / 2
          : inset + (1 - (value - min) / spread) * usableHeight,
      );
      return `${index === 0 ? "M" : "L"}${x} ${y}`;
    })
    .join(" ");
}

/**
 * Cut a list of ids into request-sized chunks.
 *
 * DefiLlama's chart endpoint answers 400 "Requested N data points exceeds
 * the maximum of 500" for the product of coins and span, so thirteen
 * listings over ninety days has to go out as three requests. The budget is
 * the caller's to state; this only does the arithmetic.
 *
 * An item that cannot fit alone (span larger than the whole budget) still
 * goes out alone rather than silently disappearing: the upstream will reject
 * it and the route degrades that one series, which is louder than dropping
 * it here.
 */
export function chunkByPointBudget<T>(
  items: readonly T[],
  pointsPerItem: number,
  budget: number,
): T[][] {
  const perChunk = Math.max(1, Math.floor(budget / Math.max(pointsPerItem, 1)));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += perChunk) {
    chunks.push(items.slice(index, index + perChunk));
  }
  return chunks;
}

/**
 * Keep only the marks taken on days the US market was open, oldest first.
 *
 * The upstream series is whatever the token was marked at each morning,
 * weekends and holidays included, and those marks are not the share's price
 * (see lib/market-calendar for what that costs when it is drawn). One mark
 * per day survives, the last one, since a duplicated date means a re-read
 * rather than two sessions.
 */
export function tradingDayCloses(
  points: readonly { timestamp: number; price: number }[],
): { dates: string[]; values: number[] } {
  const byDate = new Map<string, number>();
  for (const point of [...points].sort((a, b) => a.timestamp - b.timestamp)) {
    if (!Number.isFinite(point.price) || point.price <= 0) continue;
    const date = new Date(point.timestamp * 1000).toISOString().slice(0, 10);
    if (!isTradingDay(date)) continue;
    byDate.set(date, point.price);
  }
  const dates = [...byDate.keys()].sort();
  return { dates, values: dates.map((date) => byDate.get(date) as number) };
}

/** Percent change from one price to another, e.g. 2.14 meaning +2.14%. */
export function percentChange(
  from: number | undefined,
  to: number | undefined,
): number | undefined {
  if (from === undefined || to === undefined) return undefined;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) {
    return undefined;
  }
  return ((to - from) / from) * 100;
}

/**
 * How far a close may sit from the midpoint of the days either side of it
 * before it is treated as a bad mark rather than a move. Twenty percent
 * keeps every real gap: an earnings jump is a STEP, so the day after it
 * stays at the new level and the midpoint moves with it. Only a price that
 * goes there and comes straight back trips this.
 */
export const SPIKE_TOLERANCE = 0.2;

/**
 * Drop marks the underlying share never made.
 *
 * The trading-day filter removes the weekend and holiday prints, which is
 * most of the damage, but the thinnest listings carry bad marks inside the
 * week too: Sandisk's token printed $6,972.01 on Thursday 2026-07-16 against
 * $1,494.00 for the same stock's other wrapper, and Micron's printed $533.85
 * on Monday 2026-07-20 against about $890. Drawn as given, one such point
 * flattens the whole line around it and the shape says nothing.
 *
 * The rule is deliberately narrow: an interior close is dropped only when it
 * sits further than `tolerance` from the MEDIAN of itself and the two closes
 * either side of it. The median is what makes it safe. Comparing against the
 * midpoint of the neighbours instead would throw away the quiet day before a
 * real jump, because the midpoint of a flat day and a jump lands between
 * them and makes the flat day look wrong; the median of the three is simply
 * the middle price, so only a value that is the highest or the lowest of its
 * window, and far from the middle one, can ever be dropped. A genuine move
 * survives because it persists into the next day.
 *
 * The first and last closes are always kept. From inside a series, a first
 * big move and a bad mark look exactly alike, and there is no next day yet
 * to tell them apart; guessing would erase real news on the day it broke.
 */
export function withoutSpikes(
  dates: readonly string[],
  values: readonly number[],
  tolerance = SPIKE_TOLERANCE,
): { dates: string[]; values: number[] } {
  if (values.length < 3) return { dates: [...dates], values: [...values] };
  const keptDates: string[] = [];
  const keptValues: number[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (index > 0 && index < values.length - 1) {
      const median = [values[index - 1], value, values[index + 1]].sort(
        (a, b) => a - b,
      )[1];
      if (median > 0 && Math.abs(value - median) / median > tolerance) {
        continue;
      }
    }
    keptDates.push(dates[index]);
    keptValues.push(value);
  }
  return { dates: keptDates, values: keptValues };
}
