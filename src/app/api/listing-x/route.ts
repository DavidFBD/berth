import { rankPosts, type XPost } from "@/lib/x-feed";
import { NAME_BY_SYMBOL, gatherPosts } from "@/lib/server/x-column";

/**
 * What is being said on X about the listings. The searching, the budget and
 * Jev's reading are argued in lib/server/x-column; this ranks the result.
 *
 * Always 200: a quiet hour, an expired token and a rate limit all reach the
 * reader as the same calm line, because none of them is something a reader
 * can act on. The console gets the reason.
 */

/** How many cards the column carries, and how many any one name may take. */
const FEED_LIMIT = 12;
const PER_SYMBOL_LIMIT = 2;
/** Asking about one listing is a different question: show its own run. */
const SYMBOL_LIMIT = 8;

export type ListingXResponse = {
  items: XPost[];
  /** Present only when something degraded, for the console. */
  reason?: string;
};

export async function GET(request: Request): Promise<Response> {
  const wanted = new URL(request.url).searchParams.get("symbol")?.toUpperCase();
  if (wanted && !NAME_BY_SYMBOL.has(wanted)) {
    return Response.json({ items: [], reason: `no listing called ${wanted}` });
  }

  const { posts, substance, failures } = await gatherPosts();
  const gathered = wanted ? posts.filter((post) => post.symbol === wanted) : posts;

  const payload: ListingXResponse = {
    items: rankPosts(gathered, {
      limit: wanted ? SYMBOL_LIMIT : FEED_LIMIT,
      perSymbol: wanted ? SYMBOL_LIMIT : PER_SYMBOL_LIMIT,
      substance,
    }),
  };
  if (failures.length > 0) payload.reason = [...new Set(failures)].join("; ");
  return Response.json(payload);
}
