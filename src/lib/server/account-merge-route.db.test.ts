import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

/**
 * Phase 3 through the routes, against the real schema and real signatures:
 * the email offer answers one 401 until both the email's fresh code and the
 * wallet's session are in the same request, the merge needs the offer and
 * the same proofs again, a retry after the merge answers the same, and a
 * wallet found on another account by a proved link comes with its own
 * offer. Privy is stubbed as in account-wallets.db.test.
 */

const privy = vi.hoisted(() => ({ wallet: new Map<string, string>(), verifiedAt: new Map<string, number>() }));
vi.mock("@/lib/server/privy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/privy")>();
  return {
    ...actual,
    verifyPrivyAuth: vi.fn(async (header: string | null) => (header?.startsWith("Bearer did:") ? header.slice(7) : null)),
    fetchPrivyWallet: vi.fn(async (did: string) => ({ ok: true, address: privy.wallet.get(did) ?? null })),
    fetchPrivyEmailVerifiedAt: vi.fn(async (did: string) => privy.verifiedAt.get(did) ?? null),
    fetchPrivyEmbeddedWallet: vi.fn(async (did: string) => privy.wallet.get(did) ?? null),
  };
});

const { setSqlClient } = await import("./db");
const { makeTestDb } = await import("./pglite-test-db");
const { getOrCreateUser, setEmail } = await import("./accounts");
const { issueWalletSession } = await import("./wallet-session");
const { setSiweVerifier } = await import("./account-wallets-route");
const { verifySiweLocally } = await import("./siwe");
const { proofResource, proofStatement } = await import("@/lib/account-proof");
const { POST: listRoute } = await import("@/app/api/account/wallets/route");
const { POST: nonceRoute } = await import("@/app/api/account/wallets/nonce/route");
const { POST: linkRoute } = await import("@/app/api/account/wallets/link/route");
const { POST: offerRoute } = await import("@/app/api/account/merge/offer/route");
const { POST: mergeRoute } = await import("@/app/api/account/merge/route");

process.env.SESSION_SECRET ??= "test-session-secret-account-merge";

type Sql = import("./db").SqlClient;
let sql: Sql;
let close: () => Promise<void>;

beforeAll(async () => {
  const db = await makeTestDb();
  sql = db.sql;
  close = db.close;
  setSqlClient(sql);
  setSiweVerifier(verifySiweLocally);
});

afterAll(async () => {
  setSiweVerifier(null);
  setSqlClient(null);
  await close();
});

const key = () => privateKeyToAccount(generatePrivateKey());
const addr = (account: PrivateKeyAccount) => account.address.toLowerCase();

type Body = Record<string, unknown>;
async function call(
  route: (request: NextRequest) => Promise<Response>,
  auth: { did?: string; session?: string },
  body: Record<string, unknown> = {},
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth.did) headers.authorization = `Bearer ${auth.did}`;
  if (auth.session) headers["x-wallet-session"] = auth.session;
  const response = await route(new NextRequest("http://localhost/api/account/merge", { method: "POST", headers, body: JSON.stringify(body) }));
  return { status: response.status, body: (await response.json()) as Body };
}

async function walletAccount(home = key()) {
  const session = await issueWalletSession(addr(home));
  expect((await call(listRoute, { session })).status).toBe(200);
  const { user } = (await getOrCreateUser({ did: null, wallet: addr(home) }))!;
  return { session, home, userId: user.id };
}

let emails = 0;
async function emailAccount() {
  emails += 1;
  const did = `did:privy:merge-${emails}`;
  const embedded = key();
  privy.wallet.set(did, addr(embedded));
  const { user } = (await getOrCreateUser({ did, wallet: addr(embedded) }))!;
  await setEmail(user.id, `merge${emails}@example.com`);
  await sql.query(`insert into xp_events (user_id, kind, amount) values ($1, 'email_linked', 50)`, [user.id]);
  await sql.query(`update users set xp = 50 where id = $1`, [user.id]);
  return { did, embedded, userId: user.id };
}

const REFUSED = { status: 401, body: { error: "not verified" } };
const fresh = (did: string) => privy.verifiedAt.set(did, Date.now() - 60_000);
const stale = (did: string) => privy.verifiedAt.set(did, Date.now() - 60 * 60_000);

