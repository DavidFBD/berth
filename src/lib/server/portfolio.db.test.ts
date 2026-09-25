import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { getOrCreateUser } from "./accounts";
import { readMarks, writeMarks } from "./marks";
import { loadPortfolioDays, runPortfolioSnapshot, savePortfolioDay } from "./portfolio";

/**
 * The stored marks and portfolio days against a real Postgres with the
 * real schema: the despike's delete, the snapshot that outranks a ledger
 * row, and a snapshot run that tolerates one account failing.
 */

let sql: SqlClient;
let close: () => Promise<void>;

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
  await sql.query("delete from portfolio_days");
  await sql.query("delete from marks");
  await sql.query("delete from users");
});

const wallet = (n: number) => `0x${String(n).padStart(40, "0")}`;
const account = async (n: number) => (await getOrCreateUser({ did: null, wallet: wallet(n) }))!.user;
const FRIDAY_EVENING = new Date("2026-09-25T23:05:00Z");

describe("marks", () => {
  it("upserts, re-reads oldest first, and takes out a rejected day", async () => {
    await writeMarks("SPY", [{ day: "2026-09-23", close: 1 }, { day: "2026-09-24", close: 2 }], []);
    await writeMarks("SPY", [{ day: "2026-09-24", close: 3 }], ["2026-09-23"]);
    expect(await readMarks(["SPY", "BTC"])).toEqual({
      SPY: { dates: ["2026-09-24"], values: [3] },
      BTC: { dates: [], values: [] },
    });
  });
});

describe("portfolio days", () => {
  it("never lets a ledger row replace a snapshot", async () => {
    const user = await account(1);
    const snapshot = { value: 10, holdings: [] };
    await savePortfolioDay(user.id, "2026-09-24", snapshot, "snapshot", "2026-09-24T22:30:00Z");
    expect(
      await savePortfolioDay(user.id, "2026-09-24", { value: 99, holdings: [] }, "ledger", "2026-09-24T21:30:00Z"),
    ).toBe(false);
    const days = await loadPortfolioDays(user.id);
    expect(days).toEqual([
      { day: "2026-09-24", value: 10, holdings: [], source: "snapshot", asOf: "2026-09-24T22:30:00.000Z" },
    ]);
  });

  it("snapshots every account at today's close, the oracle where the close is missing, and survives one failing", async () => {
    const holder = await account(1);
    const broken = await account(2);
    const empty = await account(3);
    await writeMarks("NVDA", [{ day: "2026-09-25", close: 200 }], []);

    const summary = await runPortfolioSnapshot({
      now: FRIDAY_EVENING,
      deriveHubWallet: async (spoke) => `hub-${spoke}`,
      readBalances: async (hub): Promise<Record<string, number>> => {
        if (hub === `hub-${wallet(2)}`) throw new Error("rpc down");
        if (hub === `hub-${wallet(3)}`) return {};
        return { NVDA: 2, SGOV: 1 };
      },
      livePrices: async () => ({ SGOV: 100.5 }),
    });

    expect(summary).toMatchObject({ day: "2026-09-25", accounts: 3, written: 1, empty: 1, failed: 1, oraclePriced: 1 });
    const [row] = await loadPortfolioDays(holder.id);
    expect(row.value).toBeCloseTo(500.5, 10);
    expect(row.source).toBe("snapshot");
    expect(row.holdings).toEqual([
      { symbol: "NVDA", quantity: 2, price: 200, source: "mark" },
      { symbol: "SGOV", quantity: 1, price: 100.5, source: "oracle" },
    ]);
    expect(await loadPortfolioDays(broken.id)).toEqual([]);
    expect(await loadPortfolioDays(empty.id)).toEqual([]);
  });

  it("writes a sold out account's zero once it has history, and nothing on a weekend", async () => {
    const user = await account(1);
    await savePortfolioDay(user.id, "2026-09-24", { value: 10, holdings: [] }, "snapshot", "2026-09-24T22:30:00Z");
    const deps = {
      deriveHubWallet: async (spoke: string) => spoke,
      readBalances: async () => ({}),
      livePrices: async () => ({}),
    };
    expect((await runPortfolioSnapshot({ now: FRIDAY_EVENING, ...deps })).written).toBe(1);
    expect((await loadPortfolioDays(user.id)).map((day) => day.value)).toEqual([10, 0]);
    const saturday = await runPortfolioSnapshot({ now: new Date("2026-09-26T23:05:00Z"), ...deps });
    expect(saturday.skipped).toBeTruthy();
  });
});
