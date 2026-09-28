import { createHash } from "node:crypto";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { ChatProvider } from "@/lib/server/chat/config";

/**
 * The model behind the chat, and what it is asked to do per request.
 * The key is read here, server side, and never logged or sent anywhere
 * but OpenAI.
 */

export async function chatModel(provider: ChatProvider): Promise<LanguageModel> {
  if (provider.kind === "mock") {
    const { mockChatModel } = await import("@/lib/server/chat/mock-model");
    return mockChatModel();
  }
  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  // The Responses API: GPT-6 needs it for function calling with reasoning.
  return openai.responses(provider.model);
}

/** A stable, opaque stand-in for a user id: the prompt cache key and OpenAI's safety identifier, never the id itself. */
export function opaqueUser(userId: string): string {
  return createHash("sha256").update(`berth-chat:${userId}`).digest("hex").slice(0, 32);
}

/**
 * Per request settings for OpenAI: nothing stored on OpenAI's side for
 * later retrieval (`store: false`), a per person cache key so their steps
 * land on the same cache, and low reasoning effort (the tools do the
 * knowing; the model only reads and retells).
 */
export function openAiOptions(userId: string) {
  const opaque = opaqueUser(userId);
  return {
    openai: {
      store: false,
      promptCacheKey: `berth-chat-${opaque}`,
      safetyIdentifier: opaque,
      reasoningEffort: "low",
    },
  } as const;
}
