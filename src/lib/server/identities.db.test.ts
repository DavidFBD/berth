import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { getOrCreateUser, setEmail } from "./accounts";
import { backfillInsert, planIdentityBackfill, type BackfillUser } from "./identities";

/**
 * Phase 1 of the account model against the real schema: every write that
 * puts a wallet or an email on a users row records the identity in the same
 * statement, reruns change nothing, and the table's own rules (one owner per
 * identifier, one primary email, one home EVM) hold.
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

type Identity = { user_id: string; kind: string; value: string; family: string | null; is_primary: boolean; is_home: boolean; proof: string; verified_at: string | null };
const identitiesOf = async (userId: string) =>
  (await sql.query(
    `select user_id, kind, value, family, is_primary, is_home, proof, verified_at
     from user_identities where user_id = $1 order by kind`,
    [userId],
  )) as Identity[];

let n = 0;
const evm = () => `0x${(++n).toString(16).padStart(40, "0")}`;

describe("dual write: wallet", () => {
  it("a wallet-only account records its home EVM wallet, proved by SIWE", async () => {
    const wallet = evm();
    const { user, created } = (await getOrCreateUser({ did: null, wallet }))!;
    expect(created).toBe(true);
    const rows = await identitiesOf(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "wallet", value: `eip155:${wallet}`, family: "evm", is_home: true, is_primary: false, proof: "siwe" });
    expect(rows[0].verified_at).not.toBeNull();
  });

  it("is idempotent: the same wallet again changes nothing", async () => {
    const wallet = evm();
    const first = (await getOrCreateUser({ did: null, wallet }))!;
    const again = (await getOrCreateUser({ did: null, wallet }))!;
    expect(again.user.id).toBe(first.user.id);
    expect(await identitiesOf(first.user.id)).toHaveLength(1);
  });

  it("a Privy account that gains its wallet records it as Privy's", async () => {
    const wallet = evm();
    const { user } = (await getOrCreateUser({ did: "did:privy:dual-1", wallet: null }))!;
    expect(await identitiesOf(user.id)).toHaveLength(0);
    const linked = (await getOrCreateUser({ did: "did:privy:dual-1", wallet }))!;
    expect(linked.user.wallet_address).toBe(wallet);
    expect(await identitiesOf(user.id)).toMatchObject([
      { kind: "wallet", value: `eip155:${wallet}`, is_home: true, proof: "privy_wallet" },
    ]);
  });

  it("a claimed wallet account keeps its one identity", async () => {
    const wallet = evm();
    const guest = (await getOrCreateUser({ did: null, wallet }))!;
    const claimed = (await getOrCreateUser({ did: "did:privy:dual-claim", wallet }))!;
    expect(claimed.user.id).toBe(guest.user.id);
    expect(await identitiesOf(guest.user.id)).toHaveLength(1);
  });

  it("a non-EVM shape on users.wallet_address writes the row but no identity", async () => {
    const { user } = (await getOrCreateUser({ did: null, wallet: "0xguestwallet00000000" }))!;
    expect(user.wallet_address).toBe("0xguestwallet00000000");
    expect(await identitiesOf(user.id)).toHaveLength(0);
  });
});

describe("dual write: email", () => {
  it("records the normalised primary email, proved by the Privy code, and is idempotent", async () => {
    const { user } = (await getOrCreateUser({ did: "did:privy:dual-email", wallet: null }))!;
    await setEmail(user.id, "  Ada@Example.COM");
    await setEmail(user.id, "  Ada@Example.COM");
    const stored = (await sql.query(`select email from users where id = $1`, [user.id])) as { email: string }[];
    expect(stored[0].email).toBe("  Ada@Example.COM"); // users.email stays as Privy spelled it
    expect(await identitiesOf(user.id)).toMatchObject([
      { kind: "email", value: "ada@example.com", family: null, is_primary: true, proof: "privy_email" },
    ]);
  });

  it("an email already on another account still sets users.email but never moves the identity", async () => {
    const owner = (await getOrCreateUser({ did: "did:privy:email-owner", wallet: null }))!.user;
    const other = (await getOrCreateUser({ did: "did:privy:email-other", wallet: null }))!.user;
    await setEmail(owner.id, "taken@example.com");
    await setEmail(other.id, "TAKEN@example.com");
    expect(await identitiesOf(owner.id)).toHaveLength(1);
    expect(await identitiesOf(other.id)).toHaveLength(0);
    const stored = (await sql.query(`select email from users where id = $1`, [other.id])) as { email: string }[];
    expect(stored[0].email).toBe("TAKEN@example.com");
    // The conflict is audited with the kind and the other account only, never the address.
    const audit = (await sql.query(
      `select action, detail from account_audit where user_id = $1`,
      [other.id],
    )) as { action: string; detail: Record<string, unknown> }[];
    expect(audit).toEqual([{ action: "identity_conflict", detail: { kind: "email", otherUserId: owner.id } }]);
    expect(JSON.stringify(audit)).not.toMatch(/taken/i);
  });
});

describe("a broken identities table never fails the users write", () => {
  const withTableGone = async (run: () => Promise<void>) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await sql.query(`alter table user_identities rename to user_identities_away`);
    try {
      await run();
    } finally {
      await sql.query(`alter table user_identities_away rename to user_identities`);
      expect(warn).toHaveBeenCalled();
      expect(warn.mock.calls.flat().join(" ")).not.toMatch(/@|0x[0-9a-f]{40}/);
      warn.mockRestore();
    }
  };

  it("account creation, wallet linking and email save still land", async () => {
    await withTableGone(async () => {
      const wallet = evm();
      const created = (await getOrCreateUser({ did: null, wallet }))!;
      expect(created.created).toBe(true);
      expect(created.user.wallet_address).toBe(wallet);
      const privy = (await getOrCreateUser({ did: "did:privy:broken", wallet: null }))!;
      const linkedWallet = evm();
      const linked = (await getOrCreateUser({ did: "did:privy:broken", wallet: linkedWallet }))!;
      expect(linked.user.wallet_address).toBe(linkedWallet);
      await setEmail(privy.user.id, "broken@example.com");
      const stored = (await sql.query(`select email from users where id = $1`, [privy.user.id])) as { email: string }[];
      expect(stored[0].email).toBe("broken@example.com");
    });
  });

  it("the profile route still answers 200 for a new wallet account", async () => {
    process.env.SESSION_SECRET ??= "test-session-secret-identities";
    const { issueWalletSession } = await import("./wallet-session");
    const { POST } = await import("@/app/api/profile/route");
    const wallet = evm();
    const token = await issueWalletSession(wallet);
    await withTableGone(async () => {
      const response = await POST(
        new NextRequest("http://localhost/api/profile", {
          method: "POST",
          headers: { "x-wallet-session": token, "content-type": "application/json" },
          body: "{}",
        }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.hasEmail).toBe(false);
      expect(body.rewards).toEqual([expect.objectContaining({ kind: "account_created" })]);
    });
    const row = (await sql.query(`select id from users where wallet_address = $1`, [wallet])) as { id: string }[];
    expect(row).toHaveLength(1);
    expect(await identitiesOf(row[0].id)).toHaveLength(0); // missed, and the backfill will find it
  });
});

describe("the table's own rules", () => {
  it("one owner per identifier, one primary email and one home EVM per account", async () => {
    const a = (await getOrCreateUser({ did: null, wallet: evm() }))!.user;
    const b = (await getOrCreateUser({ did: null, wallet: evm() }))!.user;
    const insert = (userId: string, kind: string, value: string, family: string | null, primary: boolean, home: boolean) =>
      sql.query(
        `insert into user_identities (user_id, kind, value, family, is_primary, is_home, proof)
         values ($1, $2, $3, $4, $5, $6, 'legacy')`,
        [userId, kind, value, family, primary, home],
      );
    await expect(insert(b.id, "wallet", `eip155:${a.wallet_address}`, "evm", false, false)).rejects.toThrow();
    await expect(insert(a.id, "wallet", `eip155:${evm()}`, "evm", false, true)).rejects.toThrow();
    await insert(a.id, "wallet", `eip155:${evm()}`, "evm", false, false); // a second, pay-from EVM address is fine
    await insert(a.id, "email", "one@example.com", null, true, false);
    await expect(insert(a.id, "email", "two@example.com", null, true, false)).rejects.toThrow();
    await expect(insert(a.id, "email", "three@example.com", "evm", false, false)).rejects.toThrow();
    await expect(insert(a.id, "wallet", "solana:x", "solana", false, true)).rejects.toThrow();
    await expect(insert(a.id, "wallet", "solana:y", "solana", true, false)).rejects.toThrow();
  });

  it("solana addresses that differ only in case are two identifiers", async () => {
    const a = (await getOrCreateUser({ did: null, wallet: evm() }))!.user;
    const b = (await getOrCreateUser({ did: null, wallet: evm() }))!.user;
    const insert = (userId: string, value: string) =>
      sql.query(
        `insert into user_identities (user_id, kind, value, family, proof) values ($1, 'wallet', $2, 'solana', 'siws')`,
        [userId, value],
      );
    await insert(a.id, "solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    await insert(b.id, "solana:EpjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  });
});

describe("backfill", () => {
  it("writes the legacy rows once, and a second run finds nothing to do", async () => {
    const wallet = evm();
    await sql.query(`insert into users (wallet_address, email) values ($1, 'Legacy@Example.com')`, [wallet]);
    await sql.query(`insert into users (privy_did) values ('retired:did:privy:gone')`);
    const readUsers = async () =>
      (await sql.query(`select id, privy_did, wallet_address, email from users`)) as BackfillUser[];
    const readExisting = async () =>
      (await sql.query(`select kind, value, user_id from user_identities`)) as { kind: string; value: string; user_id: string }[];

    const plan = planIdentityBackfill(await readUsers(), await readExisting());
    // The one conflict is the earlier test's taken@example.com, on two users.email.
    expect(plan.conflicts).toEqual([{ kind: "email", userIds: expect.any(Array) }]);
    expect(plan.conflicts[0].userIds).toHaveLength(2);
    expect(plan.skipped.retired).toBe(1);
    const legacy = plan.rows.filter((row) => row.value === `eip155:${wallet}` || row.value === "legacy@example.com");
    expect(legacy).toHaveLength(2);
    const { text, params } = backfillInsert(plan.rows);
    const inserted = (await sql.query(text, params)) as unknown[];
    expect(inserted).toHaveLength(plan.rows.length);

    const rerun = planIdentityBackfill(await readUsers(), await readExisting());
    expect(rerun.rows).toEqual([]);
    expect(rerun.conflicts).toHaveLength(1);
    const replay = (await sql.query(text, params)) as unknown[];
    expect(replay).toHaveLength(0);
  });
});
