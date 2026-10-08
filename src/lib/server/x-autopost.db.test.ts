import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { ARTICLE_VERSION } from "@/lib/server/news-ingest";
import { draftChoice, readAutopostLog, readLiveCampaign, runAutopost, POST_URL } from "@/lib/server/x-autopost";
import { accessToken, openToken, TOKEN_URL, tokenStatus, type FetchLike } from "@/lib/server/x-oauth";
import { budgetSpent } from "@/lib/server/x-store";

/**
 * Berth's own posts on X against the real schema, with X itself faked:
 * nothing here ever reaches api.x.com. The token rotates and every new pair
 * is kept, two runs never spend one refresh token, the kill switch and the
 * schedule hold, nothing is posted twice, the X day's cap holds, a campaign
 * is checked when the post goes out, the guard refuses a post that repeats
 * a headline, and every attempt is logged.
 */

let sql: SqlClient;
let close: () => Promise<void>;

const ENV = {
  VERCEL_ENV: "production",
  X_AUTOPOST_ENABLED: "1",
  X_CLIENT_ID: "client-id",
  X_CLIENT_SECRET: "client-secret",
  OAUTH_ACCESS_TOKEN: "env-access",
  OAUTH_REFRESH_TOKEN: "env-refresh-0",
  MARKETAUX_API_KEY: "k",
  MARKETAUX_KEY: "k",
  NEWS_MARKETAUX: "everyone",
};

// Monday 23 November 2026, 22:00 UTC: Thanksgiving is on Thursday, and Friday closes at 1pm.
const MON = Date.parse("2026-11-23T22:00:00Z");
const MON_DAY = "2026-11-23";
// Monday 5 October 2026, 22:00 UTC: no closure in the week ahead.
const QUIET = Date.parse("2026-10-05T22:00:00Z");
const THANKSGIVING =
  "US stock markets are closed on Thursday 26 November for Thanksgiving. Trading resumes on Friday 27 November. See it on Berth. https://www.berthmarkets.com";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

beforeAll(async () => {
  ({ sql, close } = await makeTestDb());
  setSqlClient(sql);
});

afterAll(async () => {
  setSqlClient(null);
  await close();
});

beforeEach(async () => {
  for (const table of ["x_oauth_tokens", "x_autopost_log", "x_read_budget", "campaign_claims", "campaigns", "stories"]) {
    await sql.query(`delete from ${table}`);
  }
});

/** A fake X: rotates refresh tokens like the real one, and records every call. */
function fakeX({
  post = () => new Response(JSON.stringify({ data: { id: "1844000000000000001", text: "" } }), { status: 201 }),
  refreshStatus = 200,
}: { post?: () => Response | Promise<Response>; refreshStatus?: number } = {}) {
  const calls: { url: string; body: string; auth: string }[] = [];
  let valid = "env-refresh-0";
  let n = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    const body = String(init.body ?? "");
    calls.push({ url, body, auth: String((init.headers as Record<string, string>).authorization) });
    if (url === TOKEN_URL) {
      const given = new URLSearchParams(body).get("refresh_token");
      if (refreshStatus !== 200 || given !== valid) {
        return new Response(JSON.stringify({ error: "invalid_request" }), { status: refreshStatus === 200 ? 400 : refreshStatus });
      }
      n += 1;
      valid = `rotated-refresh-${n}`;
      return new Response(JSON.stringify({ access_token: `access-${n}`, refresh_token: valid, expires_in: 7200, token_type: "bearer" }), { status: 200 });
    }
    if (url === POST_URL) return post();
    throw new Error(`unexpected ${url}`);
  };
  return { fetchImpl, calls, posts: () => calls.filter((call) => call.url === POST_URL), refreshes: () => calls.filter((call) => call.url === TOKEN_URL) };
}

