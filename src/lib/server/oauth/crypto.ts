import { createHash, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The few primitives the authorization server needs. Tokens and codes are
 * 32 random bytes in base64url; only their SHA-256 (hex) is ever stored, so
 * a read of the database hands nobody a working token.
 */

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Constant time string equality; unequal lengths are simply unequal. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** RFC 7636 verifier syntax: 43 to 128 unreserved characters. */
export function isValidVerifier(verifier: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(verifier);
}

/** RFC 7636 S256 challenge syntax: base64url of a SHA-256, 43 characters. */
export function isValidChallenge(challenge: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(challenge);
}

export function s256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** PKCE S256: does this verifier answer this challenge. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!isValidVerifier(verifier) || !isValidChallenge(challenge)) return false;
  return safeEqual(s256Challenge(verifier), challenge);
}

let consentKey: Uint8Array | null = null;

/**
 * The key the consent request is signed with, derived (HKDF) from the
 * secret the deployment already has, as wallet sessions do: SESSION_SECRET
 * when set, PRIVY_APP_SECRET otherwise. A rotation only voids consent
 * screens left open across it.
 */
export function consentSigningKey(): Uint8Array {
  if (consentKey) return consentKey;
  const secret = process.env.SESSION_SECRET ?? process.env.PRIVY_APP_SECRET;
  if (!secret) throw new Error("agent access needs SESSION_SECRET (or PRIVY_APP_SECRET) set");
  consentKey = new Uint8Array(hkdfSync("sha256", secret, "berth", "oauth-consent-v1", 32));
  return consentKey;
}
