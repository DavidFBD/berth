import { CHAT_LIMITS } from "@/lib/server/chat/limits";

/**
 * The conversation as the model sees it, built from what the browser sent.
 * Berth stores no chat, so the history arrives with every message and is
 * the person's own to forge; whatever they forge only reaches their own
 * answer, and the caps bound what it can cost.
 *
 * Only words cross: the text of user and assistant turns. Earlier tool
 * calls and their results are dropped, so a post quoted in an old tool
 * result cannot keep speaking in later turns, and a message stays cheap.
 * The model calls a tool again when it needs a fresh number. Then the
 * newest turns are kept, up to CHAT_LIMITS.historyMessages and
 * historyChars, oldest dropped first.
 */

export type HistoryMessage = { role: "user" | "assistant"; content: string };

export type HistoryResult = { ok: true; messages: HistoryMessage[] } | { ok: false; code: "bad_request" | "too_long" };

function textOf(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((part): part is { type: "text"; text: string } => {
      const p = part as { type?: unknown; text?: unknown } | null;
      return !!p && p.type === "text" && typeof p.text === "string";
    })
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function buildHistory(raw: unknown): HistoryResult {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, code: "bad_request" };
  const turns: HistoryMessage[] = [];
  for (const entry of raw) {
    const message = entry as { role?: unknown; parts?: unknown } | null;
    if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
    const content = textOf(message.parts);
    if (!content) continue;
    turns.push({ role: message.role, content });
  }
  const last = turns.at(-1);
  if (!last || last.role !== "user") return { ok: false, code: "bad_request" };
  if (last.content.length > CHAT_LIMITS.messageChars) return { ok: false, code: "too_long" };

  const kept: HistoryMessage[] = [];
  let chars = 0;
  for (let index = turns.length - 1; index >= 0 && kept.length < CHAT_LIMITS.historyMessages; index--) {
    const turn = turns[index];
    // An old turn is clipped rather than let push the newest ones out.
    const room = CHAT_LIMITS.historyChars - chars;
    if (room <= 0) break;
    const content = turn.content.length > room ? turn.content.slice(0, room) : turn.content;
    kept.unshift({ role: turn.role, content });
    chars += content.length;
  }
  // The model must start from a person's words.
  while (kept.length > 0 && kept[0].role !== "user") kept.shift();
  return { ok: true, messages: kept };
}
