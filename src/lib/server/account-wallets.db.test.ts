import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

/**
 * Phase 2 end to end through the routes, against the real schema and real
 * signatures (viem keys, recovered locally): linking a second EVM address
 * with the account's own confirmation, the calm refusal when it belongs to
 * another account, the cooldown, switching home, removing, the uniform
 * refusals before a proof (wrong host, wrong statement, wrong target, a
 * replay), the rate limit, and one audit row for every change. Privy is
 * stubbed: a "Bearer did:…" header is that DID, its wallet and its last
 * email proof are whatever the test says.
 */

const privy = vi.hoisted(() => ({ wallet: new Map<string, string>(), verifiedAt: new Map<string, number>() }));
vi.mock("@/lib/server/privy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/privy")>();
  return {
    ...actual,
    verifyPrivyAuth: vi.fn(async (header: string | null) => (header?.startsWith("Bearer did:") ? header.slice(7) : null)),
    fetchPrivyWallet: vi.fn(async (did: string) => ({ ok: true, address: privy.wallet.get(did) ?? null })),
    fetchPrivyEmailVerifiedAt: vi.fn(async (did: string) => privy.verifiedAt.get(did) ?? null),
  };
});

const { setSqlClient } = await import("./db");
const { makeTestDb } = await import("./pglite-test-db");
const { getOrCreateUser, WalletCoolingDownError } = await import("./accounts");
const { accountEvmAddresses } = await import("./identities");
const { issueWalletSession } = await import("./wallet-session");
const { ACT_LIMIT_PER_HOUR, setHoldingsCheck, setSiweVerifier } = await import("./account-wallets-route");
const { verifySiweLocally } = await import("./siwe");
const { proofResource, proofStatement } = await import("@/lib/account-proof");
const { POST: listRoute } = await import("@/app/api/account/wallets/route");
const { POST: nonceRoute } = await import("@/app/api/account/wallets/nonce/route");
const { POST: linkRoute } = await import("@/app/api/account/wallets/link/route");
const { POST: homeRoute } = await import("@/app/api/account/wallets/home/route");
const { POST: removeRoute } = await import("@/app/api/account/wallets/remove/route");

process.env.SESSION_SECRET ??= "test-session-secret-account-wallets";

type Sql = import("./db").SqlClient;
let sql: Sql;
let close: () => Promise<void>;
const holding = new Set<string>();

beforeAll(async () => {
  const db = await makeTestDb();
  sql = db.sql;
  close = db.close;
  setSqlClient(sql);
  setSiweVerifier(verifySiweLocally);
  setHoldingsCheck(async (address) => holding.has(address));
});

afterAll(async () => {
  setHoldingsCheck(null);
  setSiweVerifier(null);
  setSqlClient(null);
  await close();
});

const key = () => privateKeyToAccount(generatePrivateKey());
const addr = (account: PrivateKeyAccount) => account.address.toLowerCase();

type Body = Record<string, unknown> & { wallets?: { address: string; isHome: boolean }[] };
async function call(route: (request: NextRequest) => Promise<Response>, auth: string, body: Record<string, unknown> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth.startsWith("did:")) headers.authorization = `Bearer ${auth}`;
  else headers["x-wallet-session"] = auth;
  const response = await route(
    new NextRequest("http://localhost/api/account/wallets", { method: "POST", headers, body: JSON.stringify(body) }),
  );
  return { status: response.status, body: (await response.json()) as Body };
}

/** A wallet account signed in with `home`. */
async function accountWith(home: PrivateKeyAccount) {
  const session = await issueWalletSession(addr(home));
  expect((await call(listRoute, session)).status).toBe(200);
  const { user } = (await getOrCreateUser({ did: null, wallet: addr(home) }))!;
  return { session, home, userId: user.id };
}

type Act = "link" | "home" | "unlink";
type Signed = { message: string; signature: string };

async function sign(
  signer: PrivateKeyAccount,
  nonce: string,
  act: "link" | "link-confirm" | "home" | "unlink",
  target: string,
  overrides: { domain?: string; statement?: string; resource?: string } = {},
): Promise<Signed> {
  const domain = overrides.domain ?? "localhost";
  const message = createSiweMessage({
    address: signer.address,
    chainId: 146,
    domain,
    uri: `http://${domain}`,
    nonce,
    version: "1",
    statement: overrides.statement ?? proofStatement(act, target),
    resources: [overrides.resource ?? proofResource(act, target)],
  });
  return { message, signature: await signer.signMessage({ message }) };
}

