import { timingSafeEqual } from "node:crypto";

/**
 * The cron door. Vercel Cron calls with `authorization: Bearer $CRON_SECRET`;
 * anything else is a stranger. Fails closed: with no secret configured the
 * door does not open for anyone (503), so a missing env var can never turn
 * a scheduled job into a public endpoint.
 */
export type CronAuth = { ok: true } | { ok: false; status: 401 | 503 };

export function checkCronAuth(
  header: string | null,
  secret: string | undefined = process.env.CRON_SECRET,
): CronAuth {
  if (!secret) return { ok: false, status: 503 };
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, status: 401 };
  }
  return { ok: true };
}
