import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { setBlock } from "./blocks";
import { NOT_FOUND } from "./cards";
import { friendAction, friendLink } from "./friends";
import { setHandle, setShareHoldings, setVisible } from "./handles";
import { runSocialOp } from "./ops";
import { arrangeMoments, MOMENTS_MAX, MUTUAL_FACES } from "./profile-more";
import { setSalute } from "./salutes";
import type { SocialViewer } from "./people";
import type { CardAnswer } from "@/lib/social-types";

/**
 * The profile page's extras (profile-more) against the real schema
 * (PGlite): what each viewer is sent beside the card, and that a card that
 * cannot be shown carries nothing at all.
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

type Person = SocialViewer & { name: string };

let n = 0;
async function person(name: string, { createdAt = "2026-09-01T08:00:00Z" }: { createdAt?: string } = {}): Promise<Person> {
  n += 1;
  const rows = (await sql.query(`insert into users (privy_did, email, created_at) values ($1, $2, $3::timestamptz) returning id`, [
    `did:privy:more${n}`,
    `more${n}@example.com`,
    createdAt,
  ])) as { id: string }[];
  const viewer = { id: rows[0].id, email: `more${n}@example.com`, name };
  const set = await setHandle(viewer, name);
  if (!set.ok) throw new Error(`could not name ${name}: ${set.reason}`);
  return viewer;
}

/** An XP event on a given day, and the account's total kept in step as the award path keeps it. */
async function earn(who: Person, kind: string, amount: number, at: string) {
  await sql.query(`insert into xp_events (user_id, kind, amount, ref, created_at) values ($1, $2, $3, $4, $5::timestamptz)`, [
    who.id,
    kind,
    amount,
    `${kind}:${who.id}:${at}`,
    at,
  ]);
  await sql.query(`update users set xp = (select coalesce(sum(amount), 0) from xp_events where user_id = $1) where id = $1`, [who.id]);
}

async function befriend(a: Person, b: Person) {
  await friendAction(a, "request", { handle: b.name });
  await friendAction(b, "accept", { handle: a.name });
}

/** The page's own read: the `card` operation, as the browser asks it. */
async function page(viewer: Person, handle: string): Promise<CardAnswer> {
  const result = await runSocialOp("card", { handle }, { viewer, anonKey: "x" });
  expect(result.status).toBe(200);
  return result.body as CardAnswer;
}

const xpOf = async (who: Person) => Number(((await sql.query(`select xp from users where id = $1`, [who.id])) as { xp: number }[])[0].xp);

describe("the profile page's extras", () => {
  it("give a stranger only their own XP beside the card: no moments, nothing between friends", async () => {
    const viewer = await person("more_view");
    const target = await person("more_target");
    await earn(viewer, "pour_in", 100, "2026-09-10T10:00:00Z");
    const answer = await page(viewer, "more_target");
    expect(answer.found && answer.more).toEqual({ yourXp: await xpOf(viewer) });
    expect(answer.found && answer.card.xp).toBe(await xpOf(target));
  });

  it("are not on Find a friend's answer, nor on an action's", async () => {
    const viewer = await person("more_finder");
    await person("more_found");
    const found = (await runSocialOp("find", { handle: "more_found" }, { viewer, anonKey: "x" })).body as CardAnswer;
    expect(found.found && "more" in found).toBe(false);
    const saluted = (await runSocialOp("salute", { handle: "more_found", on: true }, { viewer, anonKey: "x" })).body as CardAnswer;
    expect(saluted.found && "more" in saluted).toBe(false);
  });

  it("ride a friend link's card too", async () => {
    const viewer = await person("more_linkee");
    const owner = await person("more_linker");
    const token = await friendLink(owner);
    const answer = (await runSocialOp("link-card", { token }, { viewer, anonKey: "x" })).body as CardAnswer;
    expect(answer.found && answer.more?.yourXp).toBe(await xpOf(viewer));
  });

  it("leave out the comparison on the viewer's own card", async () => {
    const me = await person("more_self");
    const answer = await page(me, "more_self");
    expect(answer.found && answer.more?.yourXp).toBeUndefined();
  });

  it("never ride a card that cannot be shown: hidden, blocked and blocking are the one NOT_FOUND", async () => {
    const viewer = await person("more_wall");
    const hidden = await person("more_hidden");
    await befriend(viewer, hidden);
    await setVisible(hidden, false);
    expect(await page(viewer, "more_hidden")).toEqual(NOT_FOUND);

    const blocker = await person("more_blocker");
    await befriend(viewer, blocker);
    await setBlock(blocker, "more_wall", true);
    expect(await page(viewer, "more_blocker")).toEqual(NOT_FOUND);

    const blocked = await person("more_blocked");
    await befriend(viewer, blocked);
    await setBlock(viewer, "more_blocked", true);
    expect(await page(viewer, "more_blocked")).toEqual(NOT_FOUND);
    expect(await page(viewer, "no_such_name")).toEqual(NOT_FOUND);
  });

  it("take the same place in the hour as any card", async () => {
    const viewer = await person("more_counter");
    await person("more_counted");
    for (let i = 0; i < 30; i++) await page(viewer, "more_counted");
    expect((await runSocialOp("card", { handle: "more_counted" }, { viewer, anonKey: "x" })).status).toBe(429);
  });
});

