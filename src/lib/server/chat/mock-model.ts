import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

/**
 * A scripted model for development only (CHAT_PROVIDER=mock, never in
 * production: lib/server/chat/config), so the chat can be exercised end to
 * end, real route, real tools, real stream, without a key or a cent.
 *
 * It reads the person's latest words and calls one tool that fits (a buy
 * or sell drafts, "hold" reads the holdings, "headlines" reads the news,
 * "moved" reads the moves, anything else reads the board), then answers from the tool's text,
 * streamed a few words at a time.
 */

type PromptMessage = { role: string; content: unknown };

function lastUserText(prompt: PromptMessage[]): string {
  for (let index = prompt.length - 1; index >= 0; index--) {
    const message = prompt[index];
    if (message.role !== "user" || !Array.isArray(message.content)) continue;
    return message.content
      .filter((part: { type?: string }) => part.type === "text")
      .map((part: { text?: string }) => part.text ?? "")
      .join(" ");
  }
  return "";
}

function lastToolResult(prompt: PromptMessage[]): { toolName: string; text: string } | null {
  const last = prompt.at(-1);
  if (!last || last.role !== "tool" || !Array.isArray(last.content)) return null;
  const part = last.content.find((candidate: { type?: string }) => candidate.type === "tool-result") as
    | { toolName: string; output?: { type: string; value?: unknown } }
    | undefined;
  if (!part) return null;
  const value = part.output?.value;
  return { toolName: part.toolName, text: typeof value === "string" ? value : JSON.stringify(value ?? "") };
}

/** The tool call the script makes for these words. Exported for the tests. */
export function scriptedCall(words: string): { toolName: string; input: Record<string, unknown> } {
  const text = words.toLowerCase();
  const dollars = Number(/\$\s?(\d+(?:\.\d+)?)/.exec(words)?.[1] ?? "20");
  const named = /\b(nvidia|apple|tesla|microsoft|amazon|nvda|aapl|tsla|msft|amzn|spy|qqq)\b/i.exec(words)?.[1] ?? "NVIDIA";
  if (/\bsell\b/.test(text)) return { toolName: "draft_order", input: { listing: named, side: "sell", usd_amount: dollars } };
  if (/\b(buy|draft)\b/.test(text)) return { toolName: "draft_order", input: { listing: named, side: "buy", usd_amount: dollars } };
  if (/\b(hold|own|holdings)\b/.test(text)) return { toolName: "get_holdings", input: {} };
  if (/\b(s&p|doing|performance|better|gold|bitcoin)\b/.test(text)) return { toolName: "get_performance", input: {} };
  if (/\b(headlines?|news)\b/.test(text)) return { toolName: "get_headlines", input: {} };
  if (/\b(moved|today|move)\b/.test(text)) return { toolName: "get_moves", input: {} };
  return { toolName: "list_listings", input: {} };
}

function answerFor(result: { toolName: string; text: string }): string {
  if (result.toolName === "draft_order") {
    return result.text.startsWith("Draft:")
      ? "I drafted it. **Open the order** on the card to check the amount and what you pay with, and sign if it looks right. Nothing happens until you do."
      : `I could not draft that. ${result.text.split("\n")[0]}`;
  }
  const lines = result.text
    .split("\n")
    .filter((line) => line.trim() && !line.includes("<untrusted"))
    .slice(0, 4);
  return ["Here is what Berth shows right now:", "", ...lines.map((line) => `- ${line}`), "", "These are facts from Berth, not advice."].join("\n");
}

const USAGE = {
  inputTokens: { total: 2_600, noCache: 600, cacheRead: 2_000, cacheWrite: 0 },
  outputTokens: { total: 120, text: 90, reasoning: 30 },
};

export function mockChatModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "mock",
    modelId: "mock",
    doStream: async (options) => {
      const prompt = options.prompt as unknown as PromptMessage[];
      const result = lastToolResult(prompt);
      if (!result) {
        const call = scriptedCall(lastUserText(prompt));
        return {
          stream: simulateReadableStream({
            initialDelayInMs: 400,
            chunkDelayInMs: 50,
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "tool-call", toolCallId: `call-${Date.now()}`, toolName: call.toolName, input: JSON.stringify(call.input) },
              { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage: USAGE },
            ],
          }),
        } as never;
      }
      const words = answerFor(result).split(/(?<= )/);
      return {
        stream: simulateReadableStream({
          initialDelayInMs: 300,
          chunkDelayInMs: 35,
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            ...words.map((delta) => ({ type: "text-delta", id: "t1", delta })),
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: USAGE },
          ],
        }),
      } as never;
    },
  });
}
