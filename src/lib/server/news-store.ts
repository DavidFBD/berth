import { getSql } from "@/lib/server/db";
import {
  canonicalUrl,
  chooseLead,
  matchStory,
  normaliseTitle,
  type FoldMatch,
  type FoldTarget,
} from "@/lib/news-fold";

/**
 * The news store's durable half (tables and their reasons in db/schema.sql):
 * stories, each source's items folded into them, Jev's verdict per story and
 * listing, the slots and daily budgets ingestion runs under, and the dated
 * events (filings). lib/server/news-ingest writes it; lib/server/news-read
 * reads it.
 */

export type StorySource = "nasdaq" | "x" | "edgar" | "marketaux";

/** One source's item, as an adapter hands it to the store. */
export type IngestItem = {
  source: StorySource;
  sourceId: string;
  /** Verbatim. For an X post, its text. */
  title: string;
  url: string;
  publisher: string;
  publishedAt: number;
  /** The listings it was found under or tagged to. */
  symbols: readonly string[];
  taggedBy: "feed" | "topic" | "jev";
  /** The company's own account or the SEC: leads its story. */
  primary?: boolean;
  /** Only what a card may show (an X post's author and counts). Never a summary. */
  raw?: Record<string, unknown>;
};

const at = (epochMs: number) => new Date(epochMs).toISOString();
const ms = (value: unknown): number => (value instanceof Date ? value.getTime() : Date.parse(String(value)));
const textArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : String(value ?? "").replace(/^\{|\}$/g, "").split(",").filter(Boolean);
const json = <T>(value: unknown): T => (typeof value === "string" ? (JSON.parse(value) as T) : (value as T));

/* — folding — */

/**
 * Everything ingestion needs to fold a run's items in memory: which items
 * are already stored, and every recent story's urls, title keys and titles.
 * Read once per run, so an item already seen costs no query at all.
 */
export class FoldIndex {
  readonly known = new Map<string, number>();
  /** Stories led by an X post: a post's own verdict belongs only to these. */
  readonly postLed = new Set<number>();
  readonly targets = new Map<number, FoldTarget & { urls: string[]; titleKeys: string[]; titles: string[]; symbols: string[] }>();

  has(item: Pick<IngestItem, "source" | "sourceId">): boolean {
    return this.known.has(`${item.source}:${item.sourceId}`);
  }

  match(item: IngestItem): FoldMatch {
    return matchStory(
      { title: item.title, url: item.url, symbols: item.symbols, publishedAt: item.publishedAt, isPost: item.source === "x" },
      [...this.targets.values()],
    );
  }

  remember(storyId: number, item: IngestItem): void {
    this.known.set(`${item.source}:${item.sourceId}`, storyId);
    const target =
      this.targets.get(storyId) ??
      { storyId, urls: [], titleKeys: [], titles: [], symbols: [], publishedAt: item.publishedAt };
    const url = canonicalUrl(item.url);
    if (url) target.urls.push(url);
    target.titleKeys.push(normaliseTitle(item.title));
    target.titles.push(item.title);
    for (const symbol of item.symbols) if (!target.symbols.includes(symbol)) target.symbols.push(symbol);
    target.publishedAt = Math.min(target.publishedAt, item.publishedAt);
    this.targets.set(storyId, target);
  }
}

/** The fold index over items published since `sinceMs`. */
export async function loadFoldIndex(sinceMs: number): Promise<FoldIndex> {
  const rows = (await getSql().query(
    `select ss.story_id, ss.source, ss.source_id, ss.url, ss.title, ss.published_at, s.symbols, s.kind
     from story_sources ss join stories s on s.id = ss.story_id
     where ss.published_at > $1::timestamptz`,
    [at(sinceMs)],
  )) as { story_id: unknown; source: StorySource; source_id: string; url: string; title: string; published_at: unknown; symbols: unknown; kind: string }[];
  const index = new FoldIndex();
  for (const row of rows) {
    const storyId = Number(row.story_id);
    if (row.kind === "post") index.postLed.add(storyId);
    index.remember(storyId, {
      source: row.source,
      sourceId: row.source_id,
      title: row.title,
      url: row.url,
      publisher: "",
      publishedAt: ms(row.published_at),
      symbols: textArray(row.symbols),
      taggedBy: "feed",
    });
  }
  return index;
}

