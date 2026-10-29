import { createHash, createHmac } from "node:crypto";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { announcementExpired, NEW_LISTINGS_SEND_DAYS, newListingsRef, newListingsSwitchOn } from "@/lib/new-listings-window";
import { defaultWords, draftProblems, type DraftWords } from "@/lib/new-listings-draft";
import { getSql } from "@/lib/server/db";
import type { NewListingsNotice, NewListingsTestNotice } from "@/lib/server/email/compose";
import { deliver, deliverTest, listingsDailyCap, LISTINGS_TYPES, type DeliverOutcome, type NoticeInput } from "@/lib/server/email/send";
import { emailHmacKey } from "@/lib/server/email/token";
import { listingsDefaultOnSql, primaryEmailSql, recordUnsent, sendableAddress, sendsToday, suppressedAmong, usableAddressSql } from "@/lib/server/email/store";
import { maskEmail, scrubPersonal } from "@/lib/staff/mask";

/**
 * New stocks. Detection is automatic, sending is staff approved.
 *
 * DETECTING. The listing registry (lib/listings, stocks and funds, not the
 * cash shelf) against what Berth has seen: every symbol in listing_batches
 * (the 'baseline' taken the first production morning, which announces
 * nothing) plus the detected symbols of every announcement that is not
 * cancelled (or was cancelled after sending to anyone). What is live and not seen is "detected". Detection writes
 * only in production (VERCEL_ENV), where it records the baseline once; a
 * local run, a preview or a script writes nothing, so a branch's registry
 * never lands in production's seen set. Lining up, queuing, sending a test
 * and sending now are refused outside production for the same reason.
 * A listing removed and later re-added is not announced again; a renamed
 * symbol is announced as new. Never edit these tables by hand.
 *
 * ANNOUNCING. A staff admin lines up an announcement from what is
 * detected (lineUp), edits its words and picks its stocks (updateDraft),
 * takes people off its list (setExcluded), sends themselves a test
 * (sendTest), and queues it (queue). One announcement is open (a draft, or
 * being sent) at a time, which the database enforces.
 *
 * SENDING. A queued announcement is sent from the morning run
 * (continueAnnouncements) and once at the moment staff press send, within
 * the day's share of the cap (listingsDailyCap), oldest accounts first, one
 * email per person (email_sends type 'new_listings', ref
 * `<announcement id>:<user id>`). A big list goes out over the mornings
 * after. It is done when nobody eligible is left, or NEW_LISTINGS_SEND_DAYS
 * after it was queued, whichever is first, and records how many it did not
 * reach. EMAIL_NEW_LISTINGS=off is the kill switch for all of it.
 */

/** How many people a run looks at for each email its share of the cap still allows. */
export const NEW_LISTINGS_BATCH_FACTOR = 4;
export const BASELINE_BATCH = "baseline";

/**
 * The stock-kind symbols the registry listed at commit 8c5a3833 (before the
 * third shelf, 2026-10-29). When production records the baseline, the
 * first time anyone looks, it records exactly these and not the live
 * registry: the 21 stocks and the gold fund that went live on 2026-10-29
 * (fb5d6a54) shipped before this feature did, and recording the live
 * registry would have absorbed them as "already seen", so they could never
 * be announced. The baseline is written once; later registries are
 * detected against it. Do not edit this list afterwards.
 */
export const FIRST_BASELINE_SYMBOLS: readonly string[] = [
  "SPCX", "NVDA", "GME", "MSTR", "AAPL", "TSLA", "MU", "SNDK", "SPY", "QQQ", "USO", "SLV",
  "GOOGL", "AMZN", "MSFT", "META", "CRCL", "COIN", "PLTR", "TSM", "AMD", "INTC", "BABA",
];
/** A person who could not be sent for these reasons is not tried again for this announcement. */
const TERMINAL_UNSENT = ["no_address", "suppressed", "pref_off"] as const;
/** A failed send is retried on later mornings, this many tries at most. */
const MAX_TRIES = 3;

export { newListingsSwitchOn };

type Listing = { symbol: string; name: string };

/** The stock listings the registry has now, in its order. */
export function liveStocks(listings = TOKEN_LISTINGS): Listing[] {
  return listings.filter((listing) => listing.kind === "stock").map(({ symbol, name }) => ({ symbol, name }));
}

/** The plain names of `symbols` that are still live, in the registry's order. */
export function namesFor(symbols: readonly string[], listings = TOKEN_LISTINGS): string[] {
  const wanted = new Set(symbols);
  return liveStocks(listings)
    .filter((listing) => wanted.has(listing.symbol))
    .map((listing) => listing.name);
}

/**
 * The writes that line up, queue or send an announcement happen only in
 * production (VERCEL_ENV): a laptop or a preview that shares production's
 * database must not line up, queue or email from there.
 */
export const isProduction = (env: NodeJS.ProcessEnv = process.env) => env.VERCEL_ENV === "production";

