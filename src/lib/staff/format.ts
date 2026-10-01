import { TOKEN_LISTINGS } from "@/lib/listings";

/**
 * How the staff area writes numbers and times: dollars to the cent,
 * counts with separators, times in UTC (staff read across time zones, and
 * the crons and the ledger days are UTC). Pure, server or client.
 */

export function usd(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "…";
  const small = Math.abs(value) > 0 && Math.abs(value) < 0.01;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: small ? 4 : digits, maximumFractionDigits: small ? 6 : digits })}`;
}

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "…";
  return Math.round(value).toLocaleString("en-US");
}

export function percent(part: number, whole: number): string {
  if (!whole) return "…";
  return `${Math.round((100 * part) / whole)}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "1 Oct 2026" from an ISO time or day, in UTC. */
export function day(value: string | null | undefined): string {
  if (!value) return "…";
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return "…";
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "1 Oct, 14:05 UTC". */
export function when(value: string | null | undefined): string {
  if (!value) return "…";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "…";
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

/** "3 Oct": a chart's short day label. */
export function shortDay(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** A listing's plain name beside its ticker, for a person reading. */
export function listingName(symbol: string): string {
  const listing = TOKEN_LISTINGS.find((row) => row.symbol === symbol);
  return listing ? (listing.shortName ?? listing.name) : symbol;
}

/** A short id: the first eight characters of a uuid. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "…";
}
