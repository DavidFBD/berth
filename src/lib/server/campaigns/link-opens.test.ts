import { describe, expect, it } from "vitest";
import { countsAsOpen } from "./link-opens";

/** What counts as a person opening a campaign link: read from headers, nothing kept. */

const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const headers = (entries: Record<string, string>) => new Headers(entries);

describe("countsAsOpen", () => {
  it("counts a browser opening the link", () => {
    expect(countsAsOpen(headers({ "user-agent": SAFARI }))).toBe(true);
  });

  it("leaves out link previewers and crawlers", () => {
    for (const agent of ["Twitterbot/1.0", "facebookexternalhit/1.1", "Slackbot-LinkExpanding 1.0", "WhatsApp/2.23", "TelegramBot (like TwitterBot)", "Mozilla/5.0 (compatible; Discordbot/2.0)", "curl/8.4.0"]) {
      expect(countsAsOpen(headers({ "user-agent": agent })), agent).toBe(false);
    }
  });

  it("leaves out prefetches and requests without a user agent", () => {
    expect(countsAsOpen(headers({ "user-agent": SAFARI, purpose: "prefetch" }))).toBe(false);
    expect(countsAsOpen(headers({ "user-agent": SAFARI, "sec-purpose": "prefetch;prerender" }))).toBe(false);
    expect(countsAsOpen(headers({ "user-agent": SAFARI, "next-router-prefetch": "1" }))).toBe(false);
    expect(countsAsOpen(headers({}))).toBe(false);
  });
});