export type ObserveOutcome =
  /** Outside production, with no baseline recorded yet: nothing is written and nothing can be detected. */
  | { kind: "baseline"; count: number; wrote: false }
  | { kind: "new"; detected: string[] }
  | { kind: "none" };

/** Every symbol Berth has seen: listing_batches and the detected symbols of announcements not cancelled. */
async function seenSymbols(): Promise<{ seen: Set<string>; empty: boolean }> {
  const sql = getSql();
  const batches = (await sql.query(`select symbols from listing_batches`)) as { symbols: string[] }[];
  // A cancelled announcement gives its stocks back, unless it had already written to someone.
  const announced = (await sql.query(
    `select a.detected from listing_announcements a
      where a.status <> 'cancelled'
         or exists (select 1 from email_sends s where s.type = 'new_listings' and s.status = 'sent' and s.ref like a.id::text || ':%')`,
  )) as { detected: string[] }[];
  const seen = new Set([...batches.flatMap((row) => row.symbols), ...announced.flatMap((row) => row.detected)]);
  return { seen, empty: batches.length === 0 && announced.length === 0 };
}

/**
 * What the registry lists that Berth has not seen. In production, with
 * nothing recorded yet, it first records the baseline, which is the pinned
 * FIRST_BASELINE_SYMBOLS and not the live registry, and then detects
 * against it, so what went live after that list is detected at once.
 * Outside production it writes nothing at all (and, before a baseline
 * exists, detects nothing: "baseline").
 */
export async function observeListings({
  listings = TOKEN_LISTINGS,
  production = isProduction(),
  baselineSymbols = FIRST_BASELINE_SYMBOLS,
}: { listings?: typeof TOKEN_LISTINGS; production?: boolean; baselineSymbols?: readonly string[] } = {}): Promise<ObserveOutcome> {
  const live = liveStocks(listings).map((listing) => listing.symbol);
  const state = await seenSymbols();
  let seen = state.seen;
  if (state.empty) {
    if (!production) return { kind: "baseline", count: baselineSymbols.length, wrote: false };
    await getSql().query(`insert into listing_batches (id, symbols) values ($1, $2::text[]) on conflict (id) do nothing`, [BASELINE_BATCH, [...baselineSymbols]]);
    seen = new Set(baselineSymbols);
  }
  const detected = live.filter((symbol) => !seen.has(symbol));
  return detected.length > 0 ? { kind: "new", detected } : { kind: "none" };
}

export type AnnouncementStatus = "draft" | "sending" | "done" | "cancelled";

export type Announcement = {
  id: string;
  detected: string[];
  chosen: string[];
  words: DraftWords;
  status: AnnouncementStatus;
  createdBy: string | null;
  queuedBy: string | null;
  createdAt: string;
  queuedAt: string | null;
  finishedAt: string | null;
  notReached: number | null;
  /** The row's last change, as the database prints it: what a queue checks was not changed under it. */
  version: string;
};

type AnnouncementRow = {
  id: string;
  detected: string[];
  chosen: string[];
  subject: string;
  preview: string;
  intro: string;
  extra: string;
  status: AnnouncementStatus;
  created_by: string | null;
  queued_by: string | null;
  created_at: Date | string;
  queued_at: Date | string | null;
  finished_at: Date | string | null;
  not_reached: number | null;
  ver: string;
};

const iso = (value: Date | string | null): string | null => (value === null ? null : new Date(value).toISOString());

function toAnnouncement(row: AnnouncementRow): Announcement {
  return {
    id: row.id,
    detected: row.detected,
    chosen: row.chosen,
    words: { subject: row.subject, preview: row.preview, intro: row.intro, extra: row.extra },
    status: row.status,
    createdBy: row.created_by,
    queuedBy: row.queued_by,
    createdAt: iso(row.created_at) as string,
    queuedAt: iso(row.queued_at),
    finishedAt: iso(row.finished_at),
    notReached: row.not_reached,
    version: row.ver,
  };
}

const COLUMNS = `id, detected, chosen, subject, preview, intro, extra, status, created_by, queued_by, created_at, queued_at, finished_at, not_reached, updated_at::text as ver`;

/** The one open announcement (a draft, or being sent), if any. */
export async function openAnnouncement(): Promise<Announcement | null> {
  const rows = (await getSql().query(`select ${COLUMNS} from listing_announcements where status in ('draft', 'sending') limit 1`)) as AnnouncementRow[];
  return rows[0] ? toAnnouncement(rows[0]) : null;
}

export async function getAnnouncement(id: string): Promise<Announcement | null> {
  if (!UUID.test(id)) return null;
  const rows = (await getSql().query(`select ${COLUMNS} from listing_announcements where id = $1::uuid`, [id])) as AnnouncementRow[];
  return rows[0] ? toAnnouncement(rows[0]) : null;
}

/** The finished and cancelled announcements, newest first. */
export async function pastAnnouncements(limit = 10): Promise<Announcement[]> {
  const rows = (await getSql().query(
    `select ${COLUMNS} from listing_announcements where status in ('done', 'cancelled') order by created_at desc limit $1`,
    [limit],
  )) as AnnouncementRow[];
  return rows.map(toAnnouncement);
}

