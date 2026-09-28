import { isAddress, sha256 } from "viem";

/**
 * Wallet identifiers, one canonical spelling per network family, and their
 * CAIP-10 form (`<namespace>:<address>`) as stored in `user_identities.value`.
 *
 * Canonical forms (the per-network normalisation rule):
 * - evm: lowercase hex. EVM addresses are case-insensitive (EIP-55 case is
 *   only a checksum), and every address Berth already stores (users,
 *   orders, hub wallets, wallet sessions) is lowercase, so lowercase stays
 *   the one spelling. Mixed case input must carry a valid EIP-55 checksum.
 * - solana: base58, case preserved. Base58 is case-sensitive: two strings
 *   that differ only in case are two different keys. Must decode to 32 bytes.
 * - bitcoin: mainnet only. bech32/bech32m (bc1) lowercased, since BIP-173
 *   forbids mixed case and the lowercase form is canonical; legacy base58check
 *   (1…, 3…) left exactly as is, with its checksum verified. Testnet and
 *   regtest (tb1, bcrt1, m…, n…, 2…) are refused.
 *
 * CAIP-10 proper is `namespace:reference:address` with a chain id as the
 * reference. Berth's identifiers are deliberately chain-agnostic: one EVM key
 * signs on every EVM chain, so the reference is omitted and the value is
 * `eip155:<address>`, `solana:<address>`, `bip122:<address>`. Parsing splits
 * on the first colon only.
 */

export type WalletFamily = "evm" | "solana" | "bitcoin";

export const WALLET_FAMILIES: readonly WalletFamily[] = ["evm", "solana", "bitcoin"];

const NAMESPACE: Record<WalletFamily, string> = {
  evm: "eip155",
  solana: "solana",
  bitcoin: "bip122",
};

const FAMILY_BY_NAMESPACE: Record<string, WalletFamily> = {
  eip155: "evm",
  solana: "solana",
  bip122: "bitcoin",
};

// ---------------------------------------------------------------- base58

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_MAP = new Map([...BASE58].map((char, index) => [char, index]));

function base58Decode(input: string): Uint8Array | null {
  if (input.length === 0) return null;
  const bytes: number[] = [];
  for (const char of input) {
    const value = BASE58_MAP.get(char);
    if (value === undefined) return null;
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of input) {
    if (char !== "1") break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

// ---------------------------------------------------------------- bech32

const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;
// Mainnet only: a testnet or regtest address is never a Berth identity.
const BITCOIN_HRPS = new Set(["bc"]);

function polymod(values: number[]): number {
  const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) checksum ^= generator[i];
  }
  return checksum >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const char of hrp) out.push(char.charCodeAt(0) >> 5);
  out.push(0);
  for (const char of hrp) out.push(char.charCodeAt(0) & 31);
  return out;
}

function convertBits(data: number[], from: number, to: number): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const max = (1 << to) - 1;
  for (const value of data) {
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & max);
    }
  }
  if (bits >= from || ((acc << (to - bits)) & max) !== 0) return null;
  return out;
}

/** A valid segwit address (BIP-173 v0, BIP-350 v1+), already lowercased. */
function isSegwitAddress(lower: string): boolean {
  if (lower.length > 90) return false;
  const separator = lower.lastIndexOf("1");
  if (separator < 1 || separator + 7 > lower.length) return false;
  const hrp = lower.slice(0, separator);
  if (!BITCOIN_HRPS.has(hrp)) return false;
  const data: number[] = [];
  for (const char of lower.slice(separator + 1)) {
    const value = BECH32.indexOf(char);
    if (value === -1) return false;
    data.push(value);
  }
  const check = polymod([...hrpExpand(hrp), ...data]);
  const version = data[0];
  if (version > 16) return false;
  if (check !== (version === 0 ? BECH32_CONST : BECH32M_CONST)) return false;
  const program = convertBits(data.slice(1, -6), 5, 8);
  if (!program || program.length < 2 || program.length > 40) return false;
  if (version === 0 && program.length !== 20 && program.length !== 32) return false;
  return true;
}

