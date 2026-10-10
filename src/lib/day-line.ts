import type { DayMover } from "@/lib/portfolio-story";

/**
 * What the line under the week strip says about one day, before it is put
 * in words (lib/copy portfolioDayYou, portfolioDayMover): which way the
 * portfolio went and by how much, and which holding moved most.
 *
 * FLAT means what is shown would read as zero: a percentage that rounds to
 * 0.0%, or with no percentage, dollars that round to $0.00. A flat day
 * still names the holding that moved most, so "flat" never sits beside a
 * loss unexplained: the holdings moved and cancelled out. A holding whose
 * own move rounds to zero both ways is not named at all.
 *
 * Every size here is unsigned; the direction carries the sign.
 */

export type DayDirection = "up" | "down" | "flat";

/** Shown to one decimal: below this it reads as 0.0%. */
const PCT_ZERO = 0.05;
/** Shown in cents: below this it reads as $0.00. */
const USD_ZERO = 0.005;

export const pctRoundsToZero = (pct: number) => Math.abs(pct) < PCT_ZERO;
export const usdRoundsToZero = (usd: number) => Math.abs(usd) < USD_ZERO;

export type YouPart =
  | { kind: "unknown" }
  | { kind: "flat" }
  | {
      kind: "up" | "down";
      /** Unsigned percent, or null when only dollars are known or the percent rounds to zero. */
      pct: number | null;
      /** Unsigned dollars, or null when they round to zero. */
      usd: number | null;
    };

export type MoverPart = {
  symbol: string;
  direction: "up" | "down";
  /** Unsigned percent of its own move, or null when unknown or zero. */
  pct: number | null;
  /** Unsigned dollars, or null when they round to zero or repeat the portfolio's own. */
  usd: number | null;
};

export type DayFacts = {
  change?: number | null;
  changePct?: number | null;
  mover?: DayMover | null;
  top?: DayMover | null;
  fromBuy?: boolean;
};

function sign(value: number): "up" | "down" {
  return value > 0 ? "up" : "down";
}

export function describeYou({ change, changePct }: DayFacts): YouPart {
  if (change == null) return { kind: "unknown" };
  if (changePct != null) {
    if (pctRoundsToZero(changePct)) return { kind: "flat" };
    return {
      kind: sign(changePct),
      pct: Math.abs(changePct),
      usd: usdRoundsToZero(change) ? null : Math.abs(change),
    };
  }
  if (usdRoundsToZero(change)) return { kind: "flat" };
  return { kind: sign(change), pct: null, usd: Math.abs(change) };
}

/**
 * The holding that moved most: the one whose own price moved most in
 * percent (`mover`), else the largest in dollars (`top`). Null when there
 * is none, or when its move rounds to zero both ways.
 */
export function describeMover(facts: DayFacts): MoverPart | null {
  const top = facts.mover ?? facts.top ?? null;
  if (!top) return null;
  const pctShown = top.pct !== null && !pctRoundsToZero(top.pct);
  const usdShown = !usdRoundsToZero(top.usd);
  if (!pctShown && !usdShown) return null;
  const direction = pctShown ? sign(top.pct!) : sign(top.usd);
  // One holding that made the whole day's change: its dollars are the
  // portfolio's, already said, so they are not said twice.
  const sameAsWhole = facts.change != null && !facts.fromBuy && Math.abs(top.usd - facts.change) < USD_ZERO;
  return {
    symbol: top.symbol,
    direction,
    pct: pctShown ? Math.abs(top.pct!) : null,
    usd: usdShown && !(sameAsWhole && pctShown) ? Math.abs(top.usd) : null,
  };
}

/**
 * "Fri, Oct 9", from an ISO day, read in UTC so the day never shifts: the
 * card's one date format (the range chip, the readout and the friend line
 * say "Oct 9"), with the weekday in front.
 */
export function dayLineDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