function sourceParams(item: IngestItem): unknown[] {
  return [
    item.source,
    item.sourceId,
    item.publisher,
    item.url,
    canonicalUrl(item.url) ?? null,
    item.title,
    normaliseTitle(item.title),
    at(item.publishedAt),
    JSON.stringify({ ...(item.raw ?? {}), primary: item.primary === true }),
    [...item.symbols],
    item.taggedBy,
  ];
}

/**
 * A new story led by `item`, in one statement: the story, its item and its
 * listings. If the item is already stored (under any story), nothing new is
 * made and that story's id comes back, so a run can never leave a story
 * with no item. Returns the story's id; lead it again with `releadStories`.
 */
export async function insertStory(item: IngestItem): Promise<number> {
  const rows = (await getSql().query(
    `with existing as (
       select story_id as id from story_sources where source = $1 and source_id = $2
     ), made as (
       insert into stories (fingerprint, kind, title, url, publisher, symbols, published_at, last_item_at)
       select $1 || ':' || $2, $12, $6, $4, $3, $10::text[], $8::timestamptz, $8::timestamptz
       where not exists (select 1 from existing)
       on conflict (fingerprint) do update set updated_at = now()
       returning id
     ), story as (
       select id from existing union all select id from made limit 1
     ), item as (
       insert into story_sources (story_id, source, source_id, publisher, url, canonical_url, title, title_key, published_at, raw)
       select id, $1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::jsonb from story
       on conflict (source, source_id) do update set fetched_at = now()
       returning story_id
     ), tags as (
       insert into story_listings (story_id, symbol, tagged_by)
       select story.id, symbol, $11 from story, unnest($10::text[]) as symbol
       on conflict do nothing
       returning story_id
     )
     select id, (select count(*) from item) as items, (select count(*) from tags) as tags from story`,
    [...sourceParams(item), item.source === "x" ? "post" : "article"],
  )) as { id: unknown }[];
  return Number(rows[0].id);
}

/**
 * `item` joins story `storyId` with its listings, in one statement.
 * Idempotent on (source, source_id): an item already stored stays where it is.
 */
export async function addSource(storyId: number, item: IngestItem): Promise<void> {
  await getSql().query(
    `with item as (
       insert into story_sources (story_id, source, source_id, publisher, url, canonical_url, title, title_key, published_at, raw)
       values ($12, $1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::jsonb)
       on conflict (source, source_id) do update set fetched_at = now()
       returning story_id
     )
     insert into story_listings (story_id, symbol, tagged_by)
     select story_id, symbol, $11 from item, unnest($10::text[]) as symbol
     on conflict do nothing`,
    [...sourceParams(item), storyId],
  );
}

/**
 * Leads each story again with its most primary item (lib/news-fold
 * chooseLead), counts its publishers and takes its listings and times from
 * its items: one read and one write for every story a run touched.
 */
