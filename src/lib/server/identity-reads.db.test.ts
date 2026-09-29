import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { getOrCreateUser, WalletCoolingDownError } from "./accounts";
import { accountEvmAddresses, linkedWallets, walletOwner } from "./identities";

/**
 * Phase 2, step 1: sign in resolves wallets through user_identities. An
 * account with one wallet resolves exactly as before; a second address
 * linked to it signs in to it; an address still cooling down after an
 * unlink joins nothing.
 */

let sql: SqlClient;
let close: () => Promise<void>;

beforeAll(async () => {
  const db = await makeTestDb();
  sql = db.sql;
  close = db.close;
  setSqlClient(sql);
});

afterAll(async () => {
  setSqlClient(null);
  await close();
});

let n = 0x500;
const evm = () => `0x${(++n).toString(16).padStart(40, "0")}`;

const addSecond = (userId: string, address: string, unlinkedDaysAgo?: number) =>
  sql.query(
    `insert into user_identities (user_id, kind, value, family, is_home, verified_at, proof, unlinked_at)
     values ($1, 'wallet', $2, 'evm', false, now(), 'siwe', $3::timestamptz)`,
    [userId, `eip155:${address}`, unlinkedDaysAgo === undefined ? null : new Date(Date.now() - unlinkedDaysAgo * 86_400_000).toISOString()],
  );

describe("single wallet accounts resolve as before", () => {
  it("a wallet signs in to its own account, the same row every time", async () => {
    const wallet = evm();
    const first = (await getOrCreateUser({ did: null, wallet }))!;
    const again = (await getOrCreateUser({ did: null, wallet }))!;
    expect(first.created).toBe(true);
    expect(again).toEqual({ user: first.user, created: false });
    expect(await accountEvmAddresses(first.user.id, first.user.wallet_address)).toEqual({ home: wallet, all: [wallet] });
  });

  it("an account the backfill never reached still reads its users.wallet_address as home", async () => {
    const wallet = evm();
    const rows = (await sql.query(`insert into users (wallet_address) values ($1) returning id`, [wallet])) as { id: string }[];
    const again = (await getOrCreateUser({ did: null, wallet }))!;
    expect(again.user.id).toBe(rows[0].id);
    expect(await linkedWallets(rows[0].id, wallet)).toEqual([
      expect.objectContaining({ address: wallet, family: "evm", isHome: true, proof: "legacy" }),
    ]);
  });

  it("a Privy account keeps its embedded wallet as home", async () => {
    const wallet = evm();
    const { user } = (await getOrCreateUser({ did: "did:privy:reads-1", wallet }))!;
    expect(user.wallet_address).toBe(wallet);
    expect((await accountEvmAddresses(user.id, user.wallet_address)).home).toBe(wallet);
  });
});

describe("a second linked address", () => {
  it("signs in to the account it is linked to, never a new one", async () => {
    const home = evm();
    const second = evm();
    const { user } = (await getOrCreateUser({ did: null, wallet: home }))!;
    await addSecond(user.id, second);
    const resolved = (await getOrCreateUser({ did: null, wallet: second }))!;
    expect(resolved).toEqual({ user: expect.objectContaining({ id: user.id, wallet_address: home }), created: false });
    expect(await accountEvmAddresses(user.id, home)).toEqual({ home, all: [home, second] });
    const count = (await sql.query(`select count(*)::int as n from users where wallet_address = $1`, [second])) as { n: number }[];
    expect(count[0].n).toBe(0);
  });

  it("a Privy sign in whose wallet is linked to a wallet account claims that account", async () => {
    const home = evm();
    const second = evm();
    const { user } = (await getOrCreateUser({ did: null, wallet: home }))!;
    await addSecond(user.id, second);
    const claimed = (await getOrCreateUser({ did: "did:privy:reads-claim", wallet: second }))!;
    expect(claimed.user.id).toBe(user.id);
    expect(claimed.user.privy_did).toBe("did:privy:reads-claim");
  });

  it("a Privy account never stores a wallet another account has linked", async () => {
    const home = evm();
    const second = evm();
    const { user } = (await getOrCreateUser({ did: null, wallet: home }))!;
    await addSecond(user.id, second);
    await getOrCreateUser({ did: "did:privy:reads-other", wallet: null });
    const privy = (await getOrCreateUser({ did: "did:privy:reads-other", wallet: second }))!;
    expect(privy.user.id).not.toBe(user.id);
    expect(privy.user.wallet_address).toBeNull();
  });
});

describe("the unlink cooldown", () => {
  it("an address unlinked two days ago joins nothing, not even a new account", async () => {
    const home = evm();
    const gone = evm();
    const { user } = (await getOrCreateUser({ did: null, wallet: home }))!;
    await addSecond(user.id, gone, 2);
    expect(await walletOwner(gone)).toEqual({ state: "cooling", userId: user.id });
    await expect(getOrCreateUser({ did: null, wallet: gone })).rejects.toBeInstanceOf(WalletCoolingDownError);
    expect(await accountEvmAddresses(user.id, home)).toEqual({ home, all: [home] });
  });

  it("after seven days it is free: a new account takes the row over", async () => {
    const home = evm();
    const gone = evm();
    const { user } = (await getOrCreateUser({ did: null, wallet: home }))!;
    await addSecond(user.id, gone, 8);
    expect(await walletOwner(gone)).toEqual({ state: "free" });
    const fresh = (await getOrCreateUser({ did: null, wallet: gone }))!;
    expect(fresh.created).toBe(true);
    expect(fresh.user.id).not.toBe(user.id);
    const rows = (await sql.query(
      `select user_id, is_home, unlinked_at from user_identities where value = $1`,
      [`eip155:${gone}`],
    )) as { user_id: string; is_home: boolean; unlinked_at: string | null }[];
    expect(rows).toEqual([{ user_id: fresh.user.id, is_home: true, unlinked_at: null }]);
  });
});
