import { CHAT_UNLOCK_LEVEL } from "@/lib/xp";

/**
 * What one person may spend of the in-app assistant, and what one message
 * may weigh. Pure, so every number is a unit test.
 *
 * Sized for GPT-6 Luna ($0.10 in, $0.01 cached, $0.50 out per million
 * tokens): a typical turn of two tool calls is about $0.001, a heavy one
 * about $0.004. At that price dollars barely bind a person, so the day is
 * counted in messages, with a cost ceiling behind it that only a runaway
 * (long pasted history, many large tool results) would reach. The house
 * budget (CHAT_MONTHLY_BUDGET_USD) is the switch that matters.
 */

export const CHAT_LIMITS = {
  /** Messages a person may send in one UTC minute. */
  perMinute: 6,
  /** Model steps one message may take: at most four tool rounds and an answer. */
  maxSteps: 5,
  /** Output tokens one step may write, reasoning included. */
  maxOutputTokens: 1_500,
  /** The newest messages of the history the model sees. */
  historyMessages: 12,
  /** And at most this many characters of it, oldest dropped first. */
  historyChars: 24_000,
  /** The longest message a person may send. */
  messageChars: 2_000,
} as const;

/** A person's day, by rank. Cost in USD millionths. */
export const CHAT_TIERS = [
  { fromLevel: CHAT_UNLOCK_LEVEL, messages: 25, costMicros: 100_000 },
  { fromLevel: 5, messages: 50, costMicros: 200_000 },
  { fromLevel: 8, messages: 100, costMicros: 400_000 },
] as const;

export type Allowance = { messages: number; costMicros: number };

/** What a person at `level` may spend today, or null below the chat rung. */
export function dailyAllowance(level: number): Allowance | null {
  let found: Allowance | null = null;
  for (const tier of CHAT_TIERS) {
    if (level >= tier.fromLevel) found = { messages: tier.messages, costMicros: tier.costMicros };
  }
  return found;
}

/** The monthly budget in USD millionths, from CHAT_MONTHLY_BUDGET_USD (default $5). */
export function monthlyBudgetMicros(raw: string | undefined): number {
  const usd = raw === undefined || raw.trim() === "" ? 5 : Number(raw);
  if (!Number.isFinite(usd) || usd < 0) return 5_000_000;
  return Math.round(usd * 1_000_000);
}

/**
 * The most one person may spend of the house budget in a month, USD
 * millionths: $0.50 (about 400 typical Luna messages), never more than the
 * budget itself, so a few busy accounts cannot close the chat for everyone.
 */
export const MONTHLY_SHARE_MICROS = 500_000;

export function monthlyShareMicros(budgetMicros: number): number {
  return Math.min(MONTHLY_SHARE_MICROS, budgetMicros);
}

/** Whether the house budget still has room this month. At 100% the chat closes until the 1st. */
export function budgetOpen(spentMicros: number, budgetMicros: number): boolean {
  return spentMicros < budgetMicros;
}

/** The oauth_rate_limits windows a message at `now` counts against. */
export function chatWindows(userId: string, now: Date): { minute: [string, string]; day: [string, string] } {
  const minute = new Date(now);
  minute.setUTCSeconds(0, 0);
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  return {
    minute: [`chat:minute:${userId}`, minute.toISOString()],
    day: [`chat:day:${userId}`, day.toISOString()],
  };
}

/** The first moment of `now`'s UTC day and month, for the cost sums. */
export function dayStart(now: Date): Date {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Why a message may not go, in the order the route asks: the day's cost
 * first (it needs no place taken), then the places. Null when it may.
 */
export function refusalFor(input: {
  allowance: Allowance;
  costTodayMicros: number;
  minute: number | null;
  day: number | null;
}): "limit_minute" | "limit_day" | null {
  if (input.costTodayMicros >= input.allowance.costMicros) return "limit_day";
  if (input.minute !== null && input.minute > CHAT_LIMITS.perMinute) return "limit_minute";
  // No day count means the minute refused the message before the day was spent.
  if (input.day === null) return "limit_minute";
  if (input.day > input.allowance.messages) return "limit_day";
  return null;
}
