/**
 * What a model costs, in USD per million tokens, checked 2026-09-28 on
 * developers.openai.com/api/docs/models/gpt-6-luna (and /pricing):
 * input $0.10, cached input $0.01, cache writes $0.125, output $0.50.
 * Reasoning tokens are billed as output. A dollar price per million tokens
 * times a token count is USD millionths exactly, which is what chat_usage
 * stores (cost_micros).
 */

export type Price = { input: number; cachedInput: number; cacheWrite: number; output: number };

export const PRICES: Record<string, Price> = {
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 },
  /** The dev only mock (lib/server/chat/mock-model) costs nothing. */
  mock: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 },
};

export type TokenCounts = {
  /** Every input token, cached or not. */
  input: number;
  cacheRead: number;
  cacheWrite: number;
  /** Every output token, reasoning included. */
  output: number;
};

/** USD millionths for these tokens on `model`, rounded up. An unknown model is priced as Luna's big sister would be, never as free. */
export function costMicros(model: string, tokens: TokenCounts): number {
  const price = PRICES[model] ?? { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10 };
  const cacheRead = Math.max(0, tokens.cacheRead);
  const cacheWrite = Math.max(0, tokens.cacheWrite);
  const fresh = Math.max(0, tokens.input - cacheRead - cacheWrite);
  const micros =
    fresh * price.input + cacheRead * price.cachedInput + cacheWrite * price.cacheWrite + Math.max(0, tokens.output) * price.output;
  return Math.ceil(micros);
}
