import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { bindReferral, getOrCreateUser } from "./accounts";
import { chooseSurvivor, mergeAccounts, planMerge } from "./account-merge";

/**
 * Phase 3 against the real schema: the one merge transaction
 * (merge_accounts in db/schema.sql) moves everything the absorbed account
 * owns, sums XP afresh without paying a once per account kind twice, keeps
 * the survivor's home and referrer, merges the social graph without
 * duplicates, revokes the absorbed assistants, audits both rows, and is
 * safe to run again, whether it finished or failed half way.
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
const evm = () => `0x${(++n).toString(16).padStart(40, "a")}`;
const q = async <T,>(text: string, params: unknown[] = []) => (await sql.query(text, params)) as T[];
const one = async <T,>(text: string, params: unknown[] = []) => (await q<T>(text, params))[0];

type Seed = { email?: string | null; did?: string | null; wallet?: string | null; createdAt?: string; code?: string };

/** A users row with its identities, as phases 1 and 2 leave them. */
async function account(seed: Seed = {}): Promise<string> {
  const wallet = seed.wallet === undefined ? evm() : seed.wallet;
  const row = await one<{ id: string }>(
    `insert into users (privy_did, wallet_address, email, created_at, referral_code)
     values ($1, $2, $3, coalesce($4::timestamptz, now()), $5) returning id`,
    [seed.did ?? null, wallet, seed.email ?? null, seed.createdAt ?? null, seed.code ?? null],
  );
  if (wallet) {
    await q(
      `insert into user_identities (user_id, kind, value, family, is_home, proof) values ($1, 'wallet', $2, 'evm', true, 'siwe')`,
      [row.id, `eip155:${wallet}`],
    );
  }
  if (seed.email) {
    await q(`insert into user_identities (user_id, kind, value, is_primary, proof) values ($1, 'email', $2, true, 'privy_email')`, [
      row.id,
      seed.email.toLowerCase(),
    ]);
  }
  return row.id;
}

async function xp(userId: string, kind: string, amount: number, ref: string | null = null) {
  await q(`insert into xp_events (user_id, kind, amount, ref) values ($1, $2, $3, $4)`, [userId, kind, amount, ref]);
  await q(`update users set xp = (select coalesce(sum(amount), 0) from xp_events where user_id = $1) where id = $1`, [userId]);
}

