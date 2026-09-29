import { secp256k1, schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { Address, NETWORK, OutScript, RawTx, RawWitness, Transaction, p2pkh, p2sh, p2wpkh } from "@scure/btc-signer";
import { normalizeAddress } from "@/lib/identity/caip";

/**
 * Bitcoin message signatures, verified on Bitcoin mainnet addresses, the
 * two ways the wallets Berth's wallet SDK connects (Unisat, Xverse, OKX,
 * Hana) sign a message:
 *
 * - BIP-322 "simple" for native segwit (bc1q, P2WPKH), taproot (bc1p,
 *   P2TR, key path) and nested segwit (3…, P2SH-P2WPKH, the witness
 *   bip322-js and some wallets write): the signature is the witness of a virtual `to_sign`
 *   transaction spending a virtual `to_spend` output that commits to the
 *   message's tagged hash. The transactions and their sighashes (BIP-143,
 *   BIP-341) are built with @scure/btc-signer; the curve checks are
 *   @noble/curves. Both are audited (Cure53) and have no other dependency.
 * - BIP-137 (the "Bitcoin Signed Message" compact ECDSA signature) for
 *   legacy (1…, P2PKH) and nested segwit (3…, P2SH-P2WPKH), and accepted
 *   for bc1q too. Verified loosely, as bip322-js and most verifiers do: the
 *   header's recovery id is used, its address type hint is not (Unisat
 *   writes the P2PKH hint for every address), and the recovered key must
 *   hash to the address in one of the key's own single-key forms. Loose
 *   is still a proof: only the holder of that key can make the signature.
 *
 * Never accepted: BIP-137 for taproot (out of spec), BIP-322 "full"
 * (a whole transaction, no connected wallet sends it for these types),
 * P2WSH and other script addresses, anything but mainnet.
 */

export type BitcoinAddressType = "p2pkh" | "p2sh" | "p2wpkh" | "p2tr";

const SIGHASH_DEFAULT = 0x00;
const SIGHASH_ALL = 0x01;

/** The address's single-key output type, or null when Berth cannot prove it (P2WSH, testnet, junk). */
export function bitcoinAddressType(address: string): BitcoinAddressType | null {
  if (normalizeAddress("bitcoin", address) !== address) return null;
  try {
    const decoded = Address(NETWORK).decode(address);
    switch (decoded.type) {
      case "pkh":
        return "p2pkh";
      case "sh":
        return "p2sh";
      case "wpkh":
        return "p2wpkh";
      case "tr":
        return "p2tr";
      default:
        return null;
    }
  } catch {
    return null;
  }
}

const utf8 = (text: string) => new TextEncoder().encode(text);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** BIP-340 tagged hash: sha256(sha256(tag) || sha256(tag) || data). */
function taggedHash(tag: string, data: Uint8Array): Uint8Array {
  const tagHash = sha256(utf8(tag));
  return sha256(concat(tagHash, tagHash, data));
}

/** BIP-322's message hash. */
export function bip322MessageHash(message: string): Uint8Array {
  return taggedHash("BIP0322-signed-message", utf8(message));
}

/** Bitcoin's CompactSize length prefix. */
function compactSize(n: number): Uint8Array {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, n >> 8);
  return Uint8Array.of(0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
}

/** BIP-137's message hash: sha256d of the "Bitcoin Signed Message" preimage. */
export function bip137MessageHash(message: string): Uint8Array {
  const prefix = utf8("\x18Bitcoin Signed Message:\n");
  const body = utf8(message);
  return sha256(sha256(concat(prefix, compactSize(body.length), body)));
}

/**
 * The virtual `to_sign` transaction of BIP-322 for `message` and the
 * address's output script: version 0, one input spending output 0 of
 * `to_spend` with sequence 0, one OP_RETURN output of 0, lock time 0.
 */
export function toSign(script: Uint8Array, message: string): Transaction {
  const toSpend = RawTx.encode({
    version: 0,
    segwitFlag: false,
    inputs: [
      {
        txid: new Uint8Array(32),
        index: 0xffffffff,
        // OP_0 PUSH32 <message hash>
        finalScriptSig: concat(Uint8Array.of(0x00, 0x20), bip322MessageHash(message)),
        sequence: 0,
      },
    ],
    outputs: [{ amount: 0n, script }],
    witnesses: undefined,
    lockTime: 0,
  });
  const toSpendId = sha256(sha256(toSpend)).reverse();
  const tx = new Transaction({ version: 0, lockTime: 0, allowUnknownOutputs: true, allowUnknownInputs: true, disableScriptCheck: true });
  tx.addInput({ txid: toSpendId, index: 0, sequence: 0, witnessUtxo: { script, amount: 0n } });
  tx.addOutput({ script: Uint8Array.of(0x6a), amount: 0n });
  return tx;
}

function decodeBase64(signature: string): Uint8Array | null {
  if (typeof signature !== "string" || signature.length === 0 || signature.length > 2000) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature) || signature.length % 4 !== 0) return null;
  return Uint8Array.from(Buffer.from(signature, "base64"));
}

