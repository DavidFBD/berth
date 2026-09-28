import { getSql } from "@/lib/server/db";
import { detectFamily, normalizeEmail, toCaip10, type WalletFamily } from "@/lib/identity/caip";

/**
 * The account's identifiers (`user_identities`, db/schema.sql): the one
 * statement of how a users row's email and wallet become identity rows, used
 * by the dual write in lib/server/accounts and by scripts/identities-backfill.
 *
 * Phase 1 of docs/plans/account-linking.md: every write that puts an email or
 * a wallet on a users row also records the identity, in its own statement
 * right after, never failing the users write, so the table is complete by the
 * time phase 2 starts reading it. Reads stay
 * on users.email and users.wallet_address until then.
 */

export type IdentityProof = "privy_email" | "siwe" | "siws" | "bip322" | "privy_wallet" | "legacy";

export type IdentityRow = {
  user_id: string;
  kind: "email" | "wallet";
  value: string;
  family: WalletFamily | null;
  is_primary: boolean;
  is_home: boolean;
  verified_at: string | null;
  proof: IdentityProof;
};

/**
 * The CAIP-10 value for the address in users.wallet_address, which is the
 * account's home EVM address. Null for anything that is not an EVM address:
 * a home address is EVM by definition (the hub wallet is derived from it).
 */
export function homeWalletValue(wallet: string | null | undefined): string | null {
  if (!wallet || detectFamily(wallet) !== "evm") return null;
  return toCaip10("evm", wallet);
}

/** The value stored for an email identity: trimmed and lowercased. */
export function emailValue(email: string | null | undefined): string | null {
  return normalizeEmail(email);
}

/**
 * Dual write, phase 1: records the account's home EVM wallet after the users
 * write has landed, as its own statement. Never throws. The users write is
 * the one that must not fail, so a missing table, a violated check, or an
 * address already on another account (or a second home) is swallowed with a
 * short warning, and the backfill's conflict report finds what was missed.
 *
 * verified_at is the moment Berth accepted the proof in this request: a
 * SIWE wallet session (signed at most seven days earlier, see
 * wallet-session) or Privy's own record of the account's wallet, read now.
 */
export async function recordHomeWallet(
  userId: string,
  wallet: string | null,
  proof: Extract<IdentityProof, "siwe" | "privy_wallet">,
): Promise<void> {
  const value = homeWalletValue(wallet);
  if (!value) return;
  try {
    await getSql().query(
      `insert into user_identities (user_id, kind, value, family, is_home, verified_at, proof)
       values ($1, 'wallet', $2, 'evm', true, now(), $3)
       on conflict do nothing`,
      [userId, value, proof],
    );
  } catch (error) {
    warnIdentity("wallet", userId, error);
  }
}

/**
 * Dual write, phase 1: records a Privy-verified email as the account's
 * primary email identity, after users.email was written. verified_at is now:
 * this runs in the request that read the email from Privy, right after the
 * person entered the code. Never throws (see recordHomeWallet). When the
 * email already belongs to another account, one account_audit row says so,
 * with the kind and the other account's id only, never the address.
 */
export async function recordPrimaryEmail(userId: string, email: string): Promise<void> {
  const value = emailValue(email);
  if (!value) return;
  const sql = getSql();
  try {
    const inserted = (await sql.query(
      `insert into user_identities (user_id, kind, value, is_primary, verified_at, proof)
       values ($1, 'email', $2, true, now(), 'privy_email')
       on conflict do nothing
       returning id`,
      [userId, value],
    )) as unknown[];
    if (inserted.length > 0) return;
    const owner = (await sql.query(
      `select user_id from user_identities where kind = 'email' and value = $1`,
      [value],
    )) as { user_id: string }[];
    const other = owner[0]?.user_id;
    if (other && other !== userId) {
      await sql.query(
        `insert into account_audit (user_id, action, detail)
         values ($1, 'identity_conflict', $2::jsonb)`,
        [userId, JSON.stringify({ kind: "email", otherUserId: other })],
      );
    } else if (!other) {
      // Refused by the one-primary index: this account already has another.
      console.warn(`[identities] email not recorded for ${userId.slice(0, 8)}: a primary email exists`);
    }
  } catch (error) {
    warnIdentity("email", userId, error);
  }
}

function warnIdentity(kind: string, userId: string, error: unknown): void {
  const code = (error as { code?: unknown })?.code;
  console.warn(
    `[identities] ${kind} identity write failed for ${userId.slice(0, 8)}${typeof code === "string" ? ` (${code})` : ""}`,
  );
}

