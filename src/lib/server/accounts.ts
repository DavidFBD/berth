import { getSql } from "@/lib/server/db";
import type { Profile } from "@/lib/profile-types";
import { XP_ACTIONS, type XpKind } from "@/lib/xp";

export type UserRow = {
  id: string;
  privy_did: string | null;
  wallet_address: string | null;
  email: string | null;
  avatar_id: string | null;
  xp: number;
  referral_code: string | null;
  referred_by: string | null;
};

const USER_COLUMNS =
  "id, privy_did, wallet_address, email, avatar_id, xp, referral_code, referred_by" as const;

export function normalizeWallet(address: unknown): string | null {
  if (typeof address !== "string") return null;
  const trimmed = address.trim();
  // EVM (0x…), Solana base58, and the odd non-EVM format — accept a sane
  // charset and length instead of hard-coding one chain's shape.
  if (!/^[a-zA-Z0-9:._-]{20,90}$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

/**
 * Finds or creates the account for this request's identity, linking the
 * wallet onto the Privy row when both are present. The one interesting case
 * is the incentive path: a wallet-only account that later signs in with
 * email gets CLAIMED by the DID (one human, one row) instead of forked.
 * Returns the row plus whether it was created just now.
 */
export async function getOrCreateUser({
  did,
  wallet,
}: {
  did: string | null;
  wallet: string | null;
}): Promise<{ user: UserRow; created: boolean } | null> {
  if (!did && !wallet) return null;
  const sql = getSql();

  if (did) {
    let created = false;
    let user = (
      (await sql.query(
        `select ${USER_COLUMNS} from users where privy_did = $1`,
        [did],
      )) as UserRow[]
    )[0];
    if (!user && wallet) {
      // The incentive path: claim a pre-existing wallet-only account rather
      // than forking the human into two rows.
      user = (
        (await sql.query(
          `update users set privy_did = $1, updated_at = now()
           where wallet_address = $2 and privy_did is null
           returning ${USER_COLUMNS}`,
          [did, wallet],
        )) as UserRow[]
      )[0];
    }
    if (!user) {
      user = (
        (await sql.query(
          `insert into users (privy_did) values ($1)
           on conflict (privy_did) do update set updated_at = now()
           returning ${USER_COLUMNS}`,
          [did],
        )) as UserRow[]
      )[0];
      created = true;
    }
    // Store the embedded wallet the first time we see it, so pours keyed by
    // address land on this same row. Never steal an address that already
    // belongs to another account.
    if (wallet && !user.wallet_address) {
      const updated = (await sql.query(
        `update users set wallet_address = $2, updated_at = now()
         where id = $1 and not exists (select 1 from users where wallet_address = $2)
         returning ${USER_COLUMNS}`,
        [user.id, wallet],
      )) as UserRow[];
      user = updated[0] ?? user;
    }
    return { user, created };
  }

  // Wallet-only path.
  const existing = (await sql.query(
    `select ${USER_COLUMNS} from users where wallet_address = $1`,
    [wallet],
  )) as UserRow[];
  if (existing[0]) return { user: existing[0], created: false };
  const inserted = (await sql.query(
    `insert into users (wallet_address) values ($1)
     on conflict (wallet_address) do update set updated_at = now()
     returning ${USER_COLUMNS}`,
    [wallet],
  )) as UserRow[];
  return { user: inserted[0], created: true };
}

/**
 * Appends to the ledger and bumps the denormalized total in one atomic
 * statement. The partial unique indexes absorb replays: a duplicate insert
 * conflicts, the CTE yields no row, and the total moves by zero.
 * Returns the awarded amount (0 when already claimed) and the new total.
 */
export async function awardXp(
  userId: string,
  kind: XpKind,
  ref: string | null,
): Promise<{ awarded: number; xp: number }> {
  const sql = getSql();
  const amount = XP_ACTIONS[kind].amount;
  const rows = (await sql.query(
    `with ins as (
       insert into xp_events (user_id, kind, amount, ref)
       values ($1, $2, $3, $4)
       on conflict do nothing
       returning amount
     )
     update users
     set xp = xp + coalesce((select amount from ins), 0), updated_at = now()
     where id = $1
     returning xp, coalesce((select amount from ins), 0) as awarded`,
    [userId, kind, amount, ref],
  )) as { xp: number; awarded: number }[];
  return { awarded: rows[0]?.awarded ?? 0, xp: rows[0]?.xp ?? 0 };
}

/* Unambiguous lowercase alphabet: no i/l/o/0/1 lookalikes, so a code read
   aloud over a cup of tea survives the retelling. */
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 8;

function mintCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join(
    "",
  );
}

export function normalizeReferralCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(trimmed)
    ? trimmed
    : null;
}

/**
 * Gives the account its shareable code, minting one on first ask. The
 * `where referral_code is null` guard makes concurrent syncs converge on one
 * code; a (vanishingly rare) alphabet collision just falls through to the
 * next attempt.
 */
export async function ensureReferralCode(user: UserRow): Promise<UserRow> {
  if (user.referral_code) return user;
  const sql = getSql();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const rows = (await sql.query(
        `update users set referral_code = $2, updated_at = now()
         where id = $1 and referral_code is null
         returning ${USER_COLUMNS}`,
        [user.id, mintCode()],
      )) as UserRow[];
      if (rows[0]) return rows[0];
      // Someone else's sync won the race: read the code they minted.
      const existing = (await sql.query(
        `select ${USER_COLUMNS} from users where id = $1`,
        [user.id],
      )) as UserRow[];
      if (existing[0]?.referral_code) return existing[0];
    } catch {
      // Unique collision on the code itself; mint another.
    }
  }
  return user;
}

/**
 * Binds who invited this account. Callable only for rows created this
 * request (the route enforces that), and self-referral dies in the SQL: the
 * code must belong to a DIFFERENT user, and referred_by only writes once.
 */
export async function bindReferral(
  userId: string,
  code: string,
): Promise<string | null> {
  const sql = getSql();
  const rows = (await sql.query(
    `update users set referred_by = referrer.id, updated_at = now()
     from (select id from users where referral_code = $2) as referrer
     where users.id = $1 and users.referred_by is null and referrer.id <> $1
     returning referrer.id as referrer_id`,
    [userId, code],
  )) as { referrer_id: string }[];
  return rows[0]?.referrer_id ?? null;
}

export async function setAvatar(
  userId: string,
  avatarId: string,
): Promise<void> {
  const sql = getSql();
  await sql.query(
    "update users set avatar_id = $2, updated_at = now() where id = $1",
    [userId, avatarId],
  );
}

export async function setEmail(userId: string, email: string): Promise<void> {
  const sql = getSql();
  await sql.query(
    "update users set email = $2, updated_at = now() where id = $1",
    [userId, email],
  );
}

/** The shape every profile-ish endpoint returns to the client. */
export function toProfile(user: UserRow): Profile {
  return {
    xp: user.xp,
    avatarId: user.avatar_id,
    hasEmail: user.email !== null,
    referralCode: user.referral_code,
  };
}