const { POST: mergeNonceRoute } = await import("@/app/api/account/merge/nonce/route");

/** The wallet's merge signature: a nonce issued to `did` for the wallet, signed by `signer`. */
async function mergeProof(did: string, wallet: PrivateKeyAccount, signer: PrivateKeyAccount = wallet) {
  const nonce = await call(mergeNonceRoute, { did }, { wallet: addr(wallet) });
  expect(nonce.status).toBe(200);
  const message = createSiweMessage({
    address: signer.address,
    chainId: 146,
    domain: "localhost",
    uri: "http://localhost",
    nonce: nonce.body.nonce as string,
    version: "1",
    statement: proofStatement("merge", addr(wallet)),
    resources: [proofResource("merge", addr(wallet))],
  });
  return { nonceToken: nonce.body.nonceToken, message, signature: await signer.signMessage({ message }) };
}

describe("the email offer", () => {
  it("answers the same 401 until the fresh email code and a fresh wallet signature arrive together", async () => {
    const email = await emailAccount();
    const wallet = await walletAccount();
    fresh(email.did);
    const good = await mergeProof(email.did, wallet.home);
    stale(email.did);
    // The nonce itself needs the fresh code.
    expect(await call(mergeNonceRoute, { did: email.did }, { wallet: addr(wallet.home) })).toEqual(REFUSED);
    const tries = [
      await call(offerRoute, {}),
      await call(offerRoute, { did: email.did }, good),
      // A week long wallet session is not a fresh proof.
      await call(offerRoute, { session: wallet.session }),
    ];
    fresh(email.did);
    tries.push(
      await call(offerRoute, { did: email.did }),
      await call(offerRoute, { did: email.did, session: wallet.session }),
      // Signed by someone else, or for another DID's nonce.
      await call(offerRoute, { did: email.did }, await mergeProof(email.did, wallet.home, key())),
      await call(offerRoute, { did: "did:privy:someone-else" }, good),
    );
    for (const attempt of tries) expect(attempt).toEqual(REFUSED);
    // After both proofs: an email with no Berth account has nothing to offer.
    const unknownDid = "did:privy:nobody";
    fresh(unknownDid);
    expect(await call(offerRoute, { did: unknownDid }, await mergeProof(unknownDid, wallet.home))).toEqual({
      status: 200,
      body: { state: "none" },
    });
  });

  it("a merge nonce is spent once", async () => {
    const email = await emailAccount();
    const wallet = await walletAccount();
    fresh(email.did);
    const proof = await mergeProof(email.did, wallet.home);
    expect((await call(offerRoute, { did: email.did }, proof)).body.state).toBe("offer");
    expect(await call(offerRoute, { did: email.did }, proof)).toEqual(REFUSED);
  });

  it("offers, merges into the email account, and a retry answers the same", async () => {
    const email = await emailAccount();
    const wallet = await walletAccount();
    await sql.query(`insert into xp_events (user_id, kind, amount, ref) values ($1, 'pour_in', 100, '0xmerge-route')`, [wallet.userId]);
    fresh(email.did);
    const offered = await call(offerRoute, { did: email.did }, await mergeProof(email.did, wallet.home));
    expect(offered.status).toBe(200);
    expect(offered.body).toMatchObject({ state: "offer", survivor: "other", together: { xp: 150, orders: 0 } });
    expect(JSON.stringify(offered.body)).not.toContain("@example.com");
    const offer = offered.body.offer as string;

    // The offer alone, from another DID, or with a stale code, is not enough.
    expect(await call(mergeRoute, {}, { offer })).toEqual(REFUSED);
    expect(await call(mergeRoute, { session: wallet.session }, { offer })).toEqual(REFUSED);
    expect(await call(mergeRoute, { did: email.did }, { offer: "junk" })).toEqual(REFUSED);
    const otherDid = "did:privy:other-merge";
    fresh(otherDid);
    expect(await call(mergeRoute, { did: otherDid }, { offer })).toEqual(REFUSED);
    stale(email.did);
    expect(await call(mergeRoute, { did: email.did }, { offer })).toEqual(REFUSED);
    fresh(email.did);

    const merged = await call(mergeRoute, { did: email.did }, { offer });
    expect(merged).toEqual({ status: 200, body: { state: "merged", survivor: "other", xp: 150 } });
    const again = await call(mergeRoute, { did: email.did }, { offer });
    expect(again).toEqual(merged);
    // The wallet's session from before the merge was made for the account
    // that joined: refused, so the browser signs in again.
    expect(await call(listRoute, { session: wallet.session })).toEqual({ status: 401, body: { error: "wallet session required" } });
    // A session signed after it reaches the email account, its wallet linked there.
    await sql.query(`update user_identities set merged_at = merged_at - interval '5 seconds' where merged_at is not null`);
    const renewed = await issueWalletSession(addr(wallet.home));
    const list = await call(listRoute, { session: renewed });
    expect((list.body.wallets as { address: string; isHome: boolean; embedded?: boolean }[]).map((w) => [w.address, w.isHome, !!w.embedded])).toEqual([
      // The email's wallet is marked: a sell from it asks for an email sign in.
      [addr(email.embedded), true, true],
      [addr(wallet.home), false, false],
    ]);
  });
});

