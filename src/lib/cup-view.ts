/**
 * The cup view — how hot the cup steams, how full it sits, and what its
 * figures say — derived once from plain inputs. Both the shelf miniature and
 * the opened card render this, so the same position can never read
 * differently in the two places.
 *
 * The canonical heat rule: a cup steams by what it is WORTH. USD bands
 * ({@link USD_STEAM_BANDS}) whenever the oracle prices the vault's asset;
 * the per-vault token-unit thresholds (VaultMeta.steamThresholds) are only
 * the unpriced fallback.
 */

import { rayToPercentNumber } from "@/lib/format";
import { USD_STEAM_BANDS } from "@/lib/vaults-meta";

/** Steam plume intensity: 0 for an empty cup, then four heat bands. */
export type SteamLevel = 0 | 1 | 2 | 3 | 4;

/**
 * Fraction of the pot inside which a negative earned figure is treated as
 * sawtooth noise. A leveraged vault's price-per-share is a SAWTOOTH: borrow
 * interest accrues against it block by block, but the staking side only lands
 * when the LSD's exchange-rate oracle ticks (about daily). So between ticks a
 * fresh position drifts microscopically negative — accounting noise, not loss.
 */
export const SAWTOOTH_NOISE_BAND = 0.001;

export type CupViewInput = {
  /** Position value in the vault's underlying asset, token units. */
  steeping: number;
  /** True once any chain reports a non-zero share balance. */
  hasPosition: boolean;
  /** Oracle USD price of the vault's asset; undefined switches the whole view to token units. */
  assetPrice: number | undefined;
  /** Effective net APR, RAY-scaled (1e27 = 100%); undefined while loading. */
  aprRay: bigint | undefined;
  /** Unpriced-fallback steam thresholds in token units (VaultMeta.steamThresholds). */
  steamThresholds: readonly [number, number, number];
  /** Earned so far in underlying token units; undefined until anchored. */
  earned: number | undefined;
};

export type CupView = {
  steamLevel: SteamLevel;
  /** Cup fill fraction: 0 when empty, a 0.25 floor once anything steeps, capped at 1. */
  fill: number;
  /** True when the figures speak USD; false means underlying token units. */
  priced: boolean;
  /** Pot worth in USD; undefined when the asset is unpriced. */
  steepingUsd: number | undefined;
  aprNegative: boolean;
  /**
   * The carrot: principal PLUS a year of the current rate — the pot they'd
   * be looking at, not the increment. Token units.
   */
  yearTotal: number;
  /** Same figure in USD; undefined when unpriced. */
  yearTotalUsd: number | undefined;
  /** Earned figure in display units (USD when priced); undefined until anchored. */
  earnedDisplay: number | undefined;
  /** A year's projected accrual in the same display unit — the ticking rate. */
  earnedPerYear: number;
  /**
   * Pin the earned display at a flat zero: negative drift within the noise
   * band on a positive-rate vault. A negative beyond the band, or a genuinely
   * negative rate, stays honestly red.
   */
  sawtoothSuppressed: boolean;
};

export function computeCupView(input: CupViewInput): CupView {
  const { steeping, hasPosition, assetPrice, aprRay, earned } = input;

  const priced = assetPrice !== undefined;
  const steepingUsd = assetPrice !== undefined ? steeping * assetPrice : undefined;

  // Heat by worth when priced, by token units otherwise.
  const heat = steepingUsd ?? steeping;
  const [t1, t2, t3] = priced ? USD_STEAM_BANDS : input.steamThresholds;
  const steamLevel: SteamLevel = !hasPosition
    ? 0
    : heat >= t3
      ? 4
      : heat >= t2
        ? 3
        : heat >= t1
          ? 2
          : 1;
  const fill = !hasPosition ? 0 : Math.min(1, 0.25 + (heat / t3) * 0.75);

  const aprNegative = aprRay !== undefined && aprRay < 0n;
  const aprPercent = aprRay !== undefined ? rayToPercentNumber(aprRay) : 0;
  const projection = steeping * (aprPercent / 100);
  const projectionUsd =
    assetPrice !== undefined ? projection * assetPrice : undefined;
  const yearTotal = steeping + projection;
  const yearTotalUsd =
    steepingUsd !== undefined && projectionUsd !== undefined
      ? steepingUsd + projectionUsd
      : undefined;

  // The earned figure and its ticking rate speak the same unit as the pot,
  // so the number moves at the rate the projection promises.
  const earnedDisplay =
    earned !== undefined && assetPrice !== undefined
      ? earned * assetPrice
      : earned;
  const earnedPerYear = (priced ? projectionUsd : projection) ?? 0;

  const potForFloor = (priced ? steepingUsd : steeping) ?? 0;
  const sawtoothSuppressed =
    earnedDisplay !== undefined &&
    earnedDisplay < 0 &&
    !aprNegative &&
    -earnedDisplay < potForFloor * SAWTOOTH_NOISE_BAND;

  return {
    steamLevel,
    fill,
    priced,
    steepingUsd,
    aprNegative,
    yearTotal,
    yearTotalUsd,
    earnedDisplay,
    earnedPerYear,
    sawtoothSuppressed,
  };
}
