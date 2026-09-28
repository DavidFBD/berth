import type { LanguageModelUsage } from "ai";
import { costMicros, type TokenCounts } from "@/lib/server/chat/prices";

/**
 * Adds up one message's steps as they end, so whichever way the message
 * finishes (answered, stopped by the person, failed mid way) the usage
 * row carries every token already spent. Pure apart from the clock.
 */
export class ChatMeter {
  steps = 0;
  tools: string[] = [];
  tokens: TokenCounts & { reasoning: number } = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 };

  /** Input tokens the last finished step sent: the best guess at what the next one sends. */
  lastInput = 0;

  constructor(readonly model: string) {}

  /**
   * A message that ends mid step (stopped, failed) was still billed for
   * that step's input and whatever it wrote. The step's own usage never
   * arrives, so it is charged as the last step's input again (or
   * `firstInput` if none finished) plus a full step of output.
   */
  chargeInFlight(firstInput: number, maxOutput: number): void {
    this.tokens.input += this.lastInput || firstInput;
    this.tokens.output += maxOutput;
  }

  addStep(step: { usage: LanguageModelUsage; toolCalls: readonly { toolName: string }[] }): void {
    this.steps += 1;
    const usage = step.usage;
    this.tokens.input += usage.inputTokens ?? 0;
    this.lastInput = usage.inputTokens ?? 0;
    this.tokens.cacheRead += usage.inputTokenDetails?.cacheReadTokens ?? 0;
    this.tokens.cacheWrite += usage.inputTokenDetails?.cacheWriteTokens ?? 0;
    this.tokens.output += usage.outputTokens ?? 0;
    this.tokens.reasoning += usage.outputTokenDetails?.reasoningTokens ?? 0;
    for (const call of step.toolCalls) {
      if (!this.tools.includes(call.toolName)) this.tools.push(call.toolName);
    }
  }

  get costMicros(): number {
    return costMicros(this.model, this.tokens);
  }
}

/**
 * The most a message could cost before it runs, for its provisional row:
 * every step sends the fixed prefix and the history, uncached, and writes
 * a full step of output. Crude on purpose; it is replaced by the real
 * numbers when the message ends.
 */
export const PREFIX_TOKENS = 3_000;

export function firstStepInputEstimate(historyChars: number): number {
  return PREFIX_TOKENS + Math.ceil(historyChars / 4);
}

export function provisionalTokens(historyChars: number, steps: number, maxOutput: number): TokenCounts {
  return { input: firstStepInputEstimate(historyChars) * steps, cacheRead: 0, cacheWrite: 0, output: maxOutput * steps };
}
