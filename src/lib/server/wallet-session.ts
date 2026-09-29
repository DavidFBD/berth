import { hkdfSync } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { normalizeWallet } from "@/lib/server/accounts";

/**
 * Wallet-guest sessions: short self-issued JWTs proving "this browser holds
 * the key to this address", minted after a SIWE signature checks out.
 *
 * Stateless on purpose — the nonce travels as its own short-lived signed
 * token instead of a database row, and the session key is derived (HKDF)
 * from a secret the deployment already has. SESSION_SECRET wins when set;
 * PRIVY_APP_SECRET is the fallback so production needs no new env var. A
 * rotation of either simply signs everyone out of XP for one signature.
 */

const NONCE_TTL = "10m";
const SESSION_TTL = "7d";

let key: Uint8Array | null = null;

function sessionKey(): Uint8Array {
  if (key) return key;
  const secret = process.env.SESSION_SECRET ?? process.env.PRIVY_APP_SECRET;
  if (!secret) {
    throw new Error(
      "wallet sessions need SESSION_SECRET (or PRIVY_APP_SECRET) set",
    );
  }
  key = new Uint8Array(
    hkdfSync("sha256", secret, "lsteatime", "wallet-session-v1", 32),
  );
  return key;
}

async function sign(claims: Record<string, string>, ttl: string) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(sessionKey());
}

export async function issueNonceToken(nonce: string): Promise<string> {
  return sign({ purpose: "siwe-nonce", nonce }, NONCE_TTL);
}

export async function readNonceToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, sessionKey());
    if (payload.purpose !== "siwe-nonce") return null;
    return typeof payload.nonce === "string" ? payload.nonce : null;
  } catch {
    return null;
  }
}

/** The subject is the address in its family's one spelling (normalizeWallet): EVM lowercase, base58 as given. */
export async function issueWalletSession(address: string): Promise<string> {
  return sign({ purpose: "wallet-session", sub: normalizeWallet(address) ?? address }, SESSION_TTL);
}

/** The address a session token proves and when it was signed (epoch ms), or null for anything less. */
export async function readWalletSession(token: string): Promise<{ address: string; issuedAt: number } | null> {
  try {
    const { payload } = await jwtVerify(token, sessionKey());
    if (payload.purpose !== "wallet-session" || typeof payload.sub !== "string") return null;
    return { address: payload.sub, issuedAt: typeof payload.iat === "number" ? payload.iat * 1000 : 0 };
  } catch {
    return null;
  }
}

/** The address a session token proves, or null for anything less. */
export async function verifyWalletSession(
  token: string,
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, sessionKey());
    if (payload.purpose !== "wallet-session") return null;
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * What an account nonce is for (lib/server/account-wallets): linking a new
 * address, making a linked address home, or removing one. Each proof is a
 * SIWE signed over a nonce that only the account that asked for it, and
 * only for that act, can spend.
 */
export type AccountAct = "link" | "home" | "unlink";

const ACCOUNT_ACTS: readonly AccountAct[] = ["link", "home", "unlink"];

/**
 * A 10 minute nonce bound to one account, one act and one target address
 * (the wallet to link, to make home, or to remove), so a proof is always
 * fresh and says what it is for. Spent once (account_nonces).
 */
export async function issueAccountNonceToken(nonce: string, userId: string, act: AccountAct, target: string): Promise<string> {
  return sign({ purpose: "account-nonce", nonce, sub: userId, act, target }, NONCE_TTL);
}

export async function readAccountNonceToken(
  token: string,
): Promise<{ nonce: string; userId: string; act: AccountAct; target: string } | null> {
  try {
    const { payload } = await jwtVerify(token, sessionKey());
    if (payload.purpose !== "account-nonce") return null;
    const { nonce, sub, act, target } = payload as { nonce?: unknown; sub?: unknown; act?: unknown; target?: unknown };
    if (typeof nonce !== "string" || typeof sub !== "string" || typeof target !== "string") return null;
    if (!ACCOUNT_ACTS.includes(act as AccountAct)) return null;
    return { nonce, userId: sub, act: act as AccountAct, target };
  } catch {
    return null;
  }
}

/**
 * A merge offer (lib/server/account-merge): issued only once both accounts
 * were proved in the same ten minutes, to the account that asked
 * (`requester`), naming the other one, which way the proof went (`kind`:
 * an email code and a wallet session, or a wallet's link signature) and,
 * for a wallet, the address that was proved. The survivor it was offered
 * with is carried so a merge that would now go the other way is refused.
 */
export type MergeOffer = {
  requester: string;
  other: string;
  kind: "email" | "wallet";
  survivor: string;
  /** The wallet whose fresh signature proved its side (lowercase EVM). */
  wallet?: string;
  /** Kind 'email': the Privy DID whose fresh code proved the email side. */
  did?: string;
};

export async function issueMergeOfferToken(offer: MergeOffer): Promise<string> {
  const claims: Record<string, string> = {
    purpose: "merge-offer",
    sub: offer.requester,
    other: offer.other,
    kind: offer.kind,
    survivor: offer.survivor,
  };
  if (offer.wallet) claims.wallet = offer.wallet;
  if (offer.did) claims.did = offer.did;
  return sign(claims, NONCE_TTL);
}

export async function readMergeOfferToken(token: unknown): Promise<MergeOffer | null> {
  if (typeof token !== "string") return null;
  try {
    const { payload } = await jwtVerify(token, sessionKey());
    if (payload.purpose !== "merge-offer") return null;
    const { sub, other, kind, survivor, wallet, did } = payload as Record<string, unknown>;
    if (typeof sub !== "string" || typeof other !== "string" || typeof survivor !== "string") return null;
    if (kind !== "email" && kind !== "wallet") return null;
    if (survivor !== sub && survivor !== other) return null;
    if (kind === "email" && (typeof did !== "string" || typeof wallet !== "string")) return null;
    return {
      requester: sub,
      other,
      kind,
      survivor,
      wallet: typeof wallet === "string" ? wallet : undefined,
      did: typeof did === "string" ? did : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * The nonce for an email merge's wallet signature: issued to a Privy DID
 * with a fresh email code, for one wallet address, ten minutes, spent once
 * (account_nonces, act 'merge'). It names no account, so asking for one
 * says nothing about whether the wallet has one.
 */
export async function issueMergeNonceToken(nonce: string, did: string, wallet: string): Promise<string> {
  return sign({ purpose: "merge-nonce", nonce, sub: did, target: wallet }, NONCE_TTL);
}

export async function readMergeNonceToken(token: unknown): Promise<{ nonce: string; did: string; wallet: string } | null> {
  if (typeof token !== "string") return null;
  try {
    const { payload } = await jwtVerify(token, sessionKey());
    if (payload.purpose !== "merge-nonce") return null;
    const { nonce, sub, target } = payload as Record<string, unknown>;
    if (typeof nonce !== "string" || typeof sub !== "string" || typeof target !== "string") return null;
    return { nonce, did: sub, wallet: target };
  } catch {
    return null;
  }
}
