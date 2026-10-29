import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { listingsDailyCap, retryPendingSends, setBackoff, setEmailTransport } from "@/lib/server/email/send";
import type { OutgoingEmail } from "@/lib/server/email/resend";
import { readPrefs, setPref } from "@/lib/server/email/store";
import { staffEmailsState } from "@/lib/server/staff/emails";
import { newListingsRef } from "@/lib/new-listings-window";
import {
  FIRST_BASELINE_SYMBOLS,
  liveStocks,
  cancel,
  continueAnnouncements,
  getAnnouncement,
  progressOf,
  lineUp,
  observeListings,
  openAnnouncement,
  draftHash,
  queue,
  sendNow,
  recipientCounts,
  recipientKey,
  recipientsOf,
  setExcludedByKey,
  runNewListings,
  sendTest,
  setExcluded,
  updateDraft,
} from "./new-listings";

/**
 * New stocks against the real schema: the consent rule, detection that
 * writes only in production, the staff flow (line up, edit, exclude, test,
 * queue once), sending within the day's share over several mornings, done
 * when nobody is left, and the kill switch.
 */

let sql: SqlClient;
let close: () => Promise<void>;
let sent: OutgoingEmail[];

const STOCKS = TOKEN_LISTINGS.filter((listing) => listing.kind === "stock");
/** The registry as it stood before a deploy: all but the last three stocks. */
const BEFORE = TOKEN_LISTINGS.filter((listing) => !STOCKS.slice(-3).includes(listing));
const ADDED = STOCKS.slice(-3);
/** Where the baseline stands in these tests: the registry as it was before the three added stocks (the real pinned list is tested on its own). */
const BASELINE = liveStocks(BEFORE).map((listing) => listing.symbol);
const observe = (options: { listings?: typeof TOKEN_LISTINGS; production?: boolean } = {}) => observeListings({ baselineSymbols: BASELINE, ...options });

beforeAll(async () => {
  const db = await makeTestDb();
  sql = db.sql;
  close = db.close;
  setSqlClient(sql);
  setBackoff([]);
});

afterAll(async () => {
  setEmailTransport(null);
  setBackoff(null);
  setSqlClient(null);
  vi.unstubAllEnvs();
  await close();
});

beforeEach(async () => {
  vi.stubEnv("EMAIL_TOKEN_SECRET", "new-listings-db-test-secret");
  // Lining up, queuing and sending write only in production (VERCEL_ENV).
  vi.stubEnv("VERCEL_ENV", "production");
  sent = [];
  setEmailTransport(async (email) => {
    sent.push(email);
    return { ok: true, id: "re_test" };
  });
  for (const table of ["listing_announcement_exclusions", "listing_announcements", "listing_batches", "limit_orders", "orders", "email_sends", "email_prefs", "email_suppressions", "terms_acceptances", "user_identities", "users"]) {
    await sql.query(`delete from ${table}`);
  }
});

afterEach(() => {
  setEmailTransport(null);
  vi.unstubAllEnvs();
});

let people = 0;
async function account(email: string | null): Promise<string> {
  people += 1;
  const rows = (await sql.query(`insert into users (privy_did, wallet_address, email) values ($1, $2, $3) returning id`, [
    `did:privy:listings-${people}`,
    `0x${String(people).padStart(40, "0")}`,
    email,
  ])) as { id: string }[];
  const id = rows[0].id;
  if (email) {
    await sql.query(
      `insert into user_identities (user_id, kind, value, is_primary, verified_at, proof) values ($1, 'email', $2, true, now(), 'privy_email')`,
      [id, email],
    );
  }
  return id;
}

let intents = 0;
async function order(userId: string, filled: boolean): Promise<void> {
  intents += 1;
  await sql.query(
    `insert into orders (user_id, intent_tx, direction, listing_symbol, listing_address, placed_at, filled_at)
     values ($1, $2, 'buy', 'NVDA', '0xnvda', now(), ${filled ? "now()" : "null"})`,
    [userId, `0x${String(intents).padStart(64, "0")}`],
  );
}


async function accepted(userId: string, version = "2026-10-30"): Promise<void> {
  await sql.query(`insert into terms_acceptances (user_id, version) values ($1, $2) on conflict do nothing`, [userId, version]);
}

/** A person the consent rule switches on: a filled order and the 30 October terms. */
async function customer(email: string): Promise<string> {
  const id = await account(email);
  await order(id, true);
  await accepted(id);
  return id;
}

const MORNING_1 = new Date("2026-11-02T06:05:00Z");
const MORNING_2 = new Date("2026-11-03T06:05:00Z");

