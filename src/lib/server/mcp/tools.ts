import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { requireScopes } from "@modelcontextprotocol/server";
import { BERTH_TOOLS, type BerthTool, type ToolContext } from "@/lib/server/berth-tools/registry";
import { authOf, guarded, refuse, text, type BerthAuth, type ToolResult } from "@/lib/server/mcp/guard";

/**
 * The Berth tools at /mcp (app/mcp), as an adapter over the one registry
 * (lib/server/berth-tools/registry) the in-app chat also reads. The MCP
 * door owns what is its own: the token's scopes (a tool that needs one
 * asks for it with a scope challenge, and refuses in words without it),
 * the per grant limit and the usage row (`guarded`), and the result shape.
 * Names, descriptions, schemas and output are the registry's, unchanged.
 */

export { authOf, type BerthAuth } from "@/lib/server/mcp/guard";

function needScope(ctx: ServerContext, scope: string): (BerthAuth & { scopes: string[] }) | ToolResult {
  const auth = authOf(ctx);
  if (!auth) return refuse("Not signed in to Berth. Reconnect Berth in your assistant's settings.");
  if (!auth.scopes.includes(scope)) {
    return refuse(`This connection was not allowed to do that (it needs ${scope}). Reconnect Berth and allow it.`);
  }
  return auth;
}

/** One registry tool as MCP registers it: the config a client lists, and the handler it calls. */
export function mcpToolConfig(tool: BerthTool) {
  return {
    title: tool.title,
    description: tool.description,
    inputSchema: tool.input,
    annotations: tool.annotations,
    ...(tool.scope ? { scopeChallenge: requireScopes(tool.scope) } : {}),
  };
}

export function mcpToolHandler(tool: BerthTool, origin: string) {
  return async (args: Record<string, unknown>, ctx: ServerContext): Promise<ToolResult> =>
    guarded(tool.name, ctx, async () => {
      let toolCtx: ToolContext;
      if (tool.scope) {
        const auth = needScope(ctx, tool.scope);
        if ("content" in auth) return auth;
        toolCtx = { userId: auth.userId, scopes: auth.scopes, origin, surface: "mcp" };
      } else {
        const auth = authOf(ctx);
        toolCtx = { userId: auth?.userId ?? null, scopes: auth?.scopes ?? [], origin, surface: "mcp" };
      }
      const out = await tool.run(args as never, toolCtx);
      return out.isError ? refuse(out.text) : text(out.text);
    });
}

export function registerBerthTools(server: McpServer, { origin }: { origin: string }): void {
  for (const tool of BERTH_TOOLS as readonly BerthTool[]) {
    server.registerTool(tool.name, mcpToolConfig(tool), mcpToolHandler(tool, origin) as never);
  }
}
