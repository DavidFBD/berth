import { describe, expect, it } from "vitest";
import { COPY } from "@/lib/copy";
import { promptUrl } from "./assistant-prompts";

describe("promptUrl", () => {
  it("opens each assistant's new chat with the prompt encoded", () => {
    const prompt = "Draft a $20 buy of NVIDIA on Berth.";
    expect(promptUrl("claude", prompt)).toBe("https://claude.ai/new?q=Draft%20a%20%2420%20buy%20of%20NVIDIA%20on%20Berth.");
    expect(promptUrl("chatgpt", "S&P 500?")).toBe("https://chatgpt.com/?q=S%26P%20500%3F");
    expect(promptUrl("grok", "a#b")).toBe("https://grok.com/?q=a%23b");
  });

  it("every suggested prompt names Berth, so the assistant uses the connector", () => {
    expect(COPY.assistantPrompts).toHaveLength(3);
    for (const prompt of COPY.assistantPrompts) expect(prompt).toContain("Berth");
  });
});