describe("moments", () => {
  it("between friends: the rungs reached since, the day they became friends, the Salutes either way and the month they joined, newest first", async () => {
    const viewer = await person("mo_view");
    const friend = await person("mo_friend", { createdAt: "2026-07-14T08:00:00Z" });
    // username_set (25) on naming; then a buy and a sell take them past Slip (100) and Berth Holder (250).
    await earn(friend, "pour_in", 100, "2026-09-03T15:30:00Z");
    await earn(friend, "pour_out", 150, "2026-09-21T09:10:00Z");
    await befriend(viewer, friend);
    await sql.query(`update friends set since = '2026-09-10T00:00:00Z' where a_id = least($1::uuid, $2::uuid) and b_id = greatest($1::uuid, $2::uuid)`, [
      viewer.id,
      friend.id,
    ]);
    await setSalute(friend, "mo_view", true);
    await setSalute(viewer, "mo_friend", true);
    const answer = await page(viewer, "mo_friend");
    const today = new Date().toISOString().slice(0, 10);
    // Slip on 3 September came before the friendship (10 September): not said.
    expect(answer.found && answer.more?.moments).toEqual([
      { kind: "salute", from: "them", on: today },
      { kind: "salute", from: "you", on: today },
      { kind: "rank", level: 3, on: "2026-09-21" },
      { kind: "friends", on: "2026-09-10" },
      { kind: "joined", month: "2026-07" },
    ]);
  });

  it("say no rung reached before the two became friends", async () => {
    const viewer = await person("mo_before_v");
    const friend = await person("mo_before_f");
    await earn(friend, "pour_in", 100, "2026-09-03T15:30:00Z");
    await befriend(viewer, friend);
    const answer = await page(viewer, "mo_before_f");
    expect(answer.found && answer.more?.moments?.some((moment) => moment.kind === "rank")).toBe(false);
  });

  it("carry days and kinds only: no amount, no kind of XP, no time of day, no order", async () => {
    const viewer = await person("mo_plain");
    const friend = await person("mo_plain_f");
    await earn(friend, "pour_in", 100, "2026-09-03T15:30:00Z");
    await befriend(viewer, friend);
    const text = JSON.stringify(await page(viewer, "mo_plain_f"));
    expect(text).not.toMatch(/pour_|amount|T15:30|usd|intent|quantity/);
  });

  it("never name a Salute from anyone else, nor show one taken back", async () => {
    const viewer = await person("mo_only");
    const friend = await person("mo_only_f");
    const other = await person("mo_other");
    await befriend(viewer, friend);
    await setSalute(other, "mo_only_f", true);
    await setSalute(viewer, "mo_only_f", true);
    await setSalute(viewer, "mo_only_f", false);
    const answer = await page(viewer, "mo_only_f");
    expect(answer.found && answer.more?.moments?.filter((moment) => moment.kind === "salute")).toEqual([]);
    expect(JSON.stringify(answer)).not.toContain("mo_other");
  });

  it("are not on a stranger's card, nor on someone who asked or was asked", async () => {
    const viewer = await person("mo_stranger_v");
    const asked = await person("mo_asked");
    await earn(asked, "pour_in", 100, "2026-09-03T15:30:00Z");
    await friendAction(viewer, "request", { handle: "mo_asked" });
    const answer = await page(viewer, "mo_asked");
    expect(answer.found && answer.viewer.relation).toBe("sent");
    expect(answer.found && answer.more).toEqual({ yourXp: await xpOf(viewer) });
    expect(await page(asked, "mo_stranger_v")).toMatchObject({ found: true, more: { yourXp: await xpOf(asked) } });
    const received = await page(asked, "mo_stranger_v");
    expect(received.found && received.more?.moments).toBeUndefined();
  });

  it("on the viewer's own card: their rungs and the month they joined, no Salutes", async () => {
    const me = await person("mo_self", { createdAt: "2026-08-02T08:00:00Z" });
    const fan = await person("mo_fan");
    await earn(me, "pour_in", 100, "2026-09-05T10:00:00Z");
    await setSalute(fan, "mo_self", true);
    const answer = await page(me, "mo_self");
    expect(answer.found && answer.more?.moments).toEqual([
      { kind: "rank", level: 2, on: "2026-09-05" },
      { kind: "joined", month: "2026-08" },
    ]);
  });

  it("stop with the friendship: a removed friend is a stranger again", async () => {
    const viewer = await person("mo_gone_v");
    const friend = await person("mo_gone_f");
    await befriend(viewer, friend);
    await friendAction(viewer, "remove", { handle: "mo_gone_f" });
    const answer = await page(viewer, "mo_gone_f");
    expect(answer.found && answer.more?.moments).toBeUndefined();
  });

  it(`hold at ${MOMENTS_MAX}, the month they joined always last`, () => {
    const dated = Array.from({ length: 9 }, (_, index) => ({ kind: "rank" as const, level: index + 2, on: `2026-09-${String(10 + index).padStart(2, "0")}` }));
    const arranged = arrangeMoments(dated, "2026-08");
    expect(arranged).toHaveLength(MOMENTS_MAX);
    expect(arranged.map((moment) => (moment.kind === "rank" ? moment.level : moment.kind))).toEqual([10, 9, 8, 7, "joined"]);
  });
});

