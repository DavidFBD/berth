import { TOKEN_LISTINGS } from "@/lib/listings";

const SYMBOLS = new Set(TOKEN_LISTINGS.map((listing) => listing.symbol));

/**
 * The query this route answers, or null when the request asks something
 * else: only `symbol` (a listing), `fresh=1` or `poll=1`, once each.
 */
export function normaliseQuery(params: URLSearchParams): { symbol?: string; mode?: "fresh" | "poll"; canonical: string } | null {
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) return null;
  if (keys.some((key) => key !== "symbol" && key !== "fresh" && key !== "poll")) return null;
  // Exactly as the column sends it, so every answer has one cache address.
  const symbol = params.get("symbol") ?? undefined;
  if (symbol !== undefined && !SYMBOLS.has(symbol)) return null;
  const fresh = params.get("fresh");
  const poll = params.get("poll");
  if ((fresh !== null && fresh !== "1") || (poll !== null && poll !== "1") || (fresh && poll)) return null;
  const canonical = symbol ? `?symbol=${symbol}` : "";
  return { symbol, mode: fresh ? "fresh" : poll ? "poll" : undefined, canonical };
}

