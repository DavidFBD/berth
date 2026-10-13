/**
 * Starts the news store's cron run in its own function (app/api/cron/news)
 * from inside the morning cron, the one cron that gathers news (once a day,
 * to keep function time down; readers' slots fill the rest of the day).
 *
 * Always on the production domain, never on the request's own host: Vercel
 * calls a cron on the deployment's own URL, which sits behind Vercel
 * Authentication, so a call there answers a redirect to a login page (and,
 * followed, a 200 that looked like success). Redirects are not followed and
 * only a 202 counts as started; anything else is logged as a failure.
 *
 * Started, not awaited, by the crons (`startNewsKick`): their own budgets
 * run to the second, and the kick settles while they work.
 */

const PRODUCTION_FALLBACK = "www.berthmarkets.com";

/**
 * The production origin, pinned to the one domain that serves. Vercel's
 * VERCEL_PROJECT_PRODUCTION_URL names the shortest custom domain, and here
 * the shorter ones (lsteatime.com, berthmarkets.com) only redirect, which
 * would count every kick as failed. NEWS_KICK_ORIGIN overrides it.
 */
export function productionOrigin(env: Record<string, string | undefined> = process.env): string {
  const host = (env.NEWS_KICK_ORIGIN ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${host || PRODUCTION_FALLBACK}`;
}

export type KickOutcome = "started" | "already ran" | "failed";

export async function kickNewsIngest(
  authorization: string | null,
  phase: "morning" | "evening",
  { fetcher = fetch, env = process.env, timeoutMs = 3_000 }: { fetcher?: typeof fetch; env?: Record<string, string | undefined>; timeoutMs?: number } = {},
): Promise<KickOutcome> {
  try {
    const response = await fetcher(`${productionOrigin(env)}/api/cron/news?phase=${phase}`, {
      headers: { authorization: authorization ?? "" },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 202) return "started";
    if (response.status === 200) {
      const body = (await response.json().catch(() => null)) as { started?: boolean } | null;
      if (body?.started === false) return "already ran";
    }
    console.warn(`[news] cron kick answered ${response.status}`);
    return "failed";
  } catch (error) {
    console.warn("[news] cron kick", error instanceof Error ? error.message : error);
    return "failed";
  }
}

/** Fires the kick and hands back its promise, so the cron can log the outcome after its own run. */
export function startNewsKick(request: Request, phase: "morning" | "evening"): Promise<KickOutcome> {
  return kickNewsIngest(request.headers.get("authorization"), phase);
}
