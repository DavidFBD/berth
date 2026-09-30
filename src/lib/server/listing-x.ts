import { verdictFor } from "@/lib/news-judge";
import { rankPosts, type XPost } from "@/lib/x-feed";
import { NAME_BY_SYMBOL, gatherPosts, type Curation, type GatheredPosts } from "@/lib/server/x-column";

/**
 * What is being said on X about the listings. Served by app/api/listing-x
 * and read by the MCP server (app/mcp). The searching, the budget and
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
/**
 * Kept posts sent beyond the visible ones, for the column to rotate in one
 * at a time. They were already fetched and judged for this refresh, so the
 * column can keep moving for minutes on one response and no extra call.
 */
const RESERVE = 24;
const SYMBOL_RESERVE = 8;

export type ListingXResponse = {
  items: XPost[];
  /** Ranked after `items`, oldest-first never: the column rotates these in. */
  reserve: XPost[];
  /** What Jev read this refresh, when it read anything. */
  curation?: Curation;
  /** When the newest fetch behind this was made, epoch ms, for "Updated 3 minutes ago". */
  updatedAt?: number;
  /** Present only when something degraded, for the console. */
  reason?: string;
};

/**
 * The ranked column for every listing, or for one when `symbol` names it.
 * `gathered` reuses a gathering the caller already has (get_listing);
 * `fresh` is the column's refresh button (throttled in lib/x-schedule).
 */
export async function loadListingX(
  symbol?: string | null,
  gathered?: Promise<GatheredPosts>,
  { fresh = false, mayFetch = false }: { fresh?: boolean; mayFetch?: boolean } = {},
): Promise<ListingXResponse> {
  const wanted = symbol?.toUpperCase();
  if (wanted && !NAME_BY_SYMBOL.has(wanted)) {
    return { items: [], reserve: [], reason: `no listing called ${wanted}` };
  }

  const { posts, substance, failures, curation, updatedAt } = await (gathered ?? gatherPosts({ fresh, mayFetch }));
  const mine = wanted ? posts.filter((post) => post.symbol === wanted) : posts;

  const visible = wanted ? SYMBOL_LIMIT : FEED_LIMIT;
  // One ranking for both: its first pass is the breadth pass, so the first
  // twelve of a longer list are exactly the twelve a short one would give.
  const ranked = rankPosts(mine, {
    limit: visible + (wanted ? SYMBOL_RESERVE : RESERVE),
    perSymbol: wanted ? SYMBOL_LIMIT : PER_SYMBOL_LIMIT,
    substance,
  }).map((post) => {
    const weight = substance?.get(post.id);
    return weight === undefined ? post : { ...post, verdict: verdictFor(weight) };
  });

  const payload: ListingXResponse = {
    items: ranked.slice(0, visible),
    reserve: ranked.slice(visible),
    curation,
    updatedAt,
  };
  if (failures.length > 0) payload.reason = [...new Set(failures)].join("; ");
  return payload;
}