function verifyBip322Simple(address: string, type: BitcoinAddressType, message: string, raw: Uint8Array): boolean {
  let witness: Uint8Array[];
  try {
    witness = RawWitness.decode(raw);
  } catch {
    return false;
  }
  if (!equal(RawWitness.encode(witness), raw)) return false;
  const script = OutScript.encode(Address(NETWORK).decode(address));
  const tx = toSign(script, message);
  if (type === "p2wpkh" || type === "p2sh") {
    // P2WPKH, or P2WPKH nested in P2SH (the witness is the same; the
    // scriptSig, which BIP-143 does not hash, would push the redeem script).
    // Accepting "simple" for 3… addresses is the bip322-js convention, not the
    // spec's simple format; it stays sound because the key must hash to
    // p2sh(p2wpkh(key)) below. BIP-322 requires low S, enforced in verify.
    if (witness.length !== 2) return false;
    const [sigWithType, pubkey] = witness;
    if (pubkey.length !== 33 || sigWithType.length < 9) return false;
    if (sigWithType[sigWithType.length - 1] !== SIGHASH_ALL) return false;
    // The key must be the one the address commits to.
    const own = type === "p2wpkh" ? p2wpkh(pubkey).address : p2sh(p2wpkh(pubkey)).address;
    if (own !== address) return false;
    // BIP-143 script code for P2WPKH is the P2PKH script of the key hash.
    const scriptCode = p2pkh(pubkey).script;
    const sighash = tx.preimageWitnessV0(0, scriptCode, SIGHASH_ALL, 0n);
    return secp256k1.verify(sigWithType.slice(0, -1), sighash, pubkey, { prehash: false, format: "der", lowS: true });
  }
  if (type !== "p2tr" || witness.length !== 1) return false;
  const decoded = Address(NETWORK).decode(address);
  if (decoded.type !== "tr") return false;
  const [sig] = witness;
  let hashType: number;
  if (sig.length === 64) hashType = SIGHASH_DEFAULT;
  else if (sig.length === 65 && sig[64] === SIGHASH_ALL) hashType = SIGHASH_ALL;
  else return false;
  const sighash = tx.preimageWitnessV1(0, [script], hashType, [0n]);
  // Key path: the output key in the address signs.
  return schnorr.verify(sig.slice(0, 64), sighash, decoded.pubkey);
}

function verifyBip137(address: string, type: BitcoinAddressType, message: string, raw: Uint8Array): boolean {
  if (raw.length !== 65 || type === "p2tr") return false;
  const header = raw[0];
  if (header < 27 || header > 42) return false;
  const recovery = (header - 27) & 3;
  const compressed = header >= 31;
  let point;
  try {
    point = secp256k1.Signature.fromBytes(raw.slice(1), "compact")
      .addRecoveryBit(recovery)
      .recoverPublicKey(bip137MessageHash(message));
  } catch {
    return false;
  }
  const pubkey = point.toBytes(compressed);
  try {
    if (!compressed) return type === "p2pkh" && p2pkh(pubkey).address === address;
    switch (type) {
      case "p2pkh":
        return p2pkh(pubkey).address === address;
      case "p2sh":
        return p2sh(p2wpkh(pubkey)).address === address;
      case "p2wpkh":
        return p2wpkh(pubkey).address === address;
    }
  } catch {
    return false;
  }
}

/**
 * Whether `signature` (base64, as every connected wallet answers) is a
 * valid signature of `message` by the mainnet `address`, in the scheme
 * its type allows. Never throws.
 */
export function verifyBitcoinMessage(address: string, message: string, signature: string): boolean {
  const type = bitcoinAddressType(address);
  const raw = decodeBase64(signature);
  if (!type || !raw || typeof message !== "string") return false;
  try {
    if (raw.length === 65 && raw[0] >= 27 && raw[0] <= 42) return verifyBip137(address, type, message, raw);
    return type === "p2pkh" ? false : verifyBip322Simple(address, type, message, raw);
  } catch {
    return false;
  }
}
