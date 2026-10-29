import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { setSqlClient, type SqlClient } from "@/lib/server/db";
import { makeTestDb } from "@/lib/server/pglite-test-db";
import { readPrefs } from "@/lib/server/email/store";
import { issueUnsubscribeToken, UNSUBSCRIBE_TTL_DAYS } from "@/lib/server/email/token";
import { POST } from "@/app/api/email/unsubscribe/route";

/**
 * The unsubscribe route against the real schema: an email's link opts out
 * on the account that still gets mail (a merged account's link), an
 * authentic but expired link still turns a kind off and never on, and New
 * stocks is never turned on from a link.
 */

let sql: SqlClient;
let close: () => Promise<void>;

beforeAll(async () => {
  const db = await makeTestDb();
  sql = db.sql;
  close = db.close;
  setSqlClient(sql);
  vi.stubEnv("EMAIL_TOKEN_SECRET", "unsubscribe-db-test-secret");
});

afterAll(async () => {
  setSqlClient(null);
  vi.unstubAllEnvs();
  await close();
});

beforeEach(async () => {
  for (const table of ["email_prefs", "orders", "terms_acceptances", "users"]) await sql.query(`delete from ${table}`);
});

let people = 0;
async function account(retiredInto: string | null = null): Promise<string> {
  people += 1;
  const rows = (await sql.query(`insert into users (privy_did, wallet_address, retired_into) values ($1, $2, $3) returning id`, [
    `did:privy:unsub-${people}`,
    `0x${String(people).padStart(40, "0")}`,
    retiredInto,
  ])) as { id: string }[];
  return rows[0].id;
}

function post(token: string, body: string) {
  return POST(
    new NextRequest(`http://localhost/api/email/unsubscribe?t=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }),
  );
}

describe("the unsubscribe route", () => {
  it("opts out on the surviving account when the link names an account merged away, for every kind", async () => {
    const survivor = await account();
    const middle = await account(survivor);
    const old = await account(middle);
    for (const kind of ["orders", "friends", "weekly", "listings"] as const) {
      const token = await issueUnsubscribeToken({ userId: old, kind });
      expect((await post(token, "List-Unsubscribe=One-Click")).status).toBe(200);
    }
    expect(await readPrefs(survivor)).toEqual({ orders: false, friends: false, weekly: false, listings: false });
    expect(await sql.query(`select count(*)::int as n from email_prefs where user_id = $1`, [old])).toEqual([{ n: 0 }]);
  });

  it("lets an expired but authentic link turn a kind off, and never on", async () => {
    const user = await account();
    const issued = new Date(Date.now() - (UNSUBSCRIBE_TTL_DAYS + 30) * 86_400_000);
    const token = await issueUnsubscribeToken({ userId: user, kind: "orders" }, { now: issued });
    expect((await post(token, "List-Unsubscribe=One-Click")).status).toBe(200);
    expect((await readPrefs(user)).orders).toBe(false);
    await post(token, "action=on");
    expect((await readPrefs(user)).orders).toBe(false);
  });

  it("still refuses a link that was altered", async () => {
    const user = await account();
    const token = await issueUnsubscribeToken({ userId: user, kind: "orders" });
    const parts = token.split(".");
    parts[3] = `${parts[3].slice(0, -2)}AA`;
    expect((await post(parts.join("."), "List-Unsubscribe=One-Click")).status).toBe(400);
    expect((await readPrefs(user)).orders).toBe(true);
  });

  it("never turns New stocks on from a link, even a fresh one", async () => {
    const user = await account();
    const token = await issueUnsubscribeToken({ userId: user, kind: "listings" });
    await post(token, "action=off");
    expect((await readPrefs(user)).listings).toBe(false);
    await post(token, "action=on");
    expect((await readPrefs(user)).listings).toBe(false);
    // The other kinds still turn back on from a fresh link.
    const orders = await issueUnsubscribeToken({ userId: user, kind: "orders" });
    await post(orders, "action=off");
    await post(orders, "action=on");
    expect((await readPrefs(user)).orders).toBe(true);
  });
});
