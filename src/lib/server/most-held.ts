import { getSql } from "@/lib/server/db";
import { COUNTED_SYMBOLS, loadAccounts, parseHoldings, staffIdsFromEnv } from "@/lib/server/social-proof";
import { nextPublishAt, publishedWeek, type MostBoughtWeek } from "@/lib/social-proof";
import { MOST_HELD_FIRST_WEEK, rankMostHeld, snapshotDays, type HeldFact, type MostHeldResponse } from "@/lib/most-held";

/**
 * The rows behind Most held on Berth (lib/most-held).
 *
 * Reads the daily holdings records the evening job writes (portfolio_days):
 * each account's last record in the final days of a fixed Monday to Sunday
 * UTC week, published once at Tuesday 00:00 UTC and stored (most_held_weeks),
 * exactly as Most bought is (lib/server/social-proof). Only "1 in N" per
 * listing leaves this module: no count, no account, no amount. It is the
 * same for everyone and shared through the CDN (app/api/most-held).
 */

/** Most held for one fixed week, uncached and unstored (loadMostHeld stores it). */
export async function computeMostHeld(
  week: MostBoughtWeek,
  env: Record<string, string | undefined> = process.env,
): Promise<MostHeldResponse> {
  return (await countWeek(week, env)).answer;
}

/** The answer for a week, and how many daily records it was read from (none: nothing was recorded that week, yet). */
async function countWeek(week: MostBoughtWeek, env: Record<string, string | undefined>): Promise<{ answer: MostHeldResponse; records: number }> {
  const empty: MostHeldResponse = { rows: [], week: week.label };
  const { from, to } = snapshotDays(week);
  const rows = (await getSql().query(
    `select distinct on (pd.user_id) pd.user_id::text as user_id, pd.holdings
     from portfolio_days pd
     where pd.day >= $1::date and pd.day < $2::date
     order by pd.user_id, pd.day desc`,
    [from, to],
  )) as { user_id: string; holdings: unknown }[];
  if (rows.length === 0) return { answer: empty, records: 0 };
  const facts: HeldFact[] = rows.map((row) => ({ userId: row.user_id, holdings: parseHoldings(row.holdings) }));
  const accounts = await loadAccounts([...facts.map((fact) => fact.userId), ...staffIdsFromEnv(env)], env);
  return { answer: { ...empty, rows: rankMostHeld(facts, accounts, COUNTED_SYMBOLS, week.end) }, records: rows.length };
}

/** The stored answer for a week (most_held_weeks), or null if it was never published. */
async function storedWeek(label: string): Promise<MostHeldResponse | null> {
  const rows = (await getSql().query(`select answer from most_held_weeks where week_start = $1::date`, [label])) as { answer: unknown }[];
  const answer = rows[0]?.answer;
  if (!answer) return null;
  return (typeof answer === "string" ? JSON.parse(answer) : answer) as MostHeldResponse;
}

let cached: { label: string; value: MostHeldResponse } | null = null;

/**
 * Most held for the week the board shows now: the first request after a
 * week is published computes and stores it (insert on conflict do nothing),
 * and every later request on every instance serves the stored row, so a
 * published week never moves whatever is recorded late. Empty until
 * MOST_HELD_FIRST_WEEK has been published.
 *
 * A week with no daily record at all is never stored: that is a job that
 * did not run, not a week nobody held anything, so it is answered empty,
 * not cached, and counted again on the next request until records exist.
 * `final` is false then, and the CDN keeps it only briefly (mostHeldMaxAge).
 */
export async function loadMostHeldWeek(
  now = new Date(),
  env: Record<string, string | undefined> = process.env,
): Promise<{ answer: MostHeldResponse; final: boolean }> {
  const week = publishedWeek(now, MOST_HELD_FIRST_WEEK);
  if (!week) return { answer: { rows: [] }, final: true };
  if (cached && cached.label === week.label) return { answer: cached.value, final: true };
  let value = await storedWeek(week.label);
  if (!value) {
    const { answer, records } = await countWeek(week, env);
    if (records === 0) return { answer, final: false };
    await getSql().query(
      `insert into most_held_weeks (week_start, answer) values ($1::date, $2::jsonb) on conflict (week_start) do nothing`,
      [week.label, JSON.stringify(answer)],
    );
    // Another instance may have stored its answer first: serve the row, never our own copy.
    value = (await storedWeek(week.label)) ?? answer;
  }
  cached = { label: week.label, value };
  return { answer: value, final: true };
}

/** loadMostHeldWeek's answer alone. */
export async function loadMostHeld(now = new Date(), env: Record<string, string | undefined> = process.env): Promise<MostHeldResponse> {
  return (await loadMostHeldWeek(now, env)).answer;
}

/** How long the CDN keeps an answer that is not final: five minutes, then it is asked again. */
export const MOST_HELD_RETRY_SECONDS = 300;

/** How long the CDN may keep the answer: until the next week is published, at most a day, at least a minute. */
export function mostHeldMaxAge(now = new Date(), final = true): number {
  if (!final) return MOST_HELD_RETRY_SECONDS;
  const seconds = Math.ceil((nextPublishAt(now, MOST_HELD_FIRST_WEEK).getTime() - now.getTime()) / 1000);
  return Math.max(60, Math.min(86_400, seconds));
}

/** Tests only: forget the cached answer. */
export function forgetMostHeld(): void {
  cached = null;
}