/** The baseline before a deploy, then the deploy's three new stocks, lined up as a draft. */
async function draftOfThree(staff: string | null = null) {
  await observe({ listings: BEFORE, production: true });
  const made = await lineUp({ staffId: staff, production: true });
  if (!made.ok) throw new Error(made.reason);
  return made.value;
}

/** The press of send, carrying the hash of what the page last showed (here: what is stored). */
async function press(id: string, staff: string | null = null) {
  return queue(id, staff, { hash: (await draftHash(id)) ?? "" });
}

async function queued(): Promise<string> {
  const draft = await draftOfThree();
  const result = await press(draft.id, null);
  if (!result.ok) throw new Error(result.reason);
  return draft.id;
}

describe("the consent rule", () => {
  it("is on only with a filled order AND the 30 October terms, and the person's own row always wins", async () => {
    const both = await customer("both@example.com");
    const orderOnly = await account("order@example.com");
    await order(orderOnly, true);
    const termsOnly = await account("terms@example.com");
    await accepted(termsOnly);
    const unfilled = await account("unfilled@example.com");
    await order(unfilled, false);
    await accepted(unfilled);
    const older = await account("older@example.com");
    await order(older, true);
    await accepted(older, "2026-10-08");
    const later = await account("later@example.com");
    await order(later, true);
    await accepted(later, "2026-12-01");
    expect((await readPrefs(both)).listings).toBe(true);
    expect((await readPrefs(orderOnly)).listings).toBe(false);
    expect((await readPrefs(termsOnly)).listings).toBe(false);
    expect((await readPrefs(unfilled)).listings).toBe(false);
    expect((await readPrefs(older)).listings).toBe(false);
    expect((await readPrefs(later)).listings).toBe(true);
    await setPref(both, "listings", false);
    await setPref(orderOnly, "listings", true);
    expect((await readPrefs(both)).listings).toBe(false);
    expect((await readPrefs(orderOnly)).listings).toBe(true);
  });
});

describe("detection", () => {
  it("writes nothing outside production, and the baseline once in production", async () => {
    expect(await observe({ listings: BEFORE, production: false })).toMatchObject({ kind: "baseline", wrote: false });
    expect(await sql.query(`select count(*)::int as n from listing_batches`)).toEqual([{ n: 0 }]);
    expect(await observe({ listings: BEFORE, production: true })).toEqual({ kind: "none" });
    expect(await observe({ listings: BEFORE, production: true })).toEqual({ kind: "none" });
    expect(await sql.query(`select count(*)::int as n from listing_batches`)).toEqual([{ n: 1 }]);
  });

  it("records the pinned list as the first baseline, so what went live after it is detected, not absorbed", async () => {
    // The registry today holds 45 stocks and funds; 23 were live at commit 8c5a3833.
    expect(FIRST_BASELINE_SYMBOLS).toHaveLength(23);
    const live = liveStocks().map((listing) => listing.symbol);
    expect(FIRST_BASELINE_SYMBOLS.every((symbol) => live.includes(symbol))).toBe(true);
    const outcome = await observeListings({ production: true });
    expect(outcome.kind).toBe("new");
    const detected = outcome.kind === "new" ? outcome.detected : [];
    expect(detected).toHaveLength(live.length - 23);
    expect(detected).toContain("GLD");
    expect(detected.some((symbol) => FIRST_BASELINE_SYMBOLS.includes(symbol))).toBe(false);
    expect(await sql.query(`select symbols from listing_batches where id = 'baseline'`)).toEqual([{ symbols: [...FIRST_BASELINE_SYMBOLS] }]);
    // Written once: a later look changes nothing, and the same stocks stay detected until announced.
    expect(await observeListings({ production: true })).toEqual({ kind: "new", detected });
    expect(await sql.query(`select count(*)::int as n from listing_batches`)).toEqual([{ n: 1 }]);
    // Not in production, with nothing recorded: nothing is written and nothing is detected.
    await sql.query(`delete from listing_batches`);
    expect(await observeListings({ production: false })).toMatchObject({ kind: "baseline", wrote: false });
    expect(await sql.query(`select count(*)::int as n from listing_batches`)).toEqual([{ n: 0 }]);
  });

  it("detects what is live and not seen, and a cancelled announcement lets its stocks be detected again", async () => {
    await observe({ listings: BEFORE, production: true });
    expect(await observe({ production: false })).toEqual({ kind: "new", detected: ADDED.map((l) => l.symbol) });
    const made = await lineUp({ staffId: null, production: true });
    expect(made.ok).toBe(true);
    expect(await observe({ production: false })).toEqual({ kind: "none" });
    if (made.ok) await cancel(made.value.id);
    expect(await observe({ production: false })).toEqual({ kind: "new", detected: ADDED.map((l) => l.symbol) });
  });
});

