import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The Neon adapter behind the seam (lib/server/db): a transaction's
 * isolation is passed to Neon when pinned, and left to Neon otherwise.
 */
const transaction = vi.fn(async (queries: unknown[], options?: unknown) => queries.map(() => options ?? []));
const query = vi.fn((text: string, params: unknown[]) => ({ text, params }));
vi.mock("@neondatabase/serverless", () => ({ neon: () => ({ query, transaction }) }));

const { inTransaction, setSqlClient } = await import("./db");

afterEach(() => {
  setSqlClient(null);
  vi.unstubAllEnvs();
  transaction.mockClear();
});

describe("a transaction on Neon", () => {
  it("pins ReadCommitted when asked (review: the sell XP advisory lock)", async () => {
    vi.stubEnv("LOCAL_DATABASE_URL", "");
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@example.neon.tech/db");
    setSqlClient(null);
    await inTransaction([{ text: "select 1" }, { text: "select 2", params: [1] }], { isolationLevel: "ReadCommitted" });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][1]).toEqual({ isolationLevel: "ReadCommitted" });
    expect(transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it("leaves the isolation to Neon when not asked", async () => {
    vi.stubEnv("LOCAL_DATABASE_URL", "");
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@example.neon.tech/db");
    setSqlClient(null);
    await inTransaction([{ text: "select 1" }]);
    expect(transaction.mock.calls[0][1]).toBeUndefined();
  });
});

describe("the sell XP check", () => {
  it("runs its lock and award pinned to ReadCommitted", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/lib/server/robinhood-xp.ts", "utf8");
    expect(source).toMatch(/pg_advisory_xact_lock[\s\S]*\], \{ isolationLevel: "ReadCommitted" \}\);/);
  });
});
