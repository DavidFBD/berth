import { describe, expect, it } from "vitest";
import { analyticsIdFor, analyticsIdOf } from "./analytics-id";

const SALT = "a-test-salt-of-sixteen-plus";

describe("the analytics name for an account", () => {
  it("is a stable keyed hash, never the id", () => {
    const id = analyticsIdFor("user-123", SALT)!;
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).not.toContain("user-123");
    expect(analyticsIdFor("user-123", SALT)).toBe(id);
    expect(analyticsIdFor("user-124", SALT)).not.toBe(id);
  });

  it("changes with the salt", () => {
    expect(analyticsIdFor("user-123", SALT)).not.toBe(analyticsIdFor("user-123", `${SALT}x`));
  });

  it("is nothing without a proper salt", () => {
    expect(analyticsIdFor("user-123", undefined)).toBeNull();
    expect(analyticsIdFor("user-123", "short")).toBeNull();
    expect(analyticsIdFor("", SALT)).toBeNull();
  });
});

describe("asking for the name", () => {
  const found = async () => ({ id: "user-123" });

  it("answers the caller's existing account, keyed by its verified identity", async () => {
    const keys: string[] = [];
    const answer = await analyticsIdOf(
      { did: "did:privy:abc", wallet: "0xabc" },
      { allowed: async (key) => (keys.push(key), true), lookup: found, salt: SALT },
    );
    expect(answer).toEqual({ ok: true, id: analyticsIdFor("user-123", SALT) });
    expect(keys).toEqual(["did:privy:abc"]);
  });

  it("never creates an account: an identity without one stays anonymous", async () => {
    const answer = await analyticsIdOf({ did: null, wallet: "0xabc" }, { allowed: async () => true, lookup: async () => undefined, salt: SALT });
    expect(answer).toEqual({ ok: true, id: null });
  });

  it("refuses past the hourly limit, before looking anyone up", async () => {
    let looked = false;
    const answer = await analyticsIdOf(
      { did: "did:privy:abc", wallet: null },
      { allowed: async () => false, lookup: async () => ((looked = true), { id: "x" }), salt: SALT },
    );
    expect(answer).toEqual({ ok: false, status: 429 });
    expect(looked).toBe(false);
  });
});