describe("lining up and editing a draft", () => {
  it("refuses when nothing is new or one is open, and prefills from copy", async () => {
    await observe({ listings: BEFORE, production: true });
    await observe({ production: true });
    const first = await lineUp({ staffId: null });
    expect(first.ok && first.value.words.subject).toBe("Berth lists 3 more stocks");
    expect(first.ok && first.value.chosen).toHaveLength(3);
    expect(await lineUp({ staffId: null })).toEqual({ ok: false, reason: "open_exists" });
    if (first.ok) await cancel(first.value.id);
    await sql.query(`delete from listing_announcements`);
    await sql.query(`delete from listing_batches`);
    await observeListings({ baselineSymbols: liveStocks().map((listing) => listing.symbol), production: true });
    expect(await lineUp({ staffId: null })).toEqual({ ok: false, reason: "nothing_new" });
  });

  it("validates the words and the stocks, and follows the count when the defaults are untouched", async () => {
    const draft = await draftOfThree();
    const bad = await updateDraft(draft.id, { subject: "Buy now - three stocks!" });
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.problems?.length).toBeGreaterThanOrEqual(1);
    for (const intro of ["Invest in these:", "A \u{1F680} launch:", "See https://example.com", ""]) {
      expect((await updateDraft(draft.id, { intro })).ok).toBe(false);
    }
    expect((await updateDraft(draft.id, { chosen: [] })).ok).toBe(false);
    expect((await updateDraft(draft.id, { chosen: ["NOPE"] }))).toEqual({ ok: false, reason: "unknown_stock" });
    const one = await updateDraft(draft.id, { chosen: [draft.detected[0]] });
    expect(one.ok && one.value.words.subject).toBe("Berth lists one more stock");
    expect(one.ok && one.value.words.intro).toBe("Berth now lists one more stock:");
    const edited = await updateDraft(draft.id, { subject: "Fresh on the quay", extra: "First paragraph.\n\nSecond paragraph." });
    expect(edited.ok && edited.value.words.subject).toBe("Fresh on the quay");
    const more = await updateDraft(draft.id, { chosen: draft.detected });
    expect(more.ok && more.value.words.subject).toBe("Fresh on the quay");
    expect(more.ok && more.value.words.preview).toBe("3 more stocks are now on Berth. What they are, and what to know first.");
  });

  it("lists recipients masked with why, and honours exclusions", async () => {
    const draft = await draftOfThree();
    const ready = await customer("dana@example.com");
    const chosen = await customer("erin@example.com");
    await setPref(chosen, "listings", true);
    await account("nobody@example.com");
    // The staff mask: a company domain is shortened, not shown whole.
    await customer("ivo@janssen-advocaten.nl");
    expect((await recipientsOf(draft.id)).map((row) => row.masked)).toContain("i***@j****.nl");
    await sql.query(`delete from user_identities where value = 'ivo@janssen-advocaten.nl'`);
    const rows = (await recipientsOf(draft.id)).sort((a, b) => a.masked.localeCompare(b.masked));
    expect(rows.map((row) => row.masked)).toEqual(["d***@example.com", "e***@example.com"]);
    expect(rows.map((row) => row.why)).toEqual(["Filled an order", "Turned it on"]);
    expect(JSON.stringify(rows)).not.toContain("dana@example.com");
    await setExcluded(draft.id, ready, true);
    expect((await recipientsOf(draft.id)).filter((row) => row.excluded).map((row) => row.key)).toEqual([recipientKey(draft.id, ready)]);
    // By the key staff are shown, never the account id.
    expect(JSON.stringify(rows)).not.toContain(ready);
    expect(await setExcludedByKey(draft.id, "nope", true)).toEqual({ ok: false, reason: "not_found" });
    expect((await setExcludedByKey(draft.id, recipientKey(draft.id, chosen), true)).ok).toBe(true);
    expect((await setExcludedByKey(draft.id, recipientKey(draft.id, chosen), false)).ok).toBe(true);
    await press(draft.id, null);
    await continueAnnouncements({ now: MORNING_1 });
    expect(sent.map((email) => email.to)).toEqual(["erin@example.com"]);
  });
});

