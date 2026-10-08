import { SLOT_STATES } from "@/lib/campaigns";
import {
  autopostDue,
  autopostEnabled,
  calendarDrafts,
  choosePost,
  postRefusals,
  type Choice,
  type DraftSource,
  type LiveCampaign,
} from "@/lib/x-autopost";
import { dailyPostCap, utcDay } from "@/lib/x-schedule";
import { getSql } from "@/lib/server/db";
import { VERDICT_VERSIONS } from "@/lib/server/news-ingest";
import { readStories } from "@/lib/server/news-store";
import { accessToken, type FetchLike } from "@/lib/server/x-oauth";
import { reserveBudget, settleBudget } from "@/lib/server/x-store";

/**
 * Posts for @berthmarkets, once every three days, from the evening cron
 * (lib/server/evening). The choice is lib/x-autopost; this reads what it
 * needs (SELECT only, until the moment of posting), takes one from the X
 * day's cap (X_DAILY_POST_CAP, the same ledger the column reads against),
 * gets a fresh token (lib/server/x-oauth), writes `sending` to the log and
 * only then sends. Before it sends, the exact text goes through the guard
 * (lib/x-autopost postRefusals) with the headlines of the last
 * HEADLINES_WINDOW_MS; a refused post is logged as a skip and never sent.
 * It never throws: every outcome is a log row and a
 * summary, and a refused token or an X error never touches the rest of the
 * evening.
 *
 * Off unless X_AUTOPOST_ENABLED is "1" and this is production.
 */

export const POST_URL = "https://api.x.com/2/tweets";
const REQUEST_TIMEOUT_MS = 10_000;
/** A 401 is answered with a refresh and a second send only while this much of the budget is left: two requests and their writes. */
export const AUTOPOST_RETRY_NEEDS_MS = 25_000;
const LIVE = ["sending", "posted", "unknown"];
/** How far back the guard reads headlines a post must not repeat. */
export const HEADLINES_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

type Env = Record<string, string | undefined>;

export type AutopostSummary =
  | { ran: false; reason: string }
  | {
      ran: true;
      status: "posted" | "unknown" | "failed" | "skipped";
      source?: DraftSource;
      key?: string;
      tweetId?: string;
      detail?: string;
    };

const at = (ms: number) => new Date(ms).toISOString();
const msOf = (value: unknown): number => (value instanceof Date ? value.getTime() : Date.parse(String(value)));

/**
 * The signup campaign that may be posted at `now`, or null: active, begun,
 * not ended, a signup campaign (a retired buy or invite campaign is never
 * posted, and before campaigns had a kind there were only buy ones), with
 * places left and budget for at least one more reward, counting the claims
 * that hold a place (lib/campaigns SLOT_STATES), and only one staff ticked
 * "Announce on X" (campaigns.announce_on_x, off by default): a campaign's
 * money link is never posted on its own. `kind` and `announce_on_x` are
 * read through to_jsonb so this runs on a schema with or without them
 * (without, nothing is posted).
 */
export async function readLiveCampaign(now: number): Promise<LiveCampaign | null> {
  const rows = (await getSql().query(
    `select c.code, c.amount_usd::float8 as amount_usd, c.budget_usd::float8 as budget_usd, c.max_claims, c.hold_days,
            c.ends_at, to_jsonb(c)->>'kind' as kind, to_jsonb(c)->>'announce_on_x' as announce,
            (select count(*)::int from campaign_claims cc where cc.campaign_id = c.id and cc.state = any($2::text[])) as taken
     from campaigns c
     where c.active and c.starts_at <= $1::timestamptz and c.ends_at > $1::timestamptz
     order by c.activated_at desc nulls last, c.created_at desc`,
    [at(now), [...SLOT_STATES]],
  )) as {
    code: string;
    amount_usd: number;
    budget_usd: number;
    max_claims: number;
    hold_days: number;
    ends_at: unknown;
    kind: string | null;
    announce: string | null;
    taken: number;
  }[];
  for (const row of rows) {
    if (row.kind !== "signup" || row.announce !== "true") continue;
    const amount = Number(row.amount_usd);
    const taken = Number(row.taken);
    const byBudget = Math.floor((Number(row.budget_usd) - taken * amount) / amount + 1e-9);
    const placesLeft = Math.min(Number(row.max_claims) - taken, byBudget);
    if (!(amount > 0) || placesLeft <= 0) continue;
    return { code: row.code, amountUsd: amount, stayDays: Number(row.hold_days), placesLeft, endsAt: new Date(msOf(row.ends_at)) };
  }
  return null;
}

/** The last live post: when, and from which source. */
async function lastLive(): Promise<{ at: number; source: DraftSource | null } | undefined> {
  const rows = (await getSql().query(
    `select at, source from x_autopost_log where status = any($1::text[]) order by at desc limit 1`,
    [LIVE],
  )) as { at: unknown; source: DraftSource | null }[];
  return rows[0] ? { at: msOf(rows[0].at), source: rows[0].source } : undefined;
}

