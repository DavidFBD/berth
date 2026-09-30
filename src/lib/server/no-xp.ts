import { getSql } from "@/lib/server/db";

/**
 * Buys that pay nothing, keyed by intent (table `no_xp_intents`): a buy
 * reported from where Berth is not available (lib/availability). The
 * ledger stays true, the order, its marks and the recurring run it
 * answers are all written, but no XP is paid for it and no hold is judged,
 * on every path that could pay: the pour route from any country (so a
 * replay from home pays nothing), the evening pass over claims, a limit
 * order's fill, and the daily hold check. Written once, never removed.
 */

export async function markNoXp(intentTx: string): Promise<void> {
  await getSql().query(`insert into no_xp_intents (intent_tx) values ($1) on conflict (intent_tx) do nothing`, [intentTx.toLowerCase()]);
}

export async function isNoXp(intentTx: string): Promise<boolean> {
  const rows = (await getSql().query(`select 1 from no_xp_intents where intent_tx = $1`, [intentTx.toLowerCase()])) as unknown[];
  return rows.length > 0;
}

/** For a query over `orders` aliased `alias`: the row is not a no XP buy. */
export const NOT_NO_XP = (alias: string) => `not exists (select 1 from no_xp_intents n where n.intent_tx = ${alias}.intent_tx)`;

/**
 * A no XP buy earns no hold: its order is stamped as judged, 'forfeit', so
 * the daily hold check never pays it and the pending holds never list it.
 * Idempotent; a buy already judged keeps its verdict.
 */
export async function forgoHold(intentTx: string, now = new Date()): Promise<void> {
  await getSql().query(
    `update orders set hold_checked_at = $2::timestamptz, hold_outcome = 'forfeit'
      where intent_tx = $1 and direction = 'buy' and hold_checked_at is null`,
    [intentTx.toLowerCase(), now.toISOString()],
  );
}

/** Whether this account was already paid for this pour: then a later report is a replay, never a no XP buy. */
export async function pourPaid(intentTx: string): Promise<boolean> {
  const rows = (await getSql().query(`select 1 from xp_events where kind = 'pour_in' and ref = $1 limit 1`, [intentTx.toLowerCase()])) as unknown[];
  return rows.length > 0;
}
