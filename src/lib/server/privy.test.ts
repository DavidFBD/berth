import { describe, expect, it } from "vitest";
import { pickAccountWallet, type PrivyLinkedAccount } from "./privy";

const embedded: PrivyLinkedAccount = {
  type: "wallet",
  chain_type: "ethereum",
  wallet_client_type: "privy",
  address: "0xAAAa0000000000000000000000000000000000AA",
};
const external: PrivyLinkedAccount = {
  type: "wallet",
  chain_type: "ethereum",
  wallet_client_type: "hana_wallet",
  address: "0xBe59D5bf40Ac4A349bD748E0d7c19eF27Ad3Ca23",
};
const solana: PrivyLinkedAccount = {
  type: "wallet",
  chain_type: "solana",
  wallet_client_type: "phantom",
  address: "ESWQm8aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4BDD",
};
const email: PrivyLinkedAccount = { type: "email", address: "a@b.c" };

/**
 * Which address a DID belongs to. This decides whether the claim path in
 * accounts.ts can find an existing row, so getting it wrong does not throw,
 * it silently hands somebody a brand new empty account. It did exactly that
 * to a real account on 2026-09-21.
 */
describe("pickAccountWallet", () => {
  it("prefers the embedded wallet, because that IS an email user's account", () => {
    // Order matters even when both exist: lib/account gives the money
    // account to the embedded address in email mode, and the rewards row
    // must name the same person.
    expect(pickAccountWallet([external, embedded])).toBe(
      embedded.address!.toLowerCase(),
    );
  });

  it("falls back to a linked external wallet, which is the SIWE case", () => {
    // The regression: a session created by signing with a wallet has no
    // embedded wallet at all, and returning null here orphaned the user.
    expect(pickAccountWallet([external])).toBe(external.address!.toLowerCase());
  });

  it("ignores accounts that are not EVM wallets", () => {
    expect(pickAccountWallet([email, solana])).toBeNull();
  });

  it("has nothing to say about a user with no wallet at all", () => {
    expect(pickAccountWallet([])).toBeNull();
    expect(pickAccountWallet([email])).toBeNull();
  });

  it("knows a newer embedded wallet by either of its other names", () => {
    const v2 = { ...embedded, wallet_client_type: "privy-v2" };
    const byConnector = { ...embedded, wallet_client_type: undefined, connector_type: "embedded" };
    expect(pickAccountWallet([external, v2])).toBe(embedded.address!.toLowerCase());
    expect(pickAccountWallet([external, byConnector])).toBe(embedded.address!.toLowerCase());
  });

  it("ignores a Solana embedded wallet when choosing the EVM account", () => {
    const solanaEmbedded = { ...solana, wallet_client_type: "privy" };
    expect(pickAccountWallet([solanaEmbedded, external])).toBe(external.address!.toLowerCase());
  });

  it("skips a wallet entry with no address", () => {
    const blank = { ...external, address: undefined };
    expect(pickAccountWallet([blank])).toBeNull();
  });
});