async function order(userId: string, placedAt: string): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into orders (user_id, intent_tx, direction, listing_symbol, listing_address, quantity, placed_at)
     values ($1, $2, 'buy', 'NVDA', '0xnvda', 1, $3::timestamptz) returning id`,
    [userId, `0xintent${++n}`, placedAt],
  );
  await q(`insert into order_marks (order_id, symbol, price) values ($1, 'SPY', 500)`, [row.id]);
  return row.id;
}

async function day(userId: string, isoDay: string, value: number) {
  await q(
    `insert into portfolio_days (user_id, day, value_usd, source, as_of) values ($1, $2::date, $3, 'snapshot', $2::timestamptz)`,
    [userId, isoDay, value],
  );
}

const pair = (x: string, y: string) => (x < y ? [x, y] : [y, x]);
async function befriend(x: string, y: string) {
  const [a, b] = pair(x, y);
  await q(`insert into friends (a_id, b_id) values ($1, $2)`, [a, b]);
}
const friendsOf = async (id: string) =>
  (
    await q<{ other: string }>(
      `select case when a_id = $1 then b_id else a_id end as other from friends where a_id = $1 or b_id = $1`,
      [id],
    )
  )
    .map((row) => row.other)
    .sort();

async function handle(userId: string, name: string) {
  await q(`insert into handles (user_id, handle, handle_norm) values ($1, $2, $2)`, [userId, name]);
  await q(`insert into profiles (user_id) values ($1)`, [userId]);
}

describe("who stays", () => {
  const party = (id: string, hasEmail: boolean, createdAt: string) => ({ id, hasEmail, createdAt, retired: false });

  it("the account with a verified email, however young", () => {
    expect(chooseSurvivor(party("a", false, "2026-01-01"), party("b", true, "2026-09-01"))).toBe("b");
    expect(chooseSurvivor(party("a", true, "2026-09-01"), party("b", false, "2026-01-01"))).toBe("a");
  });

  it("the older one when both or neither have an email, then the lower id", () => {
    expect(chooseSurvivor(party("a", true, "2026-09-01"), party("b", true, "2026-01-01"))).toBe("b");
    expect(chooseSurvivor(party("a", false, "2026-01-01"), party("b", false, "2026-09-01"))).toBe("a");
    expect(chooseSurvivor(party("b", false, "2026-01-01"), party("a", false, "2026-01-01"))).toBe("a");
  });

  it("planMerge reads the rule from the rows and counts the XP the survivor will hold", async () => {
    const wallet = await account({ createdAt: "2026-01-01" });
    const email = await account({ email: "plan@example.com", did: "did:plan", createdAt: "2026-09-01" });
    await xp(wallet, "account_created", 25);
    await xp(wallet, "pour_in", 100, "0xplan1");
    await xp(email, "account_created", 25);
    await xp(email, "email_linked", 50);
    const plan = (await planMerge(wallet, email))!;
    expect(plan).toMatchObject({ survivor: email, absorbed: wallet, requesterSurvives: false });
    // 25 + 50 + 100: the wallet's account_created is not paid twice.
    expect(plan.together.xp).toBe(175);
    expect(await planMerge(wallet, wallet)).toBeNull();
  });
});

describe("the merge transaction", () => {
  it("moves everything the absorbed account owns, once", async () => {
    const referrerS = await account();
    const referrerA = await account();
    const s = await account({ email: "keep@example.com", did: "did:s", createdAt: "2026-08-01" });
    const aWallet = evm();
    const a = await account({ wallet: aWallet, did: "did:a", createdAt: "2026-07-01", code: "ABSORB" });
    await q(`update users set referred_by = $2 where id = $1`, [s, referrerS]);
    await q(`update users set referred_by = $2 where id = $1`, [a, referrerA]);
    const invitedByA = await account();
    await q(`update users set referred_by = $2 where id = $1`, [invitedByA, a]);
    const sHome = (await one<{ wallet_address: string }>(`select wallet_address from users where id = $1`, [s])).wallet_address;

    // XP: both have account_created; A's avatar_set and its orders move.
    await xp(s, "account_created", 25);
    await xp(s, "email_linked", 50);
    await xp(s, "pour_in", 100, "0xs-order");
    await xp(a, "account_created", 25);
    await xp(a, "avatar_set", 10);
    await xp(a, "pour_in", 100, "0xa-order");
    await xp(a, "friend_poured", 250, invitedByA);

    // The ledger.
    await order(s, "2026-09-01T15:00:00Z");
    const aOrder = await order(a, "2026-09-10T15:00:00Z");
    await q(
      `insert into limit_orders (user_id, intent_tx, direction, listing_symbol, listing_address, input_raw, input_decimals, min_output_raw, output_decimals, limit_price)
       values ($1, '0xlimit-a', 'buy', 'NVDA', '0xnvda', 1, 6, 1, 18, 100)`,
      [a],
    );
    await q(`insert into pour_claims (intent_tx, user_id, direction) values ('0xclaim-a', $1, 'buy')`, [a]);
    await q(
      `insert into chat_usage (user_id, provider, model, steps, input_tokens, output_tokens, cost_micros, ok, duration_ms)
       values ($1, 'openai', 'luna', 1, 10, 10, 5, true, 100)`,
      [a],
    );

    // Portfolio days: nothing is deleted; A's stay on A, the history adds them in.
    await day(s, "2026-09-02", 100);
    await day(s, "2026-09-12", 120);
    await day(a, "2026-09-11", 80);

    // Assistants.
    const grant = await one<{ id: string }>(
      `insert into oauth_grants (user_id, client_id, scope) values ($1, 'claude', 'berth.read') returning id`,
      [a],
    );
    await q(`insert into oauth_tokens (token_hash, grant_id, kind, expires_at) values ('h1', $1, 'access', now() + interval '1 hour')`, [grant.id]);
    await q(
      `insert into oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, expires_at)
       values ('c1', 'claude', $1, 'https://x', 'ch', 'berth.read', now() + interval '2 minutes')`,
      [a],
    );
    await q(`insert into mcp_calls (user_id, grant_id, tool, ok, duration_ms) values ($1, $2, 'get_account', true, 5)`, [a, grant.id]);

    // Social.
    await handle(s, "keeper");
    await handle(a, "joiner");
    const f1 = await account();
    const f2 = await account();
    await befriend(a, f1);
    await befriend(a, f2);
    await befriend(s, f2);
    await befriend(a, s);
    const x = await account();
    const y = await account();
    await q(`insert into salutes (giver_id, recipient_id, first_at) values ($1, $2, '2026-08-01')`, [a, x]);
    await q(`insert into salutes (giver_id, recipient_id, first_at, revoked_at) values ($1, $2, '2026-09-01', now())`, [s, x]);
    await q(`insert into salutes (giver_id, recipient_id) values ($1, $2)`, [y, a]);
    await q(`insert into salutes (giver_id, recipient_id) values ($1, $2)`, [y, s]);
    await q(`insert into salutes (giver_id, recipient_id) values ($1, $2)`, [a, s]);
    const blockedByA = await account();
    await q(`insert into blocks (blocker_id, blocked_id, handle_snapshot, handle_norm) values ($1, $2, 'pest', 'pest')`, [a, blockedByA]);
    const blocksA = await account();
    await befriend(blocksA, s);
    await q(`insert into blocks (blocker_id, blocked_id, handle_snapshot, handle_norm) values ($1, $2, 'joiner', 'joiner')`, [blocksA, a]);
    const asked = await account();
    await q(`insert into friend_requests (from_id, to_id) values ($1, $2)`, [a, asked]);
    await q(`insert into friend_links (token, user_id) values ('link-a', $1)`, [a]);

    const plan = (await planMerge(a, s))!;
    expect(plan.survivor).toBe(s);
    const result = await mergeAccounts({ survivor: plan.survivor, absorbed: plan.absorbed, reason: "email" });
    expect(result).toMatchObject({ ok: true, survivor: s, absorbed: a, again: false });
    if (!result.ok) throw new Error("merge failed");
    expect(result.moved).toMatchObject({
      identities: 1,
      orders: 1,
      limitOrders: 1,
      pourClaims: 1,
      chatUsage: 1,
      mcpCalls: 1,
      xpEvents: 3,
      xpEventsKept: 1,
      referrals: 1,
      grantsRevoked: 1,
      survivorXp: 25 + 50 + 100 + 10 + 100 + 250,
    });

    // The survivor: XP summed from its events, its home and referrer kept.
    const sAfter = await one<{ xp: number; wallet_address: string; referred_by: string; portfolio_rebuild_at: string | null }>(
      `select xp, wallet_address, referred_by, portfolio_rebuild_at from users where id = $1`,
      [s],
    );
    expect(sAfter).toMatchObject({ xp: 535, wallet_address: sHome, referred_by: referrerS });
    expect(sAfter.portfolio_rebuild_at).not.toBeNull();
    expect((await one<{ total: number }>(`select sum(amount)::int as total from xp_events where user_id = $1`, [s])).total).toBe(535);
    expect(await q(`select kind from xp_events where user_id = $1`, [a])).toEqual([{ kind: "account_created" }]);

    // Identities: A's wallet is a linked, non home wallet of S.
    expect(
      await q(`select value, is_home, is_primary from user_identities where user_id = $1 order by kind, is_home desc`, [s]),
    ).toEqual([
      { value: "keep@example.com", is_home: false, is_primary: true },
      { value: `eip155:${sHome}`, is_home: true, is_primary: false },
      { value: `eip155:${aWallet}`, is_home: false, is_primary: false },
    ]);
    expect(await q(`select 1 from user_identities where user_id = $1`, [a])).toEqual([]);

    // The absorbed row: retired, not deleted, nothing left to sign in with.
    expect(
      await one(`select retired_into, privy_did, wallet_address, email, referred_by, xp from users where id = $1`, [a]),
    ).toEqual({ retired_into: s, privy_did: "merged:did:a", wallet_address: null, email: null, referred_by: null, xp: 25 });

    // The ledger followed; order_marks follow their order.
    expect(await q(`select user_id from orders where id = $1`, [aOrder])).toEqual([{ user_id: s }]);
    expect(await q(`select order_id from order_marks where order_id = $1`, [aOrder])).toHaveLength(1);
    for (const table of ["limit_orders", "pour_claims", "chat_usage", "mcp_calls"]) {
      expect(await q(`select 1 from ${table} where user_id = $1`, [a])).toEqual([]);
      expect((await q(`select 1 from ${table} where user_id = $1`, [s])).length).toBeGreaterThan(0);
    }
    expect(await q(`select to_char(day, 'YYYY-MM-DD') as day from portfolio_days where user_id = $1 order by day`, [s])).toEqual([
      { day: "2026-09-02" },
      { day: "2026-09-12" },
    ]);
    expect(await q(`select to_char(day, 'YYYY-MM-DD') as day from portfolio_days where user_id = $1`, [a])).toEqual([{ day: "2026-09-11" }]);

    // Referrals: A's invitee is S's now; A's own referrer is dropped; A's code names S.
    expect(await one(`select referred_by from users where id = $1`, [invitedByA])).toEqual({ referred_by: s });
    const newcomer = await account();
    expect(await bindReferral(newcomer, "ABSORB")).toBe(s);

    // Assistants of A: revoked, with their tokens and codes.
    expect((await one<{ revoked_at: string | null }>(`select revoked_at from oauth_grants where id = $1`, [grant.id])).revoked_at).not.toBeNull();
    expect((await one<{ revoked_at: string | null }>(`select revoked_at from oauth_tokens where token_hash = 'h1'`)).revoked_at).not.toBeNull();
    expect((await one<{ used_at: string | null }>(`select used_at from oauth_codes where code_hash = 'c1'`)).used_at).not.toBeNull();

    // Usernames: S keeps its own; A's is held for S for 90 days.
    expect(await q(`select handle from handles where user_id in ($1, $2)`, [s, a])).toEqual([{ handle: "keeper" }]);
    const held = await one<{ user_id: string; days: number }>(
      `select user_id, round(extract(epoch from until - now()) / 86400)::int as days from handle_reserved where handle_norm = 'joiner'`,
    );
    expect(held).toEqual({ user_id: s, days: 90 });

    // Friends without duplicates or a friendship with oneself; the one who
    // blocked A blocks S now, and their friendship with S ended.
    expect(await friendsOf(s)).toEqual([f1, f2].sort());
    expect(await friendsOf(a)).toEqual([]);
    expect(await q(`select blocker_id from blocks where blocked_id = $1`, [s])).toEqual([{ blocker_id: blocksA }]);
    expect(await q(`select blocked_id from blocks where blocker_id = $1`, [s])).toEqual([{ blocked_id: blockedByA }]);
    expect(await q(`select 1 from blocks where blocker_id = $1 or blocked_id = $1`, [a])).toEqual([]);

    // Salutes: S's revoked one to X is live again from A's, dated the earlier;
    // Y saluted both, one row stays; A's salute of S is gone.
    expect(
      await one(`select revoked_at, to_char(first_at, 'YYYY-MM-DD') as first from salutes where giver_id = $1 and recipient_id = $2`, [s, x]),
    ).toEqual({ revoked_at: null, first: "2026-08-01" });
    expect(await q(`select giver_id from salutes where recipient_id = $1`, [s])).toEqual([{ giver_id: y }]);
    expect(await q(`select 1 from salutes where giver_id = $1 or recipient_id = $1`, [a])).toEqual([]);

    // Requests move; the friend link stops.
    expect(await q(`select from_id, status from friend_requests where to_id = $1`, [asked])).toEqual([{ from_id: s, status: "pending" }]);
    expect((await one<{ revoked_at: string | null }>(`select revoked_at from friend_links where token = 'link-a'`)).revoked_at).not.toBeNull();

    // Audit on both rows, and the merge row.
    const audit = await q<{ user_id: string; detail: { role: string; otherUserId: string } }>(
      `select user_id, detail from account_audit where action = 'account_merged' and user_id in ($1, $2) order by id`,
      [s, a],
    );
    expect(audit.map((row) => [row.user_id, row.detail.role, row.detail.otherUserId])).toEqual([
      [s, "survivor", a],
      [a, "absorbed", s],
    ]);
    expect(await one(`select status, reason from account_merges where absorbed_id = $1`, [a])).toEqual({ status: "done", reason: "email" });

    // Every way in to A now reaches S.
    expect((await getOrCreateUser({ did: null, wallet: aWallet }))!.user.id).toBe(s);
    expect((await getOrCreateUser({ did: "did:a", wallet: null }))!.user.id).toBe(s);

    // A retry changes nothing and answers the same counts.
    const again = await mergeAccounts({ survivor: s, absorbed: a, reason: "email" });
    expect(again).toMatchObject({ ok: true, again: true, moved: result.moved });
    expect((await one<{ xp: number }>(`select xp from users where id = $1`, [s])).xp).toBe(535);
    expect(await q(`select 1 from account_audit where action = 'account_merged' and user_id = $1`, [s])).toHaveLength(1);

    // Absorbed once, ever: into a third account it cannot go.
    const third = await account({ email: "third@example.com" });
    expect(await mergeAccounts({ survivor: third, absorbed: a, reason: "wallet" })).toEqual({ ok: false, reason: "taken" });
    expect(await planMerge(third, a)).toBeNull();
  });

  it("is all or nothing: a failure late in the transaction leaves every row where it was, and a retry finishes", async () => {
    const s = await account({ email: "late@example.com" });
    const a = await account();
    await xp(a, "account_created", 25);
    await xp(a, "pour_in", 100, "0xlate");
    const aOrder = await order(a, "2026-09-20T15:00:00Z");
    // The very last write of the function fails once.
    await q(`create table merge_fail_once (armed boolean)`);
    await q(`insert into merge_fail_once values (true)`);
    await q(`create or replace function merge_fail() returns trigger language plpgsql as $$
      begin if (select armed from merge_fail_once) and new.action = 'account_merged' then raise exception 'boom' using errcode = 'P0099'; end if; return new; end $$`);
    await q(`create trigger merge_fail before insert on account_audit for each row execute function merge_fail()`);

    const failed = await mergeAccounts({ survivor: s, absorbed: a, reason: "wallet" });
    expect(failed).toEqual({ ok: false, reason: "failed" });
    expect(await one(`select status, error from account_merges where absorbed_id = $1`, [a])).toEqual({ status: "failed", error: "P0099" });
    expect(await q(`select user_id from orders where id = $1`, [aOrder])).toEqual([{ user_id: a }]);
    expect(await one(`select retired_into, xp from users where id = $1`, [a])).toEqual({ retired_into: null, xp: 125 });
    expect(await q(`select 1 from user_identities where user_id = $1`, [a])).toHaveLength(1);

    await q(`update merge_fail_once set armed = false`);
    const retried = await mergeAccounts({ survivor: s, absorbed: a, reason: "wallet" });
    expect(retried).toMatchObject({ ok: true, again: false });
    expect(await q(`select user_id from orders where id = $1`, [aOrder])).toEqual([{ user_id: s }]);
    expect(await one(`select status, error from account_merges where absorbed_id = $1`, [a])).toEqual({ status: "done", error: null });
    await q(`drop trigger merge_fail on account_audit`);
  });

  it("a survivor with no username takes the absorbed one, card and all, with no hold", async () => {
    const s = await account({ email: "nameless@example.com" });
    const a = await account();
    await handle(a, "sailor");
    expect((await planMerge(a, s))!.usernameComes).toBe(true);
    expect((await mergeAccounts({ survivor: s, absorbed: a, reason: "email" })).ok).toBe(true);
    expect(await q(`select user_id from handles where handle_norm = 'sailor'`)).toEqual([{ user_id: s }]);
    expect(await q(`select user_id from profiles where user_id in ($1, $2)`, [s, a])).toEqual([{ user_id: s }]);
    expect(await q(`select 1 from handle_reserved where handle_norm = 'sailor'`)).toEqual([]);
  });

  it("a survivor with no home takes the absorbed home, so buys still land somewhere", async () => {
    const s = await account({ email: "nohome@example.com", did: "did:nohome", wallet: null });
    const aWallet = evm();
    const a = await account({ wallet: aWallet });
    const result = await mergeAccounts({ survivor: s, absorbed: a, reason: "email" });
    expect(result.ok).toBe(true);
    expect(await one(`select wallet_address from users where id = $1`, [s])).toEqual({ wallet_address: aWallet });
    expect(await q(`select value from user_identities where user_id = $1 and is_home`, [s])).toEqual([{ value: `eip155:${aWallet}` }]);
  });

  it("keeps every friendship even past the cap of 50; the cap then stops new ones", async () => {
    const s = await account({ email: "popular@example.com" });
    const a = await account();
    const many = await q<{ id: string }>(
      `insert into users (wallet_address) select '0x' || lpad(to_hex(g), 40, 'c') from generate_series(1, 51) g returning id`,
    );
    for (const friend of many.slice(0, 50)) await befriend(s, friend.id);
    await befriend(a, many[50].id);
    expect((await mergeAccounts({ survivor: s, absorbed: a, reason: "wallet" })).ok).toBe(true);
    expect(await friendsOf(s)).toHaveLength(51);
    const newcomer = await account();
    await expect(befriend(s, newcomer)).rejects.toThrow(/friends cap/);
  });

  it("a retired survivor is refused inside the transaction, and nothing moves", async () => {
    const other = await account({ email: "gone@example.com" });
    const s = await account({ email: "retired@example.com" });
    const a = await account();
    await q(`update users set retired_into = $2 where id = $1`, [s, other]);
    expect(await mergeAccounts({ survivor: s, absorbed: a, reason: "wallet" })).toEqual({ ok: false, reason: "failed" });
    expect(await one(`select status, error from account_merges where absorbed_id = $1`, [a])).toEqual({ status: "failed", error: "P0003" });
  });
});

describe("db:push", () => {
  it("applies the schema twice, split the way scripts/db-push.mjs splits it, merge function whole", async () => {
    const db = new PGlite();
    const statements = readFileSync(join(process.cwd(), "db/schema.sql"), "utf8")
      .split(/;\s*\n/)
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    expect(statements.some((statement) => statement.startsWith("-- The merge itself") && statement.endsWith("end $$"))).toBe(true);
    for (let round = 0; round < 2; round += 1) {
      for (const statement of statements) await db.query(statement);
    }
    await db.close();
  });
});

describe("XP that names an account", () => {
  const events = async (userId: string) =>
    (await q<{ kind: string; ref: string | null }>(`select kind, ref from xp_events where user_id = $1 order by kind, ref`, [userId])).map(
      (row) => `${row.kind}:${row.ref ?? "-"}`,
    );

  it("a ref naming the absorbed account is rewritten to the survivor, and stays behind when the survivor has it", async () => {
    const s = await account({ email: "themes@example.com" });
    const a = await account();
    await xp(s, "theme_tried", 10, `${s}:dark`);
    await xp(a, "theme_tried", 10, `${a}:dark`);
    await xp(a, "theme_tried", 10, `${a}:light`);
    const plan = (await planMerge(a, s))!;
    const result = await mergeAccounts({ survivor: s, absorbed: a, reason: "email" });
    if (!result.ok) throw new Error("merge failed");
    expect(await events(s)).toEqual([`theme_tried:${s}:dark`, `theme_tried:${s}:light`]);
    expect(await events(a)).toEqual([`theme_tried:${a}:dark`]);
    expect(result.moved.survivorXp).toBe(20);
    expect(plan.together.xp).toBe(20);
  });

  it("an account that invited the other: both sides' invite XP rests on the retired row", async () => {
    // A invited S: A was paid friend_poured for S, S was paid invite_accepted.
    const a = await account();
    const s = await account({ email: "invited@example.com" });
    await q(`update users set referred_by = $2 where id = $1`, [s, a]);
    await q(`update users set referred_by = $2 where id = $1`, [a, await account()]);
    await xp(s, "account_created", 25);
    await xp(s, "invite_accepted", 100);
    await xp(a, "account_created", 25);
    await xp(a, "invite_accepted", 100);
    await xp(a, "friend_poured", 250, s);
    const plan = (await planMerge(a, s))!;
    const result = await mergeAccounts({ survivor: s, absorbed: a, reason: "email" });
    if (!result.ok) throw new Error("merge failed");
    // S keeps its welcome and takes A's own invite XP (A was invited by someone else).
    expect(await events(s)).toEqual(["account_created:-", "invite_accepted:-"]);
    expect(await events(a)).toEqual(["account_created:-", `friend_poured:${s}`, `invite_accepted:self:${s}`]);
    expect(result.moved.survivorXp).toBe(125);
    expect(plan.together.xp).toBe(125);
  });

  it("the other way round: the survivor invited the absorbed account", async () => {
    const s = await account({ email: "inviter@example.com" });
    const a = await account();
    await q(`update users set referred_by = $2 where id = $1`, [a, s]);
    await xp(s, "friend_poured", 250, a);
    await xp(s, "pour_in", 100, "0xinviter");
    await xp(a, "invite_accepted", 100);
    await xp(a, "pour_in", 100, "0xinvitee");
    const plan = (await planMerge(a, s))!;
    const result = await mergeAccounts({ survivor: s, absorbed: a, reason: "email" });
    if (!result.ok) throw new Error("merge failed");
    expect(await events(s)).toEqual(["pour_in:0xinvitee", "pour_in:0xinviter"]);
    expect(await events(a)).toEqual([`friend_poured:${a}`, "invite_accepted:-"]);
    expect(result.moved.survivorXp).toBe(200);
    expect(plan.together.xp).toBe(200);
  });
});

describe("the smaller things", () => {
  it("records the survivor's own email as its primary identity when the backfill never did, and points reports at the survivor", async () => {
    const s = (await q<{ id: string }>(`insert into users (email, wallet_address) values ('legacy@example.com', $1) returning id`, [evm()]))[0].id;
    const a = await account({ email: "second@example.com" });
    await q(`update users set created_at = now() - interval '1 day' where id = $1`, [s]);
    const reporter = await account();
    await q(`insert into social_reports (reporter_id, target_id, handle_snapshot, reason) values ($1, $2, 'joiner', 'name')`, [reporter, a]);
    expect((await mergeAccounts({ survivor: s, absorbed: a, reason: "wallet" })).ok).toBe(true);
    expect(await q(`select value, is_primary from user_identities where user_id = $1 and kind = 'email' order by value`, [s])).toEqual([
      { value: "legacy@example.com", is_primary: true },
      { value: "second@example.com", is_primary: false },
    ]);
    expect(await q(`select target_id from social_reports where reporter_id = $1`, [reporter])).toEqual([{ target_id: s }]);
    expect(await one(`select proof_ref from account_merges where absorbed_id = $1`, [a])).toEqual({ proof_ref: null });
  });
});