export async function releadStories(ids: Iterable<number>): Promise<void> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return;
  const sql = getSql();
  const sources = (await sql.query(
    `select id, story_id, source, publisher, url, title, published_at, raw from story_sources where story_id = any($1::bigint[])`,
    [wanted],
  )) as { id: unknown; story_id: unknown; source: StorySource; publisher: string; url: string; title: string; published_at: unknown; raw: unknown }[];
  const byStory = new Map<number, typeof sources>();
  for (const row of sources) {
    const id = Number(row.story_id);
    byStory.set(id, [...(byStory.get(id) ?? []), row]);
  }
  const leads: { id: number; kind: string; title: string; url: string; publisher: string; lead: number; publishers: number }[] = [];
  for (const [id, rows] of byStory) {
    // Marketaux never leads while it may be hidden: a story it shares with a
    // licensed source must read as that source's to everyone.
    const leadable = rows.filter((row) => row.source !== "marketaux");
    const pool = (leadable.length > 0 ? leadable : rows).map((row) => ({
      ...row,
      publishedAt: ms(row.published_at),
      primary: json<{ primary?: boolean } | null>(row.raw)?.primary === true,
    }));
    const lead = chooseLead(pool);
    if (!lead) continue;
    const publishers = new Set(rows.map((row) => row.publisher.trim().toLowerCase()).filter(Boolean));
    leads.push({
      id,
      kind: lead.source === "x" ? "post" : "article",
      title: lead.title,
      url: lead.url,
      publisher: lead.publisher,
      lead: Number(lead.id),
      publishers: Math.max(1, publishers.size),
    });
  }
  if (leads.length === 0) return;
  await sql.query(
    `update stories s set
       kind = l->>'kind', title = l->>'title', url = l->>'url', publisher = l->>'publisher',
       lead_source_id = (l->>'lead')::bigint, publisher_count = (l->>'publishers')::int,
       symbols = (select coalesce(array_agg(distinct symbol order by symbol), '{}') from story_listings where story_id = s.id),
       published_at = (select min(published_at) from story_sources where story_id = s.id),
       last_item_at = (select max(published_at) from story_sources where story_id = s.id),
       updated_at = now()
     from jsonb_array_elements($1::jsonb) as l
     where s.id = (l->>'id')::bigint`,
    [JSON.stringify(leads)],
  );
}

/** The titles and listings of the stories `ids`, for a near-miss question. */
export async function storyTitles(ids: readonly number[]): Promise<Map<number, { title: string; publisher: string }>> {
  if (ids.length === 0) return new Map();
  const rows = (await getSql().query(`select id, title, publisher from stories where id = any($1::bigint[])`, [[...ids]])) as {
    id: unknown;
    title: string;
    publisher: string;
  }[];
  return new Map(rows.map((row) => [Number(row.id), { title: row.title, publisher: row.publisher }]));
}

/* — verdicts — */

export type VerdictRow = {
  storyId: number;
  symbol: string;
  version: string;
  about: number | null;
  substance: number | null;
  verdict: "material" | "fact" | "analysis" | null;
  kept: boolean;
  tokens?: number;
};

export async function saveVerdict(row: VerdictRow): Promise<void> {
  await getSql().query(
    `insert into story_verdicts (story_id, symbol, judge_version, about, substance, verdict, kept, tokens)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (story_id, symbol, judge_version) do update set
       about = excluded.about, substance = excluded.substance, verdict = excluded.verdict, kept = excluded.kept`,
    [row.storyId, row.symbol, row.version, row.about, row.substance, row.verdict, row.kept, row.tokens ?? null],
  );
}

/**
 * Many verdicts in one statement. `keep` false leaves an existing row as it
 * is (a dropped post never overwrites a kept reading); true replaces it.
 */
export async function saveVerdicts(rows: readonly VerdictRow[], { replace = true }: { replace?: boolean } = {}): Promise<void> {
  if (rows.length === 0) return;
  await getSql().query(
    `insert into story_verdicts (story_id, symbol, judge_version, about, substance, verdict, kept, tokens)
     select (v->>'storyId')::bigint, v->>'symbol', v->>'version', (v->>'about')::real, (v->>'substance')::real,
            v->>'verdict', (v->>'kept')::boolean, (v->>'tokens')::int
     from jsonb_array_elements($1::jsonb) as v
     on conflict (story_id, symbol, judge_version) do ${
       replace
         ? "update set about = excluded.about, substance = excluded.substance, verdict = excluded.verdict, kept = excluded.kept"
         : "nothing"
     }`,
    [JSON.stringify(rows.map((row) => ({ ...row, tokens: row.tokens ?? null })))],
  );
}

/* — the run's lease — */

/**
 * One ingest at a time, whatever claimed it (a cron, a slot, a refresh):
 * two at once would each make the same new story. A lease that outlives
 * `ttlMs` is taken to have died. True when this run holds it.
 */
