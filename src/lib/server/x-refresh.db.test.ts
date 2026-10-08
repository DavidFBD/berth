import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { forgetSettledSlots, refreshIfDue, type XJob, type XSearch } from "@/lib/server/x-refresh";
import { budgetSpent, readQueryStates, readStoredPosts, type StoredTweet } from "@/lib/server/x-store";
import { gatherPosts } from "@/lib/server/x-column";
import { MAX_RESULTS } from "@/lib/x-schedule";

/**
 * The X column's budget against the real schema: one fetch per slot however
 * many ask at once, every query asking only for what is newer than its last
 * post, the day's cap holding whatever the traffic, and readers other than
 * the column never reaching X at all.
 */

let sql: SqlClient;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ sql, close } = await makeTestDb());
  setSqlClient(sql);
  process.env.JEV_DISABLED = "1";
});

afterAll(async () => {
  setSqlClient(null);
  await close();
});

beforeEach(async () => {
  forgetSettledSlots();
  for (const table of ["x_posts", "x_queries", "x_fetch_slots", "x_read_budget"]) {
    await sql.query(`delete from ${table}`);
  }
});

const JOBS: XJob[] = [
  { key: "company", tier: "company", query: "(from:nvidia) -is:retweet" },
  { key: "press-0", tier: "press", query: "(from:Reuters) (NVIDIA) -is:retweet" },
  { key: "press-1", tier: "press", query: "(from:CNBC) (NVIDIA) -is:retweet" },
];

// Wednesday 30 September 2026, 10:00 New York: inside the 09:30 slot.
const WED_10AM = Date.parse("2026-09-30T14:00:00Z");
const MINUTE = 60_000;

let sequence = 0n;
/** An id as X makes them: the post's time in its top bits, so since_id's age reads true. */
function tweet(at: number, username = "nvidia"): StoredTweet {
  sequence += 1n;
  const nextId = ((BigInt(at) - 1_288_834_974_657n) << 22n) + (sequence % 4_000_000n);
  return {
    id: String(nextId),
    text: `NVIDIA reports record quarterly revenue ${nextId}`,
    created_at: new Date(at).toISOString(),
    author_id: username,
    public_metrics: { like_count: 10 },
    author: { id: username, name: username, username, profile_image_url: "https://pbs.twimg.com/a_normal.jpg" },
  };
}

/** A search that returns `perCall` new posts a call and remembers what it was asked. */
function fakeSearch(perCall = MAX_RESULTS) {
  const calls: { query: string; sinceId?: string; maxResults: number }[] = [];
  const search: XSearch = async (query, options) => {
    calls.push({ query, ...options });
    return Array.from({ length: Math.min(perCall, options.maxResults) }, () => tweet(WED_10AM - 30 * MINUTE));
  };
  return { search, calls };
}

