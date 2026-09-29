import { describe, expect, it } from "vitest";
import { issueUnsubscribeToken, readUnsubscribeToken, UNSUBSCRIBE_TTL_DAYS } from "./token";

const env = { EMAIL_TOKEN_SECRET: "test-secret-for-unsubscribe-links" } as unknown as NodeJS.ProcessEnv;
const userId = "5f0c6a0e-8b1d-4c1e-9d7e-2f3a4b5c6d7e";

describe("unsubscribe token", () => {
  it("round trips the account and the kind", async () => {
    const token = await issueUnsubscribeToken({ userId, kind: "orders" }, { env });
    expect(await readUnsubscribeToken(token, { env })).toEqual({ userId, kind: "orders" });
  });

  it("carries no readable id: the claims are sealed, not just signed", async () => {
    const token = await issueUnsubscribeToken({ userId, kind: "friends" }, { env });
    const decoded = token
      .split(".")
      .map((part) => Buffer.from(part, "base64url").toString("latin1"))
      .join(" ");
    expect(token).not.toContain(userId);
    expect(decoded).not.toContain(userId);
    expect(decoded).not.toContain("friends");
    // Safe in a URL as it is.
    expect(token).toMatch(/^[A-Za-z0-9_.-]+$/);
  });

  it("refuses an altered token", async () => {
    const token = await issueUnsubscribeToken({ userId, kind: "orders" }, { env });
    const parts = token.split(".");
    const cipher = parts[3];
    parts[3] = `${cipher[0] === "A" ? "B" : "A"}${cipher.slice(1)}`;
    expect(await readUnsubscribeToken(parts.join("."), { env })).toBeNull();
  });

  it("refuses a token sealed with another secret", async () => {
    const token = await issueUnsubscribeToken({ userId, kind: "orders" }, { env });
    expect(await readUnsubscribeToken(token, { env: { EMAIL_TOKEN_SECRET: "another" } as unknown as NodeJS.ProcessEnv })).toBeNull();
  });

  it("expires", async () => {
    const now = new Date("2026-09-29T10:00:00Z");
    const token = await issueUnsubscribeToken({ userId, kind: "orders" }, { env, now });
    const later = new Date(now.getTime() + (UNSUBSCRIBE_TTL_DAYS + 1) * 86_400_000);
    expect(await readUnsubscribeToken(token, { env, now: new Date(now.getTime() + 86_400_000) })).not.toBeNull();
    expect(await readUnsubscribeToken(token, { env, now: later })).toBeNull();
  });

  it("refuses junk", async () => {
    for (const junk of [undefined, null, "", "abc", "a.b.c.d.e", 42, "x".repeat(2000)]) {
      expect(await readUnsubscribeToken(junk, { env })).toBeNull();
    }
  });
});
