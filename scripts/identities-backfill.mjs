/**
 * Phase 1 of the account model (docs/plans/account-linking.md): give every
 * existing account its identity rows. For each users row, users.email
 * becomes the primary email identity and users.wallet_address the home EVM
 * wallet (CAIP-10 `eip155:<lowercase>`), proof 'legacy', with the same
 * normalisation the app's dual write uses (lib/server/identities).
 *
 * Retired rows are skipped. An identifier two accounts would claim is
 * reported as a conflict (kind and user ids, never the email or address)
 * and not written. Safe to run again: rows already recorded are left be and
 * the insert is `on conflict do nothing`. Needs `pnpm db:push` first.
 * Dry run by default; --write to save.
 *
 *   pnpm identities:backfill                production, dry run
 *   pnpm identities:backfill --write        production, writes
 *   pnpm identities:backfill --local        LOCAL_DATABASE_URL, dry run
 */
import "./lib/load-env.mjs";

const { planIdentityBackfill, backfillInsert } = await import("../src/lib/server/identities.ts");

const WRITE = process.argv.includes("--write");
const LOCAL = process.argv.includes("--local");
const url = LOCAL ? process.env.LOCAL_DATABASE_URL : process.env.DATABASE_URL;
if (!url) {
  console.error(LOCAL ? "LOCAL_DATABASE_URL not set." : "DATABASE_URL not set; it is read from .env.local.");
  process.exit(1);
}

let query;
let end = async () => {};
if (LOCAL) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  query = async (text, params) => (await pool.query(text, params)).rows;
  end = () => pool.end();
} else {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  query = (text, params) => sql.query(text, params);
}

try {
  const users = await query(
    `select id, privy_did, wallet_address, email from users order by created_at`,
  );
  const [{ present }] = await query(`select to_regclass('user_identities') is not null as present`);
  const existing = present ? await query(`select kind, value, user_id from user_identities`) : [];

  const plan = planIdentityBackfill(users, existing);
  const emails = plan.rows.filter((row) => row.kind === "email").length;
  const wallets = plan.rows.filter((row) => row.kind === "wallet").length;

  console.log(`${LOCAL ? "local" : "production"}, ${WRITE ? "WRITE" : "dry run"}`);
  console.log(`users rows: ${users.length} (with email ${users.filter((u) => u.email).length}, with wallet ${users.filter((u) => u.wallet_address).length})`);
  console.log(`user_identities table: ${present ? `present, ${existing.length} rows` : "missing (run pnpm db:push before --write)"}`);
  console.log(`to insert: ${plan.rows.length} (email ${emails}, wallet ${wallets})`);
  console.log(`already recorded: ${plan.alreadyRecorded}`);
  console.log(`skipped: retired ${plan.skipped.retired}, wallet not EVM ${plan.skipped.walletNotEvm}, email not valid ${plan.skipped.emailInvalid}`);
  console.log(`conflicts: ${plan.conflicts.length}`);
  for (const conflict of plan.conflicts) {
    console.log(`  ${conflict.kind} claimed by ${conflict.userIds.map((id) => id.slice(0, 8)).join(", ")}`);
  }

  if (WRITE) {
    if (!present) {
      console.error("user_identities does not exist; run pnpm db:push first.");
      process.exitCode = 1;
    } else if (plan.rows.length > 0) {
      const { text, params } = backfillInsert(plan.rows);
      const inserted = await query(text, params);
      console.log(`inserted: ${inserted.length}${inserted.length < plan.rows.length ? ` (${plan.rows.length - inserted.length} refused by a unique index, rerun the dry run to see why)` : ""}`);
    } else {
      console.log("nothing to insert");
    }
  }
} finally {
  await end();
}