describe("refreshIfDue", () => {
  it("makes one fetch per slot however many ask at once", async () => {
    const { search, calls } = fakeSearch();
    await Promise.all(
      Array.from({ length: 8 }, () => refreshIfDue({ now: WED_10AM, jobs: JOBS, search, cap: 1000 })),
    );
    expect(calls).toHaveLength(JOBS.length);
    // And again later in the same slot, from another instance: nothing.
    forgetSettledSlots();
    await refreshIfDue({ now: WED_10AM + 60 * MINUTE, jobs: JOBS, search, cap: 1000 });
    expect(calls).toHaveLength(JOBS.length);
    // The next slot (11:30) fetches again.
    await refreshIfDue({ now: WED_10AM + 95 * MINUTE, jobs: JOBS, search, cap: 1000 });
    expect(calls).toHaveLength(JOBS.length * 2);
  });

  it("asks each query only for what is newer than its last post, at ten a query", async () => {
    const { search, calls } = fakeSearch(3);
    await refreshIfDue({ now: WED_10AM, jobs: JOBS, search, cap: 1000 });
    expect(calls.every((call) => call.sinceId === undefined && call.maxResults === MAX_RESULTS)).toBe(true);
    const states = new Map((await readQueryStates()).map((state) => [state.key, state]));
    await refreshIfDue({ now: WED_10AM + 95 * MINUTE, jobs: JOBS, search, cap: 1000 });
    const second = calls.slice(JOBS.length);
    for (const call of second) {
      const job = JOBS.find((candidate) => candidate.query === call.query)!;
      expect(call.sinceId).toBe(states.get(job.key)!.sinceId);
      expect(call.sinceId).toBeDefined();
    }
    expect(await readStoredPosts(WED_10AM - 7 * 24 * 60 * MINUTE)).toHaveLength(18);
  });

  it("starts a query again when its text changes", async () => {
    const { search, calls } = fakeSearch(2);
    await refreshIfDue({ now: WED_10AM, jobs: JOBS, search, cap: 1000 });
    const changed = JOBS.map((job) => (job.key === "press-0" ? { ...job, query: `${job.query} lang:en` } : job));
    await refreshIfDue({ now: WED_10AM + 95 * MINUTE, jobs: changed, search, cap: 1000 });
    const again = calls.slice(JOBS.length);
    expect(again.find((call) => call.query.endsWith("lang:en"))!.sinceId).toBeUndefined();
    expect(again.filter((call) => call.sinceId !== undefined)).toHaveLength(2);
  });

  it("never reads past the day's cap, with every slot visited and the button pressed in each", async () => {
    const { search, calls } = fakeSearch();
    const cap = 50;
    // Every minute of the UTC day, a visit and a press.
    for (let now = Date.parse("2026-09-30T00:00:00Z"); now < Date.parse("2026-10-01T00:00:00Z"); now += 7 * MINUTE) {
      await refreshIfDue({ now, jobs: JOBS, search, cap });
      await refreshIfDue({ now, jobs: JOBS, search, cap, fresh: true });
    }
    expect(calls.length * MAX_RESULTS).toBeLessThanOrEqual(cap);
    expect(await budgetSpent("2026-09-30")).toBeLessThanOrEqual(cap);
    // Spread out, not spent by the first visitor: the day's first slot takes one request's worth.
    const [{ used }] = (await sql.query(`select used from x_read_budget where day = '2026-09-30'`)) as { used: number }[];
    expect(used).toBe(calls.length * MAX_RESULTS);
  });

  it("spreads the day's budget over the slots, the longest-waiting query first", async () => {
    const { search, calls } = fakeSearch();
    // 60 over six slots: one request a slot, rotating through the queries.
    for (const hhmm of ["11:00", "13:30", "15:30", "17:30", "19:30", "21:30"]) {
      await refreshIfDue({ now: Date.parse(`2026-09-30T${hhmm}:30Z`), jobs: JOBS, search, cap: 60 });
    }
    expect(calls.map((call) => JOBS.find((job) => job.query === call.query)!.key)).toEqual([
      "company",
      "press-0",
      "press-1",
      "company",
      "press-0",
      "press-1",
    ]);
  });

  it("lets the refresh button ask once more per slot, for one query, not moments after a fetch", async () => {
    const { search, calls } = fakeSearch();
    await refreshIfDue({ now: WED_10AM, jobs: JOBS, search, cap: 1000 });
    await refreshIfDue({ now: WED_10AM + 5 * MINUTE, jobs: JOBS, search, cap: 1000, fresh: true });
    expect(calls).toHaveLength(JOBS.length);
    await refreshIfDue({ now: WED_10AM + 20 * MINUTE, jobs: JOBS, search, cap: 1000, fresh: true });
    await refreshIfDue({ now: WED_10AM + 50 * MINUTE, jobs: JOBS, search, cap: 1000, fresh: true });
    expect(calls).toHaveLength(JOBS.length + 1);
  });

  it("never lets a refresh ask a query the slot's fetch is asking right now", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const asked: { key: string; fresh: boolean }[] = [];
    const { search: good } = fakeSearch();
    const slow = (fresh: boolean): XSearch => async (query, options) => {
      asked.push({ key: JOBS.find((job) => job.query === query)!.key, fresh });
      if (!fresh) await gate;
      return good(query, options);
    };
    // The day's first slot runs one query (60 over six slots), and stalls.
    const morning = Date.parse("2026-09-30T11:00:30Z");
    const slot = refreshIfDue({ now: morning, jobs: JOBS, search: slow(false), cap: 60 });
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    // A minute on, the button: nothing has finished, so it may ask, but not the same query.
    await refreshIfDue({ now: morning + MINUTE, jobs: JOBS, search: slow(true), cap: 60, fresh: true });
    release();
    await slot;
    const slotKeys = asked.filter((call) => !call.fresh).map((call) => call.key);
    const refreshKeys = asked.filter((call) => call.fresh).map((call) => call.key);
    expect(refreshKeys).toHaveLength(1);
    expect(slotKeys).not.toContain(refreshKeys[0]);
  });

  it("tries a failed slot once more, five minutes later, and no more", async () => {
    let attempts = 0;
    const failing: XSearch = async () => {
      attempts += 1;
      throw new Error("X Too Many Requests");
    };
    const first = await refreshIfDue({ now: WED_10AM, jobs: JOBS, search: failing, cap: 1000 });
    expect(first.failures).toHaveLength(JOBS.length);
    await refreshIfDue({ now: WED_10AM + 2 * MINUTE, jobs: JOBS, search: failing, cap: 1000 });
    expect(attempts).toBe(JOBS.length);
    await refreshIfDue({ now: WED_10AM + 6 * MINUTE, jobs: JOBS, search: failing, cap: 1000 });
    await refreshIfDue({ now: WED_10AM + 20 * MINUTE, jobs: JOBS, search: failing, cap: 1000 });
    expect(attempts).toBe(JOBS.length * 2);
    // A failed request costs no posts.
    expect(await budgetSpent("2026-09-30")).toBe(0);
  });

  it("finishes the slot and settles the budget when saving throws after X answered", async () => {
    let calls = 0;
    const breaking: XSearch = async () => {
      calls += 1;
      if (calls === 1) await sql.query(`alter table x_posts rename to x_posts_gone`);
      return [tweet(WED_10AM - 30 * MINUTE), tweet(WED_10AM - 20 * MINUTE)];
    };
    await expect(refreshIfDue({ now: WED_10AM, jobs: JOBS.slice(0, 1), search: breaking, cap: 1000 })).rejects.toThrow();
    await sql.query(`alter table x_posts_gone rename to x_posts`);
    const [budget] = (await sql.query(`select used, reserved, requests from x_read_budget where day = '2026-09-30'`)) as {
      used: number;
      reserved: number;
      requests: number;
    }[];
    // X billed the two posts; nothing is left held.
    expect(budget).toEqual({ used: 2, reserved: 0, requests: 1 });
    const [slot] = (await sql.query(`select ok from x_fetch_slots`)) as { ok: boolean | null }[];
    expect(slot.ok).toBe(false);
    // Tried again once the retry wait has passed, and kept this time.
    forgetSettledSlots();
    await refreshIfDue({ now: WED_10AM + 6 * MINUTE, jobs: JOBS.slice(0, 1), search: breaking, cap: 1000 });
    expect(calls).toBe(2);
    expect(await readStoredPosts(WED_10AM - 24 * 60 * MINUTE)).toHaveLength(2);
  });

  it("takes back a claim that never finished once it is two minutes old", async () => {
    const { search, calls } = fakeSearch();
    const slot = "2026-09-30T13:30:00.000Z";
    await sql.query(`insert into x_fetch_slots (slot, attempts, claimed_at, ok) values ($1, 1, $2, null)`, [
      slot,
      new Date(WED_10AM - MINUTE).toISOString(),
    ]);
    await refreshIfDue({ now: WED_10AM, jobs: JOBS, search, cap: 1000 });
    expect(calls).toHaveLength(0);
    await refreshIfDue({ now: WED_10AM + 2 * MINUTE, jobs: JOBS, search, cap: 1000 });
    expect(calls).toHaveLength(JOBS.length);
  });

  it("moves a query that keeps failing down the rotation, keeping where it got to", async () => {
    const asked: string[] = [];
    let failing = false;
    const { search: good } = fakeSearch();
    const search: XSearch = async (query, options) => {
      const key = JOBS.find((job) => job.query === query)!.key;
      asked.push(key);
      if (key === "company" && failing) throw new Error("X Invalid Request");
      return good(query, options);
    };
    // The day before, every query succeeds once, so each has a since_id to keep.
    await refreshIfDue({ now: Date.parse("2026-09-29T11:00:30Z"), jobs: JOBS, search, cap: 1000 });
    const [before] = (await readQueryStates()).filter((state) => state.key === "company");
    asked.length = 0;
    failing = true;
    // At a cap of 50 a slot runs one query; each slot's retry comes six minutes on.
    for (const hhmm of ["13:30", "13:36", "15:30", "15:36", "17:30", "17:36", "19:30", "19:36"]) {
      await refreshIfDue({ now: Date.parse(`2026-09-30T${hhmm}:30Z`), jobs: JOBS, search, cap: 50 });
    }
    // Without the failure time the company query would take every turn.
    expect(asked).toEqual(["company", "press-0", "press-1", "company", "press-0", "press-1"]);
    const [after] = (await readQueryStates()).filter((state) => state.key === "company");
    expect(after.sinceId).toBe(before.sinceId);
    expect(after.failedAt).toBeDefined();
  });

  it("starts a quiet query again once its newest post is past X's reach, however recently it asked", async () => {
    const { search, calls } = fakeSearch(0);
    const old = tweet(WED_10AM - 7 * 24 * 60 * MINUTE);
    await sql.query(`insert into x_queries (key, query, since_id, fetched_at) values ($1, $2, $3, $4)`, [
      "company",
      JOBS[0].query,
      old.id,
      new Date(WED_10AM - 2 * 60 * MINUTE).toISOString(),
    ]);
    await refreshIfDue({ now: WED_10AM, jobs: JOBS.slice(0, 1), search, cap: 1000 });
    expect(calls[0].sinceId).toBeUndefined();
  });

  it("asks the database nothing more once this instance has seen the day's cap spent", async () => {
    const { search, calls } = fakeSearch();
    await refreshIfDue({ now: WED_10AM, jobs: JOBS, search, cap: 10 });
    expect(calls).toHaveLength(1);
    let queries = 0;
    setSqlClient({ query: (text, params) => ((queries += 1), sql.query(text, params)) });
    try {
      // The next slot finds the cap spent once, then remembers it.
      await refreshIfDue({ now: WED_10AM + 95 * MINUTE, jobs: JOBS, search, cap: 10 });
      const first = queries;
      expect(first).toBeGreaterThan(0);
      await refreshIfDue({ now: WED_10AM + 100 * MINUTE, jobs: JOBS, search, cap: 10 });
      await refreshIfDue({ now: WED_10AM + 200 * MINUTE, jobs: JOBS, search, cap: 10, fresh: true });
      expect(queries).toBe(first);
      // A raised cap is asked about again.
      await refreshIfDue({ now: WED_10AM + 210 * MINUTE, jobs: JOBS, search, cap: 20 });
      expect(queries).toBeGreaterThan(first);
      expect(calls).toHaveLength(2);
    } finally {
      setSqlClient(sql);
    }
  });

  it("keeps the latest copy of a post returned twice", async () => {
    const post = tweet(WED_10AM - 60 * MINUTE);
    let calls = 0;
    const search: XSearch = async (query) =>
      query === JOBS[0].query ? [{ ...post, public_metrics: { like_count: calls++ ? 99 : 1 } }] : [];
    await refreshIfDue({ now: WED_10AM, jobs: JOBS, search, cap: 1000 });
    await refreshIfDue({ now: WED_10AM + 95 * MINUTE, jobs: JOBS, search, cap: 1000 });
    const stored = await readStoredPosts(WED_10AM - 24 * 60 * MINUTE);
    expect(stored).toHaveLength(1);
    expect(stored[0].tweet.public_metrics?.like_count).toBe(99);
  });
});

describe("gatherPosts", () => {
  it("never goes to X for a reader other than the column, and reads what is kept", async () => {
    // Posts from half an hour before the real now: this test runs on the
    // wall clock, and fakeSearch's fixed Wednesday passed the eight day prune
    // on 8 October 2026, which turned this test red on master.
    const now = Date.now();
    const search: XSearch = async (_query, options) =>
      Array.from({ length: Math.min(2, options.maxResults) }, () => tweet(now - 30 * MINUTE));
    await refreshIfDue({ now, jobs: JOBS, search, cap: 1000 });
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);
    process.env.X_BEARER_TOKEN = "test-token";
    try {
      await sql.query(`update x_posts set posted_at = now() - interval '1 hour'`);
      const gathered = await gatherPosts();
      expect(fetchSpy).not.toHaveBeenCalled();
      // The column's own route, but not production: still nothing from X.
      await gatherPosts({ mayFetch: true, fresh: true });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(gathered.posts.length).toBeGreaterThan(0);
      expect(gathered.updatedAt).toBeDefined();
    } finally {
      vi.unstubAllGlobals();
      delete process.env.X_BEARER_TOKEN;
    }
  });
});
