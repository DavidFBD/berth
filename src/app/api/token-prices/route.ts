import { COINGECKO_IDS } from "@/lib/coingecko-ids";

/**
 * USD prices for the deposit tokens the money market oracle can't price.
 *
 * Server-side so the CoinGecko key never reaches the browser, and so one
 * upstream request serves every client: the whole pinned id set goes out in a
 * single `/simple/price` call, cached for `REVALIDATE_SECONDS`. That is ~12
 * upstream calls an hour against a Demo-tier budget of 30 per MINUTE, no
 * matter how many people are pouring.
 *
 * Always 200 with a `prices` object. A missing key or a bad upstream response
 * yields `{}` plus a reason, because an unpriced token is a soft degrade the
 * UI already handles (no USD value shown) and must never break the app.
 */

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const REVALIDATE_SECONDS = 300;

// No `export const revalidate` here: segment config must be a literal, and the
// budget guard that matters is the fetch cache below — the handler may re-run
// per request but the upstream call is served from cache until it expires.

type TokenPricesResponse = {
  /** Symbol (original casing, as in COINGECKO_IDS) → USD price. */
  prices: Record<string, number>;
  /** Present only when prices are empty or partial, for the console. */
  reason?: string;
};

export async function GET() {
  const apiKey = process.env.COINGECKO_API_KEY;
  if (!apiKey) {
    return Response.json({
      prices: {},
      reason: "COINGECKO_API_KEY is not configured",
    } satisfies TokenPricesResponse);
  }

  const ids = [...new Set(Object.values(COINGECKO_IDS))];
  const url = `${COINGECKO_BASE}/simple/price?ids=${ids.join(",")}&vs_currencies=usd`;

  try {
    const response = await fetch(url, {
      // Demo-tier key pairs with the public base URL and this header name;
      // the Pro host rejects it (error 10011) and vice versa.
      headers: { "x-cg-demo-api-key": apiKey },
      next: { revalidate: REVALIDATE_SECONDS },
    });

    if (!response.ok) {
      return Response.json({
        prices: {},
        reason: `CoinGecko responded ${response.status}`,
      } satisfies TokenPricesResponse);
    }

    const data = (await response.json()) as Record<
      string,
      { usd?: number } | undefined
    >;

    const prices: Record<string, number> = {};
    for (const [symbol, id] of Object.entries(COINGECKO_IDS)) {
      const price = data[id]?.usd;
      if (typeof price === "number" && Number.isFinite(price) && price > 0) {
        prices[symbol] = price;
      }
    }

    return Response.json({ prices } satisfies TokenPricesResponse);
  } catch (error) {
    return Response.json({
      prices: {},
      reason: `CoinGecko request failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    } satisfies TokenPricesResponse);
  }
}