let storyN = 0;
async function marketauxStory({ symbol = "NVDA", title = "NVIDIA opens a new research centre in Taipei", at = MON - 5 * HOUR } = {}): Promise<number> {
  storyN += 1;
  const [{ id }] = (await sql.query(
    `insert into stories (fingerprint, kind, title, url, publisher, symbols, published_at, last_item_at)
     values ($1, 'article', $2, 'https://r.example/a', 'Reuters', array[$3], $4::timestamptz, $4::timestamptz) returning id`,
    [`f${storyN}`, title, symbol, new Date(at).toISOString()],
  )) as { id: number }[];
  await sql.query(
    `insert into story_sources (story_id, source, source_id, publisher, url, title, title_key, published_at)
     values ($1, 'marketaux', $2, 'Reuters', 'https://r.example/a', $3, $3, $4::timestamptz)`,
    [id, `m${storyN}`, title, new Date(at).toISOString()],
  );
  await sql.query(`insert into story_listings (story_id, symbol, tagged_by) values ($1, $2, 'feed')`, [id, symbol]);
  await sql.query(
    `insert into story_verdicts (story_id, symbol, judge_version, about, substance, verdict, kept) values ($1, $2, $3, 0.95, 0.9, 'material', true)`,
    [id, symbol, ARTICLE_VERSION],
  );
  return Number(id);
}

async function rows() {
  return (await sql.query(`select status, source, key, tweet_id, detail, text from x_autopost_log order by id`)) as {
    status: string;
    source: string | null;
    key: string | null;
    tweet_id: string | null;
    detail: string | null;
    text: string | null;
  }[];
}

describe("the token", () => {
  it("is seeded from the environment, refreshed, and every rotated pair is kept, sealed", async () => {
    const x = fakeX();
    const first = await accessToken({ env: ENV, now: MON, fetchImpl: x.fetchImpl });
    expect(first).toEqual({ ok: true, accessToken: "access-1" });
    const [stored] = (await sql.query(`select access_token, refresh_token from x_oauth_tokens`)) as { access_token: string; refresh_token: string }[];
    expect(stored.refresh_token).not.toContain("rotated");
    expect(openToken(stored.refresh_token, ENV)).toBe("rotated-refresh-1");
    expect(openToken(stored.refresh_token, { X_CLIENT_SECRET: "another" })).toBeNull();

    // Still fresh an hour later: no refresh.
    expect(await accessToken({ env: ENV, now: MON + HOUR, fetchImpl: x.fetchImpl })).toEqual({ ok: true, accessToken: "access-1" });
    expect(x.refreshes()).toHaveLength(1);

    // Near expiry: the stored (rotated) refresh token is spent, never the environment's again.
    expect(await accessToken({ env: ENV, now: MON + 2 * HOUR, fetchImpl: x.fetchImpl })).toEqual({ ok: true, accessToken: "access-2" });
    expect(new URLSearchParams(x.refreshes()[1].body).get("refresh_token")).toBe("rotated-refresh-1");
    expect(x.refreshes()[1].auth).toBe(`Basic ${Buffer.from("client-id:client-secret").toString("base64")}`);
    expect((await tokenStatus()).refreshedAt).toBe(MON + 2 * HOUR);
  });

  it("saves the rotated pair on a second try when the first save fails", async () => {
    const x = fakeX();
    let failed = false;
    setSqlClient({
      query: (text, params) => {
        if (!failed && /set access_token = \$1/.test(text)) {
          failed = true;
          return Promise.reject(new Error("connection reset"));
        }
        return sql.query(text, params);
      },
    });
    try {
      expect(await accessToken({ env: ENV, now: MON, fetchImpl: x.fetchImpl })).toEqual({ ok: true, accessToken: "access-1" });
    } finally {
      setSqlClient(sql);
    }
    expect(failed).toBe(true);
    const [stored] = (await sql.query(`select refresh_token from x_oauth_tokens`)) as { refresh_token: string }[];
    expect(openToken(stored.refresh_token, ENV)).toBe("rotated-refresh-1");
  });

  it("seals with X_TOKEN_KEY when set, so a new client secret leaves the pair readable", async () => {
    const env = { ...ENV, X_TOKEN_KEY: "own key" };
    await accessToken({ env, now: MON, fetchImpl: fakeX().fetchImpl });
    const [stored] = (await sql.query(`select refresh_token from x_oauth_tokens`)) as { refresh_token: string }[];
    expect(openToken(stored.refresh_token, { ...env, X_CLIENT_SECRET: "rotated secret" })).toBe("rotated-refresh-1");
    expect(openToken(stored.refresh_token, ENV)).toBeNull();
  });

  it("says a pair whose key changed is unreadable, not refused", async () => {
    await accessToken({ env: ENV, now: MON, fetchImpl: fakeX().fetchImpl });
    const changed = { ...ENV, X_CLIENT_SECRET: "rotated secret" };
    expect(await accessToken({ env: changed, now: MON + 2 * HOUR, fetchImpl: fakeX().fetchImpl })).toMatchObject({ ok: false, reason: "stored refresh token unreadable" });
    expect(await tokenStatus()).toMatchObject({ dead: true, unreadable: true });
  });

  it("is refreshed by one run at a time", async () => {
    const x = fakeX();
    const results = await Promise.all([
      accessToken({ env: ENV, now: MON, fetchImpl: x.fetchImpl }),
      accessToken({ env: ENV, now: MON, fetchImpl: x.fetchImpl }),
    ]);
    expect(x.refreshes()).toHaveLength(1);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ reason: expect.stringContaining("another run") });
  });

  it("marks a refused pair dead, and takes a new environment token only then", async () => {
    const refused = fakeX({ refreshStatus: 400 });
    expect(await accessToken({ env: ENV, now: MON, fetchImpl: refused.fetchImpl })).toMatchObject({ ok: false });
    const status = await tokenStatus();
    expect(status.dead).toBe(true);
    expect(status.unreadable).toBe(false);
    expect(status.lastError).toContain("400");

    // The same environment token is not taken again.
    const x = fakeX();
    expect(await accessToken({ env: ENV, now: MON + HOUR, fetchImpl: x.fetchImpl })).toMatchObject({ ok: false });
    expect(x.refreshes()).toHaveLength(0);

    // A fresh authorisation is.
    const fresh = { ...ENV, OAUTH_REFRESH_TOKEN: "env-refresh-0", OAUTH_ACCESS_TOKEN: "new" };
    await sql.query(`update x_oauth_tokens set seed_fingerprint = 'older'`);
    expect(await accessToken({ env: fresh, now: MON + 2 * HOUR, fetchImpl: x.fetchImpl })).toEqual({ ok: true, accessToken: "access-1" });
  });
});

