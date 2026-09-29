import { describe, expect, it } from "vitest";
import { createSiwbMessage, parseSiwbMessage, type SiwbFields } from "@/lib/siwb";
import { createSiwsMessage, parseSiwsMessage } from "@/lib/siws";
import { verifySiwb } from "@/lib/server/siwb";
import { bitcoinKey } from "@/lib/server/bitcoin-test-key";

const fieldsFor = (address: string, overrides: Partial<SiwbFields> = {}): SiwbFields => ({
  domain: "www.berthmarkets.com",
  address,
  statement: "Add this wallet to your Berth account. Signing is free and moves nothing.",
  uri: "https://www.berthmarkets.com",
  version: "1",
  chainId: "mainnet",
  nonce: "abc123def456",
  issuedAt: "2026-09-29T10:00:00.000Z",
  resources: [`urn:berth:link:bip122:${address}`],
  ...overrides,
});

describe("SIWB messages", () => {
  it("parse back exactly what was written, and are never read as SIWS", () => {
    const fields = fieldsFor(bitcoinKey("p2wpkh").address);
    const message = createSiwbMessage(fields);
    expect(message.split("\n")[0]).toBe("www.berthmarkets.com wants you to sign in with your Bitcoin account:");
    expect(parseSiwbMessage(message)).toEqual(fields);
    expect(parseSiwsMessage(message)).toBeNull();
    expect(parseSiwbMessage(createSiwsMessage(fields))).toBeNull();
    expect(parseSiwbMessage(`${message}\n`)).toBeNull();
  });
});

describe("verifySiwb", () => {
  for (const type of ["p2wpkh", "p2tr", "p2sh", "p2pkh"] as const) {
    it(`${type}: accepts a message made for Berth, signed by the address, over the nonce`, async () => {
      const key = bitcoinKey(type);
      const message = createSiwbMessage(fieldsFor(key.address));
      expect(await verifySiwb({ message, signature: key.sign(message), nonce: "abc123def456" })).toBe(key.address);
    });
  }

  it("refuses another host, a uri off the domain, another nonce, another chain", async () => {
    const key = bitcoinKey("p2tr");
    for (const overrides of [
      { domain: "evil.example", uri: "https://evil.example" },
      { uri: "https://evil.example" },
      { domain: "berthmarkets.com.evil.example", uri: "https://berthmarkets.com.evil.example" },
      { chainId: "testnet" },
    ]) {
      const message = createSiwbMessage(fieldsFor(key.address, overrides));
      expect(await verifySiwb({ message, signature: key.sign(message), nonce: "abc123def456" })).toBeNull();
    }
    const message = createSiwbMessage(fieldsFor(key.address));
    expect(await verifySiwb({ message, signature: key.sign(message), nonce: "someothernonce" })).toBeNull();
  });

  it("refuses a signature by another key, or a message naming another address", async () => {
    const key = bitcoinKey("p2wpkh");
    const other = bitcoinKey("p2wpkh");
    const message = createSiwbMessage(fieldsFor(key.address));
    expect(await verifySiwb({ message, signature: other.sign(message), nonce: "abc123def456" })).toBeNull();
    const claimed = createSiwbMessage(fieldsFor(other.address));
    expect(await verifySiwb({ message: claimed, signature: key.sign(claimed), nonce: "abc123def456" })).toBeNull();
  });

  it("refuses an uppercase bech32 address: the message must carry the canonical spelling", async () => {
    const key = bitcoinKey("p2wpkh");
    const message = createSiwbMessage(fieldsFor(key.address.toUpperCase()));
    expect(await verifySiwb({ message, signature: key.sign(message), nonce: "abc123def456" })).toBeNull();
  });
});