/**
 * An announcement that reached people, or may still: queued and sending,
 * or done or cancelled after at least one send. `o` is its alias. A draft,
 * or one that ended before anyone was written to, did not reach anyone and
 * does not count (its stocks are offered again, and the 7 days do not wait
 * for it).
 */
const reachedSql = (o: string) =>
  `(${o}.queued_at is not null and (${o}.status = 'sending'
      or (${o}.status in ('done', 'cancelled') and exists (select 1 from email_sends s where s.type = 'new_listings' and s.status = 'sent' and s.ref like ${o}.id::text || ':%'))))`;

/** When the last announcement that reached people was queued, or null: a new one waits 7 days after it. */
export async function lastQueuedAt(): Promise<string | null> {
  const rows = (await getSql().query(`select max(o.queued_at) as at from listing_announcements o where ${reachedSql("o")}`)) as { at: Date | string | null }[];
  return iso(rows[0]?.at ?? null);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ActResult<T = Announcement> = { ok: true; value: T } | { ok: false; reason: string; problems?: string[] };

/** The staff audit row an act writes in its own statement, so the act and its record commit together or not at all. */
export type Audit = { staffUserId: string; action: string; detail?: Record<string, unknown> };

/**
 * SQL for the audit row, selected `from` the rows the act changed (a CTE
 * named `source`): an act that changed nothing leaves no row. Its
 * parameters are appended to `params`. Like lib/server/staff-gate auditCte,
 * the target and detail are scrubbed of any address.
 */
function auditFrom(params: unknown[], audit: Audit, target: string, source: string): string {
  params.push(audit.staffUserId, audit.action, scrubPersonal(target).slice(0, 200), JSON.stringify(scrubPersonal({ outcome: "done", ...(audit.detail ?? {}) })));
  const n = params.length;
  return `insert into staff_audit (staff_user_id, action, target, detail) select $${n - 3}::uuid, $${n - 2}::text, $${n - 1}::text, $${n}::jsonb from ${source} limit 1 returning id`;
}

/** Creates a draft for what is detected now, its words from copy.ts. Refuses when nothing is new or one is open. */
export async function lineUp({
  staffId,
  listings = TOKEN_LISTINGS,
  production = isProduction(),
  audit,
}: {
  staffId: string | null;
  listings?: typeof TOKEN_LISTINGS;
  production?: boolean;
  audit?: Audit;
}): Promise<ActResult> {
  if (!production) return { ok: false, reason: "not_production" };
  if (await openAnnouncement()) return { ok: false, reason: "open_exists" };
  const observed = await observeListings({ listings, production });
  if (observed.kind !== "new") return { ok: false, reason: "nothing_new" };
  const words = defaultWords(observed.detected.length);
  const params: unknown[] = [observed.detected, words.subject, words.preview, words.intro, words.extra, staffId];
  const auditSql = audit ? `, audit as (${auditFrom(params, audit, "announcement", "ins")})` : "";
  try {
    const rows = (await getSql().query(
      `with ins as (
         insert into listing_announcements (detected, chosen, subject, preview, intro, extra, created_by)
         values ($1::text[], $1::text[], $2, $3, $4, $5, $6)
         returning ${COLUMNS})${auditSql}
       select * from ins`,
      params,
    )) as AnnouncementRow[];
    return { ok: true, value: toAnnouncement(rows[0]) };
  } catch (error) {
    // The one open announcement index: another press got there first.
    if ((error as { code?: string })?.code === "23505") return { ok: false, reason: "open_exists" };
    throw error;
  }
}

export type DraftPatch = Partial<DraftWords> & { chosen?: readonly string[] };

/**
 * Saves staff's edits to a draft after checking them (lib/new-listings-draft).
 * When the stocks ticked change the count, any of subject, preview and intro
 * still equal to the default for the old count follows the new count.
 */
export async function updateDraft(id: string, patch: DraftPatch, audit?: Audit): Promise<ActResult> {
  const current = await getAnnouncement(id);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.status !== "draft") return { ok: false, reason: "not_draft" };
  const detected = new Set(current.detected);
  const chosen = patch.chosen ? current.detected.filter((symbol) => (patch.chosen as readonly string[]).includes(symbol)) : current.chosen;
  if (patch.chosen && patch.chosen.some((symbol) => !detected.has(symbol))) return { ok: false, reason: "unknown_stock" };
  const words: DraftWords = {
    subject: patch.subject ?? current.words.subject,
    preview: patch.preview ?? current.words.preview,
    intro: patch.intro ?? current.words.intro,
    extra: patch.extra ?? current.words.extra,
  };
  if (chosen.length !== current.chosen.length && chosen.length > 0) {
    const before = defaultWords(current.chosen.length);
    const after = defaultWords(chosen.length);
    for (const field of ["subject", "preview", "intro"] as const) {
      if (patch[field] === undefined && current.words[field] === before[field]) words[field] = after[field];
    }
  }
  const problems = draftProblems(words, chosen.length, TOKEN_LISTINGS);
  if (problems.length > 0) return { ok: false, reason: "invalid", problems };
  const params: unknown[] = [id, chosen, words.subject.trim(), words.preview.trim(), words.intro.trim(), words.extra.trim()];
  const auditSql = audit ? `, audit as (${auditFrom(params, audit, `announcement:${id}`, "act")})` : "";
  const rows = (await getSql().query(
    `with act as (
       update listing_announcements set chosen = $2::text[], subject = $3, preview = $4, intro = $5, extra = $6, updated_at = now()
        where id = $1::uuid and status = 'draft' returning ${COLUMNS})${auditSql}
     select * from act`,
    params,
  )) as AnnouncementRow[];
  return rows[0] ? { ok: true, value: toAnnouncement(rows[0]) } : { ok: false, reason: "not_draft" };
}

