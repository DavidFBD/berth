import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerContext } from "@modelcontextprotocol/server";
import { setSqlClient, type SqlClient } from "../db";
import { makeTestDb } from "../pglite-test-db";
import { getOrCreateUser } from "../accounts";
import { pruneOAuth } from "../oauth/prune";
import { usageAssistant } from "@/lib/assistant-party";
import { guarded, refuse, text, type GuardDeps } from "./guard";
import {
  MCP_LIMITS,
  RATE_LIMITED_TEXT,
  mcpWindows,
  resetMcpUsageWarnings,
  takeMcpPlace,
  withinMcpLimits,
  writeMcpCall,
  type McpCall,
} from "./usage";

/**
 * MCP usage: the per grant limit's windows and its atomic count against a
 * real Postgres, the one row per call that guarded records (and what it
 * leaves out), and the two ways it must never cost an answer.
 */

const GRANT = "7c1e9b8a-3f5d-4a2b-9c6d-1e2f3a4b5c6d";

let sql: SqlClient;
let close: () => Promise<void>;
let userId: string;

beforeAll(async () => {
  const db = await makeTestDb();
  sql = db.sql;
  close = db.close;
  setSqlClient(sql);
  userId = (await getOrCreateUser({ did: null, wallet: "0x00000000000000000000000000000000000000aa" }))!.user.id;
});

afterAll(async () => {
  setSqlClient(null);
  await close();
});

beforeEach(async () => {
  await sql.query(`delete from oauth_rate_limits`);
  await sql.query(`delete from mcp_calls`);
});

function ctxFor(extra: Record<string, unknown> | null): ServerContext {
  return (extra ? { http: { authInfo: { token: "t", clientId: "c", scopes: ["berth.read"], extra } } } : {}) as unknown as ServerContext;
}

function fakeDeps(allow = true): GuardDeps & { calls: McpCall[] } {
  const calls: McpCall[] = [];
  let t = 1000;
  return { calls, take: async () => allow, record: (call) => calls.push(call), clock: () => (t += 25) };
}

describe("windows", () => {
  it("counts a call in its UTC minute and its UTC day", () => {
    const { minute, day } = mcpWindows(GRANT, new Date("2026-09-26T23:59:41.512Z"));
    expect(minute).toEqual([`mcp:minute:${GRANT}`, "2026-09-26T23:59:00.000Z"]);
    expect(day).toEqual([`mcp:day:${GRANT}`, "2026-09-26T00:00:00.000Z"]);
  });

  it("allows up to each limit and not one more", () => {
    expect(withinMcpLimits({ minute: MCP_LIMITS.perMinute, day: MCP_LIMITS.perDay })).toBe(true);
    expect(withinMcpLimits({ minute: MCP_LIMITS.perMinute + 1, day: 1 })).toBe(false);
    expect(withinMcpLimits({ minute: 1, day: MCP_LIMITS.perDay + 1 })).toBe(false);
  });
});

describe("takeMcpPlace", () => {
  it("lets exactly the per minute limit through, then opens again the next minute", async () => {
    const now = new Date("2026-09-26T12:00:10Z");
    const results = await Promise.all(Array.from({ length: MCP_LIMITS.perMinute + 5 }, () => takeMcpPlace(GRANT, now)));
    expect(results.filter(Boolean)).toHaveLength(MCP_LIMITS.perMinute);
    expect(await takeMcpPlace(GRANT, new Date("2026-09-26T12:01:00Z"))).toBe(true);
    expect(await takeMcpPlace("another-grant", now)).toBe(true);
  });

  it("stops a grant for the rest of the day once the daily limit is spent", async () => {
    await sql.query(`insert into oauth_rate_limits (bucket, window_start, n) values ($1, $2::timestamptz, $3)`, [
      `mcp:day:${GRANT}`,
      "2026-09-26T00:00:00Z",
      MCP_LIMITS.perDay,
    ]);
    expect(await takeMcpPlace(GRANT, new Date("2026-09-26T18:00:00Z"))).toBe(false);
    expect(await takeMcpPlace(GRANT, new Date("2026-09-27T00:00:05Z"))).toBe(true);
  });

  it("fails open when the query errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setSqlClient({ query: async () => Promise.reject(new Error("connection refused")) });
    try {
      expect(await takeMcpPlace(GRANT)).toBe(true);
      expect(warn).toHaveBeenCalled();
    } finally {
      setSqlClient(sql);
      warn.mockRestore();
    }
  });
});

