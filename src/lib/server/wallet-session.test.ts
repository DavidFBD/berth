import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  issueNonceToken,
  issueWalletSession,
  readNonceToken,
  verifyWalletSession,
} from "./wallet-session";

const ADDRESS = "0xF4B759cf4fD5af5C0f2A40F74823f09743959399";

let priorSecret: string | undefined;

beforeAll(() => {
  priorSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-secret-keep-the-kettle-warm";
});

afterAll(() => {
  process.env.SESSION_SECRET = priorSecret;
});

describe("wallet session tokens", () => {
  it("round-trips a session and lowercases the address", async () => {
    const token = await issueWalletSession(ADDRESS);
    expect(await verifyWalletSession(token)).toBe(ADDRESS.toLowerCase());
  });

  it("round-trips a nonce", async () => {
    const token = await issueNonceToken("abc123");
    expect(await readNonceToken(token)).toBe("abc123");
  });

  it("never lets one token kind impersonate the other", async () => {
    const nonce = await issueNonceToken("abc123");
    const session = await issueWalletSession(ADDRESS);
    expect(await verifyWalletSession(nonce)).toBeNull();
    expect(await readNonceToken(session)).toBeNull();
  });

  it("rejects tampered tokens", async () => {
    const token = await issueWalletSession(ADDRESS);
    expect(await verifyWalletSession(`${token}x`)).toBeNull();
    expect(await verifyWalletSession("not-a-jwt")).toBeNull();
  });
});
