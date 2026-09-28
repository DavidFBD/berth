import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { getOrCreateUser } from "@/lib/server/accounts";
import { CHAT_SYSTEM_PROMPT } from "@/lib/server/chat/system-prompt";

/**
 * The chat route end to end against a real Postgres, with the caller and
 * the model stubbed: the unlock is enforced by the server, not only the
 * sheet; the day's messages close the chat; the house budget closes it for
 * everyone; the system prompt is sent first; and one chat_usage row per
 * message carries tokens and cost, never words.
 */

const caller = vi.hoisted(() => ({ wallet: "0x00000000000000000000000000000000000000c1", body: {} as Record<string, unknown> }));

vi.mock("@/lib/server/rewards-route", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/rewards-route")>();
  return {
    ...actual,
    readRewardsCaller: vi.fn(async (request: Request) => ({
      ok: true,
      caller: { did: null, wallet: caller.wallet, body: (await request.json()) as Record<string, unknown> },
    })),
  };
});

const model = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/server/chat/model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/chat/model")>();
  return { ...actual, chatModel: vi.fn(async () => model.current) };
});

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  // No request scope in a test: run the after() work at once.
  return { ...actual, after: (task: () => unknown) => void task() };
});

const { POST } = await import("./route");
const { resetChatUsageCache } = await import("@/lib/server/chat/usage");

let sql: SqlClient;
let close: () => Promise<void>;

function answeringModel(text = "Here are the facts.") {
  return new MockLanguageModelV4({
    provider: "openai",
    modelId: "gpt-6-luna",
    doStream: async () =>
      ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: text },
            { type: "text-end", id: "t" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: { inputTokens: { total: 3_000, noCache: 1_000, cacheRead: 2_000, cacheWrite: 0 }, outputTokens: { total: 200, text: 150, reasoning: 50 } },
            },
          ],
        }),
      }) as never,
  });
}

function request(text = "What moved today?") {
  return new Request("http://localhost:3700/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-wallet-session": "stubbed" },
    body: JSON.stringify({ messages: [{ id: "m1", role: "user", parts: [{ type: "text", text }] }] }),
  }) as never;
}

async function userWithXp(wallet: string, xp: number): Promise<string> {
  caller.wallet = wallet;
  const id = (await getOrCreateUser({ did: null, wallet }))!.user.id;
  await sql.query(`update users set xp = $2 where id = $1`, [id, xp]);
  return id;
}

async function drain(response: Response): Promise<string> {
  return await response.text();
}

beforeAll(async () => {
  const db = await makeTestDb();
  sql = db.sql;
  close = db.close;
  setSqlClient(sql);
});

afterAll(async () => {
  setSqlClient(null);
  await close();
});

beforeEach(async () => {
  await sql.query(`delete from chat_usage`);
  await sql.query(`delete from oauth_rate_limits`);
  resetChatUsageCache();
  vi.stubEnv("OPENAI_API_KEY", "sk-test-not-real");
  vi.stubEnv("CHAT_ENABLED", "");
  vi.stubEnv("CHAT_MONTHLY_BUDGET_USD", "5");
  model.current = answeringModel();
});

