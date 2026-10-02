import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { hkdfSync } from "node:crypto";
import { makeTestDb } from "./pglite-test-db";
import { setSqlClient, type SqlClient } from "./db";
import { issueWalletSession, readWalletSession } from "./wallet-session";
import { revokeWalletSessions, walletSessionRevoked } from "./wallet-session-revocations";
import { NextRequest } from "next/server";
import { readRewardsCaller } from "./rewards-route";

const ADDRESS = "0xF4B759cf4fD5af5C0f2A40F74823f09743959399";
const SECRET = "test-secret-keep-the-kettle-warm";

let sql: SqlClient;
let close: () => Promise<void>;
let priorSecret: string | undefined;

beforeAll(async () => {
  priorSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = SECRET;
  ({ sql, close } = await makeTestDb());
  setSqlClient(sql);
});

afterAll(async () => {
  setSqlClient(null);
  await close();
  process.env.SESSION_SECRET = priorSecret;
});

/** A session as minted before ids existed: no jti. */
async function legacySession(address: string) {
  const key = new Uint8Array(hkdfSync("sha256", SECRET, "lsteatime", "wallet-session-v1", 32));
  return new SignJWT({ purpose: "wallet-session", sub: address.toLowerCase() })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key);
}

describe("wallet session revocation", () => {
  it("gives every new session its own id", async () => {
    const a = await readWalletSession(await issueWalletSession(ADDRESS));
    const b = await readWalletSession(await issueWalletSession(ADDRESS));
    expect(a?.jti).toBeTruthy();
    expect(a?.jti).not.toBe(b?.jti);
    expect(a?.expiresAt).toBeGreaterThan(Date.now());
  });

  it("ends a signed out session, and only that one, idempotently", async () => {
    const out = await issueWalletSession(ADDRESS);
    const kept = await issueWalletSession(ADDRESS);
    expect(await revokeWalletSessions([out])).toBe(1);
    expect(await revokeWalletSessions([out])).toBe(1);
    expect(await walletSessionRevoked((await readWalletSession(out))!.jti)).toBe(true);
    expect(await walletSessionRevoked((await readWalletSession(kept))!.jti)).toBe(false);
    const rows = (await sql.query(`select count(*)::int as n from wallet_session_revocations`)) as { n: number }[];
    expect(rows[0].n).toBe(1);
  });

  it("takes no word but a valid token: forgeries and garbage revoke nothing", async () => {
    expect(await revokeWalletSessions(["nope", 42, null, "a.b.c"])).toBe(0);
  });

  it("leaves a session from before ids working: it has nothing to revoke", async () => {
    const legacy = await legacySession(ADDRESS);
    const read = await readWalletSession(legacy);
    expect(read?.address).toBe(ADDRESS.toLowerCase());
    expect(read?.jti).toBeNull();
    expect(await revokeWalletSessions([legacy])).toBe(0);
    expect(await walletSessionRevoked(null)).toBe(false);
  });

  it("prunes rows whose token has expired anyway, only when it wrote one", async () => {
    await sql.query(
      `insert into wallet_session_revocations (jti, address, expires_at) values ('old', 'x', now() - interval '1 day')`,
    );
    await revokeWalletSessions([]);
    await revokeWalletSessions(["garbage"]);
    let rows = (await sql.query(`select 1 from wallet_session_revocations where jti = 'old'`)) as unknown[];
    expect(rows).toHaveLength(1);
    await revokeWalletSessions([await issueWalletSession(ADDRESS)]);
    rows = (await sql.query(`select 1 from wallet_session_revocations where jti = 'old'`)) as unknown[];
    expect(rows).toHaveLength(0);
  });

  it("answers 503, never a silent yes or a forgetting 401, when the revocation read fails", async () => {
    const token = await issueWalletSession(ADDRESS);
    const broken: SqlClient = { query: async () => { throw new Error("db down"); } };
    setSqlClient(broken);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await readRewardsCaller(
        new NextRequest("http://localhost/api/profile", {
          method: "POST",
          headers: { "x-wallet-session": token, "content-type": "application/json" },
          body: "{}",
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(503);
      expect(quiet).toHaveBeenCalled();
    } finally {
      quiet.mockRestore();
      setSqlClient(sql);
    }
  });

  it("limits sign outs per address", async () => {
    const { POST, REVOKE_LIMIT_PER_HOUR } = await import("@/app/api/siwe/revoke/route");
    const ask = () =>
      POST(
        new NextRequest("http://localhost/api/siwe/revoke", {
          method: "POST",
          headers: { "content-type": "application/json", "x-real-ip": "203.0.113.9" },
          body: JSON.stringify({ tokens: [] }),
        }),
      );
    for (let i = 0; i < REVOKE_LIMIT_PER_HOUR; i++) expect((await ask()).status).toBe(200);
    expect((await ask()).status).toBe(429);
  });

  it("refuses a signed out session at every account route, and keeps a legacy one", async () => {
    const ask = (token: string) =>
      readRewardsCaller(
        new NextRequest("http://localhost/api/profile", {
          method: "POST",
          headers: { "x-wallet-session": token, "content-type": "application/json" },
          body: "{}",
        }),
      );
    const token = await issueWalletSession(ADDRESS);
    expect((await ask(token)).ok).toBe(true);
    await revokeWalletSessions([token]);
    const refused = await ask(token);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.response.status).toBe(401);
    expect((await ask(await legacySession(ADDRESS))).ok).toBe(true);
  });
});
