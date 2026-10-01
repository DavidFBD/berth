import { after } from "next/server";
import { getSql } from "@/lib/server/db";

/**
 * Berth's own meter for a paid service whose bill it cannot read
 * (service_spend, db/schema.sql). Today that is Jev: TypeSafe has no usage
 * or balance endpoint (lib/server/jev). One upsert per call, per UTC day,
 * fired and forgotten: a meter that cannot write never slows or fails the
 * call it measures, and says so once per instance, not once per call.
 */

export type MeteredService = "jev";

/** Jev's documented price: $0.042 a million input tokens, output free (lib/server/jev, measured 2026-09-30). */
export const JEV_USD_PER_MTOK = 0.042;

/** About four characters a token: the request's JSON length, a fair estimate when the API reports none. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Jev's cost for `tokens` input tokens, in USD millionths (fractional). */
export function jevCostMicros(tokens: number): number {
  return tokens * JEV_USD_PER_MTOK;
}

let warned = false;

export async function recordSpend(
  service: MeteredService,
  { calls = 1, units = 0, costMicros = 0 }: { calls?: number; units?: number; costMicros?: number },
  now = new Date(),
): Promise<void> {
  await getSql().query(
    `insert into service_spend (service, day, calls, units, cost_micros)
     values ($1, ($2::timestamptz at time zone 'UTC')::date, $3, $4, $5)
     on conflict (service, day) do update set
       calls = service_spend.calls + excluded.calls,
       units = service_spend.units + excluded.units,
       cost_micros = service_spend.cost_micros + excluded.cost_micros,
       updated_at = now()`,
    [service, now.toISOString(), calls, Math.round(units), costMicros],
  );
}

/**
 * recordSpend after the response (next/server `after`, which Vercel waits
 * for, so the write is not lost when the instance freezes), never
 * throwing. Outside a request (a script, a test) it runs now, unawaited.
 */
export function meterSpend(service: MeteredService, amounts: { calls?: number; units?: number; costMicros?: number }): void {
  const write = () => recordSpend(service, amounts).catch(meterFailed);
  try {
    after(write);
  } catch {
    try {
      void write();
    } catch (error) {
      meterFailed(error);
    }
  }
}

function meterFailed(error: unknown): void {
  if (warned) return;
  warned = true;
  console.warn("[meter] spend not recorded:", error instanceof Error ? error.name : "error");
}
