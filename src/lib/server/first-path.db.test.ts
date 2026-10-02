import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { getOrCreateUser } from "@/lib/server/accounts";
import { FIRST_PATH_WRITES_PER_HOUR, firstPathWriteAllowed, parseFirstPathWrite, readFirstPath, writeFirstPath } from "@/lib/server/first-path";
import { firstPath } from "@/lib/first-path";

/**
 * The guided path's server side against the real schema: facts come from
 * the tables that already hold them, the record keeps skips and the two
 * client facts, every write is idempotent, and an account made before the
 * path began is not on it.
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

let n = 0;
async function user(): Promise<string> {
  n += 1;
  const made = await getOrCreateUser({ did: null, wallet: `0x${n.toString(16).padStart(40, "a")}` });
  return made!.user.id;
}

async function order(userId: string, symbol: string, filled: boolean) {
  n += 1;
  await sql.query(
    `insert into orders (user_id, intent_tx, direction, listing_symbol, listing_address, placed_at, fill_tx, filled_at)
     values ($1, $2, 'buy', $3, '0x0', now(), $4, $5)`,
    [userId, `0xtx${n}`, symbol, filled ? `0xfill${n}` : null, filled ? new Date().toISOString() : null],
  );
}

describe("readFirstPath", () => {
  it("a brand new account is on the path with nothing done", async () => {
    const id = await user();
    const state = await readFirstPath(id);
    expect(state).toEqual({
      eligible: true,
      skipped: [],
      finished: false,
      referred: false,
      facts: { avatarSet: false, usernameSet: false, hasEmail: false, funded: false, firstBuy: false, inviteSent: false },
    });
  });

  it("an account made before the path began is not on it", async () => {
    const id = await user();
    await sql.query(`update users set created_at = '2026-09-01T00:00:00Z' where id = $1`, [id]);
    expect((await readFirstPath(id))?.eligible).toBe(false);
  });

  it("reads the avatar, the username and the email from their own tables", async () => {
    const id = await user();
    await sql.query(`update users set avatar_id = 'buoy', email = 'a@example.com' where id = $1`, [id]);
    await sql.query(`insert into handles (user_id, handle, handle_norm) values ($1, 'gosia', 'gosia')`, [id]);
    const facts = (await readFirstPath(id))!.facts;
    expect(facts.avatarSet).toBe(true);
    expect(facts.usernameSet).toBe(true);
    expect(facts.hasEmail).toBe(true);
  });

  it("counts only a filled buy of a stock or fund as the first buy, never parked cash or a failed one", async () => {
    const id = await user();
    await order(id, "SGOV", true);
    await order(id, "NVDA", false);
    expect((await readFirstPath(id))!.facts.firstBuy).toBe(false);
    await order(id, "NVDA", true);
    expect((await readFirstPath(id))!.facts.firstBuy).toBe(true);
  });

  it("the friend made by the invite that brought the account is not an invite sent; any other friend is", async () => {
    const inviter = await user();
    const id = await user();
    await sql.query(`update users set referred_by = $2 where id = $1`, [id, inviter]);
    const [a, b] = [inviter, id].sort();
    await sql.query(`insert into friends (a_id, b_id) values ($1, $2)`, [a, b]);
    const state = (await readFirstPath(id))!;
    expect(state.referred).toBe(true);
    expect(state.facts.inviteSent).toBe(false);
    // The inviter, though, did invite someone: the account that joined on their code.
    expect((await readFirstPath(inviter))!.facts.inviteSent).toBe(true);
    const other = await user();
    const [c, d] = [other, id].sort();
    await sql.query(`insert into friends (a_id, b_id) values ($1, $2)`, [c, d]);
    expect((await readFirstPath(id))!.facts.inviteSent).toBe(true);
  });

  it("a friend request sent counts as an invite", async () => {
    const id = await user();
    const other = await user();
    await sql.query(`insert into friend_requests (from_id, to_id) values ($1, $2)`, [id, other]);
    expect((await readFirstPath(id))!.facts.inviteSent).toBe(true);
    expect((await readFirstPath(other))!.facts.inviteSent).toBe(false);
  });

  it("answers null for no such account", async () => {
    expect(await readFirstPath("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("writeFirstPath", () => {
  it("skips and unskips, idempotently, keeping the order of the list", async () => {
    const id = await user();
    await writeFirstPath(id, { kind: "skip", step: "avatar" });
    await writeFirstPath(id, { kind: "skip", step: "avatar" });
    await writeFirstPath(id, { kind: "skip", step: "invite" });
    expect((await readFirstPath(id))!.skipped).toEqual(["avatar", "invite"]);
    await writeFirstPath(id, { kind: "unskip", step: "avatar" });
    await writeFirstPath(id, { kind: "unskip", step: "money" });
    expect((await readFirstPath(id))!.skipped).toEqual(["invite"]);
  });

  it("keeps the first date for money seen, a link shared and the finish", async () => {
    const id = await user();
    await writeFirstPath(id, { kind: "funded" });
    await writeFirstPath(id, { kind: "invited" });
    const first = (await sql.query(`select funded_at, invite_shared_at from first_paths where user_id = $1`, [id])) as {
      funded_at: Date;
      invite_shared_at: Date;
    }[];
    await writeFirstPath(id, { kind: "funded" });
    await writeFirstPath(id, { kind: "invited" });
    const again = (await sql.query(`select funded_at, invite_shared_at from first_paths where user_id = $1`, [id])) as typeof first;
    expect(new Date(again[0].funded_at).getTime()).toBe(new Date(first[0].funded_at).getTime());
    expect(new Date(again[0].invite_shared_at).getTime()).toBe(new Date(first[0].invite_shared_at).getTime());
    const state = (await readFirstPath(id))!;
    expect(state.facts.funded).toBe(true);
    expect(state.facts.inviteSent).toBe(true);
    await writeFirstPath(id, { kind: "finish" });
    await writeFirstPath(id, { kind: "finish" });
    expect((await readFirstPath(id))!.finished).toBe(true);
  });

  it("walks a whole account through to finished, through the rulebook, and it stays off", async () => {
    const id = await user();
    const context = { account: "email" as const, canBuy: true };
    const at = async () => {
      const state = (await readFirstPath(id))!;
      const v = firstPath({ facts: state.facts, record: state, context });
      return v.kind === "step" ? v.step : v.kind;
    };
    expect(await at()).toBe("avatar");
    await sql.query(`update users set avatar_id = 'buoy', email = 'b@example.com' where id = $1`, [id]);
    expect(await at()).toBe("username");
    await writeFirstPath(id, { kind: "skip", step: "username" });
    expect(await at()).toBe("money");
    await writeFirstPath(id, { kind: "funded" });
    expect(await at()).toBe("firstBuy");
    await order(id, "AAPL", true);
    expect(await at()).toBe("invite");
    await writeFirstPath(id, { kind: "unskip", step: "username" });
    expect(await at()).toBe("username");
    await sql.query(`insert into handles (user_id, handle, handle_norm) values ($1, 'walker', 'walker')`, [id]);
    expect(await at()).toBe("invite");
    await writeFirstPath(id, { kind: "invited" });
    expect(await at()).toBe("complete");
    await writeFirstPath(id, { kind: "finish" });
    expect(await at()).toBe("off");
  });
});

describe("parseFirstPathWrite", () => {
  it("reads one known write and nothing else", () => {
    expect(parseFirstPathWrite({})).toBeNull();
    expect(parseFirstPathWrite({ skip: "avatar" })).toEqual({ kind: "skip", step: "avatar" });
    expect(parseFirstPathWrite({ skip: "drop table" })).toBeNull();
    expect(parseFirstPathWrite({ unskip: "invite" })).toEqual({ kind: "unskip", step: "invite" });
    expect(parseFirstPathWrite({ funded: true })).toEqual({ kind: "funded" });
    expect(parseFirstPathWrite({ funded: "yes" })).toBeNull();
    expect(parseFirstPathWrite({ invited: true })).toEqual({ kind: "invited" });
    expect(parseFirstPathWrite({ finish: true })).toEqual({ kind: "finish" });
  });
});

describe("firstPathWriteAllowed", () => {
  it("allows a person's handful of writes an hour and stops a loop, per account", async () => {
    const id = await user();
    const other = await user();
    const at = new Date("2026-10-02T10:15:00Z");
    for (let i = 0; i < FIRST_PATH_WRITES_PER_HOUR; i++) expect(await firstPathWriteAllowed(id, at)).toBe(true);
    expect(await firstPathWriteAllowed(id, at)).toBe(false);
    expect(await firstPathWriteAllowed(other, at)).toBe(true);
    // A new hour, a new allowance.
    expect(await firstPathWriteAllowed(id, new Date("2026-10-02T11:00:00Z"))).toBe(true);
  });
});
