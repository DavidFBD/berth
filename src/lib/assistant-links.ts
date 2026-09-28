import type { AssistantId } from "@/lib/assistant-party";

/**
 * Where each assistant adds a connector, for the "Open Claude" buttons in
 * the account drawer (components/assistant/assistant-section) and on the
 * public help page (app/assistants).
 *
 * The Claude link is claude.ai's add connector form with the name and
 * address filled in. It is not documented, so the address stays beside it
 * to copy for the day it stops working.
 */
export function assistantOpenUrl(id: AssistantId, mcpUrl: string): string {
  switch (id) {
    case "claude":
      return `https://claude.ai/customize/connectors?modal=add-custom-connector&mcpName=Berth&mcpServerUrl=${encodeURIComponent(mcpUrl)}`;
    case "chatgpt":
      return "https://chatgpt.com/plugins";
    case "grok":
      return "https://grok.com/connectors";
  }
}