async function nonceFor(auth: string, act: Act, target: string) {
  const nonce = await call(nonceRoute, auth, { act, target });
  expect(nonce.status).toBe(200);
  return { nonce: nonce.body.nonce as string, nonceToken: nonce.body.nonceToken as string };
}

/** The whole link: the new wallet signs, and the home confirms over the same nonce. */
async function linkBody(auth: string, wallet: PrivateKeyAccount, confirmer: PrivateKeyAccount | null) {
  const { nonce, nonceToken } = await nonceFor(auth, "link", addr(wallet));
  const own = await sign(wallet, nonce, "link", addr(wallet));
  const accountProof = confirmer ? await sign(confirmer, nonce, "link-confirm", addr(wallet)) : undefined;
  return { ...own, nonceToken, accountProof };
}

async function actBody(auth: string, act: "home" | "unlink", target: string, signer: PrivateKeyAccount) {
  const { nonce, nonceToken } = await nonceFor(auth, act, target);
  return { ...(await sign(signer, nonce, act, target)), nonceToken, address: target };
}

const auditOf = async (userId: string) =>
  (await sql.query(`select action, detail from account_audit where user_id = $1 order by id`, [userId])) as {
    action: string;
    detail: Record<string, unknown>;
  }[];

const REFUSED = { status: 401, body: { error: "not verified" } };