/**
 * Takes a person off (or puts them back on) an open announcement's list.
 * Taking off works while it sends (and is re-checked before each send);
 * putting back works on a draft only, so nobody joins a list that was
 * already approved and is under way.
 */
export async function setExcluded(id: string, userId: string, excluded: boolean, audit?: Audit): Promise<ActResult<boolean>> {
  if (!UUID.test(userId)) return { ok: false, reason: "not_found" };
  const current = await getAnnouncement(id);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.status !== "draft" && current.status !== "sending") return { ok: false, reason: "closed" };
  if (!excluded && current.status === "sending") return { ok: false, reason: "sending" };
  const params: unknown[] = [id, userId];
  const auditSql = audit ? `, audit as (${auditFrom(params, audit, `announcement:${id}`, "change")})` : "";
  await getSql().query(
    excluded
      ? `with change as (
           insert into listing_announcement_exclusions (announcement_id, user_id) values ($1::uuid, $2::uuid) on conflict do nothing returning user_id),
         bump as (update listing_announcements set updated_at = now() where id = $1::uuid and exists (select 1 from change) returning id)${auditSql}
         select count(*)::int as changed from change`
      : `with change as (
           delete from listing_announcement_exclusions where announcement_id = $1::uuid and user_id = $2::uuid returning user_id),
         bump as (update listing_announcements set updated_at = now() where id = $1::uuid and exists (select 1 from change) returning id)${auditSql}
         select count(*)::int as changed from change`,
    params,
  );
  return { ok: true, value: excluded };
}

/**
 * Cancels a draft or an announcement being sent. What was already sent
 * stays sent and no one more is written to. A draft, or a send that had
 * reached no one, gives its stocks back to be detected again; one that had
 * sent to anyone keeps them seen, so the same stocks are not announced to
 * the same people twice.
 */
export async function cancel(id: string, audit?: Audit): Promise<ActResult> {
  if (!UUID.test(id)) return { ok: false, reason: "not_found" };
  const params: unknown[] = [id];
  const auditSql = audit ? `, audit as (${auditFrom(params, audit, `announcement:${id}`, "act")})` : "";
  const rows = (await getSql().query(
    `with act as (
       update listing_announcements set status = 'cancelled', finished_at = now(), updated_at = now()
        where id = $1::uuid and status in ('draft', 'sending') returning ${COLUMNS})${auditSql}
     select * from act`,
    params,
  )) as AnnouncementRow[];
  return rows[0] ? { ok: true, value: toAnnouncement(rows[0]) } : { ok: false, reason: "not_open" };
}

/**
 * What staff approve: a hash of the draft's words, its ticked stocks and the
 * people taken off its list. The page shows it with the draft and sends it
 * back with the press of send; queue refuses when what is stored differs.
 */
async function hashOf(announcement: Announcement): Promise<string> {
  const rows = (await getSql().query(
    `select user_id::text as id from listing_announcement_exclusions where announcement_id = $1::uuid order by user_id`,
    [announcement.id],
  )) as { id: string }[];
  const { subject, preview, intro, extra } = announcement.words;
  return createHash("sha256")
    .update(JSON.stringify([subject, preview, intro, extra, [...announcement.chosen].sort(), rows.map((row) => row.id)]))
    .digest("hex")
    .slice(0, 32);
}

/** The hash (see hashOf) of an announcement as stored now, or null when there is none by that id. */
export async function draftHash(id: string): Promise<string | null> {
  const current = await getAnnouncement(id);
  return current ? hashOf(current) : null;
}

/**
 * Draft to sending, in one statement: two presses queue it once. Refuses
 * outside production and while the kill switch is off, when the words,
 * stocks or exclusions are not what `hash` says staff approved, when the
 * words fail their check, and when another announcement reached people
 * under NEW_LISTINGS_SEND_DAYS ago (a hard stop, not a warning).
 */