// ---------------------------------------------------------------- families

// Mainnet P2PKH (0x00) and P2SH (0x05); testnet 0x6f and 0xc4 are refused.
const BITCOIN_BASE58_VERSIONS = new Set([0x00, 0x05]);

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.slice(2);
  return Uint8Array.from(clean.match(/../g)!.map((pair) => parseInt(pair, 16)));
}

function isBase58CheckBitcoin(address: string): boolean {
  if (address.length < 26 || address.length > 35) return false;
  const bytes = base58Decode(address);
  if (!bytes || bytes.length !== 25 || !BITCOIN_BASE58_VERSIONS.has(bytes[0])) return false;
  const payload = bytes.slice(0, 21);
  const digest = hexToBytes(sha256(hexToBytes(sha256(payload))));
  return digest.slice(0, 4).every((byte, i) => byte === bytes[21 + i]);
}

function canonicalEvm(address: string): string | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  // strict: an all-lowercase address passes; mixed case must be valid EIP-55.
  const lower = address.toLowerCase();
  if (address !== lower && address !== "0x" + address.slice(2).toUpperCase()) {
    if (!isAddress(address, { strict: true })) return null;
  }
  return lower;
}

function canonicalSolana(address: string): string | null {
  if (address.length < 32 || address.length > 44) return null;
  const bytes = base58Decode(address);
  return bytes && bytes.length === 32 ? address : null;
}

function canonicalBitcoin(address: string): string | null {
  const lower = address.toLowerCase();
  if (/^(tb|bcrt)1/.test(lower)) return null; // testnet, regtest
  if (/^bc1/.test(lower)) {
    // BIP-173: all one case. Mixed case is invalid, never "fixed".
    if (address !== lower && address !== address.toUpperCase()) return null;
    return isSegwitAddress(lower) ? lower : null;
  }
  return isBase58CheckBitcoin(address) ? address : null;
}

/** The canonical spelling of an address in its family, or null when it is not one. */
export function normalizeAddress(family: WalletFamily, address: unknown): string | null {
  if (typeof address !== "string") return null;
  const trimmed = address.trim();
  switch (family) {
    case "evm":
      return canonicalEvm(trimmed);
    case "solana":
      return canonicalSolana(trimmed);
    case "bitcoin":
      return canonicalBitcoin(trimmed);
  }
}

export function isValidAddress(family: WalletFamily, address: unknown): boolean {
  return normalizeAddress(family, address) !== null;
}

/**
 * The family an address belongs to, judged by shape and checksum. The shapes
 * do not overlap: 0x hex is EVM; bech32 with a Bitcoin prefix or a base58check
 * string of 25 bytes is Bitcoin; base58 of 32 bytes is Solana.
 */
export function detectFamily(address: unknown): WalletFamily | null {
  if (typeof address !== "string") return null;
  const trimmed = address.trim();
  if (canonicalEvm(trimmed)) return "evm";
  if (canonicalBitcoin(trimmed)) return "bitcoin";
  if (canonicalSolana(trimmed)) return "solana";
  return null;
}

/** `eip155:<addr>` / `solana:<addr>` / `bip122:<addr>`, canonical, or null when invalid. */
export function toCaip10(family: WalletFamily, address: unknown): string | null {
  const canonical = normalizeAddress(family, address);
  return canonical ? `${NAMESPACE[family]}:${canonical}` : null;
}

/** Reads a chain-agnostic CAIP-10 value back; null unless it is valid and canonical. */
export function parseCaip10(
  value: unknown,
): { family: WalletFamily; address: string } | null {
  if (typeof value !== "string") return null;
  const colon = value.indexOf(":");
  if (colon < 1) return null;
  const family = FAMILY_BY_NAMESPACE[value.slice(0, colon)];
  if (!family) return null;
  const address = value.slice(colon + 1);
  const canonical = normalizeAddress(family, address);
  return canonical === address ? { family, address } : null;
}

/** The one email spelling for identity lookups: trimmed, lowercased; null unless plausible. */
export function normalizeEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) && trimmed.length <= 320 ? trimmed : null;
}