export async function takeIngestLease(now: number, ttlMs: number): Promise<boolean> {
  const rows = (await getSql().query(
    `insert into news_fetch_slots (source, slot, attempts, claimed_at, ok) values ('lease', 'ingest', 1, $1::timestamptz, null)
     on conflict (source, slot) do update set attempts = news_fetch_slots.attempts + 1, claimed_at = excluded.claimed_at, ok = null
       where news_fetch_slots.ok is not null or news_fetch_slots.claimed_at <= $2::timestamptz
     returning slot`,
    [at(now), at(now - ttlMs)],
  )) as unknown[];
  return rows.length > 0;
}

export async function releaseIngestLease(): Promise<void> {
  await getSql().query(`update news_fetch_slots set ok = true where source = 'lease' and slot = 'ingest'`);
}

export type Unjudged = { storyId: number; symbol: string; title: string; publisher: string };

/**
 * Article stories since `sinceMs` with a listing no verdict of `version`
 * covers yet, newest first, at most three listings a story.
 */
export async function unjudgedStories(version: string, sinceMs: number, limit: number): Promise<Unjudged[]> {
  const rows = (await getSql().query(
    `select s.id, sl.symbol, s.title, s.publisher
     from stories s join story_listings sl on sl.story_id = s.id
     where s.kind = 'article' and s.published_at > $2::timestamptz and s.hidden_reason is null
       and not exists (select 1 from story_verdicts v where v.story_id = s.id and v.symbol = sl.symbol and v.judge_version = $1)
       and (select count(*) from story_listings other where other.story_id = s.id and other.symbol < sl.symbol) < 3
     order by s.published_at desc, sl.symbol
     limit $3`,
    [version, at(sinceMs), limit],
  )) as { id: unknown; symbol: string; title: string; publisher: string }[];
  return rows.map((row) => ({ storyId: Number(row.id), symbol: row.symbol, title: row.title, publisher: row.publisher }));
}

/* — reading — */

export type StoredSourceRow = {
  id: number;
  source: StorySource;
  sourceId: string;
  publisher: string;
  url: string;
  title: string;
  publishedAt: number;
  raw: Record<string, unknown> | null;
};

export type StoredStory = {
  id: number;
  kind: "article" | "post";
  leadSourceId: number | null;
  publishedAt: number;
  hidden: boolean;
  sources: StoredSourceRow[];
  verdicts: Omit<VerdictRow, "storyId">[];
  /** Listings it is tagged to that no verdict of the asked versions covers yet. */
  unjudged: string[];
};

/**
 * Every story published since `sinceMs`, with its items, its verdicts of
 * `versions` and the listings still unjudged, newest first. `symbol`
 * narrows to one listing.
 */
export async function readStories({
  sinceMs,
  versions,
  symbol,
}: {
  sinceMs: number;
  versions: readonly string[];
  symbol?: string;
}): Promise<StoredStory[]> {
  const sql = getSql();
  const rows = (await sql.query(
    `select s.id, s.kind, s.lead_source_id, s.published_at, s.hidden_reason,
            sl.symbol, v.judge_version, v.about, v.substance, v.verdict, v.kept
     from stories s
     join story_listings sl on sl.story_id = s.id
     left join story_verdicts v on v.story_id = s.id and v.symbol = sl.symbol and v.judge_version = any($2::text[])
     where s.published_at > $1::timestamptz ${symbol ? "and sl.symbol = $3" : ""}
     order by s.published_at desc`,
    symbol ? [at(sinceMs), [...versions], symbol] : [at(sinceMs), [...versions]],
  )) as {
    id: unknown;
    kind: "article" | "post";
    lead_source_id: unknown;
    published_at: unknown;
    hidden_reason: string | null;
    symbol: string;
    judge_version: string | null;
    about: number | null;
    substance: number | null;
    verdict: VerdictRow["verdict"];
    kept: boolean | null;
  }[];
  const stories = new Map<number, StoredStory>();
  for (const row of rows) {
    const id = Number(row.id);
    const story =
      stories.get(id) ??
      {
        id,
        kind: row.kind,
        leadSourceId: row.lead_source_id === null ? null : Number(row.lead_source_id),
        publishedAt: ms(row.published_at),
        hidden: row.hidden_reason !== null,
        sources: [],
        verdicts: [],
        unjudged: [],
      };
    if (row.judge_version === null) {
      if (!story.unjudged.includes(row.symbol)) story.unjudged.push(row.symbol);
      stories.set(id, story);
      continue;
    }
    story.verdicts.push({
      symbol: row.symbol,
      version: row.judge_version,
      about: row.about === null ? null : Number(row.about),
      substance: row.substance === null ? null : Number(row.substance),
      verdict: row.verdict,
      kept: row.kept === true,
    });
    stories.set(id, story);
  }
  if (stories.size === 0) return [];
  const sources = (await sql.query(
    `select id, story_id, source, source_id, publisher, url, title, published_at, raw
     from story_sources where story_id = any($1::bigint[]) order by published_at`,
    [[...stories.keys()]],
  )) as { id: unknown; story_id: unknown; source: StorySource; source_id: string; publisher: string; url: string; title: string; published_at: unknown; raw: unknown }[];
  for (const row of sources) {
    stories.get(Number(row.story_id))?.sources.push({
      id: Number(row.id),
      source: row.source,
      sourceId: row.source_id,
      publisher: row.publisher,
      url: row.url,
      title: row.title,
      publishedAt: ms(row.published_at),
      raw: row.raw === null ? null : json<Record<string, unknown>>(row.raw),
    });
  }
  return [...stories.values()];
}