async function linkBody(session: string, wallet: PrivateKeyAccount, confirmer: PrivateKeyAccount) {
  const nonce = await call(nonceRoute, { session }, { act: "link", target: addr(wallet) });
  const sign = async (signer: PrivateKeyAccount, act: "link" | "link-confirm") => {
    const message = createSiweMessage({
      address: signer.address,
      chainId: 146,
      domain: "localhost",
      uri: "http://localhost",
      nonce: nonce.body.nonce as string,
      version: "1",
      statement: proofStatement(act, addr(wallet)),
      resources: [proofResource(act, addr(wallet))],
    });
    return { message, signature: await signer.signMessage({ message }) };
  };
  return { ...(await sign(wallet, "link")), nonceToken: nonce.body.nonceToken, accountProof: await sign(confirmer, "link-confirm") };
}

describe("the wallet offer", () => {
  it("comes with a proved link to a wallet on another account, and merges the younger into the older", async () => {
    const mine = await walletAccount();
    const theirs = await walletAccount();
    const linked = await call(linkRoute, { session: mine.session }, await linkBody(mine.session, theirs.home, mine.home));
    expect(linked.body.state).toBe("other_account");
    const merge = linked.body.merge as { offer: string; survivor: string; together: { xp: number } };
    expect(merge).toMatchObject({ survivor: "this" });

    // Someone else's session with this offer: refused.
    const stranger = await walletAccount();
    expect(await call(mergeRoute, { session: stranger.session }, { offer: merge.offer })).toEqual(REFUSED);

    const merged = await call(mergeRoute, { session: mine.session }, { offer: merge.offer });
    expect(merged.body).toMatchObject({ state: "merged", survivor: "this" });
    expect((await getOrCreateUser({ did: null, wallet: addr(theirs.home) }))!.user.id).toBe(mine.userId);
    // Their old session is refused; the survivor's own is untouched, and a retry answers the same.
    expect((await call(listRoute, { session: theirs.session })).status).toBe(401);
    expect(((await call(listRoute, { session: mine.session })).body.wallets as unknown[]).length).toBe(2);
    expect(await call(mergeRoute, { session: mine.session }, { offer: merge.offer })).toEqual(merged);
  });

  it("asks again when who would stay has changed since the offer", async () => {
    const mine = await walletAccount();
    const theirs = await walletAccount();
    const linked = await call(linkRoute, { session: mine.session }, await linkBody(mine.session, theirs.home, mine.home));
    const merge = linked.body.merge as { offer: string; survivor: string };
    expect(merge.survivor).toBe("this");
    await setEmail(theirs.userId, "late@example.com");
    expect(await call(mergeRoute, { session: mine.session }, { offer: merge.offer })).toEqual({ status: 200, body: { state: "changed" } });
    expect((await getOrCreateUser({ did: null, wallet: addr(theirs.home) }))!.user.id).toBe(theirs.userId);
  });
});
