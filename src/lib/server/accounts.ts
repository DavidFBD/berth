import { getSql } from "@/lib/server/db";
import { CODE_ALPHABET, CODE_LENGTH } from "@/lib/invite-code";
import type {
  Profile,
  ReferralPanel,
  RewardList,
} from "@/lib/profile-types";
import {
  INVITE_UNLOCK_LEVEL,
  isXpKind,
  rankForXp,
  XP_ACTIONS,
  type XpKind,
} from "@/lib/xp";

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
    // The repair path. A DID row with no wallet, while an unclaimed row
    // already holds this wallet, is the fork this function exists to
    // prevent, already made: a wallet owner who signed in to Privy during an
    // outage (or before lib/server/privy could see external wallets, as on
    // 2026-09-21) was handed an empty row, and it has shadowed their real
    // one on every sync since. The wallet row is the account, so the DID
    // moves to it. The empty row is kept, not deleted, so its ledger
    // survives for anyone who needs to look; it cannot go without an
    // identity (users_identity), so its DID is retired as "retired:<did>",
    // which no Privy token can ever present.
    if (wallet && !user.wallet_address) {
      const shadowed = (await sql.query(
        `select id from users where wallet_address = $1 and privy_did is null`,
        [wallet],
      )) as { id: string }[];
      if (shadowed[0]) {
        await sql.query(
          `update users set privy_did = 'retired:' || privy_did, updated_at = now()
           where id = $1 and wallet_address is null`,
          [user.id],
        );
        const moved = (
          (await sql.query(
            `update users set privy_did = $1, updated_at = now()
             where id = $2 and privy_did is null
             returning ${USER_COLUMNS}`,
            [did, shadowed[0].id],
          )) as UserRow[]
        )[0];
        if (moved) return { user: moved, created: false };
        // Lost a race for the wallet row: put the DID back where it was.
        await sql.query(
          `update users set privy_did = $1, updated_at = now() where id = $2`,
          [did, user.id],
        );
      }
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
  options: {
    /**
     * false parks the reward as unseen news: pass it when the award lands
     * during someone ELSE's request (friend_poured), so the owner's next
     * profile sync can flush it into a visible ceremony.
     */
    announced?: boolean;
  } = {},
): Promise<{ awarded: number; xp: number }> {
  const sql = getSql();
  const amount = XP_ACTIONS[kind].amount;
  const rows = (await sql.query(
    `with ins as (
       insert into xp_events (user_id, kind, amount, ref, announced)
       values ($1, $2, $3, $4, $5)
       on conflict do nothing
       returning amount
     )
     update users
     set xp = xp + coalesce((select amount from ins), 0), updated_at = now()
     where id = $1
     returning xp, coalesce((select amount from ins), 0) as awarded`,
    [userId, kind, amount, ref, options.announced ?? true],
  )) as { xp: number; awarded: number }[];
  return { awarded: rows[0]?.awarded ?? 0, xp: rows[0]?.xp ?? 0 };
}

/**
 * Collects rewards that landed while the account's owner wasn't looking
 * (announced=false) and marks them told. The caller folds the result into
 * the response's rewards list, so the referrer's "+250, a friend poured"
 * finally gets its toast instead of arriving as a silent balance bump.
 */
export async function flushUnannounced(userId: string): Promise<RewardList> {
  const sql = getSql();
  const rows = (await sql.query(
    `update xp_events set announced = true
     where user_id = $1 and announced = false
     returning kind, amount`,
    [userId],
  )) as { kind: string; amount: number }[];
  return rows
    .filter((row): row is { kind: XpKind; amount: number } =>
      isXpKind(row.kind),
    )
    .map((row) => ({ kind: row.kind, amount: row.amount }));
}

/** The mint: random draws from the rulebook's alphabet (lib/invite-code). */
function mintCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join(
    "",
  );
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

/**
 * The late-claim rule, stated ONCE: unclaimed, young (72 hours), and never
 * poured — the payout moment IS the first verified pour, so a post-pour
 * claim would bind a referral that can never pay out (and would invite
 * retro-claiming settled accounts). Both the write (claimReferral) and the
 * read (referralPanel's canClaim) ask this exact text, on the database's
 * clock, so the hatch the UI offers is the hatch the server honours.
 */
const CLAIMABLE_SQL = `
  users.referred_by is null
  and users.created_at > now() - interval '72 hours'
  and not exists (
    select 1 from xp_events
    where xp_events.user_id = users.id
      and xp_events.kind in ('pour_in', 'pour_out')
  )`;

/**
 * The stripped-link recovery hatch: WhatsApp and friends sometimes eat the
 * ref off a shared URL (field-tested 2026-08-07), so a young account may
 * still present a friend's code by hand. Same self-referral and write-once
 * guards as bindReferral, plus the late-claim rule above.
 */