/** Every headline the stories of the window carry, hidden ones too: what a post must never repeat. */
async function readHeadlines(now: number): Promise<string[]> {
  const stories = await readStories({ sinceMs: now - HEADLINES_WINDOW_MS, versions: VERDICT_VERSIONS });
  return [...new Set(stories.flatMap((story) => story.sources.map((source) => source.title)).filter(Boolean))];
}

/** Everything the day's choice reads. SELECT only, so it can be previewed against production. */
export async function draftChoice({
  now = Date.now(),
  lastSource,
}: {
  now?: number;
  /** Unused since the news source went (2026-10-08); kept so callers need not change. */
  env?: Env;
  lastSource?: DraftSource | null;
} = {}): Promise<{ choice: Choice | null; inputs: Parameters<typeof choosePost>[0]; headlines: string[]; refusals: string[] }> {
  const sql = getSql();
  const [usedRows, campaign, headlines, last] = await Promise.all([
    sql.query(`select key from x_autopost_log where key is not null and status <> 'skipped'`) as Promise<{ key: string }[]>,
    readLiveCampaign(now),
    readHeadlines(now),
    lastSource === undefined ? lastLive() : Promise.resolve(undefined),
  ]);
  const inputs = {
    campaign,
    calendar: calendarDrafts(now),
    used: new Set(usedRows.map((row) => row.key)),
    lastSource: lastSource === undefined ? (last?.source ?? null) : lastSource,
    now,
  };
  const choice = choosePost(inputs);
  return { choice, inputs, headlines, refusals: choice ? postRefusals(choice.text, headlines) : [] };
}

async function log(row: {
  now: number;
  choice?: Choice;
  status: "sending" | "posted" | "unknown" | "failed" | "skipped";
  detail?: string;
}): Promise<number | undefined> {
  const draft = row.choice?.draft;
  const rows = (await getSql().query(
    `insert into x_autopost_log (at, day, source, key, symbol, campaign_code, text, status, detail)
     values ($1::timestamptz, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict do nothing returning id`,
    [
      at(row.now),
      utcDay(row.now),
      draft?.source ?? null,
      draft?.key ?? null,
      null,
      row.choice?.campaignCode ?? null,
      row.choice?.text ?? null,
      row.status,
      row.detail ?? null,
    ],
  )) as { id: unknown }[];
  return rows[0] ? Number(rows[0].id) : undefined;
}

async function finish(id: number, status: "posted" | "unknown" | "failed" | "skipped", detail: string | null, tweetId: string | null): Promise<void> {
  await getSql().query(`update x_autopost_log set status = $2, detail = $3, tweet_id = $4 where id = $1`, [id, status, detail, tweetId]);
}

/** `unauthorized` is X's 401 (nothing posted); `token` is a 401 or a token problem this run cannot get past. */
type SendResult = { status: "posted"; tweetId: string } | { status: "unknown" | "failed" | "unauthorized" | "token"; detail: string };

