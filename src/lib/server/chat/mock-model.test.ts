import { describe, expect, it } from "vitest";
import { COPY } from "@/lib/copy";
import { scriptedCall } from "./mock-model";

/**
 * The Ask card's suggestions, each sent as the person's own words. The
 * development model routes each to the tool a real model would reach for,
 * so every button can be tried end to end without a key.
 */

describe("the Ask suggestions", () => {
  it("offer the headlines beside what moved, gold and a buy", () => {
    expect(COPY.askSuggestions).toEqual(["What moved today?", "Am I ahead of Gold?", "What are the headlines?", "Buy $5 of NVIDIA"]);
  });

  it("keep the buy last, the one the Ask card swaps for a limit where limit orders are on", () => {
    expect(scriptedCall(COPY.askSuggestions.at(-1)!).toolName).toBe("draft_order");
  });

  it("each reach their own tool in development", () => {
    expect(COPY.askSuggestions.map((prompt) => scriptedCall(prompt).toolName)).toEqual([
      "get_moves",
      "get_performance",
      "get_headlines",
      "draft_order",
    ]);
  });
});