export async function queue(
  id: string,
  staffId: string | null,
  { hash, env = process.env, audit }: { hash: string; env?: NodeJS.ProcessEnv; audit?: Audit },
): Promise<ActResult> {
  if (!isProduction(env)) return { ok: false, reason: "not_production" };
  if (!newListingsSwitchOn(env)) return { ok: false, reason: "switch_off" };
  const current = await getAnnouncement(id);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.status !== "draft") return { ok: false, reason: "not_draft" };
  const problems = draftProblems(current.words, current.chosen.length, TOKEN_LISTINGS);
  if (problems.length > 0) return { ok: false, reason: "invalid", problems };
  if ((await hashOf(current)) !== hash) return { ok: false, reason: "changed" };
  const params: unknown[] = [id, staffId, current.version, NEW_LISTINGS_SEND_DAYS];
  const auditSql = audit ? `, audit as (${auditFrom(params, audit, `announcement:${id}`, "act")})` : "";
  const rows = (await getSql().query(
    `with act as (
       update listing_announcements as a set status = 'sending', queued_by = $2, queued_at = now(), updated_at = now()
        where a.id = $1::uuid and a.status = 'draft' and a.updated_at::text = $3
          and not exists (select 1 from listing_announcements o where o.id <> a.id and o.queued_at > now() - make_interval(days => $4::int) and ${reachedSql("o")})
        returning ${COLUMNS.split(", ").map((column) => (column.startsWith("updated_at") ? "a.updated_at::text as ver" : `a.${column}`)).join(", ")})${auditSql}
     select * from act`,
    params,
  )) as AnnouncementRow[];
  if (rows[0]) return { ok: true, value: toAnnouncement(rows[0]) };
  // Not queued: say why (the row moved, or another announcement went out too recently).
  const again = await getAnnouncement(id);
  if (!again || again.status !== "draft") return { ok: false, reason: "not_draft" };
  const last = await lastQueuedAt();
  if (last && Date.now() < new Date(last).getTime() + NEW_LISTINGS_SEND_DAYS * 86_400_000) return { ok: false, reason: "too_soon" };
  return { ok: false, reason: "changed" };
}

/** The notice an announcement sends: its chosen stocks still live, and its words. Null when none is left. */
export function announcementNotice(announcement: Announcement, listings = TOKEN_LISTINGS): NewListingsNotice | null {
  const names = namesFor(announcement.chosen, listings);
  return names.length > 0 ? { type: "new_listings", names, words: announcement.words } : null;
}

/** Sends the draft, subject marked "Test: ", to the staff member's own primary email and no one else. */
export async function sendTest(
  id: string,
  staffUserId: string,
  {
    listings = TOKEN_LISTINGS,
    send = deliverTest,
    now = Date.now,
    production = isProduction(),
  }: { listings?: typeof TOKEN_LISTINGS; send?: (input: NoticeInput) => Promise<DeliverOutcome>; now?: () => number; production?: boolean } = {},
): Promise<ActResult<DeliverOutcome>> {
  if (!production) return { ok: false, reason: "not_production" };
  const current = await getAnnouncement(id);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.status !== "draft" && current.status !== "sending") return { ok: false, reason: "closed" };
  const notice = announcementNotice(current, listings);
  if (!notice) return { ok: false, reason: "no_stocks" };
  const test: NewListingsTestNotice = { ...notice, type: "new_listings_test" };
  const outcome = await send({ userId: staffUserId, ref: `${id}:${staffUserId}:${now()}`, notice: test });
  return { ok: true, value: outcome };
}

/**
 * The people an announcement would reach: not merged away, a usable
 * verified primary email (shaped, not suppressed), New stocks on (their own
 * row, else the consent rule, listingsDefaultOnSql), not written to by
 * another New stocks email in the last NEW_LISTINGS_SEND_DAYS days, and
 * (unless `includeExcluded`) not taken off its list. `send` narrows it to
 * those still to be written to: not claimed for this announcement
 * (including by an account merged into them), or failed before with tries
 * left; `today` further holds back a failure of this UTC day until the
 * next. Parameters: $1 the announcement id; $2 the terminal reasons, when
 * `send`.
 */
