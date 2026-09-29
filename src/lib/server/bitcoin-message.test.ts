import { describe, expect, it } from "vitest";
import { bip322MessageHash, bitcoinAddressType, verifyBitcoinMessage, type BitcoinAddressType } from "@/lib/server/bitcoin-message";
import { bitcoinKey } from "@/lib/server/bitcoin-test-key";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

/**
 * Signatures of "Hello World" by the key 0x22…22, made by bip322-js 3.0.0
 * (its Signer) and bitcoinjs-message 2.2.0, an implementation independent
 * of the one under test.
 */
const BIP322_JS = {
  p2wpkh: "bc1q2vfxp232rx0z9rzn0hay9jptagk8c86d9w4l7k",
  p2sh: "3QZuaDSyPfKgYuWms26ptUauXnFKH2J8uc",
  p2pkh: "18aF6pYXKDSXjXHpidt2G6okdVdBr8zA7z",
  p2tr: "bc1pvf8l7evgsrnvjsh0e3f8622e0utw2asn0wyt8un8432xshzltqksea2dzr",
  sig: {
    p2wpkh: "AkcwRAIgEOmX/kfU9AsiQ88O4lOTSvJRKlz316sZibZ3E+wMyEcCIB3ybQ9tPKzuIQIprqTldu8/eghncKQxRspDU2ZL6zaHASECRm1/yuVj5csJoNGHC7WANEgEYXh5oUlJzyIoXxuuPyc=",
    p2tr: "AUHo76OlepPECVtNJCaXR2MYt9hRLZCc8iYxGTVMXvWPOKOBDxItDOdDjOthOWSPowelpOTICeoqEQWV7BDN7y9uAQ==",
    p2shWitness: "AkcwRAIgYFT5OOZ8iMzENuue5NVpnY9iA2QlchcL/WS2Yqa0mqsCIDC7XKs+hZnmblTBygdSzN+a3XKqbPuVfUntHKEl6OG0ASECRm1/yuVj5csJoNGHC7WANEgEYXh5oUlJzyIoXxuuPyc=",
    /** Header 31: the compressed P2PKH hint, which Unisat writes for every address. */
    bip137P2pkh: "H/AE0Twn6WOmloxM4Lvl60kDEAcQQQAr2c+jnAGWNDt6OvUV6/Y7o6SfYtn8PgkAqCugLuTjVR8R7EYzg7Srmpc=",
    bip137P2sh: "I/AE0Twn6WOmloxM4Lvl60kDEAcQQQAr2c+jnAGWNDt6OvUV6/Y7o6SfYtn8PgkAqCugLuTjVR8R7EYzg7Srmpc=",
    bip137P2wpkh: "J/AE0Twn6WOmloxM4Lvl60kDEAcQQQAr2c+jnAGWNDt6OvUV6/Y7o6SfYtn8PgkAqCugLuTjVR8R7EYzg7Srmpc=",
  },
};

const TYPES: BitcoinAddressType[] = ["p2wpkh", "p2tr", "p2sh", "p2pkh"];

describe("BIP-322 test vectors (the BIP's own)", () => {
  it("hashes messages as the BIP says", () => {
    expect(hex(bip322MessageHash(""))).toBe("c90c269c4f8fcbe6880f72a721ddfbf1914268a794cbb21cfafee13770ae19f1");
    expect(hex(bip322MessageHash("Hello World"))).toBe("f0eb03b1a75ac6d9847f55c624a99169b5dccba2a31f5b23bea77ba270de0a7a");
  });

  it("accepts the BIP's P2WPKH signature of Hello World", () => {
    const signature =
      "AkcwRAIgZRfIY3p7/DoVTty6YZbWS71bc5Vct9p9Fia83eRmw2QCICK/ENGfwLtptFluMGs2KsqoNSk89pO7F29zJLUx9a/sASECx/EgAxlkQpQ9hYjgGu6EBCPMVPwVIVJqO4XCsMvViHI=";
    expect(verifyBitcoinMessage("bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l", "Hello World", signature)).toBe(true);
    expect(verifyBitcoinMessage("bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l", "Hello World.", signature)).toBe(false);
  });
});