describe("in common", () => {
  it("between friends: the day they became friends and the friends both have, faces only, never XP", async () => {
    const viewer = await person("ic_view");
    const friend = await person("ic_friend");
    await befriend(viewer, friend);
    const shared = await Promise.all(["ic_m_a", "ic_m_b", "ic_m_c", "ic_m_d", "ic_m_e", "ic_m_f"].map((name) => person(name)));
    for (const one of shared) {
      await befriend(viewer, one);
      await befriend(friend, one);
    }
    await earn(shared[0], "pour_in", 100, "2026-09-03T15:30:00Z");
    // Only the viewer's friend, or only theirs: not in common.
    const onlyMine = await person("ic_only_mine");
    await befriend(viewer, onlyMine);
    const onlyTheirs = await person("ic_only_theirs");
    await befriend(friend, onlyTheirs);
    const answer = await page(viewer, "ic_friend");
    if (!answer.found || !answer.more) throw new Error("no card");
    expect(answer.more.friendsSince).toBe(new Date().toISOString().slice(0, 10));
    expect(answer.more.mutual).toEqual({
      faces: [
        { handle: "ic_m_a", avatarId: null, level: 2 },
        { handle: "ic_m_b", avatarId: null, level: 1 },
        { handle: "ic_m_c", avatarId: null, level: 1 },
        { handle: "ic_m_d", avatarId: null, level: 1 },
      ],
      more: 6 - MUTUAL_FACES,
    });
    const text = JSON.stringify(answer.more.mutual);
    expect(text).not.toMatch(/"xp"|ic_only/);
  });

  it("leaves out a friend in common whose card is off, and counts only those it shows", async () => {
    const viewer = await person("ic_hid_v");
    const friend = await person("ic_hid_f");
    await befriend(viewer, friend);
    const shown = await person("ic_hid_shown");
    const hidden = await person("ic_hid_hidden");
    for (const one of [shown, hidden]) {
      await befriend(viewer, one);
      await befriend(friend, one);
    }
    await setVisible(hidden, false);
    const answer = await page(viewer, "ic_hid_f");
    expect(answer.found && answer.more?.mutual).toEqual({ faces: [{ handle: "ic_hid_shown", avatarId: null, level: 1 }], more: 0 });
  });

  it("is said to friends only: a stranger, a request or a removed friend learns no one's friends", async () => {
    const viewer = await person("ic_str_v");
    const target = await person("ic_str_t");
    const both = await person("ic_str_both");
    await befriend(viewer, both);
    await befriend(target, both);
    const stranger = await page(viewer, "ic_str_t");
    expect(stranger.found && stranger.more).toEqual({ yourXp: await xpOf(viewer) });
    await friendAction(viewer, "request", { handle: "ic_str_t" });
    const asked = await page(target, "ic_str_v");
    expect(asked.found && asked.viewer.relation).toBe("received");
    expect(asked.found && asked.more).toEqual({ yourXp: await xpOf(target) });
  });

  describe("you both hold", () => {
    const NOW = new Date();
    const today = NOW.toISOString().slice(0, 10);
    const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString().slice(0, 10);
    async function holdsOn(who: Person, symbols: string[], day = today) {
      await sql.query(
        `insert into portfolio_days (user_id, day, value_usd, holdings, source, as_of) values ($1, $2::date, 1, $3::jsonb, 'snapshot', now())
         on conflict (user_id, day) do update set holdings = excluded.holdings`,
        [who.id, day, JSON.stringify(symbols.map((symbol) => ({ symbol, quantity: 2, price: 100, source: "mark" })))],
      );
    }

    it("names the listings both hold, only when both share, never an amount", async () => {
      const viewer = await person("hold_v");
      const friend = await person("hold_f");
      await befriend(viewer, friend);
      await holdsOn(viewer, ["NVDA", "AAPL", "TSLA"]);
      await holdsOn(friend, ["AAPL", "NVDA", "QQQ"]);

      const neither = await page(viewer, "hold_f");
      expect(neither.found && neither.more?.bothHold).toBeUndefined();

      await setShareHoldings(viewer, true);
      const onlyMine = await page(viewer, "hold_f");
      expect(onlyMine.found && onlyMine.more?.bothHold).toBeUndefined();

      await setShareHoldings(friend, true);
      const both = await page(viewer, "hold_f");
      expect(both.found && both.more?.bothHold).toEqual(["NVDA", "AAPL"]);
      expect(JSON.stringify(both)).not.toMatch(/quantity|price|value_usd|"100"|:100\b/);

      await setShareHoldings(viewer, false);
      const mineOff = await page(viewer, "hold_f");
      expect(mineOff.found && mineOff.more?.bothHold).toBeUndefined();
    });

    it("holds to the same staleness as Your friends hold, on both sides", async () => {
      const viewer = await person("stale_v");
      const friend = await person("stale_f");
      await befriend(viewer, friend);
      await setShareHoldings(viewer, true);
      await setShareHoldings(friend, true);
      await holdsOn(friend, ["NVDA"]);
      await holdsOn(viewer, ["NVDA"], daysAgo(5));
      const old = await page(viewer, "stale_f");
      expect(old.found && old.more?.bothHold).toBeUndefined();
      await holdsOn(viewer, ["NVDA"]);
      const fresh = await page(viewer, "stale_f");
      expect(fresh.found && fresh.more?.bothHold).toEqual(["NVDA"]);
    });

    it("is never on a stranger's card, even when both share", async () => {
      const viewer = await person("hold_str_v");
      const other = await person("hold_str_o");
      for (const one of [viewer, other]) {
        await setShareHoldings(one, true);
        await holdsOn(one, ["NVDA"]);
      }
      const answer = await page(viewer, "hold_str_o");
      expect(answer.found && answer.more?.bothHold).toBeUndefined();
      expect(answer.found && answer.holds).toBeUndefined();
    });
  });
});

