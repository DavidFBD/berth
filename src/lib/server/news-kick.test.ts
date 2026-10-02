import { describe, expect, it, vi } from "vitest";
import { kickNewsIngest, productionOrigin } from "@/lib/server/news-kick";

describe("the news cron kick", () => {
  it("goes to the production domain, never the request's own deployment host", () => {
    expect(productionOrigin({ NEWS_KICK_ORIGIN: "https://preview.example.com/" })).toBe("https://preview.example.com");
    // The shortest custom domain only redirects, so Vercel's variable is ignored.
    expect(productionOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "berthmarkets.com" })).toBe("https://www.berthmarkets.com");
    expect(productionOrigin({})).toBe("https://www.berthmarkets.com");
  });

  it("counts only a 202 as started, does not follow a login redirect, and says so when it fails", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const answer = (response: Response) =>
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return response;
      }) as unknown as typeof fetch;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { NEWS_KICK_ORIGIN: "www.berthmarkets.com" };

    expect(await kickNewsIngest("Bearer s", "evening", { fetcher: answer(new Response(null, { status: 202 })), env })).toBe("started");
    expect(calls[0].url).toBe("https://www.berthmarkets.com/api/cron/news?phase=evening");
    expect(calls[0].init?.redirect).toBe("manual");
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe("Bearer s");

    const login = new Response(null, { status: 302, headers: { location: "https://vercel.com/sso-api" } });
    expect(await kickNewsIngest("Bearer s", "evening", { fetcher: answer(login), env })).toBe("failed");
    expect(await kickNewsIngest("Bearer s", "morning", { fetcher: answer(new Response("<html>login</html>", { status: 200 })), env })).toBe("failed");
    expect(await kickNewsIngest("Bearer s", "morning", { fetcher: answer(Response.json({ started: false })), env })).toBe("already ran");
    const down = vi.fn(async () => Promise.reject(new Error("timeout"))) as unknown as typeof fetch;
    expect(await kickNewsIngest("Bearer s", "morning", { fetcher: down, env })).toBe("failed");
  });
});
