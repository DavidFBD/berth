import { describe, expect, it, vi } from "vitest";
import { backfillInsert, homeWalletValue, planIdentityBackfill, type BackfillUser } from "./identities";

const A = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const B = `0x${"b".repeat(40)}`;
const user = (id: string, patch: Partial<BackfillUser>): BackfillUser => ({
  id,
  privy_did: null,
  wallet_address: null,
  email: null,
  ...patch,
});

describe("homeWalletValue", () => {
  it("is the lowercase eip155 value for an EVM address, null otherwise", () => {
    expect(homeWalletValue(A)).toBe(`eip155:${A.toLowerCase()}`);
    expect(homeWalletValue("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBeNull();
    expect(homeWalletValue(null)).toBeNull();
  });
});

describe("planIdentityBackfill", () => {
  it("gives each row a primary email and a home EVM wallet, proof legacy, verification time unknown (null)", () => {
    const plan = planIdentityBackfill(
      [user("u1", { privy_did: "did:privy:1", email: " Ada@Example.com", wallet_address: A.toLowerCase() }), user("u2", { wallet_address: B })],
      [],
    );
    expect(plan.conflicts).toEqual([]);
    expect(plan.rows).toEqual([
      { user_id: "u1", kind: "email", value: "ada@example.com", family: null, is_primary: true, is_home: false, verified_at: null, proof: "legacy" },
      { user_id: "u1", kind: "wallet", value: `eip155:${A.toLowerCase()}`, family: "evm", is_primary: false, is_home: true, verified_at: null, proof: "legacy" },
      { user_id: "u2", kind: "wallet", value: `eip155:${B}`, family: "evm", is_primary: false, is_home: true, verified_at: null, proof: "legacy" },
    ]);
  });

  it("skips retired rows and wallets that are not EVM", () => {
    const plan = planIdentityBackfill(
      [
        user("u1", { privy_did: "retired:did:privy:1", email: "x@example.com" }),
        user("u2", { wallet_address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }),
      ],
      [],
    );
    expect(plan.rows).toEqual([]);
    expect(plan.skipped).toEqual({ retired: 1, walletNotEvm: 1, emailInvalid: 0 });
  });

  it("reports an identifier two users claim once normalised, and writes neither", () => {
    const plan = planIdentityBackfill(
      [user("u2", { email: "Ada@example.com" }), user("u1", { email: "ada@EXAMPLE.com", wallet_address: B })],
      [],
    );
    expect(plan.conflicts).toEqual([{ kind: "email", userIds: ["u1", "u2"] }]);
    expect(plan.rows.map((row) => row.kind)).toEqual(["wallet"]);
  });

  it("is idempotent: rows already recorded for the same user are left be, another owner is a conflict", () => {
    const users = [user("u1", { email: "a@example.com", wallet_address: B })];
    const plan = planIdentityBackfill(users, [
      { kind: "email", value: "a@example.com", user_id: "u1" },
      { kind: "wallet", value: `eip155:${B}`, user_id: "u9" },
    ]);
    expect(plan.rows).toEqual([]);
    expect(plan.alreadyRecorded).toBe(1);
    expect(plan.conflicts).toEqual([{ kind: "wallet", userIds: ["u1", "u9"] }]);
  });
});

describe("backfillInsert", () => {
  it("numbers eight parameters per row and ends in on conflict do nothing", () => {
    const { rows } = planIdentityBackfill([user("u1", { email: "a@example.com", wallet_address: B })], []);
    const { text, params } = backfillInsert(rows);
    expect(params).toHaveLength(16);
    expect(text).toContain("$16::text");
    expect(text).toContain("on conflict do nothing");
  });
});

describe("accountEvmAddresses when the table cannot be read", () => {
  it("stands users.wallet_address in for other callers, and throws for one that asks to fail closed", async () => {
    const { setSqlClient } = await import("./db");
    const { accountEvmAddresses } = await import("./identities");
    setSqlClient({
      query: async () => {
        throw new Error("db down");
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await accountEvmAddresses("u1", A)).toEqual({ home: A.toLowerCase(), all: [A.toLowerCase()] });
      await expect(accountEvmAddresses("u1", A, { failClosed: true })).rejects.toThrow("db down");
    } finally {
      setSqlClient(null);
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
