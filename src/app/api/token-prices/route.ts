import { COINGECKO_IDS } from "@/lib/coingecko-ids";
import { CURRENCIES, type FxRates } from "@/lib/currencies";

/**
 * USD prices for the deposit tokens the money market oracle can't price,
 * plus USD→display-currency FX rates.
 *
 * Prices come from DefiLlama (keyless, and it accepts `coingecko:<id>` keys
 * directly, so the pinned id set in coingecko-ids.ts carries over untouched).
 * We moved off CoinGecko itself after its Demo tier started answering
 * routine volume with 401s dressed up as auth errors.
 *
 * FX comes from Frankfurter (ECB reference rates, keyless). Fiat FX moves on
 * a different clock from crypto — a day-old ECB rate is exactly what a
 * display currency wants — so it deliberately does NOT share the price
 * provider's fate: either half can degrade alone.
 *
 * Server-side so one upstream request serves every client. Always 200: a
 * missing price or rate is a soft degrade the UI already handles (token
 * shows unpriced, money falls back to USD) and must never break the app.
 */

const LLAMA_BASE = "https://coins.llama.fi";
const FRANKFURTER_BASE = "https://api.frankfurter.dev/v1";
const PRICES_REVALIDATE_SECONDS = 300;
/** ECB publishes once a business day; half a day of cache is generous. */
const FX_REVALIDATE_SECONDS = 43_200;

export type TokenPricesResponse = {
  /** Symbol (original casing, as in COINGECKO_IDS) → USD price. */
  prices: Record<string, number>;
  /** USD → display-currency multipliers, e.g. { EUR: 0.92 }. */
  fx?: FxRates;
  /** The ECB day the rates are for (YYYY-MM-DD): Friday's over a weekend. */
  fxDate?: string;
  /** Present only when prices are empty or partial, for the console. */
  reason?: string;
};

type LlamaResponse = {
  coins?: Record<string, { price?: number } | undefined>;
};

type FrankfurterResponse = {
  date?: string;
  rates?: Record<string, number | undefined>;
};

async function fetchPrices(): Promise<{
  prices: Record<string, number>;
  reason?: string;
}> {
  const keys = [...new Set(Object.values(COINGECKO_IDS))]
    .map((id) => `coingecko:${id}`)
    .join(",");
  try {
    const response = await fetch(`${LLAMA_BASE}/prices/current/${keys}`, {
      next: { revalidate: PRICES_REVALIDATE_SECONDS },
    });
    if (!response.ok) {
      return { prices: {}, reason: `DefiLlama responded ${response.status}` };
    }
    const data = (await response.json()) as LlamaResponse;
    const prices: Record<string, number> = {};
    for (const [symbol, id] of Object.entries(COINGECKO_IDS)) {
      const price = data.coins?.[`coingecko:${id}`]?.price;
      if (typeof price === "number" && Number.isFinite(price) && price > 0) {
        prices[symbol] = price;
      }
    }
    return { prices };
  } catch (error) {
    return {
      prices: {},
      reason: `DefiLlama request failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    };
  }
}

async function fetchFx(): Promise<{ fx: FxRates; date?: string } | undefined> {
  const symbols = CURRENCIES.filter((code) => code !== "USD").join(",");
  try {
    const response = await fetch(
      `${FRANKFURTER_BASE}/latest?base=USD&symbols=${symbols}`,
      { next: { revalidate: FX_REVALIDATE_SECONDS } },
    );
    if (!response.ok) return undefined;
    const data = (await response.json()) as FrankfurterResponse;
    const fx: FxRates = { USD: 1 };
    for (const code of CURRENCIES) {
      const rate = data.rates?.[code];
      if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
        fx[code] = rate;
      }
    }
    const date =
      typeof data.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.date)
        ? data.date
        : undefined;
    return { fx, date };
  } catch {
    // No FX is a soft degrade: money simply keeps speaking USD.
    return undefined;
  }
}

export async function GET() {
  const [priceResult, fxResult] = await Promise.all([fetchPrices(), fetchFx()]);
  return Response.json({
    prices: priceResult.prices,
    fx: fxResult?.fx,
    ...(fxResult?.date ? { fxDate: fxResult.date } : {}),
    ...(priceResult.reason ? { reason: priceResult.reason } : {}),
  } satisfies TokenPricesResponse);
}
