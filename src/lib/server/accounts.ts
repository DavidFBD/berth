import { getSql } from "@/lib/server/db";
import { detectFamily, normalizeAddress } from "@/lib/identity/caip";
import { recordHomeWallet, recordPrimaryEmail, walletOwner } from "@/lib/server/identities";
import { CODE_ALPHABET, CODE_LENGTH } from "@/lib/invite-code";
import { befriendOnReferral } from "@/lib/server/social/friends";
import { SHOWN_SQL } from "@/lib/server/social/people";
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
  /** Set once the account was merged into another (lib/server/account-merge): that one is the account now. */
  retired_into?: string | null;
};

const USER_COLUMNS =
  "id, privy_did, wallet_address, email, avatar_id, xp, referral_code, referred_by, retired_into" as const;

/**
 * The one spelling of a wallet address Berth stores and compares, per
 * network family (lib/identity/caip): EVM lowercase, Solana base58 exactly
 * as given (base58 is case-sensitive), Bitcoin bech32 lowercase and base58
 * as given. An address of no family Berth knows keeps its case too (only
 * trimmed, and only within a sane charset and length): lowercasing it could
 * merge two different keys into one row.
 */
export function normalizeWallet(address: unknown): string | null {
  if (typeof address !== "string") return null;
  const trimmed = address.trim();
  if (!/^[a-zA-Z0-9:._-]{20,90}$/.test(trimmed)) return null;
  // Any 0x + 40 hex is EVM and compares case-insensitively. Mixed case must
  // be a valid EIP-55 checksum, the same rule toCaip10 applies, so a row
  // is never stored under an address its identity would refuse.
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return normalizeAddress("evm", trimmed);
  const family = detectFamily(trimmed);
  return family ? normalizeAddress(family, trimmed) : trimmed;
}

/**
 * Thrown by getOrCreateUser when a wallet-only caller's address was unlinked
 * from an account less than UNLINK_COOLDOWN_DAYS ago: it may not start or
 * join another account yet (docs/plans/account-linking.md, Decisions).
 */
export class WalletCoolingDownError extends Error {
  constructor() {
    super("wallet cooling down");
    this.name = "WalletCoolingDownError";
  }
}

/**
 * Thrown by getOrCreateUser when user_identities cannot be read and the
 * users columns know nothing of the wallet either: the address might be one
 * unlinked days ago and still cooling down, so no new account is made for
 * it on a guess (fail closed). An address the users columns already place
 * on an account still signs in to that one, as before phase 2.
 */
export class IdentityUnavailableError extends Error {
  constructor() {
    super("identity lookup failed");
    this.name = "IdentityUnavailableError";
  }
}

/**
 * A new account asked for where Berth is not available (lib/availability).
 * Nothing was written: an existing account is always found, only a new one
 * is refused.
 */
export class NewAccountUnavailableError extends Error {
  constructor() {
    super("new account not available here");
    this.name = "NewAccountUnavailableError";
  }
}

/** The users row with this id, or undefined. */
async function userById(id: string): Promise<UserRow | undefined> {
  return (
    (await getSql().query(`select ${USER_COLUMNS} from users where id = $1`, [id])) as UserRow[]
  )[0];
}

/**
 * The account a row stands for: itself, or, for a row merged into another
 * (retired_into, lib/server/account-merge), the survivor. A merge points
 * every row retired into the absorbed one at the survivor too, so one step
 * is the rule; the loop only guards against a chain written by hand.
 */
export async function liveAccount(user: UserRow | undefined): Promise<UserRow | undefined> {
  let current = user;
  for (let hops = 0; current?.retired_into && hops < 4; hops += 1) {
    current = await userById(current.retired_into);
  }
  return current?.retired_into ? undefined : current;
}

/**
 * The account a Privy DID signs in to, without creating one: the row with
 * that DID, or the survivor of a merge that absorbed it (its DID is kept
 * as 'merged:<did>'). Undefined when neither exists.
 */
export async function accountForDid(did: string): Promise<UserRow | undefined> {
  const rows = (await getSql().query(
    `select ${USER_COLUMNS} from users where privy_did = $1 or privy_did = 'merged:' || $1
      order by (privy_did = $1) desc limit 1`,
    [did],
  )) as UserRow[];
  return liveAccount(rows[0]);
}

/**
 * The account a wallet address belongs to, without creating one: the
 * linked identity's account, else the row whose users.wallet_address it is.
 */