/** When the last ingest run finished well, epoch ms: the column's "Updated". */
export async function lastIngestAt(): Promise<number | undefined> {
  const rows = (await getSql().query(
    `select max(claimed_at) as at from news_fetch_slots where source = 'ingest' and ok is true`,
  )) as { at: unknown }[];
  const value = rows[0]?.at;
  return value === null || value === undefined ? undefined : ms(value);
}

/* — slots and budgets — */

/**
 * Claims `slot` of `source`. True for exactly one caller, and once more
 * after a failure (`retryAfterMs`) or a claim that died (`staleMs`), up to
 * `maxAttempts` in all. The same rule as lib/server/x-store claimSlot.
 */
export async function claimNewsSlot(
  source: string,
  slot: string,
  now: number,
  { retryAfterMs, staleMs, maxAttempts }: { retryAfterMs: number; staleMs: number; maxAttempts: number },
): Promise<boolean> {
  const rows = (await getSql().query(
    `insert into news_fetch_slots (source, slot, attempts, claimed_at, ok) values ($1, $2, 1, $3::timestamptz, null)
     on conflict (source, slot) do update set attempts = news_fetch_slots.attempts + 1, claimed_at = excluded.claimed_at, ok = null
       where news_fetch_slots.attempts < $4
         and ((news_fetch_slots.ok is false and news_fetch_slots.claimed_at <= $5::timestamptz)
           or (news_fetch_slots.ok is null and news_fetch_slots.claimed_at <= $6::timestamptz))
     returning slot`,
    [source, slot, at(now), maxAttempts, at(now - retryAfterMs), at(now - staleMs)],
  )) as unknown[];
  return rows.length > 0;
}

export async function finishNewsSlot(source: string, slot: string, result: { ok: boolean; requests: number }): Promise<void> {
  await getSql().query(`update news_fetch_slots set ok = $3, requests = $4 where source = $1 and slot = $2`, [
    source,
    slot,
    result.ok,
    result.requests,
  ]);
}

/** Whether `slot` of `source` is settled (fetched, or out of attempts), so a reader need not try. */
export async function newsSlotSettled(source: string, slot: string, maxAttempts: number): Promise<boolean> {
  const rows = (await getSql().query(`select attempts, ok from news_fetch_slots where source = $1 and slot = $2`, [source, slot])) as {
    attempts: number;
    ok: boolean | null;
  }[];
  const row = rows[0];
  return Boolean(row && (row.ok === true || Number(row.attempts) >= maxAttempts));
}

