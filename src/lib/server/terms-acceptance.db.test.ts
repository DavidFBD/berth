import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { TERMS_VERSION } from "@/lib/legal-version";
import { acceptTerms, termsStatus } from "./terms-acceptance";
import { runSocialOp } from "./social/ops";

/** The terms each account accepted, against the real schema (PGlite), directly and through the social route's ops. */

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

let n = 0;
async function account(): Promise<string> {
  n += 1;
  const rows = (await sql.query(`insert into users (privy_did, email) values ($1, $2) returning id`, [`did:privy:terms${n}`, `t${n}@example.com`])) as { id: string }[];
  return rows[0].id;
}

describe("terms acceptance", () => {
  it("is due until accepted, keeps the first time, and asks again for a new version", async () => {
    const id = await account();
    expect(await termsStatus(id)).toEqual({ version: TERMS_VERSION, accepted: false, acceptedAt: null });
    expect(await acceptTerms(id, TERMS_VERSION)).toBe("recorded");
    const first = await termsStatus(id);
    expect(first.accepted).toBe(true);
    expect(first.acceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await acceptTerms(id, TERMS_VERSION)).toBe("recorded");
    expect((await termsStatus(id)).acceptedAt).toBe(first.acceptedAt);
    const rows = (await sql.query(`select count(*)::int as count from terms_acceptances where user_id = $1::uuid`, [id])) as { count: number }[];
    expect(rows[0].count).toBe(1);
    // A later version has no row yet, so the account is asked again.
    expect((await termsStatus(id, "2099-01-01")).accepted).toBe(false);
  });

  it("accepts only the current version", async () => {
    const id = await account();
    for (const version of ["2020-01-01", "", null, 7]) expect(await acceptTerms(id, version)).toBe("refused");
    expect((await termsStatus(id)).accepted).toBe(false);
  });

  it("answers through the social route, per account", async () => {
    const id = await account();
    const other = await account();
    const viewer = { id, email: null };
    expect((await runSocialOp("terms", {}, { viewer, anonKey: "k" })).body).toMatchObject({ accepted: false });
    expect((await runSocialOp("terms-accept", { version: "1999-01-01" }, { viewer, anonKey: "k" })).status).toBe(400);
    const accepted = await runSocialOp("terms-accept", { version: TERMS_VERSION }, { viewer, anonKey: "k" });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ version: TERMS_VERSION, accepted: true });
    expect((await runSocialOp("terms", {}, { viewer: { id: other, email: null }, anonKey: "k2" })).body).toMatchObject({ accepted: false });
  });
});

describe("terms acceptance without its table (deployed before db:push)", () => {
  it("fails open: the read lets the person through, Accept fails quietly, and both are logged", async () => {
    const id = await account();
    await sql.query(`alter table terms_acceptances rename to terms_acceptances_away`);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await termsStatus(id)).toMatchObject({ accepted: true, failedOpen: true });
      expect(await acceptTerms(id, TERMS_VERSION)).toBe("failed");
      const viaRoute = await runSocialOp("terms-accept", { version: TERMS_VERSION }, { viewer: { id, email: null }, anonKey: "k3" });
      expect(viaRoute.status).toBe(200);
      expect(viaRoute.body).toMatchObject({ accepted: true, failedOpen: true });
      expect((await runSocialOp("terms", {}, { viewer: { id, email: null }, anonKey: "k3" })).body).toMatchObject({ accepted: true });
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
      await sql.query(`alter table terms_acceptances_away rename to terms_acceptances`);
    }
  });
});
