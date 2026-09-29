import { secp256k1, schnorr } from "@noble/curves/secp256k1.js";
import { RawWitness, p2pkh, p2sh, p2tr, p2wpkh } from "@scure/btc-signer";
import { bip137MessageHash, toSign, type BitcoinAddressType } from "@/lib/server/bitcoin-message";

/**
 * Test-only: a real secp256k1 key, its mainnet address of one type, and a
 * signer that answers base64 the way the connected wallets do (the wallet
 * SDK's Bitcoin signMessage): BIP-322 simple for bc1q and bc1p, signed by
 * @scure/btc-signer's own transaction signer; BIP-137 for 1… and 3….
 */
export function bitcoinKey(
  type: BitcoinAddressType,
  secret: Uint8Array = secp256k1.utils.randomSecretKey(),
): { address: string; sign: (message: string) => string; secret: Uint8Array } {
  const pubkey = secp256k1.getPublicKey(secret, true);
  const xonly = schnorr.getPublicKey(secret);
  const payment =
    type === "p2pkh" ? p2pkh(pubkey) : type === "p2sh" ? p2sh(p2wpkh(pubkey)) : type === "p2wpkh" ? p2wpkh(pubkey) : p2tr(xonly);
  const address = payment.address!;
  const sign = (message: string): string => {
    if (type === "p2pkh" || type === "p2sh") {
      const sig = secp256k1.sign(bip137MessageHash(message), secret, { prehash: false, format: "recovered" });
      // noble puts the recovery byte first; BIP-137's header is 27 + recovery + 4 (compressed) + 4 (P2SH-P2WPKH).
      const header = 27 + sig[0] + 4 + (type === "p2sh" ? 4 : 0);
      return Buffer.from(Uint8Array.of(header, ...sig.slice(1))).toString("base64");
    }
    const tx = toSign(payment.script, message);
    if (type === "p2tr") tx.updateInput(0, { tapInternalKey: xonly });
    tx.signIdx(secret, 0);
    tx.finalizeIdx(0);
    return Buffer.from(RawWitness.encode(tx.getInput(0).finalScriptWitness!)).toString("base64");
  };
  return { address, sign, secret };
}
