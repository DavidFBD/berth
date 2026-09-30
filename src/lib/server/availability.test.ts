import { afterEach, describe, expect, it, vi } from "vitest";
import { overrideAllowed, requestAvailability, unavailableResponse } from "./availability";

const headersOf = (entries: Record<string, string>) => new Headers(entries);

afterEach(() => vi.unstubAllEnvs());

describe("requestAvailability", () => {
  it("reads Vercel's country and region headers", () => {
    expect(requestAvailability(headersOf({ "x-vercel-ip-country": "US" }))).toEqual({ available: false, reason: "united-states" });
    expect(requestAvailability(headersOf({ "x-vercel-ip-country": "UA", "x-vercel-ip-country-region": "43" }))).toEqual({
      available: false,
      reason: "sanctions",
    });
    expect(requestAvailability(headersOf({ "x-vercel-ip-country": "NL", "x-vercel-ip-country-region": "NH" }))).toEqual({ available: true });
    expect(requestAvailability(headersOf({}))).toEqual({ available: true });
  });

  it("honours ?country in local development, from the URL or a page's searchParams", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(requestAvailability(headersOf({}), { url: "http://localhost:3204/?country=US" }).available).toBe(false);
    expect(requestAvailability(headersOf({}), { override: { country: "UA", region: "09" } }).available).toBe(false);
    // The override can also say "somewhere Berth is offered".
    expect(requestAvailability(headersOf({ "x-vercel-ip-country": "US" }), { override: { country: "NL" } }).available).toBe(true);
  });

  it("never honours ?country in production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(overrideAllowed()).toBe(false);
    expect(requestAvailability(headersOf({}), { url: "https://www.berthmarkets.com/?country=US" })).toEqual({ available: true });
    expect(requestAvailability(headersOf({ "x-vercel-ip-country": "US" }), { override: { country: "NL" } }).available).toBe(false);
  });

  it("allows the override in next dev only, never on a deployment, preview included", () => {
    expect(overrideAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(overrideAllowed({ NODE_ENV: "development", VERCEL_ENV: "development" })).toBe(true);
    expect(overrideAllowed({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(false);
    expect(overrideAllowed({ VERCEL_ENV: "preview", NODE_ENV: "development" })).toBe(false);
    expect(overrideAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(overrideAllowed({ NODE_ENV: "test" })).toBe(false);
    expect(overrideAllowed({ VERCEL_ENV: "production", NODE_ENV: "development" })).toBe(false);
  });
});

describe("unavailableResponse", () => {
  it("answers 451 with the code the client shows the landing for, echoing nothing about the caller", async () => {
    const response = unavailableResponse({ available: false, reason: "united-states" });
    expect(response.status).toBe(451);
    const body = await response.json();
    expect(body).toEqual({ error: "Berth is not available where you are", code: "unavailable_here", reason: "united-states" });
  });
});
