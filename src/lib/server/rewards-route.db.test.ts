import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { awardXp, flushUnannounced, getOrCreateUser } from "./accounts";
import { awardAndRespond } from "./rewards-route";
import { XP_ACTIONS } from "@/lib/xp";

/**
 * Every rewards response carries the parked rewards, once: a held_30_days
 * paid by the cron rides along with the next award, and the profile sync
 * after it has nothing left to report.
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
  await sql.query("delete from xp_events");
  await sql.query("delete from users");
});

describe("awardAndRespond", () => {
  it("carries a parked reward with the new total, and the next flush is empty", async () => {
    const { user } = (await getOrCreateUser({ did: null, wallet: `0x${"1".repeat(40)}` }))!;
    await awardXp(user.id, "held_30_days", "0xhold", { announced: false });

    const response = await awardAndRespond(user, "avatar_set", null, { avatar_id: "bell" });
    const body = await response.json();

    expect(body.rewards).toEqual([
      { kind: "avatar_set", amount: XP_ACTIONS.avatar_set.amount },
      { kind: "held_30_days", amount: XP_ACTIONS.held_30_days.amount },
    ]);
    expect(body.xp).toBe(
      user.xp + XP_ACTIONS.avatar_set.amount + XP_ACTIONS.held_30_days.amount,
    );
    // What /api/profile would flush next: nothing, it was already told.
    expect(await flushUnannounced(user.id)).toEqual([]);
  });

  it("still carries parked rewards when the award itself was a replay", async () => {
    const { user } = (await getOrCreateUser({ did: null, wallet: `0x${"2".repeat(40)}` }))!;
    await awardXp(user.id, "avatar_set", null);
    await awardXp(user.id, "held_30_days", "0xhold", { announced: false });

    const body = await (await awardAndRespond(user, "avatar_set", null)).json();

    expect(body.rewards).toEqual([
      { kind: "held_30_days", amount: XP_ACTIONS.held_30_days.amount },
    ]);
  });
});
