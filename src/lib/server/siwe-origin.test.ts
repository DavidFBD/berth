import { describe, expect, it } from "vitest";
import { siweMadeForBerth } from "@/lib/server/siwe-origin";

const good = {
  domain: "www.berthmarkets.com",
  uri: "https://www.berthmarkets.com",
  chainId: 146,
};

describe("siweMadeForBerth", () => {
  it("accepts a fresh message made for Berth on Sonic", () => {
    expect(siweMadeForBerth(good)).toBe(true);
    expect(siweMadeForBerth({ ...good, domain: "berthmarkets.com", uri: "https://berthmarkets.com/" })).toBe(true);
  });

  it("refuses a message a phishing site asked for", () => {
    expect(siweMadeForBerth({ ...good, domain: "evil.example", uri: "https://evil.example" })).toBe(false);
    expect(siweMadeForBerth({ ...good, domain: "berthmarkets.com.evil.example", uri: "https://berthmarkets.com.evil.example" })).toBe(false);
  });

  it("refuses a uri on another host than the domain", () => {
    expect(siweMadeForBerth({ ...good, uri: "https://evil.example" })).toBe(false);
  });

  it("refuses another chain", () => {
    expect(siweMadeForBerth({ ...good, chainId: 1 })).toBe(false);
  });
});
