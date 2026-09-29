import { describe, expect, it } from "vitest";
import { base58Decode, base58Encode } from "@/lib/identity/caip";
import { createSiwsMessage, parseSiwsMessage, type SiwsFields } from "@/lib/siws";
import { ed25519KeyUsable, ed25519Valid, verifySiws } from "@/lib/server/siws";
import { solanaKey } from "@/lib/server/solana-test-key";

const fieldsFor = (address: string, overrides: Partial<SiwsFields> = {}): SiwsFields => ({
  domain: "www.berthmarkets.com",
  address,
  statement: "Add this wallet to your Berth account. Signing is free and moves nothing.",
  uri: "https://www.berthmarkets.com",
  version: "1",
  chainId: "mainnet",
  nonce: "abc123def456",
  issuedAt: "2026-09-29T10:00:00.000Z",
  resources: [`urn:berth:link:solana:${address}`],
  ...overrides,
});

describe("base58", () => {
  it("round trips bytes, leading zeros included", () => {
    for (const bytes of [new Uint8Array([0, 0, 1, 2, 255]), new Uint8Array(32).fill(7), new Uint8Array([0])]) {
      expect(Array.from(base58Decode(base58Encode(bytes))!)).toEqual(Array.from(bytes));
    }
  });
});

describe("SIWS messages", () => {
  it("parse back exactly what was written", () => {
    const key = solanaKey();
    const fields = fieldsFor(key.address);
    expect(parseSiwsMessage(createSiwsMessage(fields))).toEqual(fields);
  });

  it("refuse anything written differently", () => {
    const message = createSiwsMessage(fieldsFor(solanaKey().address));
    expect(parseSiwsMessage(`${message}\n`)).toBeNull();
    expect(parseSiwsMessage(message.replace("Solana account", "Ethereum account"))).toBeNull();
    expect(parseSiwsMessage(message.replace("Version: 1", "Version: 2"))).toBeNull();
    expect(parseSiwsMessage(`${message}\n- urn:berth:link:solana:other`)).not.toBeNull(); // parses, but two resources
  });
});

describe("verifySiws", () => {
  it("accepts a message made for Berth, signed by the address, over the nonce", async () => {
    const key = solanaKey();
    const message = createSiwsMessage(fieldsFor(key.address));
    expect(await verifySiws({ message, signature: key.sign(message), nonce: "abc123def456" })).toBe(key.address);
  });

  it("refuses another host, or a uri off the domain", async () => {
    const key = solanaKey();
    for (const overrides of [
      { domain: "evil.example", uri: "https://evil.example" },
      { uri: "https://evil.example" },
      { domain: "berthmarkets.com.evil.example", uri: "https://berthmarkets.com.evil.example" },
    ]) {
      const message = createSiwsMessage(fieldsFor(key.address, overrides));
      expect(await verifySiws({ message, signature: key.sign(message), nonce: "abc123def456" })).toBeNull();
    }
  });

  it("refuses another nonce, or another chain", async () => {
    const key = solanaKey();
    const message = createSiwsMessage(fieldsFor(key.address));
    expect(await verifySiws({ message, signature: key.sign(message), nonce: "someothernonce" })).toBeNull();
    const devnet = createSiwsMessage(fieldsFor(key.address, { chainId: "devnet" }));
    expect(await verifySiws({ message: devnet, signature: key.sign(devnet), nonce: "abc123def456" })).toBeNull();
  });

  it("refuses a signature by another key, or a message naming another address", async () => {
    const key = solanaKey();
    const other = solanaKey();
    const message = createSiwsMessage(fieldsFor(key.address));
    expect(await verifySiws({ message, signature: other.sign(message), nonce: "abc123def456" })).toBeNull();
    const claimed = createSiwsMessage(fieldsFor(other.address));
    expect(await verifySiws({ message: claimed, signature: key.sign(claimed), nonce: "abc123def456" })).toBeNull();
  });

  it("refuses a miscased address: base58 is case-sensitive", async () => {
    const key = solanaKey();
    const flipped = [...key.address].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join("");
    const message = createSiwsMessage(fieldsFor(flipped));
    expect(await verifySiws({ message, signature: key.sign(message), nonce: "abc123def456" })).toBeNull();
  });

  it("refuses a tampered message and malformed signatures", async () => {
    const key = solanaKey();
    const message = createSiwsMessage(fieldsFor(key.address));
    const signature = key.sign(message);
    expect(ed25519Valid(key.address, message.replace("free", "fee"), signature)).toBe(false);
    expect(ed25519Valid(key.address, message, "0x" + "00".repeat(64))).toBe(false);
    expect(ed25519Valid(key.address, message, signature.slice(0, -2))).toBe(false);
    expect(ed25519Valid(key.address, message, signature)).toBe(true);
  });

  it("refuses small-order keys: the identity with S = 0 would verify without any secret", async () => {
    const identity = new Uint8Array(32);
    identity[0] = 1;
    const address = base58Encode(identity);
    const message = createSiwsMessage(fieldsFor(address));
    // R = the identity, S = 0.
    const forged = new Uint8Array(64);
    forged[0] = 1;
    expect(ed25519Valid(address, message, base58Encode(forged))).toBe(false);
    expect(await verifySiws({ message, signature: base58Encode(forged), nonce: "abc123def456" })).toBeNull();
    for (const hex of [
      "0100000000000000000000000000000000000000000000000000000000000000",
      "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
      "0000000000000000000000000000000000000000000000000000000000000000",
      "0000000000000000000000000000000000000000000000000000000000000080",
      "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
      "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85",
      "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
      "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa",
      "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
    ]) {
      expect(ed25519KeyUsable(Uint8Array.from(Buffer.from(hex, "hex")))).toBe(false);
    }
    expect(ed25519KeyUsable(base58Decode(solanaKey().address)!)).toBe(true);
  });
});
