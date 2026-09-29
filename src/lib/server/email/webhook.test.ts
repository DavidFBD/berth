import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { suppressionFor, verifyWebhook, WEBHOOK_TOLERANCE_SECONDS } from "./webhook";

const rawKey = Buffer.from("berth-webhook-test-key-32-bytes!!");
const secret = `whsec_${rawKey.toString("base64")}`;
const now = new Date("2026-09-29T10:00:00Z");
const timestamp = String(Math.floor(now.getTime() / 1000));
const body = JSON.stringify({ type: "email.bounced", data: { email_id: "re_1", to: ["gone@example.com"], bounce: { type: "Permanent" } } });

function sign(id: string, ts: string, payload: string, key: Buffer = rawKey): string {
  return `v1,${createHmac("sha256", key).update(`${id}.${ts}.${payload}`).digest("base64")}`;
}

describe("verifyWebhook", () => {
  it("accepts a signature made with the secret", () => {
    expect(verifyWebhook(secret, { id: "msg_1", timestamp, signature: sign("msg_1", timestamp, body) }, body, now)).toBe(true);
  });

  it("accepts any one of several signatures, as while a secret rotates", () => {
    const signature = `${sign("msg_1", timestamp, body, Buffer.from("old key"))} ${sign("msg_1", timestamp, body)}`;
    expect(verifyWebhook(secret, { id: "msg_1", timestamp, signature }, body, now)).toBe(true);
  });

  it("refuses a changed body, id or timestamp", () => {
    const signature = sign("msg_1", timestamp, body);
    expect(verifyWebhook(secret, { id: "msg_1", timestamp, signature }, body.replace("gone", "kept"), now)).toBe(false);
    expect(verifyWebhook(secret, { id: "msg_2", timestamp, signature }, body, now)).toBe(false);
    expect(verifyWebhook(secret, { id: "msg_1", timestamp: String(Number(timestamp) + 1), signature }, body, now)).toBe(false);
  });

  it("refuses another key, a missing header and an unknown version", () => {
    expect(verifyWebhook(secret, { id: "msg_1", timestamp, signature: sign("msg_1", timestamp, body, Buffer.from("other")) }, body, now)).toBe(false);
    expect(verifyWebhook(secret, { id: null, timestamp, signature: sign("msg_1", timestamp, body) }, body, now)).toBe(false);
    expect(verifyWebhook(secret, { id: "msg_1", timestamp, signature: sign("msg_1", timestamp, body).replace("v1,", "v2,") }, body, now)).toBe(false);
  });

  it("refuses a replay from outside the tolerance", () => {
    const old = String(Number(timestamp) - WEBHOOK_TOLERANCE_SECONDS - 1);
    expect(verifyWebhook(secret, { id: "msg_1", timestamp: old, signature: sign("msg_1", old, body) }, body, now)).toBe(false);
  });
});

describe("suppressionFor", () => {
  it("suppresses on a permanent bounce, a complaint and Resend's own suppression", () => {
    expect(suppressionFor(JSON.parse(body))).toEqual({ addresses: ["gone@example.com"], reason: "bounce", providerId: "re_1" });
    expect(suppressionFor({ type: "email.complained", data: { to: ["angry@example.com"] } })?.reason).toBe("complaint");
    expect(suppressionFor({ type: "email.suppressed", data: { to: ["x@example.com"] } })?.reason).toBe("suppressed");
  });

  it("ignores a transient bounce and every other event", () => {
    expect(suppressionFor({ type: "email.bounced", data: { to: ["full@example.com"], bounce: { type: "Transient" } } })).toBeNull();
    for (const type of ["email.sent", "email.delivered", "email.opened", "email.clicked", "contact.created"]) {
      expect(suppressionFor({ type, data: { to: ["a@example.com"] } })).toBeNull();
    }
    expect(suppressionFor({ type: "email.complained", data: {} })).toBeNull();
  });
});