describe("writes only from production", () => {
  it("refuses to line up, queue, test and send now anywhere else, and the page says so", async () => {
    const staff = await account("staff@example.com");
    const draft = await draftOfThree(staff);
    await customer("p@example.com");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(await lineUp({ staffId: staff })).toEqual({ ok: false, reason: "not_production" });
    expect(await press(draft.id, staff)).toEqual({ ok: false, reason: "not_production" });
    expect(await sendTest(draft.id, staff)).toEqual({ ok: false, reason: "not_production" });
    expect((await getAnnouncement(draft.id))?.status).toBe("draft");
    expect(sent).toHaveLength(0);
    // Detection writes nothing there either.
    await sql.query(`delete from listing_announcements`);
    await sql.query(`delete from listing_batches`);
    expect(await observeListings({})).toMatchObject({ kind: "baseline", wrote: false });
    expect(await sql.query(`select count(*)::int as n from listing_batches`)).toEqual([{ n: 0 }]);
    const state = await staffEmailsState();
    expect(state).toMatchObject({ production: false, baselineRecorded: false, detected: [] });
  });
});

describe("what staff approve is what is sent", () => {
  it("refuses a queue whose hash is not what is stored now: words, stocks or exclusions changed since the page looked", async () => {
    const draft = await draftOfThree();
    const person = await customer("h@example.com");
    const shown = (await draftHash(draft.id)) as string;
    expect(shown).toMatch(/^[0-9a-f]{32}$/);
    await updateDraft(draft.id, { extra: "A paragraph added in another tab." });
    expect(await queue(draft.id, null, { hash: shown })).toEqual({ ok: false, reason: "changed" });
    const afterWords = (await draftHash(draft.id)) as string;
    expect(afterWords).not.toBe(shown);
    await setExcluded(draft.id, person, true);
    expect(await queue(draft.id, null, { hash: afterWords })).toEqual({ ok: false, reason: "changed" });
    const afterExclusion = (await draftHash(draft.id)) as string;
    await updateDraft(draft.id, { chosen: [draft.detected[0]] });
    expect(await queue(draft.id, null, { hash: afterExclusion })).toEqual({ ok: false, reason: "changed" });
    expect((await getAnnouncement(draft.id))?.status).toBe("draft");
    expect((await queue(draft.id, null, { hash: (await draftHash(draft.id)) as string })).ok).toBe(true);
  });

  it("refuses to queue a draft while the kill switch is off", async () => {
    const draft = await draftOfThree();
    vi.stubEnv("EMAIL_NEW_LISTINGS", "off");
    expect(await press(draft.id)).toEqual({ ok: false, reason: "switch_off" });
    expect((await getAnnouncement(draft.id))?.status).toBe("draft");
  });

  it("refuses to put anyone back once sending, lets staff take people off, and re-checks that and a cancel before each send", async () => {
    vi.stubEnv("EMAIL_LISTINGS_DAILY_CAP", "10");
    const first = await customer("a1@example.com");
    const second = await customer("a2@example.com");
    const third = await customer("a3@example.com");
    const id = await queued();
    expect(await setExcluded(id, first, false)).toEqual({ ok: false, reason: "sending" });
    // Taken off after the run began, before their turn: the second person is passed over.
    const outcomes: string[] = [];
    const summary = await continueAnnouncements({
      now: MORNING_1,
      send: async (input) => {
        outcomes.push(input.userId);
        if (input.userId === first) await setExcluded(id, second, true);
        return "sent";
      },
    });
    expect(outcomes).toEqual([first, third]);
    expect(summary.sent).toBe(2);
    // A cancel mid run stops the next send.
    await sql.query(`delete from email_sends`);
    await sql.query(`update listing_announcements set status = 'sending', finished_at = null where id = $1`, [id]);
    await sql.query(`delete from listing_announcement_exclusions`);
    const seen: string[] = [];
    const stopped = await continueAnnouncements({
      now: MORNING_1,
      send: async (input) => {
        seen.push(input.userId);
        await cancel(id);
        return "sent";
      },
    });
    expect(seen).toHaveLength(1);
    expect(stopped).toMatchObject({ stopped: true });
  });
});

