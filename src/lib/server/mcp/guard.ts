import type { ServerContext } from "@modelcontextprotocol/server";
import { usageAssistant } from "@/lib/assistant-party";
import { RATE_LIMITED_TEXT, recordMcpCall, takeMcpPlace, type McpCall } from "@/lib/server/mcp/usage";

/**
 * The one choke point every MCP tool call goes through (lib/server/mcp/tools):
 * who is asking, the per grant limit, a calm answer for anything thrown, and
 * one usage row per call (lib/server/mcp/usage). Kept apart from the tools so
 * it can be tested without them.
 */

/** Who the token speaks for, set by the route's verifyToken (app/mcp). */
export type BerthAuth = { userId: string; grantId: string; clientName?: string | null };

export function authOf(ctx: ServerContext): (BerthAuth & { scopes: string[] }) | null {
  const info = ctx.http?.authInfo;
  const extra = info?.extra as Partial<BerthAuth> | undefined;
  if (!info || !extra?.userId || !extra.grantId) return null;
  return { userId: extra.userId, grantId: extra.grantId, clientName: extra.clientName ?? null, scopes: info.scopes };
}

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

export function text(body: string): ToolResult {
  return { content: [{ type: "text", text: body }] };
}

export function refuse(body: string): ToolResult {
  return { content: [{ type: "text", text: body }], isError: true };
}

export type GuardDeps = {
  take: (grantId: string) => Promise<boolean>;
  record: (call: McpCall) => void;
  clock: () => number;
};

const DEFAULT_DEPS: GuardDeps = { take: (grantId) => takeMcpPlace(grantId), record: recordMcpCall, clock: () => performance.now() };

/**
 * Run a tool body behind the limit; anything thrown becomes a calm error the
 * assistant can relay. The usage row carries a short code only: "refused"
 * when the tool itself said no (an unknown listing, a missing scope),
 * "failed" when it threw, "rate_limited" when it never ran.
 */
export async function guarded(
  name: string,
  ctx: ServerContext,
  run: () => Promise<ToolResult>,
  deps: GuardDeps = DEFAULT_DEPS,
): Promise<ToolResult> {
  const auth = authOf(ctx);
  const started = deps.clock();
  const log = (ok: boolean, error: string | null) => {
    if (!auth) return;
    deps.record({
      userId: auth.userId,
      grantId: auth.grantId,
      assistant: usageAssistant(auth.clientName),
      tool: name,
      ok,
      error,
      durationMs: deps.clock() - started,
    });
  };
  if (auth && !(await deps.take(auth.grantId))) {
    log(false, "rate_limited");
    return refuse(RATE_LIMITED_TEXT);
  }
  try {
    const result = await run();
    log(!result.isError, result.isError ? "refused" : null);
    return result;
  } catch (error) {
    console.warn(`[mcp] ${name} failed`, error instanceof Error ? error.message : error);
    log(false, "failed");
    return refuse("Berth could not answer that just now. Try again in a minute.");
  }
}
