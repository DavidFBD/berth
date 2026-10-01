/**
 * Reporting a pour again when the server could not read the chain yet
 * (HTTP 503 from /api/xp/pour, lib/server/pour-ownership): a few tries,
 * further apart each time. When the server could see that the hash holds a
 * real intent it also kept a claim (proven false), which the evening pass
 * proves and settles if every try here finds the chain silent; a hash whose
 * receipt could not be read at all keeps nothing, and only these tries (or
 * pnpm orders:recover) bring it in. Any answer other than 503 ends it. Pure,
 * so the schedule is testable.
 */

/** Waits between tries, ms: about four minutes in all. */
export const POUR_RETRY_DELAYS_MS: readonly number[] = [5_000, 15_000, 45_000, 120_000];

export type PourAttempt<T> = { status: number; data: T | null };

export async function reportWithRetry<T>(
  attempt: () => Promise<PourAttempt<T>>,
  {
    delays = POUR_RETRY_DELAYS_MS,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  }: { delays?: readonly number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<PourAttempt<T>> {
  let result = await attempt();
  for (const delay of delays) {
    if (result.status !== 503) return result;
    await sleep(delay);
    result = await attempt();
  }
  return result;
}
