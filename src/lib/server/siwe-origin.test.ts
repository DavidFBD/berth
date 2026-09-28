import { describe, expect, it } from "vitest";
import { siweMadeForBerth } from "@/lib/server/siwe-origin";

const now = Date.parse("2026-09-29T12:00:00Z");
const good = {
  domain: "www.berthmarkets.com",
  uri: "https://www.berthmarkets.com",
  chainId: 146,
  issuedAt: new Date(now - 30_000),
};

describe("siweMadeForBerth", () => {
  it("accepts a fresh message made for Berth on Sonic", () => {
    expect(siweMadeForBerth(good, now)).toBe(true);
    expect(siweMadeForBerth({ ...good, domain: "berthmarkets.com", uri: "https://berthmarkets.com/" }, now)).toBe(true);
  });

  it("refuses a message a phishing site asked for", () => {
    expect(siweMadeForBerth({ ...good, domain: "evil.example", uri: "https://evil.example" }, now)).toBe(false);
    expect(siweMadeForBerth({ ...good, domain: "berthmarkets.com.evil.example", uri: "https://berthmarkets.com.evil.example" }, now)).toBe(false);
  });

  it("refuses a uri on another host than the domain", () => {
    expect(siweMadeForBerth({ ...good, uri: "https://evil.example" }, now)).toBe(false);
  });

  it("refuses another chain, a stale message or one from the future", () => {
    expect(siweMadeForBerth({ ...good, chainId: 1 }, now)).toBe(false);
    expect(siweMadeForBerth({ ...good, issuedAt: new Date(now - 11 * 60_000) }, now)).toBe(false);
    expect(siweMadeForBerth({ ...good, issuedAt: new Date(now + 5 * 60_000) }, now)).toBe(false);
    expect(siweMadeForBerth({ ...good, issuedAt: undefined }, now)).toBe(false);
  });
});
