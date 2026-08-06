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

/**
 * A display currency plus the USD→currency multiplier. The whole app computes
 * in USD (the oracle only speaks it); this is applied as the final step
 * before formatting, nowhere else.
 */
export type Money = { currency: string; rate: number };

export const USD_MONEY: Money = { currency: "USD", rate: 1 };

/**
 * How many fraction digits a currency conventionally carries (2 for USD/EUR,
 * 0 for JPY/KRW). Intl knows; asking it once per currency is enough.
 */
const fractionDigitsCache = new Map<string, number>();
function currencyFractionDigits(currency: string): number {
  let digits = fractionDigitsCache.get(currency);
  if (digits === undefined) {
    digits =
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2;
    fractionDigitsCache.set(currency, digits);
  }
  return digits;
}

function formatCurrency(value: number, currency: string, digits: number, compact = false): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: compact ? undefined : digits,
    maximumFractionDigits: digits,
    notation: compact ? "compact" : "standard",
  }).format(value);
}

/** Human display for a money value: "$1,234", "€12.34", "<¥1", "$1.2M". */
export function formatMoney(usd: number, money: Money = USD_MONEY): string {
  const value = usd * money.rate;
  const base = currencyFractionDigits(money.currency);
  const smallest = 10 ** -base; // one cent, or one yen
  if (value > 0 && value < smallest) {
    return `<${formatCurrency(smallest, money.currency, base)}`;
  }
  if (value >= 1_000_000) return formatCurrency(value, money.currency, 1, true);
  return formatCurrency(value, money.currency, value >= 1_000 ? 0 : base);
}

export function formatUsd(value: number): string {
  return formatMoney(value);
}

/**
 * Money display that keeps small values legible instead of collapsing them to
 * "<$0.01". A modest pot earns fractions of a cent a day, so the earned figure
 * needs real decimals to say anything at all — and to be seen ticking.
 */
export function formatMoneyPrecise(
  usd: number,
  money: Money = USD_MONEY,
): string {
  const value = usd * money.rate;
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return formatCurrency(value, money.currency, 1, true);
  const base = currencyFractionDigits(money.currency);
  const digits =
    abs >= 1_000
      ? Math.max(base - 2, 0)
      : abs >= 1
        ? base
        : abs >= 0.01
          ? base + 2
          : base + 4;
  return formatCurrency(value, money.currency, digits);
}

export function formatUsdPrecise(value: number): string {
  return formatMoneyPrecise(value);
}

/**
 * Split a money figure into a settled head and an accruing tail, so the
 * digits that actually move can be styled apart from the ones that don't.
 *
 * Deliberately finer than `formatMoneyPrecise`: a $10 pot at 9% moves in the
 * eighth decimal, and a number that never visibly changes reads as broken
 * rather than as earning. The tail carries that motion; the head stays the
 * figure you'd actually quote.
 */
export function splitAccruingMoney(
  usd: number,
  money: Money = USD_MONEY,
): { head: string; tail: string } {
  const value = usd * money.rate;
  const abs = Math.abs(value);
  // Well past a thousand the visible digits already move on their own.
  if (abs >= 100_000) return { head: formatMoneyPrecise(usd, money), tail: "" };

  const base = currencyFractionDigits(money.currency);
  const headDigits = abs >= 1_000 ? 0 : abs >= 1 ? base : base + 2;

  // Two tail digits, no more: the tail is de-emphasised styling, and a long
  // faded run reads as line noise rather than precision.
  // Head and tail MUST come from the same decimal string: formatting the raw
  // value would ROUND the head ($0.0013) while the tail continues from the
  // truncated digits (84), printing a number that doesn't exist.
  const [whole, frac = ""] = abs.toFixed(headDigits + 2).split(".");
  const headValue = Number(`${whole}.${frac.slice(0, headDigits) || "0"}`);
  const head = formatCurrency(
    value < 0 ? -headValue : headValue,
    money.currency,
    headDigits,
  );
  const tail = frac.slice(headDigits);
  // A head with no decimals needs the point itself to live in the tail,
  // or "¥1,500" + "0123" would read as ¥15,000,123.
  return { head, tail: tail ? (headDigits === 0 ? `.${tail}` : tail) : "" };
}

export function splitAccruingUsd(value: number): {
  head: string;
  tail: string;
} {
  return splitAccruingMoney(value);
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