export async function accountForWallet(wallet: string): Promise<UserRow | undefined> {
  const owner = await walletOwner(wallet);
  if (owner?.state === "linked") return liveAccount(await userById(owner.userId));
  if (owner?.state === "cooling") return undefined;
  const rows = (await getSql().query(`select ${USER_COLUMNS} from users where wallet_address = $1`, [wallet])) as UserRow[];
  return liveAccount(rows[0]);
}

/**
 * Finds or creates the account for this request's identity, linking the
 * wallet onto the Privy row when both are present. The one interesting case
 * is the incentive path: a wallet-only account that later signs in with
 * email gets CLAIMED by the DID (one human, one row) instead of forked.
 * Returns the row plus whether it was created just now.
 *
 * Phase 2: a wallet is looked up in user_identities first, so any address
 * linked to an account (not only its home, users.wallet_address) signs in to
 * that account. When the table cannot be read the users columns decide, as
 * before; an account with one wallet resolves exactly as it always did.
 */
export async function getOrCreateUser({
  did,
  wallet,
  mayCreate = true,
}: {
  did: string | null;
  wallet: string | null;
  /**
   * false where Berth is not available (lib/availability): an account that
   * already exists is found as always, a new one is not made, and
   * NewAccountUnavailableError says so.
   */
  mayCreate?: boolean;
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
    // A DID whose account was merged into another signs in to the survivor.
    if (!user) {
      const merged = await accountForDid(did);
      if (merged) return { user: merged, created: false };
    }
    // Who the Privy wallet belongs to in user_identities (undefined when the
    // table cannot be read: the users columns decide).
    const owner = wallet ? await walletOwner(wallet) : undefined;
    if (!user && wallet) {
      // The incentive path: claim a pre-existing wallet-only account rather
      // than forking the human into two rows. The account is the one the
      // identity names, else the row whose users.wallet_address it is.
      user = (
        (await sql.query(
          owner?.state === "linked"
            ? `update users set privy_did = $1, updated_at = now()
               where id = $2 and privy_did is null
               returning ${USER_COLUMNS}`
            : `update users set privy_did = $1, updated_at = now()
               where wallet_address = $2 and privy_did is null
               returning ${USER_COLUMNS}`,
          [did, owner?.state === "linked" ? owner.userId : wallet],
        )) as UserRow[]
      )[0];
    }
    if (!user && !mayCreate) throw new NewAccountUnavailableError();
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
    //
    // Only an empty row is retired: no email, no order, nobody seated on
    // its invite. An email user can reach the same shape by exporting their
    // embedded key and connecting it as an external wallet, and their row is
    // an account, not a fork; that case keeps the old refusal below.
    if (wallet && !user.wallet_address && !user.email) {
      const shadowed = (await sql.query(
        `select w.id from users w
         where w.wallet_address = $1 and w.privy_did is null
           and not exists (
             select 1 from xp_events e
             where e.user_id = $2 and e.kind in ('pour_in', 'pour_out', 'friend_poured')
           )
           and not exists (select 1 from users r where r.referred_by = $2)`,
        [wallet, user.id],
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
    // An address another account holds in user_identities (linked, or
    // unlinked and cooling down) is theirs too.
    const heldElsewhere = owner !== undefined && owner.state !== "free" && owner.userId !== user.id;
    if (wallet && !user.wallet_address && !heldElsewhere) {
      const updated = (await sql.query(
        `update users set wallet_address = $2, updated_at = now()
         where id = $1 and not exists (select 1 from users where wallet_address = $2)
         returning ${USER_COLUMNS}`,
        [user.id, wallet],
      )) as UserRow[];
      // Dual write (phase 1), after the users write and never failing it.
      // Privy vouches for this address, so the proof says so.
      if (updated[0]) await recordHomeWallet(updated[0].id, wallet, "privy_wallet");
      user = updated[0] ?? user;
    }
    return { user, created };
  }

  // Wallet-only path. The identity decides first: a linked address (home or
  // not) is its account; an address unlinked less than the cooldown ago
  // joins nothing yet.
  const owner = await walletOwner(wallet);
  if (owner?.state === "linked") {
    const linked = await liveAccount(await userById(owner.userId));
    if (linked) return { user: linked, created: false };
  }
  if (owner?.state === "cooling") throw new WalletCoolingDownError();
  const existing = (await sql.query(
    `select ${USER_COLUMNS} from users where wallet_address = $1`,
    [wallet],
  )) as UserRow[];
  if (existing[0]) return { user: existing[0], created: false };
  if (owner === undefined) throw new IdentityUnavailableError();
  if (!mayCreate) throw new NewAccountUnavailableError();
  const inserted = (await sql.query(
    `insert into users (wallet_address) values ($1)
     on conflict (wallet_address) do update set updated_at = now()
     returning ${USER_COLUMNS}`,
    [wallet],
  )) as UserRow[];
  // Dual write (phase 1), after the users write and never failing it. A
  // wallet-only caller proved the address with SIWE (readRewardsCaller
  // accepts nothing less).
  if (inserted[0]) await recordHomeWallet(inserted[0].id, wallet, "siwe");
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
 * Binds the invite code a new account arrived with, on its first profile
 * sync. "New" is the account's own record, not the request that happened to
 * create the row: the welcome reward (account_created) is paid on that same
 * first sync, just after this, so an account that has it has synced before
 * and is not new. Until 2026-09-29 the rule was "created this request", and
 * any other rewards route that won the race to create the row (a wallet
 * sign in fires several at once) silently spent the code (a referred account
 * in production was born in another route 7 seconds before its sync).
 *
 * The late-claim rule holds too (young, unclaimed, never poured), and
 * self-referral dies in the SQL: the code must belong to a DIFFERENT user,
 * and referred_by only writes once. The code of an account merged into
 * another names the survivor. A bind makes the two friends.
 */
export async function bindReferral(
  userId: string,
  code: string,
): Promise<string | null> {
  const sql = getSql();
  const rows = (await sql.query(
    `update users set referred_by = referrer.id, updated_at = now()
     from (select coalesce(retired_into, id) as id from users where referral_code = $2) as referrer
     where users.id = $1
       and referrer.id <> $1
       and ${CLAIMABLE_SQL}
       and not exists (
         select 1 from xp_events
         where xp_events.user_id = users.id and xp_events.kind = 'account_created'
       )
     returning referrer.id as referrer_id`,
    [userId, code],
  )) as { referrer_id: string }[];
  const referrerId = rows[0]?.referrer_id ?? null;
  if (referrerId) await befriendOnReferral(userId, referrerId, "invite");
  return referrerId;
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
     from (select coalesce(retired_into, id) as id from users where referral_code = $2) as referrer
     where users.id = $1
       and referrer.id <> $1
       and ${CLAIMABLE_SQL}
     returning referrer.id as referrer_id`,
    [userId, code],
  )) as { referrer_id: string }[];
  const referrerId = rows[0]?.referrer_id ?? null;
  if (referrerId) await befriendOnReferral(userId, referrerId, "code");
  return referrerId;
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
    // Friends since the referral bound (social/friends befriendOnReferral):
    // the name is shown as the friends list would show it, the name at the
    // time the card went off when it is off.
    const friendship = (await sql.query(
      `select case when ${SHOWN_SQL("$2::uuid")} then h.handle else coalesce(p.hidden_handle, h.handle) end as name
       from friends f
       left join handles h on h.user_id = $2
       left join profiles p on p.user_id = $2
       where f.a_id = least($1::uuid, $2::uuid) and f.b_id = greatest($1::uuid, $2::uuid)`,
      [user.id, user.referred_by],
    )) as { name: string | null }[];
    if (referrer[0]) {
      invitedBy = {
        avatarId: referrer[0].avatar_id,
        level: rankForXp(referrer[0].xp).level,
        firstPourPaid: accepted.length > 0,
        friends: friendship.length > 0,
        name: friendship[0]?.name ?? null,
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

/**
 * Stores the Privy-verified email on the row, then records it as the
 * account's primary email identity (dual write, phase 1) in a separate
 * statement that can never fail the save (lib/server/identities).
 * users.email stays exactly as Privy spelled it; the identity is the
 * normalised form.
 */
export async function setEmail(userId: string, email: string): Promise<void> {
  const sql = getSql();
  await sql.query(
    "update users set email = $2, updated_at = now() where id = $1",
    [userId, email],
  );
  await recordPrimaryEmail(userId, email);
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
    homeAddress: user.wallet_address && /^0x[0-9a-f]{40}$/.test(user.wallet_address) ? user.wallet_address : null,
    referralCode:
      rankForXp(user.xp).level >= INVITE_UNLOCK_LEVEL
        ? user.referral_code
        : null,
  };
}
