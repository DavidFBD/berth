import type { AssistantId } from "@/lib/assistant-party";

/**
 * A link that opens a new chat in an assistant with a prompt filled in.
 * All three read `q` on their new chat page (checked 2026-09-26: claude.ai's
 * own desktop deep link documents `new?q=`, and the web page answers the
 * same path; ChatGPT and Grok read it on their home page). Claude and
 * ChatGPT leave it for the person to send; Grok may send it at once.
 */
export function promptUrl(id: AssistantId, prompt: string): string {
  const q = encodeURIComponent(prompt);
  switch (id) {
    case "claude":
      return `https://claude.ai/new?q=${q}`;
    case "chatgpt":
      return `https://chatgpt.com/?q=${q}`;
    case "grok":
      return `https://grok.com/?q=${q}`;
  }
}
