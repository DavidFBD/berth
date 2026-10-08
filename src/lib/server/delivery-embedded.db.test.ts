import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { recordHomeWallet } from "./identities";
import { embeddedEligible, isEmbeddedWallet, recheckDestination } from "./delivery";

/**
 * A Privy email wallet and Robinhood Chain (rh-ux-sec B1): no delivery
 * there while 4663 is not sponsorable, since such a wallet holds no ETH to
 * sell from there; an external wallet stays eligible. Against the real
 * schema.
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
beforeEach(async () => {
  await sql.query("delete from user_identities");
  await sql.query("delete from users");
});

const EMAIL_WALLET = "0x00000000000000000000000000000000000000e1";
const EXTERNAL = "0x00000000000000000000000000000000000000e2";

async function user(privyDid: string | null, wallet: string): Promise<string> {
  const rows = (await sql.query(`insert into users (privy_did, wallet_address) values ($1, $2) returning id`, [privyDid, wallet])) as {
    id: string;
  }[];
  return rows[0].id;
}

/** Every chain read answers "no code": a plain key. */
const plainChain = vi.fn(async (_url: string | URL, init?: RequestInit) => {
  const call = JSON.parse(String(init?.body)) as { id: number };
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: call.id, result: "0x" }));
}) as unknown as typeof fetch;

describe("a Privy email wallet on Robinhood Chain", () => {
  it("becomes eligible exactly when Robinhood Chain joins the sponsorable chains", () => {
    expect(embeddedEligible()).toBe(false);
    expect(embeddedEligible(new Set([8453, 4663]))).toBe(true);
  });

  it("is told apart from an external wallet by Privy's proof, or as an email account's home before proofs", async () => {
    const email = await user("did:privy:a", EMAIL_WALLET);
    await recordHomeWallet(email, EMAIL_WALLET, "privy_wallet");
    expect(await isEmbeddedWallet(email, EMAIL_WALLET)).toBe(true);
    const legacy = await user("did:privy:b", "0x00000000000000000000000000000000000000e3");
    expect(await isEmbeddedWallet(legacy, "0x00000000000000000000000000000000000000E3")).toBe(true);
    const external = await user(null, EXTERNAL);
    await recordHomeWallet(external, EXTERNAL, "siwe");
    expect(await isEmbeddedWallet(external, EXTERNAL)).toBe(false);
  });

  it("is refused when the order is recorded, and an external wallet allowed", async () => {
    const place = { ok: true } as const;
    const email = await user("did:privy:c", EMAIL_WALLET);
    await recordHomeWallet(email, EMAIL_WALLET, "privy_wallet");
    expect(
      await recheckDestination({ userId: email, usersWallet: EMAIL_WALLET, signer: EMAIL_WALLET, place, dstAddress: EMAIL_WALLET, fetcher: plainChain }),
    ).toEqual({ verdict: "refused", reason: "embedded_wallet" });
    const external = await user(null, EXTERNAL);
    await recordHomeWallet(external, EXTERNAL, "siwe");
    expect(
      await recheckDestination({ userId: external, usersWallet: EXTERNAL, signer: EXTERNAL, place, dstAddress: EXTERNAL, fetcher: plainChain }),
    ).toEqual({ verdict: "allowed" });
  });
});
