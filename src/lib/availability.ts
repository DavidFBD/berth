import { TERMS_AVAILABILITY } from "@/lib/copy";

/**
 * Where Berth can open an account or take an order, judged from the country
 * (and first level region) a request comes from. The places come from
 * TERMS_AVAILABILITY in lib/copy, the same list the terms of use name, so
 * the terms and the gate cannot disagree.
 *
 * A soft landing, not a wall: an excluded visitor still reads the welcome
 * page, the terms, privacy and the assistants pages. From an excluded
 * place (the United States, Russia, Belarus), an account that already exists can always see what it holds,
 * sell and withdraw; what is refused is starting something new: an
 * account, a buy, a limit buy, an assistant connection.
 * From a comprehensively sanctioned place ("sanctions") nothing beyond the
 * public pages is served, an existing account included
 * (lib/server/availability refuseSanctioned).
 *
 * Pure and client safe. Reading the request lives in lib/server/availability.
 * The country is used for this one answer and never stored.
 */

export type UnavailableReason = (typeof TERMS_AVAILABILITY.excluded)[number]["reason"] | "sanctions";

/**
 * All the app ever learns from the country: whether Berth is available,
 * and if not, which kind of reason. The country itself is read, judged and
 * dropped; it is never kept, logged, or sent to the browser.
 */
export type Availability = { available: true } | { available: false; reason: UnavailableReason };

export const AVAILABLE: Availability = { available: true };

/** The code every refusing route answers with (HTTP 451), so the client can show the landing. */
export const UNAVAILABLE_CODE = "unavailable_here";

const EXCLUDED_COUNTRIES = new Map<string, UnavailableReason>(
  TERMS_AVAILABILITY.excluded.flatMap((place) => place.countries.map((code) => [code, place.reason] as const)),
);
const SANCTIONED_COUNTRIES = new Set<string>(TERMS_AVAILABILITY.sanctionedCountries.flatMap((place) => place.countries));
const SANCTIONED_REGIONS = new Set<string>(TERMS_AVAILABILITY.sanctionedRegions.flatMap((place) => place.regions));

/**
 * The answer for a country (ISO 3166-1 alpha-2) and region. The region may
 * come as Vercel sends it ("43") or in full ("UA-43"). Unknown or missing
 * means available: local development and requests without a country header
 * are never refused on a guess.
 */
export function availabilityFor(country: string | null | undefined, region?: string | null): Availability {
  const cc = (country ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return AVAILABLE;
  if (SANCTIONED_COUNTRIES.has(cc)) return { available: false, reason: "sanctions" };
  // Regions before the excluded countries: an occupied region filed under
  // Russia is sanctioned, while the rest of Russia is only not offered.
  const raw = (region ?? "").trim().toUpperCase();
  if (raw) {
    const full = raw.includes("-") ? raw : `${cc}-${raw}`;
    if (full.startsWith(`${cc}-`) && SANCTIONED_REGIONS.has(full)) return { available: false, reason: "sanctions" };
  }
  const excluded = EXCLUDED_COUNTRIES.get(cc);
  if (excluded) return { available: false, reason: excluded };
  return AVAILABLE;
}
