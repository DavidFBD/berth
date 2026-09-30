import { getSql } from "@/lib/server/db";

/**
 * The X column's durable half: the posts X returned, where each query got
 * to, which slots were fetched and what the day has read. Tables and their
 * reasons are in db/schema.sql; the rules that use them are lib/x-schedule
 * and lib/server/x-refresh.
 */

export type XUser = {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
};

/** A post as recent search returns it, its author carried alongside. */
export type StoredTweet = {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  public_metrics?: {
    like_count?: number;
    retweet_count?: number;
    quote_count?: number;
    reply_count?: number;
  };
  author?: XUser;
};

export type Tier = "company" | "press";

export type QueryState = {
  key: string;
  query: string;
  sinceId: string | undefined;
  /** When it last got an answer from X. */
  fetchedAt: number | undefined;
  /** When it last failed. */
  failedAt: number | undefined;
};

const ms = (value: unknown): number => (value instanceof Date ? value.getTime() : Date.parse(String(value)));
const maybeMs = (value: unknown): number | undefined => (value === null || value === undefined ? undefined : ms(value));
const at = (epochMs: number) => new Date(epochMs).toISOString();

export async function readQueryStates(): Promise<QueryState[]> {
  const rows = (await getSql().query(`select key, query, since_id, fetched_at, failed_at from x_queries`)) as {
    key: string;
    query: string;
    since_id: string | null;
    fetched_at: unknown;
    failed_at: unknown;
  }[];
  return rows.map((row) => ({
    key: row.key,
    query: row.query,
    sinceId: row.since_id ?? undefined,
    fetchedAt: maybeMs(row.fetched_at),
    failedAt: maybeMs(row.failed_at),
  }));
}

/**
 * A query X refused or did not answer: its turn is spent, so the rotation
 * moves on, and where it got to is kept. A query whose text changed starts
 * again, as a success would have made it.
 */
export async function recordQueryFailure(key: string, query: string, failedAt: number): Promise<void> {
  await getSql().query(
    `insert into x_queries (key, query, failed_at) values ($1, $2, $3::timestamptz)
     on conflict (key) do update set
       failed_at = excluded.failed_at,
       since_id = case when x_queries.query = excluded.query then x_queries.since_id end,
       fetched_at = case when x_queries.query = excluded.query then x_queries.fetched_at end,
       query = excluded.query`,
    [key, query, at(failedAt)],
  );
}

/**
 * Where `slot` stands: `open` to be claimed (never tried, failed or died
 * with an attempt left), `busy` while a fetch runs, `done` once fetched or
 * out of attempts.
 */
export async function slotState(
  slot: string,
  now: number,
  { maxAttempts, staleMs }: { maxAttempts: number; staleMs: number },
): Promise<"open" | "busy" | "done"> {
  const rows = (await getSql().query(`select attempts, ok, claimed_at from x_fetch_slots where slot = $1`, [slot])) as {
    attempts: number;
    ok: boolean | null;
    claimed_at: unknown;
  }[];
  const row = rows[0];
  if (!row) return "open";
  if (row.ok === true) return "done";
  if (row.ok === null && now - ms(row.claimed_at) < staleMs) return "busy";
  return row.attempts >= maxAttempts ? "done" : "open";
}

/**
 * Claims `slot` for this instance. True for exactly one caller per slot,
 * and again for one caller after a failure once `retryAfterMs` has passed,
 * or after a claim that never finished once `staleMs` has, up to
 * `maxAttempts` in all.
 */
export async function claimSlot(
  slot: string,
  now: number,
  { retryAfterMs, staleMs, maxAttempts }: { retryAfterMs: number; staleMs: number; maxAttempts: number },
): Promise<boolean> {
  const rows = (await getSql().query(
    `insert into x_fetch_slots (slot, attempts, claimed_at, ok) values ($1, 1, $2::timestamptz, null)
     on conflict (slot) do update set attempts = x_fetch_slots.attempts + 1, claimed_at = excluded.claimed_at, ok = null
       where x_fetch_slots.attempts < $3
         and ((x_fetch_slots.ok is false and x_fetch_slots.claimed_at <= $4::timestamptz)
           or (x_fetch_slots.ok is null and x_fetch_slots.claimed_at <= $5::timestamptz))
     returning slot`,
    [slot, at(now), maxAttempts, at(now - retryAfterMs), at(now - staleMs)],
  )) as unknown[];
  return rows.length > 0;
}

/** Records which queries a claimed slot is asking, for `heldQueries`. */
export async function holdQueries(slot: string, keys: readonly string[]): Promise<void> {
  await getSql().query(`update x_fetch_slots set queries = $2::text[] where slot = $1`, [slot, keys]);
}