describe("linking a second EVM wallet", () => {
  it("links it with its signature and the home's, keeps the home, and signs in to the same account", async () => {
    const { session, home, userId } = await accountWith(key());
    const second = key();

    const linked = await call(linkRoute, session, await linkBody(session, second, home));
    expect(linked.status).toBe(200);
    expect(linked.body.state).toBe("linked");
    expect(linked.body.wallets).toEqual([
      expect.objectContaining({ address: addr(home), isHome: true }),
      expect.objectContaining({ address: addr(second), isHome: false }),
    ]);
    expect(typeof linked.body.walletSession).toBe("string");

    const asSecond = await call(listRoute, linked.body.walletSession as string);
    expect(asSecond.body.wallets).toHaveLength(2);
    expect(asSecond.body.signedInWith).toBe(addr(second));
    expect((await getOrCreateUser({ did: null, wallet: addr(second) }))!.user.id).toBe(userId);

    expect(await auditOf(userId)).toEqual([
      { action: "wallet_linked", detail: { family: "evm", wallet: `eip155:${addr(second)}`, home: false, proof: "siwe" } },
    ]);
    const again = await call(linkRoute, session, await linkBody(session, second, home));
    expect(again.body.state).toBe("already");
    expect(await auditOf(userId)).toHaveLength(1);
  });

  it("a lingering session alone never adds a wallet: without the home's confirmation, refused", async () => {
    const { session, userId } = await accountWith(key());
    const second = key();
    expect(await call(linkRoute, session, await linkBody(session, second, null))).toEqual(REFUSED);
    // Confirmed by the new wallet itself, or by a stranger: refused too.
    expect(await call(linkRoute, session, await linkBody(session, second, second))).toEqual(REFUSED);
    expect(await call(linkRoute, session, await linkBody(session, second, key()))).toEqual(REFUSED);
    expect(await accountEvmAddresses(userId)).toMatchObject({ all: [expect.any(String)] });
  });

  it("an email account links with a code entered in the last ten minutes, else it is asked to sign in again", async () => {
    const did = "did:privy:link-email";
    const embedded = key();
    privy.wallet.set(did, addr(embedded));
    expect((await call(listRoute, did)).status).toBe(200);
    const second = key();
    privy.verifiedAt.set(did, Date.now() - 60 * 60_000);
    expect(await call(linkRoute, did, await linkBody(did, second, null))).toEqual({ status: 403, body: { error: "sign in again" } });
    privy.verifiedAt.set(did, Date.now() - 60_000);
    const linked = await call(linkRoute, did, await linkBody(did, second, null));
    expect(linked.body.state).toBe("linked");
    expect(linked.body.signedInWith).toBeNull();
  });

  it("an address on another account: a calm state after proof, nothing moves, one conflict row", async () => {
    const { session, home, userId } = await accountWith(key());
    const theirs = key();
    const other = await accountWith(theirs);
    const result = await call(linkRoute, session, await linkBody(session, theirs, home));
    expect(result.status).toBe(200);
    expect(result.body.state).toBe("other_account");
    expect(result.body.walletSession).toBeUndefined();
    expect(result.body.wallets).toHaveLength(1);
    expect(JSON.stringify(result.body)).not.toContain(other.userId);
    expect(await accountEvmAddresses(other.userId, addr(theirs))).toEqual({ home: addr(theirs), all: [addr(theirs)] });
    expect(await auditOf(userId)).toEqual([
      { action: "identity_conflict", detail: { kind: "wallet", family: "evm", otherUserId: other.userId } },
    ]);
  });

  it("refuses the same way before the proof checks out: another host, another statement, another target, a replay", async () => {
    const { session, home } = await accountWith(key());
    const theirs = key();
    await accountWith(theirs);
    const stranger = key();

    const { nonce, nonceToken } = await nonceFor(session, "link", addr(theirs));
    const confirm = await sign(home, nonce, "link-confirm", addr(theirs));
    const good = await sign(theirs, nonce, "link", addr(theirs));
    const refusals = await Promise.all([
      call(linkRoute, session, { ...good, nonceToken, accountProof: confirm, signature: await stranger.signMessage({ message: good.message }) }),
      call(linkRoute, session, { ...good, nonceToken: "not-a-token", accountProof: confirm }),
      call(linkRoute, session, { message: good.message, accountProof: confirm }),
      call(linkRoute, session, { ...(await sign(theirs, nonce, "link", addr(theirs), { domain: "evil.example" })), nonceToken, accountProof: confirm }),
      call(linkRoute, session, { ...(await sign(theirs, nonce, "link", addr(theirs), { statement: "Sign in to a game." })), nonceToken, accountProof: confirm }),
      call(linkRoute, session, { ...(await sign(theirs, nonce, "link", addr(theirs), { resource: proofResource("home", addr(theirs)) })), nonceToken, accountProof: confirm }),
      // Signed by another address than the one the nonce was issued for.
      call(linkRoute, session, { ...(await sign(stranger, nonce, "link", addr(theirs))), nonceToken, accountProof: confirm }),
    ]);
    for (const refusal of refusals) expect(refusal).toEqual(REFUSED);

    // A nonce issued to another account cannot be spent here.
    const other = await accountWith(key());
    expect(await call(linkRoute, session, await linkBody(other.session, stranger, other.home))).toEqual(REFUSED);

    // The good proof works once; the same proof again is a replay.
    const once = await call(linkRoute, session, { ...good, nonceToken, accountProof: confirm });
    expect(once.body.state).toBe("other_account");
    expect(await call(linkRoute, session, { ...good, nonceToken, accountProof: confirm })).toEqual(REFUSED);
  });

  it("is rate limited per account", async () => {
    const { session } = await accountWith(key());
    const statuses: number[] = [];
    for (let i = 0; i <= ACT_LIMIT_PER_HOUR; i++) statuses.push((await call(linkRoute, session, {})).status);
    expect(statuses.slice(0, ACT_LIMIT_PER_HOUR).every((status) => status === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it("two links racing on an account with no home: one becomes home, the other pays from, no error", async () => {
    const did = "did:privy:race";
    privy.wallet.set(did, "");
    expect((await call(listRoute, did)).status).toBe(200);
    privy.verifiedAt.set(did, Date.now());
    const [a, b] = [key(), key()];
    const results = await Promise.all([call(linkRoute, did, await linkBody(did, a, null)), call(linkRoute, did, await linkBody(did, b, null))]);
    expect(results.map((result) => result.body.state)).toEqual(["linked", "linked"]);
    const wallets = (await call(listRoute, did)).body.wallets!;
    expect(wallets.filter((wallet) => wallet.isHome)).toHaveLength(1);
    expect(wallets).toHaveLength(2);
  });
});

describe("home", () => {
  it("switching home needs the current home's signature over this target, once, and moves the mirror", async () => {
    const { session, home, userId } = await accountWith(key());
    const second = key();
    await call(linkRoute, session, await linkBody(session, second, home));

    expect(await call(homeRoute, session, await actBody(session, "home", addr(second), second))).toEqual(REFUSED);
    // A home proof issued for another address cannot be pointed at this one.
    const third = key();
    await call(linkRoute, session, await linkBody(session, third, home));
    const forThird = await actBody(session, "home", addr(third), home);
    expect(await call(homeRoute, session, { ...forThird, address: addr(second) })).toEqual(REFUSED);

    const body = await actBody(session, "home", addr(second), home);
    const switched = await call(homeRoute, session, body);
    expect(switched.body.state).toBe("home");
    expect(switched.body.wallets![0]).toMatchObject({ address: addr(second), isHome: true });
    expect(await call(homeRoute, session, body)).toEqual(REFUSED); // replay
    const mirror = (await sql.query(`select wallet_address from users where id = $1`, [userId])) as { wallet_address: string }[];
    expect(mirror[0].wallet_address).toBe(addr(second));
    const homes = (await sql.query(`select count(*)::int as n from user_identities where user_id = $1 and is_home`, [userId])) as { n: number }[];
    expect(homes[0].n).toBe(1);
    expect((await auditOf(userId)).at(-1)).toEqual({
      action: "home_changed",
      detail: { family: "evm", from: `eip155:${addr(home)}`, to: `eip155:${addr(second)}` },
    });
    expect((await getOrCreateUser({ did: null, wallet: addr(home) }))!.user.id).toBe(userId);
  });

  it("an address not on the account cannot become home", async () => {
    const { session, home } = await accountWith(key());
    const result = await call(homeRoute, session, await actBody(session, "home", addr(key()), home));
    expect(result.body.state).toBe("not_linked");
  });
});

describe("remove and the cooldown", () => {
  it("removes a pay-from address, never the home, the signed in one, or one still holding listings, and it cools down", async () => {
    const { session, home, userId } = await accountWith(key());
    const second = key();
    const linked = await call(linkRoute, session, await linkBody(session, second, home));

    expect((await call(removeRoute, session, await actBody(session, "unlink", addr(home), home))).body.state).toBe("is_home");
    const secondSession = linked.body.walletSession as string;
    expect((await call(removeRoute, secondSession, await actBody(secondSession, "unlink", addr(second), second))).body.state).toBe("signed_in");

    holding.add(addr(second));
    const blocked = await call(removeRoute, session, await actBody(session, "unlink", addr(second), home));
    expect(blocked.body.state).toBe("holds");
    expect(blocked.body.wallets).toHaveLength(2);
    holding.delete(addr(second));

    const removed = await call(removeRoute, session, await actBody(session, "unlink", addr(second), home));
    expect(removed.body.state).toBe("unlinked");
    expect(removed.body.wallets).toEqual([expect.objectContaining({ address: addr(home), isHome: true })]);
    expect((await auditOf(userId)).at(-1)).toEqual({ action: "wallet_unlinked", detail: { family: "evm", wallet: `eip155:${addr(second)}` } });

    await expect(getOrCreateUser({ did: null, wallet: addr(second) })).rejects.toBeInstanceOf(WalletCoolingDownError);
    expect((await call(listRoute, secondSession)).status).toBe(409);
    const other = await accountWith(key());
    expect((await call(linkRoute, other.session, await linkBody(other.session, second, other.home))).body.state).toBe("cooling");

    expect((await call(linkRoute, session, await linkBody(session, second, home))).body.state).toBe("linked");
    await call(removeRoute, session, await actBody(session, "unlink", addr(second), second));

    await sql.query(`update user_identities set unlinked_at = now() - interval '8 days' where value = $1`, [`eip155:${addr(second)}`]);
    expect((await call(linkRoute, other.session, await linkBody(other.session, second, other.home))).body.state).toBe("linked");
    expect((await getOrCreateUser({ did: null, wallet: addr(second) }))!.user.id).toBe(other.userId);
  });

  it("orders paid from a removed address stay on the account", async () => {
    const { session, home, userId } = await accountWith(key());
    const second = key();
    await call(linkRoute, session, await linkBody(session, second, home));
    await sql.query(
      `insert into orders (user_id, wallet_address, intent_tx, direction, listing_symbol, listing_address, quantity, placed_at)
       values ($1, $2, $3, 'buy', 'NVDA', $4, 1, now())`,
      [userId, addr(second), `0x${"ab".repeat(32)}`, `0x${"cd".repeat(20)}`],
    );
    await call(removeRoute, session, await actBody(session, "unlink", addr(second), home));
    const orders = (await sql.query(`select user_id from orders where wallet_address = $1`, [addr(second)])) as { user_id: string }[];
    expect(orders).toEqual([{ user_id: userId }]);
  });
});