describe("Salutes between the two", () => {
  it("count the standing Salutes either way, for friends only", async () => {
    const viewer = await person("sb_view");
    const friend = await person("sb_friend");
    await befriend(viewer, friend);
    const count = async () => {
      const answer = await page(viewer, "sb_friend");
      return answer.found ? answer.more?.salutesBetween : "not found";
    };
    expect(await count()).toBe(0);
    await runSocialOp("salute", { handle: "sb_friend", on: true }, { viewer, anonKey: "x" });
    expect(await count()).toBe(1);
    await setSalute(friend, "sb_view", true);
    expect(await count()).toBe(2);
    // One each at most: saluting again changes nothing.
    await setSalute(viewer, "sb_friend", true);
    expect(await count()).toBe(2);
    await setSalute(viewer, "sb_friend", false);
    expect(await count()).toBe(1);

    const stranger = await person("sb_stranger");
    await setSalute(stranger, "sb_view", true);
    const theirs = await page(viewer, "sb_stranger");
    expect(theirs.found && theirs.more?.salutesBetween).toBeUndefined();
  });

  it("keep the Salute's own hourly limit", async () => {
    const viewer = await person("sb_limit");
    await person("sb_limit_t");
    const salute = (on: boolean) => runSocialOp("salute", { handle: "sb_limit_t", on }, { viewer, anonKey: "x" });
    for (let i = 0; i < 60; i++) expect((await salute(i % 2 === 0)).status).toBe(200);
    expect((await salute(true)).status).toBe(429);
  });
});