describe("the evening's post", () => {
  it("does nothing at all with the kill switch off, or outside production", async () => {
    const x = fakeX();
    expect(await runAutopost({ now: MON, env: { ...ENV, X_AUTOPOST_ENABLED: "0" }, fetchImpl: x.fetchImpl })).toEqual({ ran: false, reason: "disabled" });
    expect(await runAutopost({ now: MON, env: { ...ENV, VERCEL_ENV: "preview" }, fetchImpl: x.fetchImpl })).toEqual({ ran: false, reason: "disabled" });
    expect(x.calls).toHaveLength(0);
    expect(await rows()).toEqual([]);
  });

  it("posts a market closure once, logs it, and waits three days", async () => {
    const x = fakeX();
    const result = await runAutopost({ now: MON, env: ENV, fetchImpl: x.fetchImpl });
    expect(result).toMatchObject({ ran: true, status: "posted", source: "calendar", key: "calendar:2026-11-26", tweetId: "1844000000000000001" });
    expect(JSON.parse(x.posts()[0].body).text).toBe(THANKSGIVING);
    expect(x.posts()[0].auth).toBe("Bearer access-1");
    expect(await rows()).toMatchObject([{ status: "posted", source: "calendar", tweet_id: "1844000000000000001" }]);
    expect((await readAutopostLog())[0]).toMatchObject({ status: "posted", tweetId: "1844000000000000001" });
    expect(await budgetSpent(MON_DAY)).toBe(1);

    // The next evenings: not due.
    expect(await runAutopost({ now: MON + DAY, env: ENV, fetchImpl: x.fetchImpl })).toEqual({ ran: false, reason: "not due" });
    expect(await runAutopost({ now: MON + 2 * DAY, env: ENV, fetchImpl: x.fetchImpl })).toEqual({ ran: false, reason: "not due" });

    // Thursday: due, Thanksgiving is never posted again, and Friday's early close is.
    expect(await runAutopost({ now: MON + 3 * DAY, env: ENV, fetchImpl: x.fetchImpl })).toMatchObject({ status: "posted", key: "calendar:2026-11-27" });
    // Sunday: nothing left to say.
    expect(await runAutopost({ now: MON + 6 * DAY, env: ENV, fetchImpl: x.fetchImpl })).toMatchObject({ status: "skipped", detail: "nothing to say today" });
    expect(x.posts()).toHaveLength(2);
  });

  it("never posts about a company, however much news there is", async () => {
    const x = fakeX();
    await marketauxStory({ at: QUIET - 5 * HOUR });
    await marketauxStory({ symbol: "AAPL", title: "Apple opens a new store in Mumbai this weekend", at: QUIET - 5 * HOUR });
    expect(await runAutopost({ now: QUIET, env: ENV, fetchImpl: x.fetchImpl })).toMatchObject({ status: "skipped", detail: "nothing to say today" });
    expect(x.calls).toHaveLength(0);
  });

  it("logs nothing to say as a skip, and posts nothing", async () => {
    const x = fakeX();
    expect(await runAutopost({ now: QUIET, env: ENV, fetchImpl: x.fetchImpl })).toMatchObject({ status: "skipped" });
    expect(x.calls).toHaveLength(0);
    expect(await rows()).toMatchObject([{ status: "skipped", source: null }]);
  });

  it("refuses a post that repeats a headline, logs the skip, and sends nothing", async () => {
    const x = fakeX();
    await marketauxStory({ title: "US stock markets are closed on Thursday 26 November for Thanksgiving", at: MON - 5 * HOUR });
    const result = await runAutopost({ now: MON, env: ENV, fetchImpl: x.fetchImpl });
    expect(result).toMatchObject({ ran: true, status: "skipped", key: "calendar:2026-11-26", detail: "refused: repeats a headline" });
    expect(x.posts()).toHaveLength(0);
    expect(await rows()).toMatchObject([{ status: "skipped", key: "calendar:2026-11-26", detail: "refused: repeats a headline", text: THANKSGIVING }]);
    expect(await budgetSpent(MON_DAY)).toBe(0);
  });

  it("holds the X day's cap", async () => {
    const x = fakeX();
    await sql.query(`insert into x_read_budget (day, used) values ($1, 50)`, [MON_DAY]);
    expect(await runAutopost({ now: MON, env: { ...ENV, X_DAILY_POST_CAP: "50" }, fetchImpl: x.fetchImpl })).toMatchObject({
      status: "skipped",
      detail: "X daily cap reached",
    });
    expect(x.calls).toHaveLength(0);
  });

  it("never crashes on a dead token: it logs a skip and keeps the day for later", async () => {
    const x = fakeX({ refreshStatus: 401 });
    const result = await runAutopost({ now: MON, env: ENV, fetchImpl: x.fetchImpl });
    expect(result).toMatchObject({ ran: true, status: "skipped", detail: expect.stringContaining("token") });
    expect(x.posts()).toHaveLength(0);
    expect(await rows()).toMatchObject([{ status: "skipped", key: "calendar:2026-11-26" }]);
    expect(await budgetSpent(MON_DAY)).toBe(0);
    // Authorised again: the next evening posts the same day.
    await sql.query(`delete from x_oauth_tokens`);
    const fixed = fakeX();
    expect(await runAutopost({ now: MON + DAY, env: ENV, fetchImpl: fixed.fetchImpl })).toMatchObject({ status: "posted", key: "calendar:2026-11-26" });
  });

  it("refreshes once and tries again when X refuses the token", async () => {
    let n = 0;
    const x = fakeX({
      post: () => (++n === 1 ? new Response("{}", { status: 401 }) : new Response(JSON.stringify({ data: { id: "77" } }), { status: 201 })),
    });
    expect(await runAutopost({ now: MON, env: ENV, fetchImpl: x.fetchImpl })).toMatchObject({ status: "posted", tweetId: "77" });
    expect(x.refreshes()).toHaveLength(2);
    expect(x.posts().map((call) => call.auth)).toEqual(["Bearer access-1", "Bearer access-2"]);
  });

  it("does not refresh and retry after a 401 when the budget is nearly spent", async () => {
    const x = fakeX({ post: () => new Response("{}", { status: 401 }) });
    expect(await runAutopost({ now: MON, env: ENV, fetchImpl: x.fetchImpl, deadline: Date.now() + 5_000 })).toMatchObject({
      status: "skipped",
      detail: expect.stringContaining("no time left"),
    });
    expect(x.refreshes()).toHaveLength(1);
    expect(x.posts()).toHaveLength(1);
  });

  it("counts an answer that never came as posted, so it is never sent twice", async () => {
    const x = fakeX({ post: () => Promise.reject(new DOMException("timed out", "TimeoutError")) });
    expect(await runAutopost({ now: MON, env: ENV, fetchImpl: x.fetchImpl })).toMatchObject({ status: "unknown" });
    expect(await rows()).toMatchObject([{ status: "unknown", key: "calendar:2026-11-26" }]);
    expect(await runAutopost({ now: MON + DAY, env: ENV, fetchImpl: x.fetchImpl })).toEqual({ ran: false, reason: "not due" });
    expect(await budgetSpent(MON_DAY)).toBe(1);
  });

  it("logs X's refusal, and does not count it as a post", async () => {
    const x = fakeX({ post: () => new Response(JSON.stringify({ title: "Forbidden", detail: "duplicate content" }), { status: 403 }) });
    expect(await runAutopost({ now: MON, env: ENV, fetchImpl: x.fetchImpl })).toMatchObject({ status: "failed", detail: expect.stringContaining("403") });
    // The refused day is not tried again; the day after tries the next one.
    expect(await runAutopost({ now: MON + DAY, env: ENV, fetchImpl: x.fetchImpl })).toMatchObject({ status: "failed", key: "calendar:2026-11-27" });
    expect(x.posts()).toHaveLength(2);
    expect(await budgetSpent(MON_DAY)).toBe(0);
  });

  it("posts at most once a day, however many runs", async () => {
    const x = fakeX();
    const results = await Promise.all([1, 2].map(() => runAutopost({ now: MON, env: ENV, fetchImpl: x.fetchImpl })));
    expect(results.filter((result) => result.ran && result.status === "posted")).toHaveLength(1);
    expect(x.posts()).toHaveLength(1);
  });
});

