/**
 * The one call Berth makes to Resend: POST /emails.
 *
 * Plain REST over fetch rather than the `resend` package: Berth sends one
 * kind of request, the call is injectable for tests without module mocks,
 * the Idempotency-Key header is a plain header, and the bundle gains no
 * client it does not need. Webhook signatures are checked by hand too
 * (webhook.ts), since svix's scheme is three lines of HMAC.
 */

export type OutgoingEmail = {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  /** The same key for the same event: Resend drops a repeat inside 24 hours. */
  idempotencyKey: string;
};

export type SendResult = { ok: true; id: string | null } | { ok: false; error: string };

export type EmailTransport = (email: OutgoingEmail) => Promise<SendResult>;

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 8_000;

export function resendTransport(apiKey: string, fetchImpl: typeof fetch = fetch): EmailTransport {
  return async (email) => {
    try {
      const response = await fetchImpl(RESEND_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "idempotency-key": email.idempotencyKey,
        },
        body: JSON.stringify({
          from: email.from,
          to: [email.to],
          reply_to: email.replyTo,
          subject: email.subject,
          html: email.html,
          text: email.text,
          headers: email.headers,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        // The error's name only (validation_error, rate_limit_exceeded, ...), never the body we sent.
        const body = (await response.json().catch(() => ({}))) as { name?: unknown };
        return { ok: false, error: `http_${response.status}${typeof body.name === "string" ? `:${body.name}` : ""}` };
      }
      const body = (await response.json().catch(() => ({}))) as { id?: unknown };
      return { ok: true, id: typeof body.id === "string" ? body.id : null };
    } catch (error) {
      return { ok: false, error: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network" };
    }
  };
}