export type BackfillUser = {
  id: string;
  privy_did: string | null;
  wallet_address: string | null;
  email: string | null;
};

export type BackfillPlan = {
  rows: IdentityRow[];
  /** Identifiers two or more accounts would claim (or one already owned by another). Never written. */
  conflicts: { kind: "email" | "wallet"; userIds: string[] }[];
  skipped: { retired: number; walletNotEvm: number; emailInvalid: number };
  alreadyRecorded: number;
};

/**
 * What the backfill would write: one primary email and one home EVM wallet
 * per users row, proof 'legacy' and verified_at null: the row was proved
 * once (Privy verified every stored email, every stored wallet came through
 * SIWE or Privy) but when is not known, and a made up time would lie. Retired and merged rows are skipped. An identifier claimed by two
 * users, or already recorded for a different user, is a conflict and none of
 * its rows are written. A row already recorded for the same user is left be.
 */
export function planIdentityBackfill(
  users: readonly BackfillUser[],
  existing: readonly { kind: string; value: string; user_id: string }[],
): BackfillPlan {
  const skipped = { retired: 0, walletNotEvm: 0, emailInvalid: 0 };
  const candidates: IdentityRow[] = [];
  for (const user of users) {
    if (user.privy_did && /^(retired|merged):/.test(user.privy_did)) {
      skipped.retired += 1;
      continue;
    }
    if (user.email) {
      const value = emailValue(user.email);
      if (!value) skipped.emailInvalid += 1;
      else
        candidates.push({
          user_id: user.id,
          kind: "email",
          value,
          family: null,
          is_primary: true,
          is_home: false,
          verified_at: null,
          proof: "legacy",
        });
    }
    if (user.wallet_address) {
      const value = homeWalletValue(user.wallet_address);
      if (!value) skipped.walletNotEvm += 1;
      else
        candidates.push({
          user_id: user.id,
          kind: "wallet",
          value,
          family: "evm",
          is_primary: false,
          is_home: true,
          verified_at: null,
          proof: "legacy",
        });
    }
  }

  const owners = new Map<string, Set<string>>();
  const key = (kind: string, value: string) => `${kind}\u0000${value}`;
  for (const row of existing) {
    const set = owners.get(key(row.kind, row.value)) ?? new Set();
    set.add(row.user_id);
    owners.set(key(row.kind, row.value), set);
  }
  for (const row of candidates) {
    const set = owners.get(key(row.kind, row.value)) ?? new Set();
    set.add(row.user_id);
    owners.set(key(row.kind, row.value), set);
  }

  const recorded = new Set(existing.map((row) => `${key(row.kind, row.value)}\u0000${row.user_id}`));
  const rows: IdentityRow[] = [];
  const conflicts: BackfillPlan["conflicts"] = [];
  const reported = new Set<string>();
  let alreadyRecorded = 0;
  for (const row of candidates) {
    const k = key(row.kind, row.value);
    const claimants = owners.get(k)!;
    if (claimants.size > 1) {
      if (!reported.has(k)) {
        reported.add(k);
        conflicts.push({ kind: row.kind, userIds: [...claimants].sort() });
      }
      continue;
    }
    if (recorded.has(`${k}\u0000${row.user_id}`)) {
      alreadyRecorded += 1;
      continue;
    }
    rows.push(row);
  }
  return { rows, conflicts, skipped, alreadyRecorded };
}

/**
 * One multi-row insert for the plan, so a write lands whole or not at all.
 * `on conflict do nothing` makes a rerun, or a race with the dual write, a
 * no-op; it also means a row refused by the one-home or one-primary index is
 * skipped rather than failing the batch, which the returned count shows.
 */
export function backfillInsert(rows: readonly IdentityRow[]): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const tuples = rows.map((row) => {
    const base = params.length;
    params.push(
      row.user_id,
      row.kind,
      row.value,
      row.family,
      row.is_primary,
      row.is_home,
      row.verified_at,
      row.proof,
    );
    const p = (i: number) => `$${base + i}`;
    return `(${p(1)}::uuid, ${p(2)}::text, ${p(3)}::text, ${p(4)}::text, ${p(5)}::boolean, ${p(6)}::boolean, ${p(7)}::timestamptz, ${p(8)}::text)`;
  });
  return {
    text: `insert into user_identities (user_id, kind, value, family, is_primary, is_home, verified_at, proof)
           values ${tuples.join(",\n")}
           on conflict do nothing
           returning id`,
    params,
  };
}
