import { normalizeAddress } from "@/lib/identity/caip";
import { parseSiwbMessage, type SiwbFields } from "@/lib/siwb";
import { madeForBerthHost } from "@/lib/server/siwe-origin";
import { verifyBitcoinMessage } from "@/lib/server/bitcoin-message";

/**
 * The one Sign-In With Bitcoin check, the sibling of lib/server/siws: the
 * message is exactly the shape lib/siwb writes, carries the nonce Berth
 * issued, names Berth's own host (lib/server/siwe-origin) and Bitcoin
 * mainnet, and the signature is the address's own over the message
 * (lib/server/bitcoin-message: BIP-322 for bc1q, bc1p and 3…, BIP-137 for
 * 1… and 3…). Freshness is the nonce's; issuedAt is the person's clock and
 * is not trusted. Returns the signer, in its canonical spelling, or null.
 */

export const SIWB_CHAIN_ID = "mainnet";

export type SiwbVerifier = (input: { message: string; signature: string; nonce: string }) => Promise<string | null>;

/** The message's fields when it was made for Berth over `nonce`, else null. No signature check. */
export function siwbFieldsFor(message: string, nonce: string): SiwbFields | null {
  const fields = parseSiwbMessage(message);
  if (!fields) return null;
  if (fields.nonce !== nonce || fields.chainId !== SIWB_CHAIN_ID) return null;
  if (!madeForBerthHost(fields.domain, fields.uri)) return null;
  if (normalizeAddress("bitcoin", fields.address) !== fields.address) return null;
  return fields;
}

export const verifySiwb: SiwbVerifier = async ({ message, signature, nonce }) => {
  const fields = siwbFieldsFor(message, nonce);
  if (!fields) return null;
  return verifyBitcoinMessage(fields.address, message, signature) ? fields.address : null;
};
