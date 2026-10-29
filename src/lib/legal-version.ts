/**
 * The version of Berth's terms of use and privacy policy, which both carry
 * one effective date. Pure and tiny, so the server's acceptance record
 * (lib/server/terms-acceptance) can read it without the copy.
 *
 * Bump both together when the terms change in a way a person must accept
 * again: every account is then asked once more before its next buy
 * (lib/terms-gate). TERMS_VERSION is the date as ISO, the record's key.
 */
export const LEGAL_EFFECTIVE_DATE = "30 October 2026";
export const TERMS_VERSION = "2026-10-30";

/**
 * The first version of the terms that told people Berth may email them when
 * it adds stocks (the New stocks email, lib/server/new-listings). The New
 * stocks switch is on by default only for someone who has filled an order
 * AND accepted this version or a later one (lib/server/email/store
 * listingsDefaultOnSql). A fixed date, never TERMS_VERSION: a later bump
 * must not switch anyone off.
 */
export const LISTINGS_NOTICE_VERSION = "2026-10-30";
