import { loadFirstLook } from "@/lib/server/first-look";

export type { FirstLookResponse } from "@/lib/first-look";

/** The first buy's readings (lib/first-look). Public, like the news it is made of. */
/** `?also=AMZN` adds one stock, for the first stock card when it is none of the examples. */
export async function GET(request?: Request): Promise<Response> {
  const also = request ? new URL(request.url).searchParams.get("also") : null;
  return Response.json(await loadFirstLook({ also }), {
    // Short at the edge, so a reading is never much older than its words say.
    headers: { "cache-control": "public, s-maxage=600, stale-while-revalidate=600" },
  });
}
