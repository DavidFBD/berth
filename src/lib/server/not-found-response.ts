import { NextResponse } from "next/server";
import { NOWHERE_PATH } from "@/lib/nowhere";

/**
 * Next's own 404, as a route handler can answer it. `notFound()` in a
 * route handler gives a bare 404 with no body, which tells a prober the
 * route exists; a path that does not exist gets the not-found page. So
 * this asks the app for a path that is not there and hands back exactly
 * what came: the same page, status and type. The page is the same for
 * everyone and is kept for a minute.
 */

const MISSING_PATH = NOWHERE_PATH;
let cached: { html: string; type: string; at: number } | null = null;

export async function nextNotFound(request: Request, fetcher: typeof fetch = fetch): Promise<NextResponse> {
  if (!cached || Date.now() - cached.at > 60_000) {
    try {
      const response = await fetcher(new URL(MISSING_PATH, request.url), { headers: { accept: "text/html" }, cache: "no-store" });
      cached = { html: await response.text(), type: response.headers.get("content-type") ?? "text/html; charset=utf-8", at: Date.now() };
    } catch {
      cached = null;
      return new NextResponse("Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
  }
  return new NextResponse(cached.html, { status: 404, headers: { "content-type": cached.type, "cache-control": "no-store" } });
}
