import { formatUnits, parseUnits } from "viem";

/** RAY = 1e27 = 100% (AAVE rate convention used by the SDK's APR fields). */
const RAY_PER_PERCENT = 10n ** 25n;

/**
 * Format a RAY-scaled rate (1e27 = 100%) as a percentage string, e.g. "7.42%".
 * Keeps the math in bigint until the final 4-decimal division so huge rates
 * can't lose precision through an intermediate float.
 */
export function formatRayAsPercent(ray: bigint, digits = 2): string {
  const scaled = Number((ray * 10_000n) / RAY_PER_PERCENT) / 10_000;
  return `${scaled.toFixed(digits)}%`;
}

/** WAD = 1e18. Used for the vault leverage multiplier, e.g. "3.2x". */
export function formatWadAsMultiplier(wad: bigint, digits = 1): string {
  const scaled = Number((wad * 1_000n) / 10n ** 18n) / 1_000;
  return `${scaled.toFixed(digits)}x`;
}

/** Basis points out of 10_000 → "65%" style display. */
export function formatBps(bps: bigint, digits = 0): string {
  return `${(Number(bps) / 100).toFixed(digits)}%`;
}

/**
 * Human display for a token amount: trims trailing zeros and caps fraction
 * digits, switching to compact notation for large values.
 */
export function formatTokenAmount(
  value: bigint,
  decimals: number,
  maxFractionDigits = 4,
): string {
  const asNumber = Number(formatUnits(value, decimals));
  if (asNumber === 0) return "0";
  if (asNumber > 0 && asNumber < 1 / 10 ** maxFractionDigits) {
    return `<${(1 / 10 ** maxFractionDigits).toFixed(maxFractionDigits)}`;
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: maxFractionDigits,
    notation: asNumber >= 1_000_000 ? "compact" : "standard",
  }).format(asNumber);
}

/**
 * Parse user text input into token base units. Returns undefined for
 * anything that isn't a plain positive decimal number (parseUnits throws
 * on malformed input, and negative/zero amounts are never valid here).
 */
export function parseAmount(input: string, decimals: number): bigint | undefined {
  const trimmed = input.trim();
  if (!/^\d*\.?\d+$/.test(trimmed)) return undefined;
  try {
    const value = parseUnits(trimmed, decimals);
    return value > 0n ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parse user text entered as US dollars into token base units at the given
 * oracle price. Same input rules as parseAmount; undefined when the text
 * isn't a positive decimal or the price is unusable.
 */
export function usdToTokenAmount(
  input: string,
  price: number,
  decimals: number,
): bigint | undefined {
  const trimmed = input.trim();
  if (!/^\d*\.?\d+$/.test(trimmed)) return undefined;
  const usd = Number(trimmed);
  if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(price) || price <= 0)
    return undefined;
  try {
    // toFixed never emits scientific notation, so parseUnits stays happy.
    const value = parseUnits(
      (usd / price).toFixed(Math.min(decimals, 12)),
      decimals,
    );
    return value > 0n ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Human display for a USD value: "$1,234", "$12.34", "<$0.01", "$1.2M". */
export function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return "<$0.01";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1_000 ? 0 : 2,
    notation: value >= 1_000_000 ? "compact" : "standard",
  }).format(value);
}

/**
 * USD display that keeps small values legible instead of collapsing them to
 * "<$0.01". A modest pot earns fractions of a cent a day, so the earned figure
 * needs real decimals to say anything at all — and to be seen ticking.
 */
export function formatUsdPrecise(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  }
  const digits = abs >= 1_000 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function shortenAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`;
}

/** Apply slippage tolerance (in percent, e.g. 0.5) to a quoted output. */
export function applySlippage(quoted: bigint, slippagePct: number): bigint {
  const bps = BigInt(Math.round(slippagePct * 100));
  return (quoted * (10_000n - bps)) / 10_000n;
}