describe("signatures made by bip322-js and bitcoinjs-message", () => {
  it("accept BIP-322 simple for bc1q, bc1p and 3…", () => {
    expect(verifyBitcoinMessage(BIP322_JS.p2wpkh, "Hello World", BIP322_JS.sig.p2wpkh)).toBe(true);
    expect(verifyBitcoinMessage(BIP322_JS.p2tr, "Hello World", BIP322_JS.sig.p2tr)).toBe(true);
    expect(verifyBitcoinMessage(BIP322_JS.p2sh, "Hello World", BIP322_JS.sig.p2shWitness)).toBe(true);
  });

  it("accept BIP-137 for 1…, 3… and bc1q, whatever address hint the header carries", () => {
    expect(verifyBitcoinMessage(BIP322_JS.p2pkh, "Hello World", BIP322_JS.sig.bip137P2pkh)).toBe(true);
    expect(verifyBitcoinMessage(BIP322_JS.p2sh, "Hello World", BIP322_JS.sig.bip137P2sh)).toBe(true);
    expect(verifyBitcoinMessage(BIP322_JS.p2sh, "Hello World", BIP322_JS.sig.bip137P2pkh)).toBe(true);
    expect(verifyBitcoinMessage(BIP322_JS.p2wpkh, "Hello World", BIP322_JS.sig.bip137P2wpkh)).toBe(true);
  });

  it("refuse BIP-137 for taproot: out of spec, and it would not bind the tweaked key", () => {
    expect(verifyBitcoinMessage(BIP322_JS.p2tr, "Hello World", BIP322_JS.sig.bip137P2pkh)).toBe(false);
  });

  it("refuse a signature over another message, or for the same key's other address", () => {
    expect(verifyBitcoinMessage(BIP322_JS.p2wpkh, "Hello World!", BIP322_JS.sig.p2wpkh)).toBe(false);
    expect(verifyBitcoinMessage(BIP322_JS.p2tr, "hello world", BIP322_JS.sig.p2tr)).toBe(false);
    expect(verifyBitcoinMessage(BIP322_JS.p2pkh, "Hello World", BIP322_JS.sig.p2wpkh)).toBe(false);
    expect(verifyBitcoinMessage(BIP322_JS.p2sh, "Hello World", BIP322_JS.sig.p2wpkh)).toBe(false);
  });
});

describe("verifyBitcoinMessage with fresh keys", () => {
  for (const type of TYPES) {
    it(`${type}: accepts the key's own signature, refuses another key's`, () => {
      const key = bitcoinKey(type);
      const other = bitcoinKey(type);
      expect(bitcoinAddressType(key.address)).toBe(type);
      const message = "Add this wallet to your Berth account.";
      expect(verifyBitcoinMessage(key.address, message, key.sign(message))).toBe(true);
      expect(verifyBitcoinMessage(key.address, message, other.sign(message))).toBe(false);
      expect(verifyBitcoinMessage(other.address, message, key.sign(message))).toBe(false);
      expect(verifyBitcoinMessage(key.address, `${message} `, key.sign(message))).toBe(false);
    });
  }

  it("refuses a tampered signature", () => {
    for (const type of TYPES) {
      const key = bitcoinKey(type);
      const bytes = Buffer.from(key.sign("m"), "base64");
      bytes[bytes.length - 8] ^= 1;
      expect(verifyBitcoinMessage(key.address, "m", bytes.toString("base64"))).toBe(false);
    }
  });

  it("refuses a taproot signature with a sighash type other than default or all", () => {
    const key = bitcoinKey("p2tr");
    const bytes = Buffer.from(key.sign("m"), "base64");
    // one 64 byte item: add a sighash byte 0x02 (NONE).
    const withNone = Buffer.concat([Buffer.from([1, 65]), bytes.subarray(2), Buffer.from([2])]);
    expect(verifyBitcoinMessage(key.address, "m", withNone.toString("base64"))).toBe(false);
  });

  it("refuses junk, empty, hex and non-canonical input without throwing", () => {
    const key = bitcoinKey("p2wpkh");
    const sig = key.sign("m");
    expect(verifyBitcoinMessage(key.address, "m", "")).toBe(false);
    expect(verifyBitcoinMessage(key.address, "m", "!!!!")).toBe(false);
    expect(verifyBitcoinMessage(key.address, "m", Buffer.from(sig, "base64").toString("hex"))).toBe(false);
    expect(verifyBitcoinMessage(key.address.toUpperCase(), "m", sig)).toBe(false);
    expect(verifyBitcoinMessage(` ${key.address}`, "m", sig)).toBe(false);
    expect(verifyBitcoinMessage(key.address, "m", `${sig}AAAA`)).toBe(false);
  });
});

describe("bitcoinAddressType", () => {
  it("names the single-key types Berth can prove, mainnet only", () => {
    expect(bitcoinAddressType(BIP322_JS.p2wpkh)).toBe("p2wpkh");
    expect(bitcoinAddressType(BIP322_JS.p2tr)).toBe("p2tr");
    expect(bitcoinAddressType(BIP322_JS.p2sh)).toBe("p2sh");
    expect(bitcoinAddressType(BIP322_JS.p2pkh)).toBe("p2pkh");
    // P2WSH (a script, not a key), testnet, and junk are never provable.
    expect(bitcoinAddressType("bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3")).toBeNull();
    expect(bitcoinAddressType("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx")).toBeNull();
    expect(bitcoinAddressType("not an address")).toBeNull();
  });
});
