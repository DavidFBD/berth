import { canonicalFirstLookSearch } from "@/lib/first-look";
import { loadFirstLook } from "@/lib/server/first-look";

export type { FirstLookResponse } from "@/lib/first-look";

export const FIRST_LOOK_CACHE_CONTROL = "public, s-maxage=5, stale-while-revalidate=5";

/** The first buy's readings (lib/first-look). Public, like the news it is made of. */
/** `?also=AMZN` adds one stock, for the first stock card when it is none of the examples. */
export async function GET(request?: Request): Promise<Response> {
  let also: string | null = null;
  if (request) {
    const url = new URL(request.url);
    const canonical = canonicalFirstLookSearch(url.searchParams);
    // Any other query string is redirected to its one canonical form before the store is read,
    // so it shares that form's edge cache instead of forcing a fresh read.
    if (url.search !== canonical) {
      return new Response(null, {
        status: 308,
        headers: { location: `${url.pathname}${canonical}`, "cache-control": "public, s-maxage=86400" },
      });
    }
    also = url.searchParams.get("also");
  }
  return Response.json(await loadFirstLook({ also }), {
    // Seconds at the edge, because a headline here sits a step from Buy: a story hidden
    // after it was read (stories.hidden_reason, set by hand, so there is no hook to purge
    // a cache from) leaves the first buy within about twenty seconds at worst: 5 s fresh
    // plus 5 s stale here, then the browser's next ask within 10 s (hooks/use-first-look).
    // The read is one query over the week's stories and cached verdicts, never Jev.
    headers: { "cache-control": FIRST_LOOK_CACHE_CONTROL },
  });
}
