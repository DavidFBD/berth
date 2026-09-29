import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

/**
 * Linking a Bitcoin address, end to end through the routes against the real
 * schema, with real secp256k1 keys of every address type Berth proves
 * (bitcoin-test-key: BIP-322 for bc1q and bc1p, BIP-137 for 1… and 3…) and
 * the real SIWB check: the Bitcoin key signs a Sign-In With Bitcoin message
 * over a nonce bound to the account, the act and the address, and the
 * account confirms with its home's SIWE (or a recent email code), exactly
 * as a Solana link. The value is the canonical mainnet spelling, never
 * home, one account holds it, and it never signs in or offers a merge.
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
const { getOrCreateUser } = await import("./accounts");
const { issueWalletSession } = await import("./wallet-session");
const { setHoldingsCheck, setSiweVerifier } = await import("./account-wallets-route");
const { verifySiweLocally } = await import("./siwe");
const { bitcoinKey } = await import("./bitcoin-test-key");
const { solanaKey } = await import("./solana-test-key");
const { createSiwbMessage } = await import("@/lib/siwb");
const { createSiwsMessage } = await import("@/lib/siws");
const { proofResource, proofStatement, targetKey } = await import("@/lib/account-proof");
const { POST: nonceRoute } = await import("@/app/api/account/wallets/nonce/route");
const { POST: linkRoute } = await import("@/app/api/account/wallets/link/route");
const { POST: homeRoute } = await import("@/app/api/account/wallets/home/route");
const { POST: removeRoute } = await import("@/app/api/account/wallets/remove/route");
const { POST: listRoute } = await import("@/app/api/account/wallets/route");

process.env.SESSION_SECRET ??= "test-session-secret-bitcoin-wallets";

type Sql = import("./db").SqlClient;
let sql: Sql;
let close: () => Promise<void>;

beforeAll(async () => {
  const db = await makeTestDb();
  sql = db.sql;
  close = db.close;
  setSqlClient(sql);
  setSiweVerifier(verifySiweLocally);
  setHoldingsCheck(async () => false);
});

afterAll(async () => {
  setHoldingsCheck(null);
  setSiweVerifier(null);
  setSqlClient(null);
  await close();
});

const evmKey = () => privateKeyToAccount(generatePrivateKey());
const addr = (account: PrivateKeyAccount) => account.address.toLowerCase();
type BitcoinKey = ReturnType<typeof bitcoinKey>;
const TYPES = ["p2wpkh", "p2tr", "p2sh", "p2pkh"] as const;

type Body = Record<string, unknown> & { wallets?: { address: string; family: string; isHome: boolean }[] };
async function call(route: (request: NextRequest) => Promise<Response>, auth: string, body: Record<string, unknown> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth.startsWith("did:")) headers.authorization = `Bearer ${auth}`;
  else headers["x-wallet-session"] = auth;
  const response = await route(
    new NextRequest("http://localhost/api/account/wallets", { method: "POST", headers, body: JSON.stringify(body) }),
  );
  return { status: response.status, body: (await response.json()) as Body };
}

async function accountWith(home: PrivateKeyAccount) {
  const session = await issueWalletSession(addr(home));
  expect((await call(listRoute, session)).status).toBe(200);
  const { user } = (await getOrCreateUser({ did: null, wallet: addr(home) }))!;
  return { session, home, userId: user.id };
}

async function nonceFor(auth: string, act: "link" | "unlink" | "home", target: string, family = "bitcoin") {
  return call(nonceRoute, auth, { act, target, family });
}

type SiwbOverrides = { domain?: string; nonce?: string; address?: string; resource?: string; chainId?: string };

function siwb(key: BitcoinKey, nonce: string, act: "link" | "unlink", target: string, overrides: SiwbOverrides = {}) {
  const domain = overrides.domain ?? "localhost";
  const message = createSiwbMessage({
    domain,
    address: overrides.address ?? key.address,
    statement: proofStatement(act, targetKey("bitcoin", target)),
    uri: `http://${domain}`,
    version: "1",
    chainId: overrides.chainId ?? "mainnet",
    nonce: overrides.nonce ?? nonce,
    issuedAt: new Date().toISOString(),
    resources: [overrides.resource ?? proofResource(act, targetKey("bitcoin", target))],
  });
  return { message, signature: key.sign(message) };
}

async function confirmBy(home: PrivateKeyAccount, nonce: string, target: string) {
  const key = targetKey("bitcoin", target);
  const message = createSiweMessage({
    address: home.address,
    chainId: 146,
    domain: "localhost",
    uri: "http://localhost",
    nonce,
    version: "1",
    statement: proofStatement("link-confirm", key),
    resources: [proofResource("link-confirm", key)],
  });
  return { message, signature: await home.signMessage({ message }) };
}

async function linkBody(auth: string, wallet: BitcoinKey, confirmer: PrivateKeyAccount | null, overrides: SiwbOverrides = {}) {
  const issued = await nonceFor(auth, "link", wallet.address);
  expect(issued.status).toBe(200);
  const nonce = issued.body.nonce as string;
  const own = siwb(wallet, nonce, "link", wallet.address, overrides);
  const accountProof = confirmer ? await confirmBy(confirmer, nonce, wallet.address) : undefined;
  return { ...own, nonceToken: issued.body.nonceToken, accountProof };
}

const REFUSED = { status: 401, body: { error: "not verified" } };

describe("linking a Bitcoin address", () => {
  for (const type of TYPES) {
    it(`${type}: links with its SIWB and the home's SIWE, stored canonical, never home, no wallet session`, async () => {
      const { session, home, userId } = await accountWith(evmKey());
      const wallet = bitcoinKey(type);
      const linked = await call(linkRoute, session, await linkBody(session, wallet, home));
      expect(linked.status).toBe(200);
      expect(linked.body.state).toBe("linked");
      expect(linked.body.address).toBe(wallet.address);
      expect(linked.body.family).toBe("bitcoin");
      expect(linked.body.walletSession).toBeUndefined();
      expect(linked.body.wallets).toEqual([
        expect.objectContaining({ address: addr(home), family: "evm", isHome: true }),
        expect.objectContaining({ address: wallet.address, family: "bitcoin", isHome: false }),
      ]);
      const rows = (await sql.query(
        `select value, family, is_home, proof from user_identities where user_id = $1 and family = 'bitcoin'`,
        [userId],
      )) as { value: string; family: string; is_home: boolean; proof: string }[];
      expect(rows).toEqual([{ value: `bip122:${wallet.address}`, family: "bitcoin", is_home: false, proof: "bip322" }]);

      const again = await call(linkRoute, session, await linkBody(session, wallet, home));
      expect(again.body.state).toBe("already");
    });
  }

  it("an email account confirms with a code entered in the last ten minutes", async () => {
    const did = "did:privy:bitcoin-email";
    privy.wallet.set(did, addr(evmKey()));
    expect((await call(listRoute, did)).status).toBe(200);
    const wallet = bitcoinKey("p2wpkh");
    privy.verifiedAt.set(did, Date.now() - 60 * 60_000);
    expect(await call(linkRoute, did, await linkBody(did, wallet, null))).toEqual({ status: 403, body: { error: "sign in again" } });
    privy.verifiedAt.set(did, Date.now() - 60_000);
    expect((await call(linkRoute, did, await linkBody(did, wallet, null))).body.state).toBe("linked");
  });

  it("never with the Bitcoin signature alone, or confirmed by anyone but the home", async () => {
    const { session } = await accountWith(evmKey());
    const wallet = bitcoinKey("p2tr");
    expect(await call(linkRoute, session, await linkBody(session, wallet, null))).toEqual(REFUSED);
    expect(await call(linkRoute, session, await linkBody(session, wallet, evmKey()))).toEqual(REFUSED);
  });

  it("refuses the same way for another host, another nonce, another chain, another address, a replay", async () => {
    const { session, home } = await accountWith(evmKey());
    const wallet = bitcoinKey("p2wpkh");
    const stranger = bitcoinKey("p2wpkh");
    expect(await call(linkRoute, session, await linkBody(session, wallet, home, { domain: "evil.example" }))).toEqual(REFUSED);
    expect(await call(linkRoute, session, await linkBody(session, wallet, home, { domain: "localhost.evil.example" }))).toEqual(REFUSED);
    expect(await call(linkRoute, session, await linkBody(session, wallet, home, { nonce: "notthenonce1" }))).toEqual(REFUSED);
    expect(await call(linkRoute, session, await linkBody(session, wallet, home, { chainId: "testnet" }))).toEqual(REFUSED);
    expect(
      await call(linkRoute, session, await linkBody(session, wallet, home, { resource: proofResource("link", targetKey("bitcoin", stranger.address)) })),
    ).toEqual(REFUSED);
    // A signature by another key over a message naming this address.
    const issued = await nonceFor(session, "link", wallet.address);
    const nonce = issued.body.nonce as string;
    const confirm = await confirmBy(home, nonce, wallet.address);
    const forged = siwb(stranger, nonce, "link", wallet.address, { address: wallet.address });
    expect(await call(linkRoute, session, { ...forged, nonceToken: issued.body.nonceToken, accountProof: confirm })).toEqual(REFUSED);
    // Another address's proof over this address's nonce.
    const swapped = siwb(stranger, nonce, "link", wallet.address, { address: stranger.address });
    expect(await call(linkRoute, session, { ...swapped, nonceToken: issued.body.nonceToken, accountProof: confirm })).toEqual(REFUSED);
    // The same key's other address is another address.
    const sibling = bitcoinKey("p2sh", wallet.secret);
    const siblingProof = siwb(sibling, nonce, "link", wallet.address, { address: sibling.address });
    expect(await call(linkRoute, session, { ...siblingProof, nonceToken: issued.body.nonceToken, accountProof: confirm })).toEqual(REFUSED);

    const body = await linkBody(session, wallet, home);
    expect((await call(linkRoute, session, body)).body.state).toBe("linked");
    expect(await call(linkRoute, session, body)).toEqual(REFUSED);
  });

  it("a Solana message cannot stand in for a Bitcoin one", async () => {
    const { session, home } = await accountWith(evmKey());
    const wallet = bitcoinKey("p2wpkh");
    const sol = solanaKey();
    const issued = await nonceFor(session, "link", wallet.address);
    const nonce = issued.body.nonce as string;
    const message = createSiwsMessage({
      domain: "localhost",
      address: sol.address,
      statement: proofStatement("link", targetKey("bitcoin", wallet.address)),
      uri: "http://localhost",
      version: "1",
      chainId: "mainnet",
      nonce,
      issuedAt: new Date().toISOString(),
      resources: [proofResource("link", targetKey("bitcoin", wallet.address))],
    });
    expect(
      await call(linkRoute, session, {
        message,
        signature: sol.sign(message),
        nonceToken: issued.body.nonceToken,
        accountProof: await confirmBy(home, nonce, wallet.address),
      }),
    ).toEqual(REFUSED);
  });

  it("only the canonical mainnet spelling: uppercase bech32, testnet, script addresses are refused, and never home", async () => {
    const { session } = await accountWith(evmKey());
    const wallet = bitcoinKey("p2wpkh");
    expect((await nonceFor(session, "link", wallet.address.toUpperCase())).status).toBe(400);
    expect((await nonceFor(session, "link", ` ${wallet.address}`)).status).toBe(400);
    expect((await nonceFor(session, "link", "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx")).status).toBe(400);
    expect((await nonceFor(session, "link", wallet.address, "solana")).status).toBe(400);
    expect((await nonceFor(session, "home", wallet.address)).status).toBe(400);
    // A P2WSH address gets a nonce (it is a valid address) but no key can sign for it.
    const p2wsh = "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3";
    const issued = await nonceFor(session, "link", p2wsh);
    expect(issued.status).toBe(200);
  });

  it("one owner: another account gets a calm state after proof, and no merge is offered", async () => {
    const mine = await accountWith(evmKey());
    const theirs = await accountWith(evmKey());
    const wallet = bitcoinKey("p2tr");
    expect((await call(linkRoute, theirs.session, await linkBody(theirs.session, wallet, theirs.home))).body.state).toBe("linked");
    const result = await call(linkRoute, mine.session, await linkBody(mine.session, wallet, mine.home));
    expect(result.status).toBe(200);
    expect(result.body.state).toBe("other_account");
    expect(result.body.wallets).toHaveLength(1);
    expect(JSON.stringify(result.body)).not.toContain(theirs.userId);
    expect(result.body.merge).toBeUndefined();
  });

  it("is removed with the home's signature, and cools down for other accounts", async () => {
    const { session, home, userId } = await accountWith(evmKey());
    const wallet = bitcoinKey("p2pkh");
    expect((await call(linkRoute, session, await linkBody(session, wallet, home))).body.state).toBe("linked");

    const issued = await nonceFor(session, "unlink", wallet.address);
    const nonce = issued.body.nonce as string;
    const key = targetKey("bitcoin", wallet.address);
    const message = createSiweMessage({
      address: home.address,
      chainId: 146,
      domain: "localhost",
      uri: "http://localhost",
      nonce,
      version: "1",
      statement: proofStatement("unlink", key),
      resources: [proofResource("unlink", key)],
    });
    const removed = await call(removeRoute, session, {
      message,
      signature: await home.signMessage({ message }),
      nonceToken: issued.body.nonceToken,
      address: wallet.address,
    });
    expect(removed.body.state).toBe("unlinked");
    expect(removed.body.wallets).toHaveLength(1);
    const audit = (await sql.query(`select action from account_audit where user_id = $1 order by id`, [userId])) as { action: string }[];
    expect(audit.map((row) => row.action)).toEqual(["wallet_linked", "wallet_unlinked"]);

    const other = await accountWith(evmKey());
    expect((await call(linkRoute, other.session, await linkBody(other.session, wallet, other.home))).body.state).toBe("cooling");
    expect((await call(linkRoute, session, await linkBody(session, wallet, home))).body.state).toBe("linked");
  });

  it("removes itself with its own SIWB", async () => {
    const { session, home } = await accountWith(evmKey());
    const wallet = bitcoinKey("p2sh");
    await call(linkRoute, session, await linkBody(session, wallet, home));
    const issued = await nonceFor(session, "unlink", wallet.address);
    const own = siwb(wallet, issued.body.nonce as string, "unlink", wallet.address);
    const removed = await call(removeRoute, session, { ...own, nonceToken: issued.body.nonceToken, address: wallet.address });
    expect(removed.body.state).toBe("unlinked");
  });

  it("a home proof over a Bitcoin nonce is refused", async () => {
    const { session } = await accountWith(evmKey());
    const wallet = bitcoinKey("p2wpkh");
    const issued = await nonceFor(session, "unlink", wallet.address);
    const result = await call(homeRoute, session, { message: "x", signature: "y", nonceToken: issued.body.nonceToken, address: wallet.address });
    expect(result).toEqual(REFUSED);
  });
});
