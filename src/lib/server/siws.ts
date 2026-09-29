import { createPublicKey, verify } from "node:crypto";
import { base58Decode, normalizeAddress } from "@/lib/identity/caip";
import { parseSiwsMessage, type SiwsFields } from "@/lib/siws";
import { madeForBerthHost } from "@/lib/server/siwe-origin";

/**
 * The one Sign-In With Solana check, the sibling of lib/server/siwe: the
 * message is exactly the shape lib/siws writes, carries the nonce Berth
 * issued, names Berth's own host (the same host rule as SIWE,
 * lib/server/siwe-origin) and Solana mainnet, and the signature is an
 * ed25519 signature over the message's UTF-8 bytes by the key the address
 * is. A Solana address is its public key, so nothing is asked of a chain.
 * Freshness is the nonce's (its token lives ten minutes); issuedAt is the
 * person's clock and is not trusted. Returns the signer, base58 as signed
 * (case preserved), or null.
 */

export const SIWS_CHAIN_ID = "mainnet";

export type SiwsVerifier = (input: { message: string; signature: string; nonce: string }) => Promise<string | null>;

/** The message's fields when it was made for Berth over `nonce`, else null. No signature check. */
export function siwsFieldsFor(message: string, nonce: string): SiwsFields | null {
  const fields = parseSiwsMessage(message);
  if (!fields) return null;
  if (fields.nonce !== nonce || fields.chainId !== SIWS_CHAIN_ID) return null;
  if (!madeForBerthHost(fields.domain, fields.uri)) return null;
  if (normalizeAddress("solana", fields.address) !== fields.address) return null;
  return fields;
}

/**
 * The small-order ed25519 points (orders 1, 2, 4 and 8, identity included),
 * as canonical encodings and their sign-bit twins. A key among them lets a
 * forger make a "signature" that verifies without any secret (S = 0 over
 * the identity, for one), so none of them is ever a signer.
 */
const SMALL_ORDER_KEYS = new Set(
  [
    "0100000000000000000000000000000000000000000000000000000000000000",
    "0100000000000000000000000000000000000000000000000000000000000080",
    "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
    "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    "0000000000000000000000000000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000000000000000000000000080",
    "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
    "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85",
    "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
    "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa",
  ],
);

/** A y coordinate at or above the field prime p = 2^255 - 19: a non-canonical encoding. */
function nonCanonicalY(key: Uint8Array): boolean {
  if ((key[31] & 0x7f) !== 0x7f) return false;
  for (let i = 1; i < 31; i++) if (key[i] !== 0xff) return false;
  return key[0] >= 0xed;
}

/** Whether a 32 byte public key may sign at all: not small order, canonically encoded. */
export function ed25519KeyUsable(key: Uint8Array): boolean {
  return key.length === 32 && !SMALL_ORDER_KEYS.has(Buffer.from(key).toString("hex")) && !nonCanonicalY(key);
}

/** Whether `signature` (base58, 64 bytes) is `address`'s ed25519 signature over `message`. */
export function ed25519Valid(address: string, message: string, signature: string): boolean {
  const key = base58Decode(address);
  const sig = /^[1-9A-HJ-NP-Za-km-z]+$/.test(signature) ? base58Decode(signature) : null;
  if (!key || !ed25519KeyUsable(key) || !sig || sig.length !== 64) return false;
  try {
    const publicKey = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(key).toString("base64url") },
      format: "jwk",
    });
    return verify(null, Buffer.from(message, "utf8"), publicKey, Buffer.from(sig));
  } catch {
    return false;
  }
}

export const verifySiws: SiwsVerifier = async ({ message, signature, nonce }) => {
  const fields = siwsFieldsFor(message, nonce);
  if (!fields) return null;
  return ed25519Valid(fields.address, message, signature) ? fields.address : null;
};
