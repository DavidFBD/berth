import { getSql } from "@/lib/server/db";
import { detectFamily, normalizeEmail, parseCaip10, toCaip10, type WalletFamily } from "@/lib/identity/caip";

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

/**
 * Phase 2: reads. How long an unlinked address waits before another
 * account may take it (docs/plans/account-linking.md, Decisions). While it
 * waits the old row keeps its place under unique (kind, value), with
 * unlinked_at set, so no other account can insert it.
 */
export const UNLINK_COOLDOWN_DAYS = 7;

/** SQL for "this row still holds its identifier": linked, or unlinked and still cooling down. */
export const HOLDS_IDENTIFIER_SQL = `(unlinked_at is null or unlinked_at > now() - interval '${UNLINK_COOLDOWN_DAYS} days')`;

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
       ${RECLAIM_EXPIRED_SQL}`,
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
    const owner = (await sql.query(
      `select user_id, is_primary from user_identities where kind = 'email' and value = $1`,
      [value],
    )) as { user_id: string; is_primary: boolean }[];
    const other = owner[0]?.user_id;
    if (other && other !== userId) {
      await sql.query(
        `insert into account_audit (user_id, action, detail)
         values ($1, 'identity_conflict', $2::jsonb)`,
        [userId, JSON.stringify({ kind: "email", otherUserId: other })],
      );
      return;
    }
    if (owner[0]?.is_primary) return;
    // A changed email: the old primary stays on the account as a linked
    // email (it still belongs to nobody else), and the new one becomes the
    // primary. Clear, then set, in the order the one-primary index allows.
    const demoted = (await sql.query(
      `update user_identities set is_primary = false
        where user_id = $1 and kind = 'email' and is_primary and value <> $2
        returning id`,
      [userId, value],
    )) as unknown[];
    if (owner[0]) {
      await sql.query(`update user_identities set is_primary = true, verified_at = now(), proof = 'privy_email' where kind = 'email' and value = $1 and user_id = $2`, [value, userId]);
    } else {
      await sql.query(
        `insert into user_identities (user_id, kind, value, is_primary, verified_at, proof)
         values ($1, 'email', $2, true, now(), 'privy_email')`,
        [userId, value],
      );
    }
    if (demoted.length > 0) {
      await sql.query(`insert into account_audit (user_id, action, detail) values ($1, 'primary_email_changed', '{}'::jsonb)`, [userId]);
    }
  } catch (error) {
    warnIdentity("email", userId, error);
  }
}

/**
 * After a merge: an account left with no primary email identity although
 * its users.email holds one (a survivor the backfill never reached, or
 * whose row moved over as linked) records it as primary, so notices have
 * somewhere to go. Never throws; does nothing when a primary exists.
 */
export async function ensurePrimaryEmail(userId: string): Promise<void> {
  try {
    const rows = (await getSql().query(
      `select u.email from users u
        where u.id = $1 and u.email is not null and btrim(u.email) <> ''
          and not exists (select 1 from user_identities i where i.user_id = u.id and i.is_primary)`,
      [userId],
    )) as { email: string }[];
    const value = emailValue(rows[0]?.email);
    if (!value) return;
    await getSql().query(
      `insert into user_identities (user_id, kind, value, is_primary, proof)
       values ($1, 'email', $2, true, 'legacy')
       on conflict on constraint user_identities_kind_value do update set is_primary = true
         where user_identities.user_id = excluded.user_id`,
      [userId, value],
    );
  } catch (error) {
    warnIdentity("email", userId, error);
  }
}

/**
 * The conflict clause of every wallet identity insert: an address unlinked
 * more than UNLINK_COOLDOWN_DAYS ago is free, so its old row is taken over
 * by the new account, as if it were new. Any other owner keeps it (the
 * insert becomes a no-op).
 */
const RECLAIM_EXPIRED_SQL = `on conflict on constraint user_identities_kind_value do update set
         user_id = excluded.user_id, is_home = excluded.is_home, is_primary = false,
         verified_at = excluded.verified_at, proof = excluded.proof,
         unlinked_at = null, created_at = now()
       where user_identities.unlinked_at is not null
         and user_identities.unlinked_at <= now() - interval '${UNLINK_COOLDOWN_DAYS} days'`;

export { RECLAIM_EXPIRED_SQL };

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

export type WalletOwner =
  | { state: "linked"; userId: string }
  | { state: "cooling"; userId: string }
  | { state: "free" };

/**
 * Who a wallet address belongs to, read from user_identities: the linked
 * account, the account it was unlinked from while the cooldown runs, or
 * nobody (never recorded, or unlinked more than UNLINK_COOLDOWN_DAYS ago).
 * Undefined when the table cannot be read, so callers fall back to the
 * users columns instead of failing a sign in.
 */
export async function walletOwner(wallet: string | null | undefined): Promise<WalletOwner | undefined> {
  const family = wallet ? detectFamily(wallet) : null;
  const value = family ? toCaip10(family, wallet) : null;
  if (!value) return { state: "free" };
  try {
    const rows = (await getSql().query(
      `select user_id, unlinked_at is null as linked, ${HOLDS_IDENTIFIER_SQL} as holds
         from user_identities where kind = 'wallet' and value = $1`,
      [value],
    )) as { user_id: string; linked: boolean; holds: boolean }[];
    const row = rows[0];
    if (!row || !row.holds) return { state: "free" };
    return row.linked ? { state: "linked", userId: row.user_id } : { state: "cooling", userId: row.user_id };
  } catch (error) {
    warnIdentity("wallet read", "-", error);
    return undefined;
  }
}

export type LinkedWallet = {
  /** The canonical address (EVM lowercase). */
  address: string;
  family: WalletFamily;
  isHome: boolean;
  proof: IdentityProof;
  linkedAt: string;
};

/**
 * Every wallet linked to the account now, home first, then in the order they
 * were linked. When the table cannot be read, or holds nothing for an
 * account that has a users.wallet_address (an account the backfill has not
 * reached), that one address stands in as the home: the account reads
 * exactly as it did before phase 2.
 */
export async function linkedWallets(
  userId: string,
  usersWallet?: string | null,
): Promise<LinkedWallet[]> {
  let rows: { value: string; family: WalletFamily; is_home: boolean; proof: IdentityProof; created_at: string | Date }[] = [];
  try {
    rows = (await getSql().query(
      `select value, family, is_home, proof, created_at from user_identities
        where user_id = $1 and kind = 'wallet' and unlinked_at is null
        order by is_home desc, created_at, value`,
      [userId],
    )) as typeof rows;
  } catch (error) {
    warnIdentity("wallet list", userId, error);
  }
  const out: LinkedWallet[] = [];
  for (const row of rows) {
    const parsed = parseCaip10(row.value);
    if (!parsed) continue;
    out.push({
      address: parsed.address,
      family: parsed.family,
      isHome: row.is_home,
      proof: row.proof,
      linkedAt: new Date(row.created_at).toISOString(),
    });
  }
  const home = homeWalletValue(usersWallet);
  if (home && !out.some((wallet) => wallet.family === "evm" && wallet.isHome)) {
    const address = home.slice(home.indexOf(":") + 1);
    const known = out.find((wallet) => wallet.family === "evm" && wallet.address === address);
    if (known) known.isHome = true;
    else out.unshift({ address, family: "evm", isHome: true, proof: "legacy", linkedAt: new Date(0).toISOString() });
    out.sort((a, b) => Number(b.isHome) - Number(a.isHome));
  }
  return out;
}

/** The account's EVM addresses, home first: every one has its own hub wallet. */
export async function accountEvmAddresses(
  userId: string,
  usersWallet?: string | null,
): Promise<{ home: string | null; all: string[] }> {
  const evm = (await linkedWallets(userId, usersWallet)).filter((wallet) => wallet.family === "evm");
  return { home: evm.find((wallet) => wallet.isHome)?.address ?? null, all: evm.map((wallet) => wallet.address) };
}