/** Takes `amount` from `source`'s day before it is spent; false when the cap would not hold. */
export async function reserveNews(source: string, day: string, amount: number, cap: number): Promise<boolean> {
  const sql = getSql();
  await sql.query(`insert into news_budget (source, day) values ($1, $2) on conflict do nothing`, [source, day]);
  const rows = (await sql.query(
    `update news_budget set reserved = reserved + $3 where source = $1 and day = $2 and used + reserved + $3 <= $4 returning day`,
    [source, day, amount, cap],
  )) as unknown[];
  return rows.length > 0;
}

/** Turns a reservation into what was really spent. */
export async function settleNews(
  source: string,
  day: string,
  { reserved, used, requests }: { reserved: number; used: number; requests: number },
): Promise<void> {
  await getSql().query(
    `update news_budget set reserved = greatest(reserved - $3, 0), used = used + $4, requests = requests + $5 where source = $1 and day = $2`,
    [source, day, reserved, used, requests],
  );
}

export async function newsSpent(source: string, day: string): Promise<{ used: number; reserved: number; requests: number }> {
  const rows = (await getSql().query(`select used, reserved, requests from news_budget where source = $1 and day = $2`, [source, day])) as {
    used: number;
    reserved: number;
    requests: number;
  }[];
  const row = rows[0];
  return { used: Number(row?.used ?? 0), reserved: Number(row?.reserved ?? 0), requests: Number(row?.requests ?? 0) };
}

/* — events — */

export type ListingEvent = {
  symbol: string;
  kind: "earnings" | "filing" | "dividend" | "split";
  /** ISO date, YYYY-MM-DD. */
  day: string;
  detail: Record<string, unknown>;
  source: "edgar" | "finnhub";
  sourceRef: string;
  shown: boolean;
};

/** Upserts events; a changed date or detail updates the row and its `updated_at`. */
export async function upsertEvents(events: readonly ListingEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  const rows = (await getSql().query(
    `insert into listing_events (symbol, kind, day, detail, source, source_ref, shown)
     select e->>'symbol', e->>'kind', (e->>'day')::date, e->'detail', e->>'source', e->>'sourceRef', (e->>'shown')::boolean
     from jsonb_array_elements($1::jsonb) as e
     on conflict (symbol, kind, source_ref) do update set
       day = excluded.day, detail = excluded.detail, shown = excluded.shown, updated_at = now()
       where listing_events.day <> excluded.day or listing_events.detail <> excluded.detail or listing_events.shown <> excluded.shown
     returning id`,
    [JSON.stringify(events)],
  )) as unknown[];
  return rows.length;
}

/** Shown events on or after `fromDay`, by date, then listing. */
export async function readEvents(fromDay: string, toDay: string): Promise<ListingEvent[]> {
  const rows = (await getSql().query(
    `select symbol, kind, to_char(day, 'YYYY-MM-DD') as day, detail, source, source_ref, shown
     from listing_events where shown and day >= $1::date and day <= $2::date order by day desc, symbol`,
    [fromDay, toDay],
  )) as { symbol: string; kind: ListingEvent["kind"]; day: string; detail: unknown; source: ListingEvent["source"]; source_ref: string; shown: boolean }[];
  return rows.map((row) => ({
    symbol: row.symbol,
    kind: row.kind,
    day: row.day,
    detail: json<Record<string, unknown>>(row.detail) ?? {},
    source: row.source,
    sourceRef: row.source_ref,
    shown: row.shown,
  }));
}

/* — pruning — */

/** Drops stories and answers older than `beforeMs`, slots older than `slotsBeforeMs`. The daily budgets stay, for the bill. */
export async function pruneNews(beforeMs: number, slotsBeforeMs: number): Promise<void> {
  const sql = getSql();
  await sql.query(`delete from stories where last_item_at < $1::timestamptz`, [at(beforeMs)]);
  await sql.query(`delete from jev_answers where at < $1::timestamptz`, [at(beforeMs)]);
  await sql.query(`delete from news_fetch_slots where claimed_at < $1::timestamptz`, [at(slotsBeforeMs)]);
  await sql.query(`delete from listing_events where day < ($1::timestamptz)::date - 90`, [at(beforeMs)]);
}