function eligibleFrom(options: { send: boolean; today?: boolean; includeExcluded?: boolean }): string {
  const sendFilter = options.send
    ? `
        and (s.id is null
             or (s.status = 'failed' and s.attempts < ${MAX_TRIES}
                 and coalesce(s.error, '') <> all ($2::text[])${options.today ? `
                 and s.created_at < date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'` : ""}))
        and not exists (
          select 1 from email_sends s2 join users r on r.id = s2.user_id
           where r.retired_into = u.id and s2.type = 'new_listings'
             and s2.ref = $1 || ':' || r.id::text and s2.status in ('sent', 'pending'))`
    : "";
  const excludedFilter = options.includeExcluded
    ? ""
    : `
        and not exists (select 1 from listing_announcement_exclusions x where x.announcement_id = $1::uuid and x.user_id = u.id)`;
  return `from users u
       left join email_prefs p on p.user_id = u.id and p.kind = 'listings'
       left join email_sends s on s.type = 'new_listings' and s.ref = $1 || ':' || u.id::text
      where u.retired_into is null
        and coalesce(p.enabled, ${listingsDefaultOnSql("u.id")})
        and ${usableAddressSql("u.id")}
        and not exists (
          select 1 from email_sends r where r.user_id = u.id and r.type = 'new_listings' and r.status = 'sent'
             and r.ref not like $1 || ':%' and r.created_at > now() - make_interval(days => ${NEW_LISTINGS_SEND_DAYS}))${excludedFilter}${sendFilter}`;
}

/**
 * Who this run may write to: untried people first, then whoever a failed
 * send left behind (not on the day it failed), oldest accounts first. People
 * with no usable address or a suppressed one are recorded as unsent so they
 * are not asked again (the query already leaves them out; this catches one
 * that changed in between).
 */
async function candidates(announcementId: string, limit: number): Promise<string[]> {
  const rows = (await getSql().query(
    `select u.id as user_id, (${primaryEmailSql("u.id")}) as address
       ${eligibleFrom({ send: true, today: true })}
      order by (s.id is not null), u.created_at, u.id
      limit $3`,
    [announcementId, [...TERMINAL_UNSENT], limit],
  )) as { user_id: string; address: string | null }[];
  const dropped: { userId: string; reason: "no_address" | "suppressed" }[] = [];
  const people = rows.flatMap((row) => {
    const address = sendableAddress(row.address);
    if (!address) dropped.push({ userId: row.user_id, reason: "no_address" });
    return address ? [{ userId: row.user_id, address }] : [];
  });
  const suppressed = await suppressedAmong(people.map((person) => person.address));
  for (const person of people) {
    if (suppressed.has(person.address)) dropped.push({ userId: person.userId, reason: "suppressed" });
  }
  await Promise.all(
    dropped.map(({ userId, reason }) => recordUnsent(userId, "new_listings", newListingsRef(announcementId, userId), reason).catch(() => undefined)),
  );
  return people.filter((person) => !suppressed.has(person.address)).map((person) => person.userId);
}

/**
 * How many people an announcement still has a claim on: eligible, and
 * either not written to yet or failed with tries left, on any day. It is
 * done only when this is zero, however a run's own fetch came out.
 */
async function remainingCount(announcementId: string): Promise<number> {
  const rows = (await getSql().query(`select count(*)::int as n ${eligibleFrom({ send: true })}`, [announcementId, [...TERMINAL_UNSENT]])) as { n: number }[];
  return rows[0]?.n ?? 0;
}

/** How many of the people eligible for an announcement have no sent or pending email for it. */
async function unreachedCount(announcementId: string): Promise<number> {
  const rows = (await getSql().query(
    `select count(*)::int as n ${eligibleFrom({ send: false })} and (s.id is null or s.status = 'failed')`,
    [announcementId],
  )) as { n: number }[];
  return rows[0]?.n ?? 0;
}

async function finish(announcementId: string): Promise<number> {
  const notReached = await unreachedCount(announcementId);
  await getSql().query(
    `update listing_announcements set status = 'done', finished_at = now(), not_reached = $2, updated_at = now()
      where id = $1::uuid and status = 'sending'`,
    [announcementId, notReached],
  );
  return notReached;
}

/** What the page shows for sends that did not go: the count and why, reason by reason. */
export type NotSent = { count: number; reasons: Record<string, number> };
export type Progress = { sent: number; waiting: number; notSent: NotSent; notReached: number | null };

/** Counts for staff: sent, waiting (eligible and not yet written to), not sent (tried, by reason) and, once done, not reached. */
export async function progressOf(announcement: Announcement): Promise<Progress> {
  const sql = getSql();
  const counts = (await sql.query(
    `select status, coalesce(error, '') as error, count(*)::int as n
       from email_sends where type = 'new_listings' and ref like $1 || ':%' and status in ('sent', 'failed')
      group by status, coalesce(error, '')`,
    [announcement.id],
  )) as { status: string; error: string; n: number }[];
  const reasons: Record<string, number> = {};
  let sent = 0;
  for (const row of counts) {
    if (row.status === "sent") sent += row.n;
    else reasons[row.error || "other"] = (reasons[row.error || "other"] ?? 0) + row.n;
  }
  let waiting = 0;
  if (announcement.status === "sending") {
    const rows = (await sql.query(`select count(*)::int as n ${eligibleFrom({ send: true })}`, [announcement.id, [...TERMINAL_UNSENT]])) as { n: number }[];
    waiting = rows[0]?.n ?? 0;
  }
  const count = Object.values(reasons).reduce((total, n) => total + n, 0);
  return { sent, waiting, notSent: { count, reasons }, notReached: announcement.notReached };
}

export type ContinueSummary = {
  /** The announcement being sent, or null when none is. */
  announcement: string | null;
  /** False while EMAIL_NEW_LISTINGS is "off": nothing is sent. */
  switchOn: boolean;
  sent: number;
  notSent: number;
  /** Left for tomorrow: the deadline, or the day's share of the cap. */
  deferred: number;
  /** The announcement was finished this run (nobody left, or its days are over). */
  finished: boolean;
  /** Staff cancelled it while this run was sending. */
  stopped?: boolean;
};

/** Read before each send: the announcement's status now, and whether this person was taken off its list since. */
async function stillGoing(announcementId: string, userId: string): Promise<{ sending: boolean; excluded: boolean }> {
  const rows = (await getSql().query(
    `select (select status from listing_announcements where id = $1::uuid) as status,
            exists (select 1 from listing_announcement_exclusions where announcement_id = $1::uuid and user_id = $2::uuid) as excluded`,
    [announcementId, userId],
  )) as { status: string | null; excluded: boolean }[];
  return { sending: rows[0]?.status === "sending", excluded: rows[0]?.excluded === true };
}

/**
 * Sends the announcement being sent to as many of its people as the day's
 * share of the cap and the deadline allow, and finishes it when nobody has
 * a claim left (remainingCount) or its days are over. Used by the morning
 * run (a small top-up) and by staff's presses (sendNow). Before each send it
 * re-reads whether staff cancelled the announcement or took that person off
 * the list. Every outcome but a send is recorded (recordUnsent), so the
 * next run tries the untried first.
 */
export async function continueAnnouncements({
  now = new Date(),
  deadline = Number.POSITIVE_INFINITY,
  clock = Date.now,
  send = deliver,
  listings = TOKEN_LISTINGS,
  switchOn = newListingsSwitchOn(),
}: {
  now?: Date;
  deadline?: number;
  clock?: () => number;
  send?: (input: NoticeInput) => Promise<DeliverOutcome>;
  listings?: typeof TOKEN_LISTINGS;
  switchOn?: boolean;
} = {}): Promise<ContinueSummary> {
  const summary: ContinueSummary = { announcement: null, switchOn, sent: 0, notSent: 0, deferred: 0, finished: false };
  const open = await openAnnouncement();
  if (!open || open.status !== "sending") return summary;
  summary.announcement = open.id;
  if (!switchOn) return summary;
  if (open.queuedAt && announcementExpired(open.queuedAt, now)) {
    await finish(open.id);
    summary.finished = true;
    return summary;
  }
  if (clock() >= deadline) return summary;
  const notice = announcementNotice(open, listings);
  if (!notice) {
    await finish(open.id);
    summary.finished = true;
    return summary;
  }
  const room = listingsDailyCap() - (await sendsToday(LISTINGS_TYPES));
  if (room <= 0) return summary;
  const people = await candidates(open.id, room * NEW_LISTINGS_BATCH_FACTOR);
  if (people.length === 0) {
    // Nobody to write to this run. It is done only when nobody has a claim left at all
    // (a failure from today waits for tomorrow; a fetch that was all dropped is not the end).
    if ((await remainingCount(open.id)) === 0) {
      await finish(open.id);
      summary.finished = true;
    }
    return summary;
  }
  for (const [index, userId] of people.entries()) {
    if (summary.sent >= room || clock() >= deadline) {
      summary.deferred += people.length - index;
      break;
    }
    const going = await stillGoing(open.id, userId);
    if (!going.sending) {
      summary.stopped = true;
      break;
    }
    if (going.excluded) continue;
    const ref = newListingsRef(open.id, userId);
    let outcome: DeliverOutcome;
    try {
      outcome = await send({ userId, ref, notice });
    } catch (error) {
      console.warn("[new-listings] send failed", error instanceof Error ? error.name : "error");
      summary.notSent += 1;
      await recordUnsent(userId, "new_listings", ref, "build").catch(() => undefined);
      continue;
    }
    if (outcome === "sent") summary.sent += 1;
    else if (outcome === "daily_volume" || outcome === "off") {
      summary.deferred += people.length - index;
      break;
    } else {
      summary.notSent += 1;
      if (outcome === "no_address" || outcome === "suppressed" || outcome === "pref_off") {
        await recordUnsent(userId, "new_listings", ref, outcome).catch(() => undefined);
      }
    }
  }
  return summary;
}

/** How long a staff press may spend sending inside its request: well under the route's maxDuration, so a slow provider call cannot pass it. */
export const SEND_NOW_MS = 15_000;

/**
 * Staff's "Send today's share now": sends the announcement being sent to
 * as many people as today's New stocks share still allows, within `deadline`.
 * Refused outside production, while the kill switch is off, when nothing
 * is being sent and when today's share is used.
 */
export async function sendNow({
  deadline,
  production = isProduction(),
  env = process.env,
  ...options
}: {
  deadline: number;
  production?: boolean;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  clock?: () => number;
  send?: (input: NoticeInput) => Promise<DeliverOutcome>;
  listings?: typeof TOKEN_LISTINGS;
}): Promise<ActResult<ContinueSummary>> {
  if (!production) return { ok: false, reason: "not_production" };
  if (!newListingsSwitchOn(env)) return { ok: false, reason: "switch_off" };
  const open = await openAnnouncement();
  if (!open || open.status !== "sending") return { ok: false, reason: "not_sending" };
  if (listingsDailyCap() - (await sendsToday(LISTINGS_TYPES)) <= 0) return { ok: false, reason: "share_used" };
  return { ok: true, value: await continueAnnouncements({ ...options, deadline, switchOn: true }) };
}

export type RecipientRow = {
  /** Opaque to the browser (never the account id): the staff page sends it back to exclude or include. */
  key: string;
  /** Username or handle when the person has one. */
  label: string | null;
  /** The staff area's mask (lib/staff/mask): first character, a shared webmail domain whole, any other domain shortened. */
  masked: string;
  why: "Filled an order" | "Turned it on";
  excluded: boolean;
};

/** The browser's handle for one person on one announcement's list: an HMAC with a server secret, not the account id or a bare hash. */
export function recipientKey(announcementId: string, userId: string, env: NodeJS.ProcessEnv = process.env): string {
  return createHmac("sha256", emailHmacKey("new-listings-recipient-v1", env)).update(`${announcementId}:${userId}`).digest("hex").slice(0, 20);
}

/**
 * The list staff see: everyone the announcement would reach (consent rule,
 * usable verified primary email, not merged away), with those taken off
 * marked. Oldest accounts first, the order they are written to. Masked,
 * never a full address or account id. `limit` bounds only what is listed;
 * the counts (recipientCounts) and the lookup of a key cover everyone.
 */
async function recipientRows(announcementId: string, limit: number): Promise<RecipientRow[]> {
  const found = (await getSql().query(
    `select u.id as user_id, (select h.handle from handles h where h.user_id = u.id limit 1) as username, (${primaryEmailSql("u.id")}) as address,
            p.enabled is not null as own,
            exists (select 1 from listing_announcement_exclusions x where x.announcement_id = $1::uuid and x.user_id = u.id) as excluded
       ${eligibleFrom({ send: false, includeExcluded: true })}
      order by u.created_at, u.id
      limit $2`,
    [announcementId, limit],
  )) as { user_id: string; username: string | null; address: string | null; own: boolean; excluded: boolean }[];
  return found.flatMap((row) => {
    const address = sendableAddress(row.address);
    if (!address) return [];
    return [{ key: recipientKey(announcementId, row.user_id), label: row.username, masked: maskEmail(address) ?? "***", why: row.own ? ("Turned it on" as const) : ("Filled an order" as const), excluded: row.excluded }];
  });
}

export async function recipientsOf(announcementId: string, limit = 2000): Promise<RecipientRow[]> {
  return recipientRows(announcementId, limit);
}

/**
 * How many people the announcement would write to (eligible and not taken
 * off) and how many are on the list in all (taken off included), counted
 * in SQL over everyone, not over the capped list on the page.
 */
export async function recipientCounts(announcementId: string): Promise<{ sendCount: number; total: number }> {
  const sql = getSql();
  const [send, all] = (await Promise.all([
    sql.query(`select count(*)::int as n ${eligibleFrom({ send: false })}`, [announcementId]),
    sql.query(`select count(*)::int as n ${eligibleFrom({ send: false, includeExcluded: true })}`, [announcementId]),
  ])) as { n: number }[][];
  return { sendCount: send[0]?.n ?? 0, total: all[0]?.n ?? 0 };
}

/** Takes a person off (or back onto) an open announcement's list by the key staff were shown, whoever is on it, however long the list. */
export async function setExcludedByKey(announcementId: string, key: string, excluded: boolean, audit?: Audit): Promise<ActResult<boolean>> {
  const ids = (await getSql().query(`select u.id as user_id ${eligibleFrom({ send: false, includeExcluded: true })}`, [announcementId])) as { user_id: string }[];
  const match = ids.find((row) => recipientKey(announcementId, row.user_id) === key);
  if (!match) return { ok: false, reason: "not_found" };
  return setExcluded(announcementId, match.user_id, excluded, audit ? { ...audit, detail: { ...audit.detail, key } } : undefined);
}

export type NewListingsRunSummary = {
  /** What the registry check found this morning. */
  observed: ObserveOutcome["kind"];
  /** How many stocks are detected and not yet announced. */
  detected: number;
  /** What the sending part did. */
  sending: ContinueSummary;
};

/**
 * The morning stage: detects new listings (recording the baseline in
 * production, nothing else) and tops up the announcement staff queued,
 * within the day's share and the stage's deadline (staff's presses do the
 * bulk of the day's share, sendNow). It never opens an announcement or
 * sends one nobody approved.
 */
export async function runNewListings({
  now = new Date(),
  deadline = Number.POSITIVE_INFINITY,
  clock = Date.now,
  send = deliver,
  listings = TOKEN_LISTINGS,
  switchOn = newListingsSwitchOn(),
  production = isProduction(),
}: {
  now?: Date;
  deadline?: number;
  clock?: () => number;
  send?: (input: NoticeInput) => Promise<DeliverOutcome>;
  listings?: typeof TOKEN_LISTINGS;
  switchOn?: boolean;
  production?: boolean;
} = {}): Promise<NewListingsRunSummary> {
  const observed = await observeListings({ listings, production });
  const sending = await continueAnnouncements({ now, deadline, clock, send, listings, switchOn });
  return { observed: observed.kind, detected: observed.kind === "new" ? observed.detected.length : 0, sending };
}
