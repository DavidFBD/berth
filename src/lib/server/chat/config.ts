/**
 * Which model answers in the chat, and whether it may answer at all.
 *
 * v1 is OpenAI's GPT-6 Luna only (`gpt-6-luna`, checked 2026-09-28 on
 * developers.openai.com/api/docs/models/gpt-6-luna: no dated snapshot is
 * published, the page says to use the alias). Function calling with
 * reasoning needs the Responses API, which the AI SDK's OpenAI provider
 * uses by default.
 *
 * Env, server side only:
 *   OPENAI_API_KEY           the key; without it the chat is unavailable
 *   CHAT_ENABLED             "0" or "false" turns the chat off (default on)
 *   CHAT_MONTHLY_BUDGET_USD  the house budget, default 5 (lib/server/chat/limits)
 *   CHAT_PROVIDER=mock       development only: a scripted model, no key, no cost
 */

export const CHAT_MODEL_ID = "gpt-6-luna";

export type ChatProvider = { kind: "openai"; model: typeof CHAT_MODEL_ID } | { kind: "mock"; model: "mock" };

export type ChatAvailability = { ok: true; provider: ChatProvider } | { ok: false; code: "disabled" | "unavailable" };

type Env = Record<string, string | undefined>;

export function chatEnabled(env: Env): boolean {
  const raw = env.CHAT_ENABLED?.trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

export function chatAvailability(env: Env = process.env): ChatAvailability {
  if (!chatEnabled(env)) return { ok: false, code: "disabled" };
  // The mock never answers in production, whatever the env says.
  if (env.NODE_ENV !== "production" && env.CHAT_PROVIDER === "mock") return { ok: true, provider: { kind: "mock", model: "mock" } };
  if (env.OPENAI_API_KEY?.trim()) return { ok: true, provider: { kind: "openai", model: CHAT_MODEL_ID } };
  return { ok: false, code: "unavailable" };
}
