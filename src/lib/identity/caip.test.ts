import { describe, expect, it } from "vitest";
import {
  detectFamily,
  isValidAddress,
  normalizeAddress,
  normalizeEmail,
  parseCaip10,
  toCaip10,
} from "./caip";

// Real addresses: Vitalik's EOA (EIP-55), the USDC mint and the SPL token
// program on Solana, BIP-173/BIP-350 vectors and well-known base58 addresses
// on Bitcoin.
const EVM_CHECKSUMMED = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const EVM_LOWER = EVM_CHECKSUMMED.toLowerCase();
const EVM_BAD_CHECKSUM = "0xd8Da6BF26964aF9D7eEd9e03E53415D37aA96045";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
// Differs from USDC_MINT only in the case of one letter, and is itself a
// valid 32 byte key: a different account.
const USDC_MINT_CASE_TWIN = "EpjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_PROGRAM_CASE_TWIN = "tokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const BTC_P2WPKH = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const BTC_TAPROOT = "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0";
const BTC_P2PKH = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
const BTC_P2SH = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";
const BTC_TESTNET = "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn";

describe("normalizeAddress: evm", () => {
  it("lowercases, so checksummed and lowercase spellings are one address", () => {
    expect(normalizeAddress("evm", EVM_CHECKSUMMED)).toBe(EVM_LOWER);
    expect(normalizeAddress("evm", EVM_LOWER)).toBe(EVM_LOWER);
    expect(normalizeAddress("evm", ` ${EVM_CHECKSUMMED.toUpperCase().replace("0X", "0x")} `)).toBe(EVM_LOWER);
  });

  it("rejects mixed case with a broken EIP-55 checksum, and non addresses", () => {
    expect(normalizeAddress("evm", EVM_BAD_CHECKSUM)).toBeNull();
    expect(normalizeAddress("evm", EVM_LOWER.slice(0, 41))).toBeNull();
    expect(normalizeAddress("evm", USDC_MINT)).toBeNull();
    expect(normalizeAddress("evm", 42)).toBeNull();
  });
});

describe("normalizeAddress: solana", () => {
  it("keeps the case exactly", () => {
    expect(normalizeAddress("solana", USDC_MINT)).toBe(USDC_MINT);
    expect(normalizeAddress("solana", ` ${TOKEN_PROGRAM}\n`)).toBe(TOKEN_PROGRAM);
  });

  it("treats addresses that differ only in case as two different keys", () => {
    expect(normalizeAddress("solana", USDC_MINT_CASE_TWIN)).toBe(USDC_MINT_CASE_TWIN);
    expect(normalizeAddress("solana", USDC_MINT_CASE_TWIN)).not.toBe(normalizeAddress("solana", USDC_MINT));
    expect(toCaip10("solana", TOKEN_PROGRAM_CASE_TWIN)).not.toBe(toCaip10("solana", TOKEN_PROGRAM));
  });

  it("rejects non base58 and keys that are not 32 bytes", () => {
    expect(normalizeAddress("solana", USDC_MINT.replace("E", "0"))).toBeNull(); // 0 is not base58
    expect(normalizeAddress("solana", USDC_MINT.toLowerCase())).toBeNull(); // decodes past 32 bytes
    expect(normalizeAddress("solana", EVM_LOWER)).toBeNull();
    expect(normalizeAddress("solana", BTC_P2PKH)).toBeNull();
  });
});

describe("normalizeAddress: bitcoin", () => {
  it("lowercases bech32 and bech32m, which are case-insensitive but never mixed", () => {
    expect(normalizeAddress("bitcoin", BTC_P2WPKH.toUpperCase())).toBe(BTC_P2WPKH);
    expect(normalizeAddress("bitcoin", BTC_TAPROOT)).toBe(BTC_TAPROOT);
    expect(normalizeAddress("bitcoin", "bc1Qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).toBeNull();
  });

  it("checks the bech32 checksum and the version's constant", () => {
    expect(normalizeAddress("bitcoin", BTC_P2WPKH.replace(/4$/, "5"))).toBeNull();
    // A truncated v1 program fails its checksum.
    expect(normalizeAddress("bitcoin", "bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kt5nd6y")).toBeNull();
  });

  it("leaves base58check exactly as is and verifies its checksum", () => {
    expect(normalizeAddress("bitcoin", BTC_P2PKH)).toBe(BTC_P2PKH);
    expect(normalizeAddress("bitcoin", BTC_P2SH)).toBe(BTC_P2SH);
    expect(normalizeAddress("bitcoin", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVn2")).toBeNull();
  });

  it("refuses testnet and regtest, bech32 and base58 alike", () => {
    // BIP-173 testnet vector, a regtest address, and a valid testnet P2PKH.
    expect(normalizeAddress("bitcoin", "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx")).toBeNull();
    expect(normalizeAddress("bitcoin", "bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080")).toBeNull();
    expect(normalizeAddress("bitcoin", BTC_TESTNET)).toBeNull();
    expect(detectFamily(BTC_TESTNET)).not.toBe("bitcoin");
  });
});

describe("detectFamily", () => {
  it("tells the families apart by shape and checksum", () => {
    expect(detectFamily(EVM_CHECKSUMMED)).toBe("evm");
    expect(detectFamily(USDC_MINT)).toBe("solana");
    expect(detectFamily(BTC_P2WPKH)).toBe("bitcoin");
    expect(detectFamily(BTC_P2PKH)).toBe("bitcoin");
    expect(detectFamily("0xguestwallet00000000")).toBeNull();
    expect(detectFamily(null)).toBeNull();
  });
});

describe("toCaip10 / parseCaip10", () => {
  it("writes the chain-agnostic namespace:address form, canonical", () => {
    expect(toCaip10("evm", EVM_CHECKSUMMED)).toBe(`eip155:${EVM_LOWER}`);
    expect(toCaip10("solana", USDC_MINT)).toBe(`solana:${USDC_MINT}`);
    expect(toCaip10("bitcoin", BTC_P2WPKH.toUpperCase())).toBe(`bip122:${BTC_P2WPKH}`);
    expect(toCaip10("evm", USDC_MINT)).toBeNull();
  });

  it("round-trips, and refuses values that are not canonical", () => {
    for (const [family, address] of [
      ["evm", EVM_LOWER],
      ["solana", USDC_MINT_CASE_TWIN],
      ["bitcoin", BTC_P2SH],
    ] as const) {
      expect(parseCaip10(toCaip10(family, address))).toEqual({ family, address });
    }
    expect(parseCaip10(`eip155:${EVM_CHECKSUMMED}`)).toBeNull();
    expect(parseCaip10(`bip122:${BTC_P2WPKH.toUpperCase()}`)).toBeNull();
    expect(parseCaip10(`eip155:8453:${EVM_LOWER}`)).toBeNull();
    expect(parseCaip10(`cosmos:${EVM_LOWER}`)).toBeNull();
    expect(parseCaip10(EVM_LOWER)).toBeNull();
  });

  it("isValidAddress agrees with normalizeAddress", () => {
    expect(isValidAddress("evm", EVM_CHECKSUMMED)).toBe(true);
    expect(isValidAddress("solana", EVM_CHECKSUMMED)).toBe(false);
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases, and refuses what is not an address", () => {
    expect(normalizeEmail("  Ada.Lovelace@Example.COM ")).toBe("ada.lovelace@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});
