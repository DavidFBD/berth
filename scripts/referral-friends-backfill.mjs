/**
 * Makes every existing referrer and referred pair friends, by the rule a
 * new referral follows since 2026-09-29 (lib/server/social/referral-backfill):
 * no pair across a block or a decline, none past the 50 friend cap, one social_audit row
 * per pair made. Prints counts only, never an id, a name or an address.
 * Safe to run again. Dry run by default; --write to save.
 *
 *   pnpm referral-friends:backfill            production, dry run
 *   pnpm referral-friends:backfill --write    production, writes
 *   pnpm referral-friends:backfill --local    LOCAL_DATABASE_URL, dry run
 */
import "./lib/load-env.mjs";

const WRITE = process.argv.includes("--write");
const LOCAL = process.argv.includes("--local");

if (LOCAL) {
  if (!process.env.LOCAL_DATABASE_URL) {
    console.error("--local needs LOCAL_DATABASE_URL (postgres://…@localhost/…).");
    process.exit(1);
  }
} else {
  // lib/server/db prefers LOCAL_DATABASE_URL when it is set; without
  // --local the target is DATABASE_URL, said out loud.
  delete process.env.LOCAL_DATABASE_URL;
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set; it is read from .env.local.");
    process.exit(1);
  }
}

const { backfillReferralFriends } = await import("../src/lib/server/social/referral-backfill.ts");

console.log(`${LOCAL ? "local" : "DATABASE_URL (production)"}, ${WRITE ? "WRITE" : "dry run"}`);
const report = await backfillReferralFriends({ write: WRITE });
console.log(`referral pairs: ${report.pairs}`);
console.log(`already friends: ${report.alreadyFriends}`);
console.log(`skipped, blocked: ${report.blocked}`);
console.log(`skipped, a request was declined: ${report.declined}`);
console.log(`skipped, a list is full: ${report.full}`);
console.log(`${WRITE ? "made" : "would make"}: ${WRITE ? report.made : report.toMake}`);
if (!WRITE) console.log("dry run: nothing written. --write to save.");
