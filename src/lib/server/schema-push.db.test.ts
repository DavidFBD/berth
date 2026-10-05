import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The reason check on no_xp_intents only ever widens (db/schema.sql), and
 * a push is all or nothing (scripts/db-push.mjs runs every statement in one
 * transaction): once a 'delivery_refused' row exists, a push from an older
 * schema.sql that re-adds the narrower check fails whole and leaves the
 * check and everything else as it was.
 */

const schema = readFileSync(join(process.cwd(), "db/schema.sql"), "utf8");
/** db-push's own split. */
const statements = schema
  .split(/;\s*\n/)
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);
const OLD_NARROW = [
  "alter table no_xp_intents drop constraint if exists no_xp_intents_reason_check",
  "alter table no_xp_intents add constraint no_xp_intents_reason_check check (reason in ('unavailable', 'unproven_source'))",
  "create table pushed_after_the_check (id int)",
];

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(schema);
});
afterAll(async () => {
  await db.close();
});

const checkDef = async () =>
  (await db.query<{ def: string }>(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'no_xp_intents_reason_check'`)).rows[0]?.def;

/** As db-push: every statement, in order, in one transaction. */
const push = (list: readonly string[]) =>
  db.transaction(async (tx) => {
    for (const statement of list) await tx.query(statement);
  });

describe("pushing the schema", () => {
  it("keeps every DO block whole under db-push's split, and reruns cleanly", async () => {
    expect(statements.filter((statement) => statement.includes("no_xp_intents_reason_check"))).toHaveLength(1);
    await push(statements);
    expect(await checkDef()).toContain("delivery_refused");
  });

  it("never narrows a check that is already wider", async () => {
    await db.exec(`alter table no_xp_intents drop constraint no_xp_intents_reason_check;
      alter table no_xp_intents add constraint no_xp_intents_reason_check check (reason in ('unavailable', 'unproven_source', 'delivery_refused', 'later_reason'))`);
    await push(statements);
    expect(await checkDef()).toContain("later_reason");
  });

  it("rolls back an older, narrower push whole once a delivery_refused row exists", async () => {
    await db.query(`insert into no_xp_intents (intent_tx, reason) values ('0xrefused', 'delivery_refused')`);
    const before = await checkDef();
    await expect(push(OLD_NARROW)).rejects.toThrow();
    expect(await checkDef()).toBe(before);
    expect((await db.query(`select to_regclass('pushed_after_the_check') as t`)).rows).toEqual([{ t: null }]);
  });
});