async function send(text: string, token: string, fetchImpl: FetchLike): Promise<SendResult> {
  let response: Response;
  try {
    response = await fetchImpl(POST_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return { status: "unknown", detail: `no answer from X: ${error instanceof Error ? error.name : "error"}` };
  }
  const body = (await response.json().catch(() => ({}))) as { data?: { id?: string }; title?: string; detail?: string };
  if (response.ok && body.data?.id) return { status: "posted", tweetId: String(body.data.id) };
  if (response.ok) return { status: "unknown", detail: `X answered ${response.status} without a post id` };
  if (response.status === 401) return { status: "unauthorized", detail: "X refused the token" };
  const why = `X refused: ${response.status}${body.title ? ` ${String(body.title).slice(0, 80)}` : ""}${body.detail ? `, ${String(body.detail).slice(0, 160)}` : ""}`;
  // A server error may still have posted; a client error did not.
  return { status: response.status >= 500 ? "unknown" : "failed", detail: why };
}

/** The evening's autopost stage. Never throws. */
export async function runAutopost({
  now = Date.now(),
  env = process.env,
  fetchImpl = fetch,
  deadline = Infinity,
}: {
  now?: number;
  env?: Env;
  fetchImpl?: FetchLike;
  /** Wall clock, epoch ms: when the caller stops waiting (lib/server/evening AUTOPOST_BUDGET_MS). */
  deadline?: number;
} = {}): Promise<AutopostSummary> {
  if (!autopostEnabled(env)) return { ran: false, reason: "disabled" };
  try {
    const last = await lastLive();
    if (!autopostDue(last?.at, now)) return { ran: false, reason: "not due" };

    const drafted = await draftChoice({ now, env, lastSource: last?.source ?? null });
    const headlines = drafted.headlines;
    let choice = drafted.choice;
    if (!choice) {
      await log({ now, status: "skipped", detail: "nothing to say today" });
      return { ran: true, status: "skipped", detail: "nothing to say today" };
    }

    const day = utcDay(now);
    if (!(await reserveBudget(day, 1, dailyPostCap(env.X_DAILY_POST_CAP)))) {
      await log({ now, choice, status: "skipped", detail: "X daily cap reached" });
      return { ran: true, status: "skipped", source: choice.draft.source, key: choice.draft.key, detail: "X daily cap reached" };
    }
    let used = 0;
    try {
      let token = await accessToken({ env, now, fetchImpl });
      if (!token.ok) {
        // Nothing was sent: a skip, so the draft's key stays free for the run after the token is fixed.
        console.warn("[x-autopost] no token:", token.reason);
        await log({ now, choice, status: "skipped", detail: `token: ${token.reason}` });
        return { ran: true, status: "skipped", source: choice.draft.source, key: choice.draft.key, detail: `token: ${token.reason}` };
      }

      // A campaign is checked again at the moment of posting, never only when drafted.
      if (choice.campaignCode) {
        const live = await readLiveCampaign(now);
        if (!live || live.code !== choice.campaignCode) {
          choice = (await draftChoice({ now, env, lastSource: last?.source ?? null })).choice;
          if (choice?.campaignCode) choice = null;
          if (!choice) {
            await log({ now, status: "skipped", detail: "campaign closed before posting; nothing else to say" });
            return { ran: true, status: "skipped", detail: "campaign closed before posting" };
          }
        }
      }

      // The guard, on the exact text about to go out: a refused post is a logged skip, never a send.
      const refusals = postRefusals(choice.text, headlines);
      if (refusals.length > 0) {
        const detail = `refused: ${refusals.join("; ")}`;
        console.warn("[x-autopost]", detail);
        await log({ now, choice, status: "skipped", detail });
        return { ran: true, status: "skipped", source: choice.draft.source, key: choice.draft.key, detail };
      }

      const id = await log({ now, choice, status: "sending" });
      if (id === undefined) return { ran: true, status: "skipped", key: choice.draft.key, detail: "already posted today or this key" };

      let result = await send(choice.text, token.accessToken, fetchImpl);
      if (result.status === "unauthorized" && deadline - Date.now() < AUTOPOST_RETRY_NEEDS_MS) {
        result = { status: "token", detail: "X refused the token; no time left this run to refresh and try again" };
      }
      if (result.status === "unauthorized") {
        token = await accessToken({ env, now, fetchImpl, force: true });
        result = token.ok ? await send(choice.text, token.accessToken, fetchImpl) : { status: "token", detail: `token: ${token.reason}` };
        if (result.status === "unauthorized") result = { status: "token", detail: result.detail };
      }
      if (result.status === "posted") {
        used = 1;
        await finish(id, "posted", null, result.tweetId);
        return { ran: true, status: "posted", source: choice.draft.source, key: choice.draft.key, tweetId: result.tweetId };
      }
      if (result.status === "unknown") used = 1;
      // A refused token posted nothing: a skip, so the key is not spent.
      const status = result.status === "unknown" ? "unknown" : result.status === "token" ? "skipped" : "failed";
      console.warn("[x-autopost]", status, result.detail);
      await finish(id, status, result.detail, null);
      return { ran: true, status, source: choice.draft.source, key: choice.draft.key, detail: result.detail };
    } finally {
      await settleBudget(day, { reserved: 1, used, requests: 1 }).catch(() => undefined);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "failed";
    console.warn("[x-autopost] failed:", detail);
    return { ran: true, status: "failed", detail };
  }
}

export type AutopostLogRow = {
  id: number;
  at: number;
  source: DraftSource | null;
  key: string | null;
  campaignCode: string | null;
  text: string | null;
  status: string;
  tweetId: string | null;
  detail: string | null;
};

/** The staff page's list, newest first. */
export async function readAutopostLog(limit = 100): Promise<AutopostLogRow[]> {
  const rows = (await getSql().query(
    `select id, at, source, key, campaign_code, text, status, tweet_id, detail from x_autopost_log order by at desc, id desc limit $1`,
    [limit],
  )) as { id: unknown; at: unknown; source: DraftSource | null; key: string | null; campaign_code: string | null; text: string | null; status: string; tweet_id: string | null; detail: string | null }[];
  return rows.map((row) => ({
    id: Number(row.id),
    at: msOf(row.at),
    source: row.source,
    key: row.key,
    campaignCode: row.campaign_code,
    text: row.text,
    status: row.status,
    tweetId: row.tweet_id,
    detail: row.detail,
  }));
}