describe("no repeat mail", () => {
  /** A second announcement in the database, as a draft, for the same people. */
  async function secondDraft(): Promise<string> {
    const rows = (await sql.query(
      `insert into listing_announcements (detected, chosen, subject, preview, intro, status) values ('{ZZZ}', '{ZZZ}', 'Berth lists 3 more stocks', 'p', 'i', 'draft') returning id`,
    )) as { id: string }[];
    return rows[0].id;
  }

  it("refuses to queue another announcement within 7 days of one that reached people, and allows it after", async () => {
    const first = await queued();
    await sql.query(`update listing_announcements set status = 'done', finished_at = now() where id = $1`, [first]);
    const second = await secondDraft();
    // Done without writing to anyone: it reached nobody, so it holds nothing back.
    expect((await press(second)).ok).toBe(true);
    await cancel(second);
    const person = await customer("reached@example.com");
    await sql.query(`insert into email_sends (user_id, type, ref, status) values ($1, 'new_listings', $2, 'sent')`, [person, newListingsRef(first, person)]);
    const third = await secondDraft();
    expect(await press(third)).toEqual({ ok: false, reason: "too_soon" });
    expect((await getAnnouncement(third))?.status).toBe("draft");
    await sql.query(`update listing_announcements set queued_at = now() - interval '8 days' where id = $1`, [first]);
    expect((await press(third)).ok).toBe(true);
  });

  it("does not count a draft, or a cancel before anyone was written to, but does count a cancel after a send", async () => {
    const first = await queued();
    await cancel(first);
    const second = await secondDraft();
    expect((await press(second)).ok).toBe(true);
    await cancel(second);
    const person = await customer("c@example.com");
    const third = await secondDraft();
    await sql.query(`update listing_announcements set status = 'sending', queued_at = now() where id = $1`, [third]);
    await sql.query(`insert into email_sends (user_id, type, ref, status) values ($1, 'new_listings', $2, 'sent')`, [person, newListingsRef(third, person)]);
    await cancel(third);
    const fourth = await secondDraft();
    expect(await press(fourth)).toEqual({ ok: false, reason: "too_soon" });
  });

  it("skips anyone written to by a New stocks email in the last 7 days, and not after", async () => {
    const recent = await customer("recent@example.com");
    const older = await customer("older@example.com");
    const fresh = await customer("fresh@example.com");
    const earlier = "00000000-0000-4000-8000-0000000000aa";
    await sql.query(`insert into email_sends (user_id, type, ref, status, created_at) values ($1, 'new_listings', $2, 'sent', now() - interval '3 days')`, [recent, `${earlier}:${recent}`]);
    await sql.query(`insert into email_sends (user_id, type, ref, status, created_at) values ($1, 'new_listings', $2, 'sent', now() - interval '8 days')`, [older, `${earlier}:${older}`]);
    const id = await queued();
    await continueAnnouncements({ now: MORNING_1 });
    expect(new Set(sent.map((email) => email.to))).toEqual(new Set(["older@example.com", "fresh@example.com"]));
    expect(fresh).toBeTruthy();
    expect((await recipientCounts(id)).sendCount).toBe(2);
  });

  it("keeps a cancelled announcement's stocks seen once it has sent to anyone, and gives them back when it had not", async () => {
    await customer("k@example.com");
    const id = await queued();
    await continueAnnouncements({ now: MORNING_1 });
    expect(sent).toHaveLength(1);
    await cancel(id);
    expect(await observe({ production: false })).toEqual({ kind: "none" });
    // A cancel that had written to no one releases them.
    await sql.query(`delete from email_sends`);
    expect(await observe({ production: false })).toEqual({ kind: "new", detected: ADDED.map((l) => l.symbol) });
  });
});

describe("counts and lists", () => {
  it("counts in SQL over everyone: suppressed and unusable addresses are not counted, and a key beyond the shown list still resolves", async () => {
    const draft = await draftOfThree();
    const ok = await customer("ok@example.com");
    await customer("bad@example.com");
    await sql.query(`insert into email_suppressions (address, reason) values ('bad@example.com', 'bounce')`);
    const broken = await customer("broken@example.com");
    await sql.query(`update user_identities set value = 'not an address' where user_id = $1`, [broken]);
    const last = await customer("last@example.com");
    expect(await recipientCounts(draft.id)).toEqual({ sendCount: 2, total: 2 });
    // The page's list is cut to its first rows, but a key for someone past the cut still resolves.
    const cut = await recipientsOf(draft.id, 1);
    expect(cut).toHaveLength(1);
    expect((await setExcludedByKey(draft.id, recipientKey(draft.id, last), true)).ok).toBe(true);
    expect(await recipientCounts(draft.id)).toEqual({ sendCount: 1, total: 2 });
    expect(ok).toBeTruthy();
  });

  it("keys the list with an HMAC of a server secret, never the account id or a bare hash", async () => {
    const draft = await draftOfThree();
    const person = await customer("key@example.com");
    const key = recipientKey(draft.id, person);
    expect(key).toMatch(/^[0-9a-f]{20}$/);
    expect(key).not.toBe(recipientKey(draft.id, person, { EMAIL_TOKEN_SECRET: "another secret" } as unknown as NodeJS.ProcessEnv));
    const { createHash } = await import("node:crypto");
    expect(key).not.toBe(createHash("sha256").update(`berth-recipient:${draft.id}:${person}`).digest("hex").slice(0, 20));
  });
});

