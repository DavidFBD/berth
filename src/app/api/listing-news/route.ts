import { loadListingNews } from "@/lib/server/listing-news";

export type { ListingNewsResponse } from "@/lib/server/listing-news";

/** Headlines about the listings, read from the news store (lib/server/listing-news). */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  return Response.json(await loadListingNews(params.get("symbol")));
}
