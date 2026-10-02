import { normaliseQuery } from "@/lib/news-query";
import { newsVariesByReader } from "@/lib/news-schedule";
import { loadNewsColumn, requestIngest } from "@/lib/server/news-read";
import { takeRatePlace } from "@/lib/server/oauth/rate-limit";
import { readStaff } from "@/lib/server/staff-gate";

export type { NewsColumnResponse } from "@/lib/news-stories";

/** Refreshes and the looks after them, per caller per hour: a person presses a few times a day. */
const UNCACHED_PER_HOUR = 120;

const PUBLIC = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=600" };
const PRIVATE = { "Cache-Control": "private, no-store, max-age=0" };

/**
 * The news column (lib/server/news-read): stories from the store, every
 * listing's owner news and the filings, for the column to sort into "For
 * what you own", "Coming up" and "Across Berth" by what the reader holds.
 * Holdings never reach this route.
 *
 * The plain answer is the same for everyone and shared through the CDN for
 * a minute; any other query string is sent to that one address, so a
 * random parameter cannot skip the cache and reach the database. Only the
 * refresh button (`fresh=1`, which may start the slot's one extra ingest)
 * and the looks after it (`poll=1`) are read per request, and those are
 * rate limited. While one source is shown to staff only (lib/news-schedule)
 * every answer is private.
 *
 * The first request in a New York slot also starts that slot's ingest,
 * after this answer is sent. Always 200 for a known query.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = normaliseQuery(url.searchParams);
  if (!query) return Response.redirect(new URL(`/api/news`, url), 308);
  const perReader = newsVariesByReader();
  if (query.mode) {
    const caller = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const allowed = await takeRatePlace("news", caller, UNCACHED_PER_HOUR).catch(() => true);
    if (!allowed) return Response.json({ error: "too many" }, { status: 429, headers: PRIVATE });
  }
  // Viewers and admins alike: anyone signed in to the staff area.
  const staff = perReader ? (await readStaff(request).catch(() => null)) !== null : false;
  const [payload, claimed] = await Promise.all([
    loadNewsColumn({ symbol: query.symbol, staff }),
    query.mode === "poll" ? Promise.resolve(false) : requestIngest({ fresh: query.mode === "fresh" }).catch(() => false),
  ]);
  const body = query.mode === "fresh" && claimed ? { ...payload, refreshing: true } : payload;
  return Response.json(body, { headers: perReader || query.mode ? PRIVATE : PUBLIC });
}
