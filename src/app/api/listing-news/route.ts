import { loadListingNews } from "@/lib/server/listing-news";

export type { ListingNewsResponse } from "@/lib/server/listing-news";

/** Headlines about the listings; the reading and the rules are in lib/server/listing-news. */
export async function GET(request: Request): Promise<Response> {
  return Response.json(await loadListingNews(new URL(request.url).searchParams.get("symbol")));
}