/** The queries other fetches are asking right now: claims unfinished and younger than `staleMs`. */
export async function heldQueries(exceptSlot: string, now: number, staleMs: number): Promise<Set<string>> {
  const rows = (await getSql().query(
    `select queries from x_fetch_slots where ok is null and slot <> $1 and claimed_at > $2::timestamptz and queries is not null`,
    [exceptSlot, at(now - staleMs)],
  )) as { queries: string[] | string }[];
  const held = new Set<string>();
  for (const row of rows) {
    // An array from Neon and PGlite; the text form only as a fallback.
    const keys = Array.isArray(row.queries) ? row.queries : String(row.queries).replace(/^\{|\}$/g, "").split(",");
    for (const key of keys) if (key) held.add(key);
  }
  return held;
}

export async function finishSlot(slot: string, result: { ok: boolean; posts: number; requests: number }): Promise<void> {
  await getSql().query(`update x_fetch_slots set ok = $2, posts = $3, requests = $4 where slot = $1`, [
    slot,
    result.ok,
    result.posts,
    result.requests,
  ]);
}

/** What the UTC day has read or holds in flight. */
export async function budgetSpent(day: string): Promise<number> {
  const rows = (await getSql().query(`select used, reserved from x_read_budget where day = $1`, [day])) as {
    used: number;
    reserved: number;
  }[];
  return rows[0] ? Number(rows[0].used) + Number(rows[0].reserved) : 0;
}

/** Takes `posts` from the day's budget before they are asked for; false when the cap would not hold. */
export async function reserveBudget(day: string, posts: number, cap: number): Promise<boolean> {
  const sql = getSql();
  await sql.query(`insert into x_read_budget (day) values ($1) on conflict (day) do nothing`, [day]);
  const rows = (await sql.query(
    `update x_read_budget set reserved = reserved + $2 where day = $1 and used + reserved + $2 <= $3 returning day`,
    [day, posts, cap],
  )) as unknown[];
  return rows.length > 0;
}

/** Turns a reservation into what was actually read. */
export async function settleBudget(
  day: string,
  { reserved, used, requests }: { reserved: number; used: number; requests: number },
): Promise<void> {
  await getSql().query(
    `update x_read_budget set reserved = greatest(reserved - $2, 0), used = used + $3, requests = requests + $4 where day = $1`,
    [day, reserved, used, requests],
  );
}

/** One query's answer: its posts kept (a repeat replaces its copy) and where it got to. */
export async function saveQueryResult({
  key,
  query,
  tier,
  tweets,
  sinceId,
  fetchedAt,
}: {
  key: string;
  query: string;
  tier: Tier;
  tweets: readonly StoredTweet[];
  sinceId: string | undefined;
  fetchedAt: number;
}): Promise<void> {
  const sql = getSql();
  const dated = tweets.filter((tweet) => tweet.created_at && Number.isFinite(Date.parse(tweet.created_at)));
  if (dated.length > 0) {
    await sql.query(
      `insert into x_posts (id, query_key, tier, tweet, posted_at, fetched_at)
       select t->>'id', $1, $2, t, (t->>'created_at')::timestamptz, $3::timestamptz
       from jsonb_array_elements($4::jsonb) as t
       on conflict (id) do update set tweet = excluded.tweet, fetched_at = excluded.fetched_at,
         query_key = excluded.query_key, tier = excluded.tier`,
      [key, tier, at(fetchedAt), JSON.stringify(dated)],
    );
  }
  await sql.query(
    `insert into x_queries (key, query, since_id, fetched_at) values ($1, $2, $3, $4::timestamptz)
     on conflict (key) do update set query = excluded.query, since_id = excluded.since_id, fetched_at = excluded.fetched_at`,
    [key, query, sinceId ?? null, at(fetchedAt)],
  );
}

export type StoredPost = { queryKey: string; tier: Tier; tweet: StoredTweet; fetchedAt: number };

/** Every kept post published after `sinceMs`, newest first. */
export async function readStoredPosts(sinceMs: number): Promise<StoredPost[]> {
  const rows = (await getSql().query(
    `select query_key, tier, tweet, fetched_at from x_posts where posted_at > $1::timestamptz order by posted_at desc`,
    [at(sinceMs)],
  )) as { query_key: string; tier: Tier; tweet: StoredTweet | string; fetched_at: unknown }[];
  return rows.map((row) => ({
    queryKey: row.query_key,
    tier: row.tier,
    tweet: typeof row.tweet === "string" ? (JSON.parse(row.tweet) as StoredTweet) : row.tweet,
    fetchedAt: ms(row.fetched_at),
  }));
}

/** When any query last asked X, epoch ms. */
export async function lastFetchedAt(): Promise<number | undefined> {
  const rows = (await getSql().query(`select max(fetched_at) as at from x_queries`)) as { at: unknown }[];
  const value = rows[0]?.at;
  return value === null || value === undefined ? undefined : ms(value);
}

/** Drops posts published before `beforeMs` and slots claimed before it. The daily counts stay, for the bill. */
export async function prune(beforeMs: number): Promise<void> {
  const sql = getSql();
  await sql.query(`delete from x_posts where posted_at < $1::timestamptz`, [at(beforeMs)]);
  await sql.query(`delete from x_fetch_slots where claimed_at < $1::timestamptz`, [at(beforeMs)]);
}
