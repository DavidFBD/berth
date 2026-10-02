import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { mergeAccounts } from "@/lib/server/account-merge";
import { XP_ACTIONS } from "@/lib/xp";
import { setHandle } from "./handles";
import type { SocialViewer } from "./people";

/**
 * username_set against the real schema (PGlite): the first username pays
 * once per person, a rename or a resave never does, two first saves at once
 * pay once, a house word only staff may carry pays nothing, and a merge of
 * two named accounts keeps a single award.
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

const PAY = XP_ACTIONS.username_set.amount;
const DAY = 86_400_000;
let n = 0;

async function person(email?: string): Promise<SocialViewer> {
  n += 1;
  const address = email ?? `u${n}@example.com`;
  const rows = (await sql.query(`insert into users (privy_did, email) values ($1, $2) returning id`, [
    `did:privy:uxp${n}`,
    address,
  ])) as { id: string }[];
  return { id: rows[0].id, email: address };
}

async function ledger(userId: string): Promise<{ events: number; xp: number }> {
  const rows = (await sql.query(
    `select (select count(*)::int from xp_events where user_id = $1 and kind = 'username_set') as events,
            (select xp from users where id = $1) as xp`,
    [userId],
  )) as { events: number; xp: number }[];
  return rows[0];
}

describe("username_set", () => {
  it("pays the first username once, and says so", async () => {
    const sailor = await person();
    const first = await setHandle(sailor, "first_light");
    expect(first.ok && first.rewards).toEqual([{ kind: "username_set", amount: PAY }]);
    expect(first.ok && first.xp).toBe(PAY);
    expect(await ledger(sailor.id)).toEqual({ events: 1, xp: PAY });
  });

  it("never pays a resave or a rename", async () => {
    const start = new Date("2026-09-01T10:00:00Z");
    const sailor = await person();
    expect((await setHandle(sailor, "tide_one", start)).ok).toBe(true);
    const resaved = await setHandle(sailor, "Tide_One", new Date(start.getTime() + DAY));
    expect(resaved.ok && resaved.rewards).toEqual([]);
    expect(resaved.ok && resaved.xp).toBeNull();
    const renamed = await setHandle(sailor, "tide_two", new Date(start.getTime() + 31 * DAY));
    expect(renamed.ok && renamed.social.handle).toBe("tide_two");
    expect(renamed.ok && renamed.rewards).toEqual([]);
    expect(await ledger(sailor.id)).toEqual({ events: 1, xp: PAY });
  });

  it("pays once when two first saves arrive together", async () => {
    const sailor = await person();
    const results = await Promise.all([setHandle(sailor, "race_one"), setHandle(sailor, "race_two"), setHandle(sailor, "race_three")]);
    const paid = results.filter((result) => result.ok && result.rewards.length > 0);
    expect(paid).toHaveLength(1);
    expect(await ledger(sailor.id)).toEqual({ events: 1, xp: PAY });
  });

  it("pays nothing for a house word only staff may carry", async () => {
    const staff = await person(`crew${n + 1}@sodax.com`);
    const named = await setHandle(staff, "berth");
    expect(named.ok && named.social.handle).toBe("berth");
    expect(named.ok && named.rewards).toEqual([]);
    expect(await ledger(staff.id)).toEqual({ events: 0, xp: 0 });
  });

  it("keeps one award when two named accounts merge", async () => {
    const survivor = await person();
    const absorbed = await person();
    expect((await setHandle(survivor, "keeper_one")).ok).toBe(true);
    expect((await setHandle(absorbed, "joiner_one")).ok).toBe(true);
    expect((await mergeAccounts({ survivor: survivor.id, absorbed: absorbed.id, reason: "email" })).ok).toBe(true);
    expect(await ledger(survivor.id)).toEqual({ events: 1, xp: PAY });
    // The absorbed row keeps its own for the record, never paid twice.
    expect((await ledger(absorbed.id)).events).toBe(1);
  });

  it("does not pay the survivor again after a merge brought its name", async () => {
    const start = new Date("2026-09-01T10:00:00Z");
    const survivor = await person();
    const absorbed = await person();
    expect((await setHandle(absorbed, "brought_name", start)).ok).toBe(true);
    expect((await mergeAccounts({ survivor: survivor.id, absorbed: absorbed.id, reason: "email" })).ok).toBe(true);
    expect(await ledger(survivor.id)).toEqual({ events: 1, xp: PAY });
    const later = await setHandle(survivor, "own_name", new Date(start.getTime() + 31 * DAY));
    expect(later.ok && later.rewards).toEqual([]);
    expect(await ledger(survivor.id)).toEqual({ events: 1, xp: PAY });
  });
});
