import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { awardXp, flushUnannounced, getOrCreateUser } from "./accounts";
import { awardAndRespond, resolveRewardsUser } from "./rewards-route";
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

describe("resolveRewardsUser where Berth is not available", () => {
  const away = { available: false, reason: "united-states" } as const;

  it("makes no new account, for a wallet or an email, and answers 451", async () => {
    const wallet = await resolveRewardsUser({ did: null, wallet: `0x${"5".repeat(40)}`, body: {}, availability: away });
    expect(wallet.ok).toBe(false);
    if (!wallet.ok) {
      expect(wallet.response.status).toBe(451);
      expect(await wallet.response.json()).toMatchObject({ code: "unavailable_here" });
    }
    const email = await resolveRewardsUser({ did: "did:privy:away", wallet: null, body: {}, availability: away });
    expect(email.ok).toBe(false);
    const rows = (await sql.query("select count(*)::int as n from users")) as { n: number }[];
    expect(rows[0].n).toBe(0);
  });

  it("finds an account that already exists: someone who travels still sees, sells and withdraws", async () => {
    const wallet = `0x${"6".repeat(40)}`;
    const made = (await getOrCreateUser({ did: null, wallet }))!.user;
    const byWallet = await resolveRewardsUser({ did: null, wallet, body: {}, availability: away });
    expect(byWallet).toMatchObject({ ok: true, created: false });
    if (byWallet.ok) expect(byWallet.user.id).toBe(made.id);

    const byDid = (await getOrCreateUser({ did: "did:privy:home", wallet: null }))!.user;
    const again = await resolveRewardsUser({ did: "did:privy:home", wallet: null, body: {}, availability: away });
    expect(again).toMatchObject({ ok: true, created: false });
    if (again.ok) expect(again.user.id).toBe(byDid.id);
  });

  it("makes an account where Berth is available, as before", async () => {
    const made = await resolveRewardsUser({ did: null, wallet: `0x${"7".repeat(40)}`, body: {}, availability: { available: true } });
    expect(made).toMatchObject({ ok: true, created: true });
  });
});
