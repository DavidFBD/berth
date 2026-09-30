import type { Availability } from "@/lib/availability";
import { tool, type ToolSet } from "ai";
import { BERTH_TOOLS, type BerthTool, type ToolContext, type ToolOutput } from "@/lib/server/berth-tools/registry";
import { SCOPE_DRAFT, SCOPE_READ } from "@/lib/server/oauth/config";

/**
 * The Berth tools as the in-app chat hands them to the model: the same
 * registry the MCP server reads (lib/server/berth-tools/registry), same
 * names, descriptions and schemas. The person's own signed in session is
 * the grant, so both scopes are theirs.
 *
 * `execute` returns the whole ToolOutput, which reaches the browser as the
 * tool part's output (a draft renders its card from `draft`, values the
 * server computed); `toModelOutput` gives the model only the text.
 * Anything thrown becomes a calm line the model can relay, and the
 * message's chat_usage row names the tools used.
 */

const FAILED_TEXT = "Berth could not answer that just now. Try again in a minute.";

export function chatToolContext(userId: string, origin: string, availability?: Availability): ToolContext {
  return { userId, scopes: [SCOPE_READ, SCOPE_DRAFT], origin, surface: "chat", availability };
}

export function chatTools(ctx: ToolContext): ToolSet {
  const set: ToolSet = {};
  for (const berthTool of BERTH_TOOLS as readonly BerthTool[]) {
    set[berthTool.name] = tool({
      title: berthTool.title,
      description: berthTool.description,
      inputSchema: berthTool.input,
      execute: async (args: unknown): Promise<ToolOutput> => {
        try {
          return await berthTool.run(args as never, ctx);
        } catch (error) {
          // A name, never the message: a chain error can carry an RPC URL with its key.
          console.warn(`[chat] ${berthTool.name} failed: ${error instanceof Error ? error.name : "error"}`);
          return { text: FAILED_TEXT, isError: true };
        }
      },
      toModelOutput: ({ output }: { output: ToolOutput }) =>
        output.isError ? { type: "error-text", value: output.text } : { type: "text", value: output.text },
    });
  }
  return set;
}
