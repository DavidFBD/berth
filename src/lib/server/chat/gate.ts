import type { UserRow } from "@/lib/server/accounts";
import { CHAT_UNLOCK_LEVEL, RANKS, rankForXp, type RankInfo } from "@/lib/xp";
import { chatAvailability, type ChatProvider } from "@/lib/server/chat/config";
import { budgetOpen, dailyAllowance, monthlyBudgetMicros, monthlyShareMicros, type Allowance } from "@/lib/server/chat/limits";
import { costMonthMicros, costTodayMicros, messagesToday, monthSpendMicros } from "@/lib/server/chat/usage";

/**
 * Whether this account may talk to the assistant right now, before any
 * place is taken: switched on, a key present, the account at the chat rung
 * (the unlock is the server's rule, the client only says it), the house
 * budget open, the person's day not spent. The status route shows the
 * answer; the chat route enforces it.
 */

export type ChatRefusal = "disabled" | "unavailable" | "locked" | "budget" | "limit_month" | "limit_day";

export type ChatGate =
  | { ok: true; provider: ChatProvider; rank: RankInfo; allowance: Allowance; costToday: number; usedToday: number }
  | { ok: false; code: ChatRefusal; rank: RankInfo };

export type GateDeps = {
  env: Record<string, string | undefined>;
  monthSpend: () => Promise<number>;
  costToday: (userId: string) => Promise<number>;
  usedToday: (userId: string) => Promise<number>;
  costMonth: (userId: string) => Promise<number>;
};

const DEFAULT_DEPS: GateDeps = {
  env: process.env,
  monthSpend: () => monthSpendMicros(),
  costToday: (userId) => costTodayMicros(userId),
  usedToday: (userId) => messagesToday(userId),
  costMonth: (userId) => costMonthMicros(userId),
};

export async function chatGate(user: Pick<UserRow, "id" | "xp">, deps: GateDeps = DEFAULT_DEPS): Promise<ChatGate> {
  const rank = rankForXp(Number(user.xp));
  const availability = chatAvailability(deps.env);
  if (!availability.ok) return { ok: false, code: availability.code, rank };
  const allowance = dailyAllowance(rank.level);
  if (!allowance || rank.level < CHAT_UNLOCK_LEVEL) return { ok: false, code: "locked", rank };
  // Failing closed: counts that cannot be read (chat_usage not pushed yet,
  // the database away) mean no model call, never an uncounted one.
  let spent: number;
  let costToday: number;
  let usedToday: number;
  let costMonth: number;
  try {
    [spent, costToday, usedToday, costMonth] = await Promise.all([
      deps.monthSpend(),
      deps.costToday(user.id),
      deps.usedToday(user.id),
      deps.costMonth(user.id),
    ]);
  } catch (error) {
    console.warn("[chat] usage unreadable, closing:", error instanceof Error ? error.name : "error");
    return { ok: false, code: "unavailable", rank };
  }
  const budget = monthlyBudgetMicros(deps.env.CHAT_MONTHLY_BUDGET_USD);
  if (!budgetOpen(spent, budget)) return { ok: false, code: "budget", rank };
  if (costMonth >= monthlyShareMicros(budget)) return { ok: false, code: "limit_month", rank };
  if (costToday >= allowance.costMicros || usedToday >= allowance.messages) return { ok: false, code: "limit_day", rank };
  return { ok: true, provider: availability.provider, rank, allowance, costToday, usedToday };
}

/** What the browser is told before it sends anything. */
export type ChatStatusResponse = {
  state: "open" | ChatRefusal;
  level: number;
  unlockLevel: number;
  unlockRankName: string;
  /** XP still to earn to reach the chat rung; 0 once there. */
  xpToUnlock: number;
  /** Messages left today, when open. */
  left: number | null;
};

export function statusOf(gate: ChatGate, xp: number): ChatStatusResponse {
  const unlock = RANKS[CHAT_UNLOCK_LEVEL - 1];
  return {
    state: gate.ok ? "open" : gate.code,
    level: gate.rank.level,
    unlockLevel: CHAT_UNLOCK_LEVEL,
    unlockRankName: unlock.name,
    xpToUnlock: Math.max(0, unlock.xp - xp),
    left: gate.ok ? Math.max(0, gate.allowance.messages - gate.usedToday) : null,
  };
}