describe("send now", () => {
  it("sends up to the day's share within its window, refuses when nothing is sending or the share is used", async () => {
    vi.stubEnv("EMAIL_LISTINGS_DAILY_CAP", "2");
    for (let i = 0; i < 5; i += 1) await customer(`s${i}@example.com`);
    const draft = await draftOfThree();
    expect(await sendNow({ deadline: Date.now() + 20_000 })).toEqual({ ok: false, reason: "not_sending" });
    await press(draft.id);
    const done = await sendNow({ deadline: Date.now() + 20_000, now: MORNING_1 });
    expect(done.ok && done.value.sent).toBe(2);
    expect(sent).toHaveLength(2);
    expect(await sendNow({ deadline: Date.now() + 20_000, now: MORNING_1 })).toEqual({ ok: false, reason: "share_used" });
    // The next day it sends the next share.
    await sql.query(`update email_sends set created_at = created_at - interval '1 day'`);
    const next = await sendNow({ deadline: Date.now() + 20_000, now: MORNING_2 });
    expect(next.ok && next.value.sent).toBe(2);
    // A window already over starts nobody.
    await sql.query(`update email_sends set created_at = created_at - interval '1 day'`);
    const late = await sendNow({ deadline: Date.now() - 1, now: MORNING_2 });
    expect(late.ok && late.value.sent).toBe(0);
    expect(sent).toHaveLength(4);
  });

  it("refuses with the switch off and outside production", async () => {
    const draft = await draftOfThree();
    await customer("n@example.com");
    await press(draft.id);
    vi.stubEnv("EMAIL_NEW_LISTINGS", "off");
    expect(await sendNow({ deadline: Date.now() + 1000 })).toEqual({ ok: false, reason: "switch_off" });
    vi.stubEnv("EMAIL_NEW_LISTINGS", "on");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(await sendNow({ deadline: Date.now() + 1000 })).toEqual({ ok: false, reason: "not_production" });
    expect(sent).toHaveLength(0);
  });
});

describe("finishing and retries", () => {
  it("is done only when nobody has a claim left: a failure from today waits for tomorrow instead of ending it", async () => {
    await customer("good@example.com");
    await customer("flaky@example.com");
    const id = await queued();
    setEmailTransport(async (email) => {
      if (email.to === "flaky@example.com") return { ok: false, error: "http_500" };
      sent.push(email);
      return { ok: true, id: "re_test" };
    });
    expect(await continueAnnouncements({ now: MORNING_1 })).toMatchObject({ sent: 1, notSent: 1, finished: false });
    // The same UTC day: nobody to try, but one has a failed send with tries left: not done.
    expect(await continueAnnouncements({ now: MORNING_1 })).toMatchObject({ sent: 0, finished: false });
    expect((await getAnnouncement(id))?.status).toBe("sending");
    // Tomorrow it tries again, succeeds, and the following run finds nobody left.
    setEmailTransport(async (email) => {
      sent.push(email);
      return { ok: true, id: "re_test" };
    });
    await sql.query(`update email_sends set created_at = created_at - interval '1 day'`);
    expect(await continueAnnouncements({ now: MORNING_2 })).toMatchObject({ sent: 1 });
    await sql.query(`update email_sends set created_at = created_at - interval '1 day'`);
    expect(await continueAnnouncements({ now: MORNING_2 })).toMatchObject({ sent: 0, finished: true });
    expect(new Set(sent.map((email) => email.to))).toEqual(new Set(["good@example.com", "flaky@example.com"]));
  });

  it("gives a person up after three tries and counts why in the progress", async () => {
    await customer("never@example.com");
    const id = await queued();
    setEmailTransport(async () => ({ ok: false, error: "http_500" }));
    for (let day = 0; day < 4; day += 1) {
      await continueAnnouncements({ now: MORNING_1 });
      await sql.query(`update email_sends set created_at = created_at - interval '1 day'`);
    }
    expect((await getAnnouncement(id))?.status).toBe("done");
    expect((await progressOf((await getAnnouncement(id)) as Awaited<ReturnType<typeof getAnnouncement>> & object)).notSent).toEqual({ count: 1, reasons: { http_500: 1 } });
  });

  it("holds a retried row when the day's share is used, keeps its try, and lets staff's exclusion win", async () => {
    vi.stubEnv("EMAIL_LISTINGS_DAILY_CAP", "1");
    const sentToday = await customer("sentday@example.com");
    const waiting = await customer("waiting@example.com");
    const excluded = await customer("excluded@example.com");
    const id = await queued();
    await sql.query(`insert into email_sends (user_id, type, ref, status) values ($1, 'new_listings', $2, 'sent')`, [sentToday, newListingsRef(id, sentToday)]);
    const notice = JSON.stringify({ type: "new_listings", names: ["Apple"] });
    const stale = (await sql.query(
      `insert into email_sends (user_id, type, ref, status, notice, attempts, created_at) values ($1, 'new_listings', $2, 'pending', $3::jsonb, 2, now() - interval '1 hour') returning id`,
      [waiting, newListingsRef(id, waiting), notice],
    )) as { id: string }[];
    await retryPendingSends({ now: MORNING_1 });
    expect(sent).toHaveLength(0);
    expect(await sql.query(`select status, attempts, error from email_sends where id = $1`, [stale[0].id])).toEqual([{ status: "pending", attempts: 2, error: "daily_volume" }]);
    // Staff took a person off after their row was claimed: the retry drops it.
    await sql.query(`delete from email_sends`);
    await setExcluded(id, excluded, true);
    await sql.query(
      `insert into email_sends (user_id, type, ref, status, notice, created_at) values ($1, 'new_listings', $2, 'pending', $3::jsonb, now() - interval '1 hour')`,
      [excluded, newListingsRef(id, excluded), notice],
    );
    await retryPendingSends({ now: MORNING_1 });
    expect(await sql.query(`select status, error from email_sends`)).toEqual([{ status: "failed", error: "pref_off" }]);
    expect(sent).toHaveLength(0);
  });

  it("holds a test when the day's overall cap is full", async () => {
    vi.stubEnv("EMAIL_DAILY_CAP", "1");
    const staff = await account("tester@example.com");
    const other = await account("other@example.com");
    await sql.query(`insert into email_sends (user_id, type, ref, status) values ($1, 'order_filled', 'o1', 'sent')`, [other]);
    const draft = await draftOfThree(staff);
    expect(await sendTest(draft.id, staff)).toEqual({ ok: true, value: "daily_volume" });
  });
});

