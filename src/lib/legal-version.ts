/**
 * The version of Berth's terms of use and privacy policy, which both carry
 * one effective date. Pure and tiny, so the server's acceptance record
 * (lib/server/terms-acceptance) can read it without the copy.
 *
 * Bump both together when the terms change in a way a person must accept
 * again: every account is then asked once more before its next buy
 * (lib/terms-gate). TERMS_VERSION is the date as ISO, the record's key.
 */
export const LEGAL_EFFECTIVE_DATE = "5 October 2026";
export const TERMS_VERSION = "2026-10-05";
