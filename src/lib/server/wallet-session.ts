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