describe("assistant derivation", () => {
  it("names the three known assistants and calls everything else other", () => {
    expect(usageAssistant("Claude")).toBe("claude");
    expect(usageAssistant("ChatGPT")).toBe("chatgpt");
    expect(usageAssistant("Grok")).toBe("grok");
    expect(usageAssistant("claude")).toBe("other");
    expect(usageAssistant("Cursor")).toBe("other");
    expect(usageAssistant(null)).toBe("other");
  });
});

describe("guarded", () => {
  const auth = { userId: "u-1", grantId: GRANT, clientName: "ChatGPT" };

  it("records one row for a good call, with no arguments or output in it", async () => {
    const deps = fakeDeps();
    const result = await guarded("get_holdings", ctxFor(auth), async () => text("secret holdings 12.5 NVDA"), deps);
    expect(result.isError).toBeUndefined();
    expect(deps.calls).toEqual([
      { userId: "u-1", grantId: GRANT, assistant: "chatgpt", tool: "get_holdings", ok: true, error: null, durationMs: 25 },
    ]);
    expect(JSON.stringify(deps.calls)).not.toContain("secret");
  });

  it("records a refusal and a throw with short codes only", async () => {
    const deps = fakeDeps();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await guarded("get_listing", ctxFor(auth), async () => refuse("No listing called Pets.com"), deps);
    const thrown = await guarded("get_orders", ctxFor(auth), async () => Promise.reject(new Error("user 0xabc boom")), deps);
    warn.mockRestore();
    expect(thrown.isError).toBe(true);
    expect(deps.calls.map((call) => [call.tool, call.ok, call.error])).toEqual([
      ["get_listing", false, "refused"],
      ["get_orders", false, "failed"],
    ]);
    expect(JSON.stringify(deps.calls)).not.toMatch(/Pets|0xabc/);
  });

  it("over the limit, answers calmly without running the tool and logs rate_limited", async () => {
    const deps = fakeDeps(false);
    const run = vi.fn(async () => text("ran"));
    const result = await guarded("list_listings", ctxFor(auth), run, deps);
    expect(run).not.toHaveBeenCalled();
    expect(result).toEqual(refuse(RATE_LIMITED_TEXT));
    expect(deps.calls[0]).toMatchObject({ tool: "list_listings", ok: false, error: "rate_limited" });
  });

  it("without auth runs the tool and records nothing", async () => {
    const deps = fakeDeps();
    const result = await guarded("list_listings", ctxFor(null), async () => text("ok"), deps);
    expect(result).toEqual(text("ok"));
    expect(deps.calls).toEqual([]);
  });
});

describe("writeMcpCall and pruning", () => {
  const call = (extra: Partial<McpCall> = {}): McpCall => ({
    userId,
    grantId: GRANT,
    assistant: "claude",
    tool: "get_moves",
    ok: true,
    error: null,
    durationMs: 41.6,
    ...extra,
  });

  it("writes the row", async () => {
    await writeMcpCall(call());
    const rows = (await sql.query(`select assistant, tool, ok, error, duration_ms from mcp_calls`)) as unknown[];
    expect(rows).toEqual([{ assistant: "claude", tool: "get_moves", ok: true, error: null, duration_ms: 42 }]);
  });

  it("warns once and carries on when the table does not exist yet", async () => {
    resetMcpUsageWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setSqlClient({ query: async () => Promise.reject(new Error('relation "mcp_calls" does not exist')) });
    try {
      await expect(writeMcpCall(call())).resolves.toBeUndefined();
      await expect(writeMcpCall(call())).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      setSqlClient(sql);
      warn.mockRestore();
    }
  });

  it("the evening prune removes rows older than 90 days and keeps the rest", async () => {
    await writeMcpCall(call());
    await writeMcpCall(call({ tool: "get_orders" }));
    await sql.query(`update mcp_calls set created_at = now() - interval '91 days' where tool = 'get_orders'`);
    const summary = await pruneOAuth();
    expect(summary.mcpCalls).toBe(1);
    const rows = (await sql.query(`select tool from mcp_calls`)) as { tool: string }[];
    expect(rows.map((row) => row.tool)).toEqual(["get_moves"]);
  });
});