async function signupCampaign({
  code = "welcome-oct",
  maxClaims = 20,
  budget = 100,
  amount = 5,
  active = true,
  ends = MON + 20 * DAY,
  announce = true,
} = {}) {
  await sql.query(`alter table campaigns add column if not exists kind text not null default 'buy'`);
  const [{ id }] = (await sql.query(
    `insert into campaigns (code, title, starts_at, ends_at, active, max_claims, budget_usd, amount_usd, hold_days, kind, announce_on_x)
     values ($1, $1, $2::timestamptz, $3::timestamptz, $4, $5, $6, $7, 7, 'signup', $8) returning id`,
    [code, new Date(MON - DAY).toISOString(), new Date(ends).toISOString(), active, maxClaims, budget, amount, announce],
  )) as { id: string }[];
  return id;
}

let userN = 0;
async function takePlaces(campaignId: string, count: number) {
  for (let i = 0; i < count; i += 1) {
    userN += 1;
    const [{ id }] = (await sql.query(`insert into users (privy_did) values ($1) returning id`, [`did:test:${userN}`])) as { id: string }[];
    await sql.query(`insert into campaign_claims (campaign_id, user_id, state) values ($1, $2, 'qualified')`, [campaignId, id]);
  }
}

describe("the campaign", () => {
  it("is never a retired buy or invite campaign", async () => {
    await sql.query(
      `insert into campaigns (code, title, starts_at, ends_at, active, kind) values ('old-buy', 'x', $1::timestamptz, $2::timestamptz, true, 'buy'),
              ('old-invite', 'x', $1::timestamptz, $2::timestamptz, true, 'invite')`,
      [new Date(MON - DAY).toISOString(), new Date(MON + DAY).toISOString()],
    );
    expect(await readLiveCampaign(MON)).toBeNull();
  });

  it("is never posted unless staff ticked Announce on X on that campaign, which is off by default", async () => {
    const x = fakeX();
    const id = await signupCampaign({ announce: false });
    expect(await readLiveCampaign(MON)).toBeNull();
    const [{ announce_on_x }] = (await sql.query(
      `insert into campaigns (code, title, starts_at, ends_at, active, kind) values ('plain-oct', 'x', $1::timestamptz, $2::timestamptz, true, 'signup')
       returning announce_on_x`,
      [new Date(MON - DAY).toISOString(), new Date(MON + 20 * DAY).toISOString()],
    )) as { announce_on_x: boolean }[];
    expect(announce_on_x).toBe(false);
    expect(await readLiveCampaign(MON)).toBeNull();
    // Neither as its own post nor as a calendar post's call to action.
    const result = await runAutopost({ now: MON, env: ENV, fetchImpl: x.fetchImpl });
    for (const post of x.posts()) expect(JSON.parse(post.body).text).not.toContain("/c/");
    if (result.ran) expect(result).not.toMatchObject({ source: "campaign" });
    await sql.query(`update campaigns set announce_on_x = true where id = $1`, [id]);
    expect(await readLiveCampaign(MON)).toMatchObject({ code: "welcome-oct" });
  });

  it("is live only while active, inside its dates, with a place and a reward's budget left", async () => {
    const id = await signupCampaign({ maxClaims: 20, budget: 100, amount: 5 });
    expect(await readLiveCampaign(MON)).toMatchObject({ code: "welcome-oct", amountUsd: 5, stayDays: 7, placesLeft: 20 });
    await takePlaces(id, 18);
    expect(await readLiveCampaign(MON)).toMatchObject({ placesLeft: 2 });
    await takePlaces(id, 2);
    expect(await readLiveCampaign(MON)).toBeNull();
    await sql.query(`update campaigns set max_claims = 30, budget_usd = 102`);
    expect(await readLiveCampaign(MON)).toBeNull();
    await sql.query(`update campaigns set budget_usd = 150`);
    expect(await readLiveCampaign(MON)).toMatchObject({ placesLeft: 10 });
    expect(await readLiveCampaign(MON + 21 * DAY)).toBeNull();
    await sql.query(`update campaigns set active = false`);
    expect(await readLiveCampaign(MON)).toBeNull();
  });

  it("takes every other slot and is the call to action between", async () => {
    const x = fakeX();
    await signupCampaign();
    expect(await runAutopost({ now: MON, env: ENV, fetchImpl: x.fetchImpl })).toMatchObject({ status: "posted", source: "campaign" });
    expect(JSON.parse(x.posts()[0].body).text).toContain("https://www.berthmarkets.com/c/welcome-oct");
    const second = await runAutopost({ now: MON + 3 * DAY, env: ENV, fetchImpl: x.fetchImpl });
    expect(second).toMatchObject({ status: "posted", source: "calendar" });
    expect(JSON.parse(x.posts()[1].body).text).toContain("New here? Join through this link, set up and still use Berth 7 days later, and $5 in USDC on Base is yours");
    expect(JSON.parse(x.posts()[1].body).text).not.toMatch(/invite/i);
  });

  it("is checked again at the moment of posting", async () => {
    const x = fakeX();
    await signupCampaign();
    // The campaign closes between the draft and the post (here, during the token refresh).
    const closing: FetchLike = async (url, init) => {
      if (url === TOKEN_URL) await sql.query(`update campaigns set active = false`);
      return x.fetchImpl(url, init);
    };
    expect(await runAutopost({ now: MON, env: ENV, fetchImpl: closing })).toMatchObject({ status: "posted", source: "calendar" });
    const text = JSON.parse(x.posts()[0].body).text as string;
    expect(text).not.toContain("/c/");
    expect(text).toContain("See it on Berth.");
  });

  it("drafts read only: the preview writes nothing", async () => {
    await marketauxStory({ at: MON - 5 * HOUR });
    const writes: string[] = [];
    setSqlClient({
      query: (text, params) => {
        if (!/^\s*(select|with)\b/i.test(text)) writes.push(text);
        return sql.query(text, params);
      },
    });
    try {
      const { choice } = await draftChoice({ now: MON, env: ENV });
      expect(choice?.draft.source).toBe("calendar");
    } finally {
      setSqlClient(sql);
    }
    expect(writes).toEqual([]);
  });
});