export async function claimReferral(
  userId: string,
  code: string,
): Promise<string | null> {
  const sql = getSql();
  const rows = (await sql.query(
    `update users set referred_by = referrer.id, updated_at = now()
     from (select id from users where referral_code = $2) as referrer
     where users.id = $1
       and referrer.id <> $1
       and ${CLAIMABLE_SQL}
     returning referrer.id as referrer_id`,
    [userId, code],
  )) as { referrer_id: string }[];
  return rows[0]?.referrer_id ?? null;
}

/** Records one invite-link landing. Junk codes never make a row. */
export async function recordReferralClick(code: string): Promise<void> {
  const sql = getSql();
  await sql.query(
    `insert into referral_clicks (code)
     select $1 where exists (select 1 from users where referral_code = $1)`,
    [code],
  );
}

/**
 * Everything the pantry's referral corner shows, both directions: who set
 * this account's seat (avatar and rank only — never the referrer's email or
 * address), and how the account's own invitations are brewing.
 */
export async function referralPanel(user: UserRow): Promise<ReferralPanel> {
  const sql = getSql();

  let invitedBy: ReferralPanel["invitedBy"] = null;
  if (user.referred_by) {
    const referrer = (await sql.query(
      `select avatar_id, xp from users where id = $1`,
      [user.referred_by],
    )) as { avatar_id: string | null; xp: number }[];
    const accepted = (await sql.query(
      `select 1 from xp_events where user_id = $1 and kind = 'invite_accepted'`,
      [user.id],
    )) as unknown[];
    if (referrer[0]) {
      invitedBy = {
        avatarId: referrer[0].avatar_id,
        level: rankForXp(referrer[0].xp).level,
        firstPourPaid: accepted.length > 0,
      };
    }
  }

  const outbound = (await sql.query(
    `select
       (select count(*) from users where referred_by = $1)::int as seated,
       (select count(*) from xp_events where user_id = $1 and kind = 'friend_poured')::int as poured,
       (select coalesce(sum(amount), 0) from xp_events where user_id = $1 and kind = 'friend_poured')::int as earned`,
    [user.id],
  )) as { seated: number; poured: number; earned: number }[];

  const clicks = user.referral_code
    ? ((await sql.query(
        `select count(*)::int as taps from referral_clicks where code = $1`,
        [user.referral_code],
      )) as { taps: number }[])
    : [{ taps: 0 }];

  // The hatch question is CLAIMABLE_SQL's to answer — the panel asks the
  // same predicate the claim write enforces, never a re-derivation.
  const claimable = (await sql.query(
    `select exists(
       select 1 from users where users.id = $1 and ${CLAIMABLE_SQL}
     ) as can`,
    [user.id],
  )) as { can: boolean }[];

  const { seated, poured, earned } = outbound[0] ?? {
    seated: 0,
    poured: 0,
    earned: 0,
  };

  return {
    invitedBy,
    canClaim: claimable[0]?.can ?? false,
    stats: {
      taps: clicks[0]?.taps ?? 0,
      seated,
      poured,
      earnedXp: earned,
      steepingXp:
        Math.max(0, seated - poured) * XP_ACTIONS.friend_poured.amount,
    },
  };
}

const LEDGER_PAGE = 30;

/**
 * The house ledger: the account's recent XP events, newest first, so every
 * award is attributable after the fact (field feedback 2026-08-07: a fresh
 * account couldn't tell where its 210 XP came from).
 */
export async function xpHistory(
  userId: string,
): Promise<{ kind: XpKind; amount: number; at: string }[]> {
  const sql = getSql();
  const rows = (await sql.query(
    `select kind, amount, created_at from xp_events
     where user_id = $1
     order by created_at desc, id desc
     limit ${LEDGER_PAGE}`,
    [userId],
  )) as { kind: string; amount: number; created_at: string }[];
  return rows
    .filter((row): row is (typeof rows)[number] & { kind: XpKind } =>
      isXpKind(row.kind),
    )
    .map((row) => ({
      kind: row.kind,
      amount: row.amount,
      at: new Date(row.created_at).toISOString(),
    }));
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

/**
 * The shape every profile-ish endpoint returns to the client. The invite
 * code is a rank perk: minted for everyone (so inbound links always
 * resolve), revealed only from INVITE_UNLOCK_LEVEL — below that the client
 * shows the locked row instead of a link.
 */
export function toProfile(user: UserRow): Profile {
  return {
    xp: user.xp,
    avatarId: user.avatar_id,
    hasEmail: user.email !== null,
    referralCode:
      rankForXp(user.xp).level >= INVITE_UNLOCK_LEVEL
        ? user.referral_code
        : null,
  };
}
