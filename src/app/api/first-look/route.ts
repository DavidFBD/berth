import { canonicalFirstLookSearch } from "@/lib/first-look";
import { loadFirstLook } from "@/lib/server/first-look";

export type { FirstLookResponse } from "@/lib/first-look";

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
    // Short at the edge, so a reading is never much older than its words say. A story
    // hidden after it was read leaves the first buy within about four minutes at worst:
    // 120 s fresh plus 60 s stale here, then the browser's 60 s (hooks/use-first-look).
    headers: { "cache-control": "public, s-maxage=120, stale-while-revalidate=60" },
  });
}
