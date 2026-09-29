import { createHmac, timingSafeEqual } from "node:crypto";
import { suppress, type SuppressionReason } from "@/lib/server/email/store";

/**
 * Resend's delivery webhooks, signed the svix way: the signature is an
 * HMAC SHA-256 over `${svix-id}.${svix-timestamp}.${raw body}`, keyed with
 * the base64 part of the `whsec_` secret, and `svix-signature` lists one
 * or more `v1,<base64>` values (several while a secret rotates). A
 * timestamp more than five minutes off is refused, so a captured request
 * cannot be replayed later.
 *
 * Berth listens for three events and ignores the rest (it tracks no opens
 * or clicks): a permanent bounce, a complaint, and Resend's own
 * suppression. Each marks the address undeliverable, and every send checks
 * that list first.
 */

export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export function verifyWebhook(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  now: Date = new Date(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(Math.floor(now.getTime() / 1000) - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

type ResendEvent = {
  type?: unknown;
  data?: { email_id?: unknown; to?: unknown; bounce?: { type?: unknown } };
};

/** What an event asks of the suppression list, or null for an event Berth ignores. */
export function suppressionFor(event: ResendEvent): { addresses: string[]; reason: SuppressionReason; providerId: string | null } | null {
  const data = event.data ?? {};
  const addresses = (Array.isArray(data.to) ? data.to : [data.to]).filter((value): value is string => typeof value === "string");
  const providerId = typeof data.email_id === "string" ? data.email_id : null;
  if (addresses.length === 0) return null;
  if (event.type === "email.complained") return { addresses, reason: "complaint", providerId };
  if (event.type === "email.suppressed") return { addresses, reason: "suppressed", providerId };
  if (event.type === "email.bounced") {
    // Only a permanent bounce: a full mailbox or a greylist tries again.
    const kind = typeof data.bounce?.type === "string" ? data.bounce.type.toLowerCase() : "permanent";
    return kind === "permanent" ? { addresses, reason: "bounce", providerId } : null;
  }
  return null;
}

export async function applyWebhookEvent(event: ResendEvent): Promise<"suppressed" | "ignored"> {
  const action = suppressionFor(event);
  if (!action) return "ignored";
  for (const address of action.addresses) await suppress(address, action.reason, action.providerId);
  return "suppressed";
}
