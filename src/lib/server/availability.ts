import { NextResponse } from "next/server";
import { AVAILABLE, UNAVAILABLE_CODE, availabilityFor, type Availability } from "@/lib/availability";

/**
 * The availability gate, server side: the country and first level region
 * Vercel's edge reads from the caller's IP (`x-vercel-ip-country`,
 * `x-vercel-ip-country-region`), judged against TERMS_AVAILABILITY
 * (lib/copy) by lib/availability. The headers are read for this one answer
 * and never stored, logged or passed on.
 *
 * Used only where the request comes from the person's own browser. Never
 * on webhooks, crons, the email unsubscribe, the OAuth token and
 * registration endpoints or /mcp: those are called by Resend, Vercel or an
 * assistant's servers, whose country says nothing about the person.
 *
 * In local development only (`next dev`), a `?country=US` (and
 * `&region=43`) on the request URL stands in for the headers, so the
 * landing can be tested and shot. Never on any Vercel deployment, preview
 * included: a preview may share production's database and sign in, and an
 * override there could lift a real visitor's refusal.
 */

/**
 * Whether the `?country=` override is honoured here: `next dev` only. Every
 * Vercel deployment runs a production build, so NODE_ENV alone rules them
 * out; a deployment's VERCEL_ENV is checked as well, belt and braces.
 */
export function overrideAllowed(env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview") return false;
  return env.NODE_ENV === "development";
}

type HeaderReader = { get(name: string): string | null };

/**
 * The answer for a request. `override` is the `country` (and `region`)
 * search parameters when the caller has them to hand (a page's
 * searchParams); otherwise they are read from `url`.
 */
export function requestAvailability(
  headers: HeaderReader,
  options: { url?: string; override?: { country?: string | null; region?: string | null } } = {},
): Availability {
  if (overrideAllowed()) {
    let country = options.override?.country ?? null;
    let region = options.override?.region ?? null;
    if (!country && options.url) {
      try {
        const params = new URL(options.url).searchParams;
        country = params.get("country");
        region = params.get("region");
      } catch {
        // Not a URL: no override.
      }
    }
    if (country) return availabilityFor(country, region);
  }
  return availabilityFor(headers.get("x-vercel-ip-country"), headers.get("x-vercel-ip-country-region"));
}

/**
 * For a comprehensively sanctioned place only (TERMS_AVAILABILITY
 * sanctionedCountries and sanctionedRegions): the refusal every account
 * route answers, sign in included, else null. There, Berth offers nothing
 * beyond its public pages, not even to an account that already exists
 * (decided 2026-09-30, for counsel to confirm): no sign in, no buy, sell,
 * withdraw, limit order, plan or assistant approval. The places that are
 * only not offered (TERMS_AVAILABILITY excluded: the United States and its
 * territories, Russia and Belarus) keep sell, withdraw, cancel and key
 * export for an account that already exists; that is not this refusal.
 */
export function refuseSanctioned(headers: HeaderReader, url?: string): NextResponse | null {
  const availability = requestAvailability(headers, { url });
  return !availability.available && availability.reason === "sanctions" ? unavailableResponse(availability) : null;
}

/** The one refusal: 451, with the code the client turns into the landing. Nothing about the caller is echoed back. */
export function unavailableResponse(availability: Availability): NextResponse {
  const reason = availability.available ? null : availability.reason;
  return NextResponse.json(
    { error: "Berth is not available where you are", code: UNAVAILABLE_CODE, reason },
    { status: 451 },
  );
}

export { AVAILABLE };
export type { Availability };
