import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { recordHomeWallet } from "./identities";
import { embeddedEligible, isEmbeddedWallet, recheckDestination } from "./delivery";

/**
 * A Privy email wallet and Robinhood Chain (rh-ux-sec B1): delivery there
 * exactly when Privy sponsors 4663 (on NEXT_PUBLIC_GAS_SPONSOR_CHAINS),
 * since such a wallet holds no ETH to sell from there otherwise; an
 * external wallet stays eligible either way. Against the real
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
afterEach(() => {
  vi.unstubAllEnvs();
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
  it("is eligible exactly when Privy sponsors Robinhood Chain: 4663 on the sponsor list", () => {
    expect(embeddedEligible(new Set([8453, 4663]))).toBe(true);
    expect(embeddedEligible(new Set([8453]))).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_GAS_SPONSOR_CHAINS", "8453,42161,10,137,56,4663");
    expect(embeddedEligible()).toBe(true);
    // A deploy whose env leaves 4663 out keeps email wallets on the hub.
    vi.stubEnv("NEXT_PUBLIC_GAS_SPONSOR_CHAINS", "8453,42161");
    expect(embeddedEligible()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_GAS_SPONSOR_CHAINS", undefined);
    expect(embeddedEligible()).toBe(false);
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

  it("is allowed when the order is recorded once 4663 is sponsored, Privy's 7702 delegate still a plain key", async () => {
    vi.stubEnv("NEXT_PUBLIC_GAS_SPONSOR_CHAINS", "8453,4663");
    const delegated = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const call = JSON.parse(String(init?.body)) as { id: number };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: call.id, result: "0xef0100d6cedde84be40893d153be9d467cd6ad37875b28" }));
    }) as unknown as typeof fetch;
    const place = { ok: true } as const;
    const email = await user("did:privy:d", EMAIL_WALLET);
    await recordHomeWallet(email, EMAIL_WALLET, "privy_wallet");
    expect(
      await recheckDestination({ userId: email, usersWallet: EMAIL_WALLET, signer: EMAIL_WALLET, place, dstAddress: EMAIL_WALLET, fetcher: delegated }),
    ).toEqual({ verdict: "allowed" });
    expect(
      await recheckDestination({ userId: email, usersWallet: EMAIL_WALLET, signer: EMAIL_WALLET, place, dstAddress: EMAIL_WALLET, fetcher: plainChain }),
    ).toEqual({ verdict: "allowed" });
  });

  it("is refused when the order is recorded on a deploy that does not sponsor 4663, and an external wallet allowed", async () => {
    vi.stubEnv("NEXT_PUBLIC_GAS_SPONSOR_CHAINS", "8453");
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

  it("asks Privy for the account's embedded wallet when the tables do not say, and any doubt is an error, never a no (rh-final 3)", async () => {
    const linkedLater = await user("did:privy:d", "0x00000000000000000000000000000000000000e4");
    await recordHomeWallet(linkedLater, "0x00000000000000000000000000000000000000e4", "privy_wallet");
    await sql.query(`insert into user_identities (user_id, kind, value, family, is_home, proof) values ($1, 'wallet', $2, 'evm', false, 'siwe')`, [
      linkedLater,
      EMAIL_WALLET,
    ]);
    const privySays = (address: string | null) => async () => ({ ok: true as const, address });
    expect(await isEmbeddedWallet(linkedLater, EMAIL_WALLET, privySays(EMAIL_WALLET))).toBe(true);
    expect(await isEmbeddedWallet(linkedLater, EMAIL_WALLET, privySays("0x00000000000000000000000000000000000000e4"))).toBe(false);
    await expect(isEmbeddedWallet(linkedLater, EMAIL_WALLET, async () => ({ ok: false as const }))).rejects.toThrow("Privy");
    // An account with no Privy sign in is never asked.
    const external = await user(null, EXTERNAL);
    const never = vi.fn(privySays(EXTERNAL));
    expect(await isEmbeddedWallet(external, EXTERNAL, never)).toBe(false);
    expect(never).not.toHaveBeenCalled();
  });
});
