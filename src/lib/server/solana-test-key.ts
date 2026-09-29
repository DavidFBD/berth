import { generateKeyPairSync, sign as edSign, type KeyObject } from "node:crypto";
import { base58Encode } from "@/lib/identity/caip";

/** A real ed25519 key, its Solana address, and a signer that answers base58 like the client sends. */
export function solanaKey(): { address: string; sign: (message: string) => string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  const address = base58Encode(new Uint8Array(Buffer.from(jwk.x, "base64url")));
  return {
    address,
    privateKey,
    sign: (message) => base58Encode(new Uint8Array(edSign(null, Buffer.from(message, "utf8"), privateKey))),
  };
}
