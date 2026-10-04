import { getSql } from "@/lib/server/db";
import { takeRatePlace } from "@/lib/server/oauth/rate-limit";
import { parseSnapshot, snapshotFromDay, type LastKnown, type LastKnownSnapshot } from "@/lib/last-known";

/**
 * The account's last-known home (lib/last-known): its own saved reading,
 * else its latest daily snapshot (portfolio_days), else nothing. Private to
 * the account; app/api/account/last-known serves it only to its session.
 */
export async function readLastKnown(userId: string): Promise<LastKnown | null> {
  const saved = (await getSql().query(
    `select snapshot, as_of from home_last_known where user_id = $1::uuid`,
    [userId],
  )) as { snapshot: unknown; as_of: string | Date }[];
  const snapshot = saved[0] ? parseSnapshot(saved[0].snapshot) : null;
  if (snapshot) return { snapshot, asOf: new Date(saved[0].as_of).getTime(), source: "live" };

  const days = (await getSql().query(
    `select holdings, as_of from portfolio_days where user_id = $1::uuid order by day desc limit 1`,
    [userId],
  )) as { holdings: { symbol?: unknown; quantity?: unknown; price?: unknown }[] | null; as_of: string | Date }[];
  const day = days[0];
  if (!day) return null;
  const holdings = (day.holdings ?? []).flatMap((holding) =>
    typeof holding.symbol === "string" && typeof holding.quantity === "number" && typeof holding.price === "number"
      ? [{ symbol: holding.symbol, quantity: holding.quantity, price: holding.price }]
      : [],
  );
  return { snapshot: snapshotFromDay(holdings), asOf: new Date(day.as_of).getTime(), source: "day" };
}

/** Keeps a live reading as the account's last known, replacing the one before. */
export async function saveLastKnown(userId: string, snapshot: LastKnownSnapshot): Promise<LastKnown> {
  const rows = (await getSql().query(
    `insert into home_last_known (user_id, snapshot, as_of) values ($1::uuid, $2::jsonb, now())
     on conflict (user_id) do update set snapshot = excluded.snapshot, as_of = excluded.as_of
     returning as_of`,
    [userId, JSON.stringify(snapshot)],
  )) as { as_of: string | Date }[];
  return { snapshot, asOf: new Date(rows[0].as_of).getTime(), source: "live" };
}

/**
 * Saves per account per hour. The page saves at most once a minute per tab
 * (lib/last-known shouldSave), so this leaves room for a second tab or
 * device and only stops a loop. Reads are not limited.
 */
export const LAST_KNOWN_WRITES_PER_HOUR = 120;

/** Takes one save place for the account this hour; false once the limit is reached. */
export function lastKnownWriteAllowed(userId: string, now = new Date()): Promise<boolean> {
  return takeRatePlace("last-known", userId, LAST_KNOWN_WRITES_PER_HOUR, now);
}
