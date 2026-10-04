import { getSql } from "@/lib/server/db";
import { sendNotice } from "@/lib/server/email/notify";
import { toCaip10, type WalletFamily } from "@/lib/identity/caip";
import {
  UNLINK_COOLDOWN_DAYS,
  linkedWallets,
  walletOwner,
  type LinkedWallet,
} from "@/lib/server/identities";

/**
 * Phase 2 of docs/plans/account-linking.md: an account holds more than one
 * EVM address. Each address was proved with a fresh SIWE signature
 * (app/api/account/wallets/*); this module is what happens after the proof,
 * against user_identities, with one account_audit row for every change.
 *
 * - One home EVM address per account: buys land in its hub wallet. The
 *   users.wallet_address column mirrors it for every reader not yet moved.
 * - Other addresses pay from, and their hub wallets count toward totals.
 * - Unlinking keeps the row with unlinked_at set; the address may join
 *   another account only UNLINK_COOLDOWN_DAYS later. Orders stay put.
 * - An address on another account is never moved here (merge is phase 3).
 * - A Solana address (proved with Sign-In With Solana) joins the same way,
 *   never as home: its rows are family 'solana', proof 'siws', value
 *   `solana:<base58>` with the case as signed.
 * - A Bitcoin mainnet address (proved with Sign-In With Bitcoin, BIP-322 or
 *   BIP-137, lib/server/siwb) likewise: family 'bitcoin', proof 'bip322',
 *   value `bip122:<address>` (bech32 lowercase, base58 as it is).
 */

/** The families an address can be linked in. */
export type LinkFamily = WalletFamily;

/** The proof each family's link is recorded with (user_identities.proof). */
const LINK_PROOF: Record<LinkFamily, "siwe" | "siws" | "bip322"> = { evm: "siwe", solana: "siws", bitcoin: "bip322" };

export type LinkOutcome =
  /** Now on this account. */
  | "linked"
  /** It already was. */
  | "already"
  /** Another account holds it. Nothing more is said. */
  | "other_account"
  /** It left another account less than the cooldown ago. */
  | "cooling";

export async function audit(userId: string, action: string, detail: Record<string, unknown>): Promise<void> {
  try {
    await getSql().query(
      `insert into account_audit (user_id, action, detail) values ($1, $2, $3::jsonb)`,
      [userId, action, JSON.stringify(detail)],
    );
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    console.warn(`[account-wallets] audit ${action} failed for ${userId.slice(0, 8)}${typeof code === "string" ? ` (${code})` : ""}`);
  }
}

/**
 * Links an EVM address the caller has just proved to the account. The
 * first EVM address of an account with no home becomes its home (and the
 * users.wallet_address mirror); every other one pays from. One statement:
 * an address another account holds (linked, cooling down, or only on its
 * users.wallet_address) is never inserted, and a row unlinked long enough
 * ago, or unlinked from this very account, is taken over.
 */
export async function linkWallet(userId: string, address: string, family: LinkFamily = "evm"): Promise<LinkOutcome> {
  const value = toCaip10(family, address);
  if (!value) throw new Error(`not a ${family} address`);
  const wallet = value.slice(value.indexOf(":") + 1);
  const evm = family === "evm";
  const sql = getSql();
  // users.wallet_address is the EVM home mirror: only an EVM link may
  // become home, and only an EVM address can be held there by another row.
  const insert = (mayBeHome: boolean) =>
    sql.query(
      `insert into user_identities (user_id, kind, value, family, is_home, verified_at, proof)
     select $1, 'wallet', $2, '${family}',
            ${!evm ? "false" : `${mayBeHome ? "" : "false and "}not exists (select 1 from user_identities h where h.user_id = $1 and h.is_home)
              and exists (select 1 from users u where u.id = $1 and (u.wallet_address is null or u.wallet_address = $3))`},
            now(), '${LINK_PROOF[family]}'
      where ${evm ? "not exists (select 1 from users u where u.wallet_address = $3 and u.id <> $1)" : "$3::text is not null"}
     on conflict on constraint user_identities_kind_value do update set
       user_id = excluded.user_id, is_home = excluded.is_home, is_primary = false,
       verified_at = excluded.verified_at, proof = excluded.proof,
       unlinked_at = null, created_at = now()
     where user_identities.unlinked_at is not null
       and (user_identities.user_id = excluded.user_id
            or user_identities.unlinked_at <= now() - interval '${UNLINK_COOLDOWN_DAYS} days')
     returning is_home, id, extract(epoch from created_at)::bigint::text as at`,
      [userId, value, wallet],
    ) as Promise<{ is_home: boolean; id: string; at: string }[]>;
  let rows: { is_home: boolean; id: string; at: string }[];
  try {
    rows = await insert(true);
  } catch (error) {
    // Two links racing for an account with no home: the one-home index
    // lets one win, and the other joins as a pay-from address.
    if ((error as { code?: unknown })?.code !== "23505") throw error;
    rows = await insert(false);
  }

  if (rows[0]) {
    if (rows[0].is_home) {
      await sql.query(
        `update users set wallet_address = $2, updated_at = now() where id = $1 and wallet_address is null`,
        [userId, wallet],
      );
    }
    await audit(userId, "wallet_linked", { family, wallet: value, home: rows[0].is_home, proof: LINK_PROOF[family] });
    // A security notice, once per link (the row and when it was linked).
    sendNotice({ userId, ref: `${rows[0].id}:${rows[0].at}`, notice: { type: "wallet_added", family, address: wallet } });
    return "linked";
  }

  const owner = await walletOwner(wallet);
  if (owner?.state === "linked" && owner.userId === userId) return "already";
  if (owner === undefined || owner.state === "free") {
    const usersOwner = evm
      ? ((await sql.query(`select id from users where wallet_address = $1`, [wallet])) as { id: string }[])
      : [];
    if (usersOwner[0]?.id === userId) return "already";
    await audit(userId, "identity_conflict", { kind: "wallet", family, otherUserId: usersOwner[0]?.id ?? null });
    return "other_account";
  }
  if (owner.state === "cooling") {
    await audit(userId, "wallet_link_cooling", { family, otherUserId: owner.userId });
    return "cooling";
  }
  await audit(userId, "identity_conflict", { kind: "wallet", family, otherUserId: owner.userId });
  return "other_account";
}

