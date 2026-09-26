/**
 * How the MCP tools write numbers for an assistant to read: plain dollars,
 * signed percents, dates in words. Kept here so every tool says a price
 * the same way.
 */

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * "$1,234.56", "-$12.00"; under a dollar keeps four decimals so a small
 * price still says something, and anything smaller than that says so
 * ("<$0.0001") rather than reading as nothing.
 */
export function usd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "unknown";
  if (value === 0) return USD.format(0);
  const size = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (size < 0.0001) return value < 0 ? ">-$0.0001" : "<$0.0001";
  if (size < 1) return `${sign}$${size.toFixed(4)}`;
  return USD.format(value);
}

/** "+1.23%", "-0.40%", "unknown". */
export function pct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "unknown";
  const fixed = value.toFixed(digits);
  return value > 0 ? `+${fixed}%` : `${fixed}%`;
}

/**
 * A quantity of a listing, without trailing zeros: "0.512345". A quantity
 * too small for that many decimals keeps three significant digits
 * ("0.000000412") instead of reading as "0".
 */
export function units(value: number, digits = 6): string {
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0 && value !== 0 && Number.isFinite(value)) {
    return value.toLocaleString("en-US", { maximumSignificantDigits: 3, useGrouping: false, maximumFractionDigits: 20 });
  }
  return String(rounded);
}

/** "Sep 18, 2026". */
export function day(value: string | number | Date): string {
  const date = new Date(value);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** "Sep 18, 2026, 14:02 UTC". */
export function moment(value: string | number | Date): string {
  const date = new Date(value);
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return `${day(date)}, ${time} UTC`;
}

/** "3 hours ago", "2 days ago", "just now". */
export function ago(value: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - value) / 1000));
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Collapse whitespace and cut a post's text to a readable length. */
export function clip(text: string, max = 280): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** "NVIDIA (NVDA)": the name a person reads, with the ticker an assistant can pass back. */
export function named(listing: { name: string; symbol: string }): string {
  return `${listing.name} (${listing.symbol})`;
}