describe("POST /api/chat", () => {
  it("refuses an account below the chat rung, before any model call", async () => {
    await userWithXp("0x00000000000000000000000000000000000000c1", 25);
    const mock = model.current as MockLanguageModelV4;
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "locked" });
    expect(mock.doStreamCalls).toHaveLength(0);
  });

  it("answers at the chat rung, sends the system prompt first, and records counts only", async () => {
    const id = await userWithXp("0x00000000000000000000000000000000000000c2", 175);
    const mock = model.current as MockLanguageModelV4;
    const response = await POST(request("Tell me a secret phrase: pelican"));
    expect(response.status).toBe(200);
    const body = await drain(response);
    expect(body).toContain("Here are the facts.");

    const prompt = mock.doStreamCalls[0].prompt as { role: string; content: unknown }[];
    expect(prompt[0].role).toBe("system");
    expect(String(prompt[0].content).startsWith(CHAT_SYSTEM_PROMPT)).toBe(true);
    expect(mock.doStreamCalls[0].tools?.map((tool) => tool.name)).toHaveLength(9);

    await vi.waitFor(async () => {
      const rows = (await sql.query(`select * from chat_usage where user_id = $1`, [id])) as Record<string, unknown>[];
      expect(rows).toHaveLength(1);
    });
    const [row] = (await sql.query(`select * from chat_usage where user_id = $1`, [id])) as Record<string, unknown>[];
    expect(row).toMatchObject({ provider: "openai", model: "gpt-6-luna", steps: 1, input_tokens: 3000, cache_read_tokens: 2000, output_tokens: 200, reasoning_tokens: 50, ok: true });
    // 1,000 fresh at $0.10 + 2,000 cached at $0.01 + 200 out at $0.50 per million.
    expect(Number(row.cost_micros)).toBe(100 + 20 + 100);
    expect(JSON.stringify(row)).not.toContain("pelican");
  });

  it("closes the day once the day's messages are spent", async () => {
    const id = await userWithXp("0x00000000000000000000000000000000000000c3", 175);
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    await sql.query(`insert into oauth_rate_limits (bucket, window_start, n) values ($1, $2::timestamptz, 25)`, [`chat:day:${id}`, day.toISOString()]);
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ code: "limit_day" });
  });

  it("holds the minute", async () => {
    await userWithXp("0x00000000000000000000000000000000000000c4", 175);
    for (let index = 0; index < 6; index++) {
      const ok = await POST(request());
      expect(ok.status).toBe(200);
      await drain(ok);
      model.current = answeringModel();
    }
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ code: "limit_minute" });
  });

  it("closes for everyone when the month's budget is spent", async () => {
    const other = await userWithXp("0x00000000000000000000000000000000000000c5", 175);
    await sql.query(
      `insert into chat_usage (user_id, provider, model, steps, input_tokens, output_tokens, cost_micros, ok, duration_ms) values ($1, 'openai', 'gpt-6-luna', 1, 1, 1, 5000000, true, 1)`,
      [other],
    );
    await userWithXp("0x00000000000000000000000000000000000000c6", 175);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "budget" });
  });

  it("closes for one person who has used this month's share, while others go on", async () => {
    const heavy = await userWithXp("0x00000000000000000000000000000000000000cb", 175);
    await sql.query(
      `insert into chat_usage (user_id, provider, model, steps, input_tokens, output_tokens, cost_micros, ok, duration_ms) values ($1, 'openai', 'gpt-6-luna', 1, 1, 1, 500000, true, 1)`,
      [heavy],
    );
    const refused = await POST(request());
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ code: "limit_month" });
    await userWithXp("0x00000000000000000000000000000000000000cc", 175);
    const fine = await POST(request());
    expect(fine.status).toBe(200);
    await drain(fine);
  });

  it("is unavailable without a key, and off with the switch", async () => {
    await userWithXp("0x00000000000000000000000000000000000000c7", 175);
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(await (await POST(request())).json()).toEqual({ code: "unavailable" });
    vi.stubEnv("OPENAI_API_KEY", "sk-test-not-real");
    vi.stubEnv("CHAT_ENABLED", "0");
    expect(await (await POST(request())).json()).toEqual({ code: "disabled" });
  });

  it("charges a failed message for the step it was in, not nothing", async () => {
    const id = await userWithXp("0x00000000000000000000000000000000000000c9", 175);
    model.current = new MockLanguageModelV4({
      provider: "openai",
      modelId: "gpt-6-luna",
      doStream: async () => {
        throw Object.assign(new Error("upstream"), { statusCode: 500 });
      },
    });
    const response = await POST(request());
    await drain(response);
    await vi.waitFor(async () => {
      const [row] = (await sql.query(`select * from chat_usage where user_id = $1`, [id])) as Record<string, unknown>[];
      expect(row.error).toBe("failed");
    });
    const [row] = (await sql.query(`select * from chat_usage where user_id = $1`, [id])) as Record<string, unknown>[];
    expect(row.ok).toBe(false);
    // The prefix plus the history as input, and a full step of output.
    expect(Number(row.output_tokens)).toBe(1_500);
    expect(Number(row.input_tokens)).toBeGreaterThanOrEqual(3_000);
    expect(Number(row.cost_micros)).toBeGreaterThan(0);
  });

  it("counts a message before it answers, so one cut off still costs its estimate", async () => {
    const id = await userWithXp("0x00000000000000000000000000000000000000ca", 175);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const inner = answeringModel();
    model.current = new MockLanguageModelV4({
      provider: "openai",
      modelId: "gpt-6-luna",
      doStream: async (options) => {
        await held;
        return inner.doStream(options);
      },
    });
    const response = await POST(request());
    const [provisional] = (await sql.query(`select * from chat_usage where user_id = $1`, [id])) as Record<string, unknown>[];
    expect(provisional.error).toBe("provisional");
    expect(Number(provisional.cost_micros)).toBeGreaterThan(3_000);
    release();
    await drain(response);
    await vi.waitFor(async () => {
      const rows = (await sql.query(`select * from chat_usage where user_id = $1`, [id])) as Record<string, unknown>[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ ok: true, error: null, cost_micros: 220 });
    });
  });

  it("refuses a message over the limit without spending a place", async () => {
    const id = await userWithXp("0x00000000000000000000000000000000000000c8", 175);
    const response = await POST(request("x".repeat(2_001)));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "too_long" });
    const rows = (await sql.query(`select n from oauth_rate_limits where bucket like $1`, [`chat:%:${id}`])) as unknown[];
    expect(rows).toHaveLength(0);
  });
});