describe("opting out follows a merge only one way", () => {
  it("turning off lands on the surviving account, turning on acts only on the account asked", async () => {
    const survivor = await account("surv@example.com");
    const retired = await account("old@example.com");
    await sql.query(`update users set retired_into = $2 where id = $1`, [retired, survivor]);
    await setPref(retired, "listings", true);
    expect(await sql.query(`select user_id, enabled from email_prefs`)).toEqual([{ user_id: retired, enabled: true }]);
    await setPref(retired, "listings", false);
    expect(await sql.query(`select user_id, enabled from email_prefs order by enabled`)).toEqual([
      { user_id: survivor, enabled: false },
      { user_id: retired, enabled: true },
    ]);
  });
});

describe("sending", () => {
  it("queues once however many presses, and sends nothing before it is queued", async () => {
    const draft = await draftOfThree();
    await customer("a@example.com");
    expect((await continueAnnouncements({ now: MORNING_1 })).sent).toBe(0);
    const presses = await Promise.all([press(draft.id, null), press(draft.id, null), press(draft.id, null)]);
    expect(presses.filter((press) => press.ok)).toHaveLength(1);
    expect((await continueAnnouncements({ now: MORNING_1 })).sent).toBe(1);
    expect((await continueAnnouncements({ now: MORNING_1 })).sent).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("Berth lists 3 more stocks");
    expect(sent[0].text).toContain("Sent by Berth");
  });

  it("sends within the day's share, carries on the next morning, then is done with nobody left", async () => {
    vi.stubEnv("EMAIL_LISTINGS_DAILY_CAP", "2");
    expect(listingsDailyCap()).toBe(2);
    for (let i = 0; i < 5; i += 1) await customer(`p${i}@example.com`);
    const id = await queued();
    expect(await continueAnnouncements({ now: MORNING_1 })).toMatchObject({ sent: 2, finished: false });
    expect((await continueAnnouncements({ now: MORNING_1 })).sent).toBe(0);
    // The next UTC day: the day's count starts again.
    await sql.query(`update email_sends set created_at = created_at - interval '1 day'`);
    expect(await continueAnnouncements({ now: MORNING_2 })).toMatchObject({ sent: 2 });
    await sql.query(`update email_sends set created_at = created_at - interval '1 day'`);
    expect(await continueAnnouncements({ now: MORNING_2 })).toMatchObject({ sent: 1 });
    await sql.query(`update email_sends set created_at = created_at - interval '1 day'`);
    expect(await continueAnnouncements({ now: MORNING_2 })).toMatchObject({ sent: 0, finished: true });
    expect(sent).toHaveLength(5);
    expect(new Set(sent.map((email) => email.to)).size).toBe(5);
    expect((await getAnnouncement(id))?.status).toBe("done");
    expect(await openAnnouncement()).toBeNull();
  });

  it("is done 7 days after it was queued, recording how many it did not reach", async () => {
    vi.stubEnv("EMAIL_LISTINGS_DAILY_CAP", "1");
    for (let i = 0; i < 3; i += 1) await customer(`q${i}@example.com`);
    const id = await queued();
    await continueAnnouncements({ now: MORNING_1 });
    const later = new Date(Date.now() + 8 * 86_400_000);
    expect(await continueAnnouncements({ now: later })).toMatchObject({ sent: 0, finished: true });
    const done = await getAnnouncement(id);
    expect(done).toMatchObject({ status: "done", notReached: 2 });
    expect(sent).toHaveLength(1);
  });

  it("does not write twice to someone through an account merged into theirs", async () => {
    const survivor = await customer("one@example.com");
    const id = await queued();
    const absorbed = await customer("two@example.com");
    await sql.query(`update users set retired_into = $2 where id = $1`, [absorbed, survivor]);
    await sql.query(`insert into email_sends (user_id, type, ref, status) values ($1, 'new_listings', $2, 'sent')`, [absorbed, newListingsRef(id, absorbed)]);
    expect((await continueAnnouncements({ now: MORNING_1 })).sent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("skips suppressed addresses, a switched off person, and someone merged away", async () => {
    await customer("ok@example.com");
    const suppressed = await customer("bad@example.com");
    await sql.query(`insert into email_suppressions (address, reason) values ('bad@example.com', 'bounce')`);
    const off = await customer("off@example.com");
    await setPref(off, "listings", false);
    const gone = await customer("gone@example.com");
    await sql.query(`update users set retired_into = $2 where id = $1`, [gone, suppressed]);
    await queued();
    expect((await continueAnnouncements({ now: MORNING_1 })).sent).toBe(1);
    expect(sent.map((email) => email.to)).toEqual(["ok@example.com"]);
  });

  it("stops everything while EMAIL_NEW_LISTINGS is off, retries included, and give up rows of a closed announcement", async () => {
    const person = await customer("kill@example.com");
    const id = await queued();
    vi.stubEnv("EMAIL_NEW_LISTINGS", "off");
    expect(await continueAnnouncements({ now: MORNING_1 })).toMatchObject({ sent: 0, switchOn: false });
    const notice = { type: "new_listings", names: ["Apple"] };
    const stale = await sql.query(
      `insert into email_sends (user_id, type, ref, status, notice, created_at) values ($1, 'new_listings', $2, 'pending', $3::jsonb, now() - interval '1 hour') returning id`,
      [person, newListingsRef(id, person), JSON.stringify(notice)],
    );
    await retryPendingSends({ now: MORNING_1 });
    expect(await sql.query(`select status, error from email_sends where id = $1`, [(stale as { id: string }[])[0].id])).toEqual([{ status: "failed", error: "switch_off" }]);
    expect(sent).toHaveLength(0);
    vi.stubEnv("EMAIL_NEW_LISTINGS", "on");
    await cancel(id);
    await sql.query(`delete from email_sends`);
    await sql.query(
      `insert into email_sends (user_id, type, ref, status, notice, created_at) values ($1, 'new_listings', $2, 'pending', $3::jsonb, now() - interval '1 hour')`,
      [person, newListingsRef(id, person), JSON.stringify(notice)],
    );
    await retryPendingSends({ now: MORNING_1 });
    expect(await sql.query(`select status, error from email_sends`)).toEqual([{ status: "failed", error: "announcement_closed" }]);
    expect(sent).toHaveLength(0);
  });

  it("sends a test only to the staff member's own address, marked, and counts it against the day", async () => {
    vi.stubEnv("EMAIL_LISTINGS_DAILY_CAP", "1");
    const staff = await account("staff@example.com");
    await customer("someone@example.com");
    const draft = await draftOfThree(staff);
    expect(await sendTest(draft.id, staff)).toEqual({ ok: true, value: "sent" });
    expect(sent.map((email) => email.to)).toEqual(["staff@example.com"]);
    expect(sent[0].subject).toBe("Test: Berth lists 3 more stocks");
    expect(sent[0].headers["X-Berth-Type"]).toBe("new_listings_test");
    expect(await sql.query(`select type from email_sends`)).toEqual([{ type: "new_listings_test" }]);
    // The test took the day's one place: a second test is refused, and so is the real send.
    expect(await sendTest(draft.id, staff)).toEqual({ ok: true, value: "daily_volume" });
    await press(draft.id, staff);
    expect((await continueAnnouncements({ now: MORNING_1 })).sent).toBe(0);
  });

  it("is run by the morning stage, which never opens or sends an announcement nobody queued", async () => {
    await customer("m@example.com");
    await observe({ listings: BEFORE, production: true });
    const summary = await runNewListings({ now: MORNING_1, production: true });
    expect(summary).toMatchObject({ observed: "new", detected: 3 });
    expect(sent).toHaveLength(0);
    expect(await openAnnouncement()).toBeNull();
  });
});