export type HomeOutcome = "home" | "already" | "not_linked";

/**
 * Makes a linked EVM address the account's home: future buys land in its
 * hub wallet. Nothing already bought moves. Two statements, in the order
 * the one-home index allows (clear, then set); while between them the
 * users.wallet_address mirror still names the old home, and linkedWallets
 * reads it as the home, so a reader never sees an account without one. A
 * failed set puts the old home back.
 */
export async function makeHome(userId: string, address: string): Promise<HomeOutcome> {
  const value = toCaip10("evm", address);
  if (!value) return "not_linked";
  const wallet = value.slice(value.indexOf(":") + 1);
  const sql = getSql();
  const wallets = await linkedWallets(userId, await usersWallet(userId));
  const target = wallets.find((candidate) => candidate.family === "evm" && candidate.address === wallet);
  if (!target) return "not_linked";
  if (target.isHome) return "already";
  const previous = wallets.find((candidate) => candidate.family === "evm" && candidate.isHome) ?? null;

  // A home carried only on users.wallet_address (never backfilled) gets its
  // identity row first, so the switch below has a row to clear.
  if (previous && previous.proof === "legacy") {
    await sql.query(
      `insert into user_identities (user_id, kind, value, family, is_home, proof)
       values ($1, 'wallet', $2, 'evm', false, 'legacy')
       on conflict do nothing`,
      [userId, `eip155:${previous.address}`],
    );
  }
  await sql.query(`update user_identities set is_home = false where user_id = $1 and is_home`, [userId]);
  try {
    const set = (await sql.query(
      `update user_identities set is_home = true
        where user_id = $1 and kind = 'wallet' and value = $2 and unlinked_at is null
        returning id`,
      [userId, value],
    )) as unknown[];
    if (set.length === 0) throw new Error("home row gone");
  } catch (error) {
    if (previous) {
      await sql
        .query(
          `update user_identities set is_home = true where user_id = $1 and kind = 'wallet' and value = $2`,
          [userId, `eip155:${previous.address}`],
        )
        .catch(() => undefined);
    }
    throw error;
  }
  await sql.query(`update users set wallet_address = $2, updated_at = now() where id = $1`, [userId, wallet]);
  await audit(userId, "home_changed", {
    family: "evm",
    from: previous ? `eip155:${previous.address}` : null,
    to: value,
  });
  return "home";
}

export type UnlinkOutcome = "unlinked" | "is_home" | "not_linked";

/**
 * Takes a linked address off the account. The home cannot go: another must
 * be made home first. Orders it paid for stay on the account as history,
 * and its hub wallet's holdings stay reachable only by reconnecting it (the
 * UI says so before asking). The row stays, cooling down.
 */
export async function unlinkWallet(userId: string, address: string, family: LinkFamily = "evm"): Promise<UnlinkOutcome> {
  const value = toCaip10(family, address);
  if (!value) return "not_linked";
  const wallet = value.slice(value.indexOf(":") + 1);
  const sql = getSql();
  const wallets = await linkedWallets(userId, await usersWallet(userId));
  const target = wallets.find((candidate) => candidate.family === family && candidate.address === wallet);
  if (!target) return "not_linked";
  if (target.isHome) return "is_home";
  const rows = (await sql.query(
    `update user_identities set unlinked_at = now()
      where user_id = $1 and kind = 'wallet' and value = $2 and unlinked_at is null and not is_home
      returning id, extract(epoch from unlinked_at)::bigint::text as at`,
    [userId, value],
  )) as { id: string; at: string }[];
  if (rows.length === 0) return "not_linked";
  await audit(userId, "wallet_unlinked", { family, wallet: value });
  sendNotice({ userId, ref: `${rows[0].id}:${rows[0].at}`, notice: { type: "wallet_removed", family, address: wallet } });
  return "unlinked";
}

async function usersWallet(userId: string): Promise<string | null> {
  const rows = (await getSql().query(`select wallet_address from users where id = $1`, [userId])) as { wallet_address: string | null }[];
  return rows[0]?.wallet_address ?? null;
}

/** The list the drawer shows: every linked wallet, home first. */
export async function walletsOf(userId: string): Promise<LinkedWallet[]> {
  return linkedWallets(userId, await usersWallet(userId));
}
