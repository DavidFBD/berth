import { after } from "next/server";
import { render } from "@react-email/render";
import { emailBaseUrl, emailFrom, emailMarkUrl, emailReplyTo, emailSendingOn } from "@/lib/server/email/config";
import { composeNotice, NOTICE_KIND, type EmailContent, type Notice } from "@/lib/server/email/compose";
import { resendTransport, type EmailTransport, type OutgoingEmail } from "@/lib/server/email/resend";
import { claimSend, finishSend, isSuppressed, primaryEmail, readPrefs, sendsToday, takeStalePending } from "@/lib/server/email/store";
import { NoticeEmail, noticeText } from "@/lib/server/email/template";
import { issueUnsubscribeToken } from "@/lib/server/email/token";

/**
 * Sending a notice, queue free. A route calls `sendNotice` after its own
 * database write has landed; the send runs after the response has gone
 * (next/server `after`), so a slow or failing mail provider never holds up
 * or breaks the request. Failures are logged, never thrown.
 *
 * `deliver` is the whole decision, in order: the kill switch (read at every
 * step, so EMAIL_SENDING=off stops even a send already under way), the
 * person's switch for this kind (security has none), the verified primary
 * email read now (never cached), the suppression list (a bounce or
 * complaint stops even security), the day's volume guard (past the cap only
 * security goes out), then the claim on (type, ref) in email_sends, so the
 * same event is sent once however often its route runs, and a friend
 * request takes the day's one slot. Only then is it rendered and sent.
 *
 * Resend's rate limit (429) is waited out a little; if it holds, a
 * security notice stays pending and the morning and evening passes
 * (`retryPendingSends`) send it later, as they do any send that died
 * midway. Anything else that fails is recorded as failed.
 */

export type NoticeInput = {
  userId: string;
  /** The event's own id: the order, the grant, the merge, the identity row. */
  ref: string;
  notice: Notice;
};

export type DeliverOutcome =
  | "sent"
  | "failed"
  | "deferred"
  | "off"
  | "pref_off"
  | "no_address"
  | "suppressed"
  | "daily_cap"
  | "daily_volume"
  | "duplicate";

/**
 * Sends a day (UTC) past which only security notices go out, below
 * Resend's free tier of 100, so a security notice never meets a full day.
 * EMAIL_DAILY_CAP overrides it.
 */
export const DEFAULT_DAILY_CAP = 90;

export function dailyCap(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.EMAIL_DAILY_CAP);
  return Number.isFinite(value) && value >= 0 && env.EMAIL_DAILY_CAP?.trim() ? Math.floor(value) : DEFAULT_DAILY_CAP;
}

/** Waits before each retry of a rate limited send. */
let backoffMs: readonly number[] = [1_000, 3_000];
/** Test injection point for the waits. */
export function setBackoff(next: readonly number[] | null): void {
  backoffMs = next ?? [1_000, 3_000];
}

let transportOverride: EmailTransport | null = null;
/** Test injection point; null goes back to Resend (or the dry run). */
export function setEmailTransport(next: EmailTransport | null): void {
  transportOverride = next;
}

function transport(): EmailTransport {
  if (transportOverride) return transportOverride;
  // EMAIL_DRY=1: every step runs, the send is only logged.
  if (process.env.EMAIL_DRY === "1") {
    return async (email) => {
      console.info(`[email] dry run: ${email.subject} (${email.headers["X-Berth-Type"] ?? "notice"})`);
      return { ok: true, id: null };
    };
  }
  return resendTransport(process.env.RESEND_API_KEY ?? "");
}

export function unsubscribeUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/api/email/unsubscribe?t=${encodeURIComponent(token)}`;
}

/** The finished message for one notice: HTML, text and headers. Pure but for the token's clock. */
export async function buildEmail({
  userId,
  ref,
  notice,
  to,
}: NoticeInput & { to: string }): Promise<{ email: OutgoingEmail; content: EmailContent }> {
  const baseUrl = emailBaseUrl();
  const content = composeNotice(notice, baseUrl);
  const kind = NOTICE_KIND[notice.type];
  const unsubscribe =
    kind === "security" ? null : unsubscribeUrl(baseUrl, await issueUnsubscribeToken({ userId, kind }));
  const html = await render(
    <NoticeEmail content={content} markUrl={emailMarkUrl()} unsubscribeUrl={unsubscribe} contact={emailReplyTo()} />,
  );
  const text = noticeText({ content, unsubscribeUrl: unsubscribe, contact: emailReplyTo() });
  const headers: Record<string, string> = { "X-Berth-Type": notice.type };
  if (unsubscribe) {
    // RFC 8058 one click: the mail client POSTs List-Unsubscribe=One-Click to this URL.
    headers["List-Unsubscribe"] = `<${unsubscribe}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  return {
    content,
    email: {
      from: emailFrom(),
      to,
      replyTo: emailReplyTo(),
      subject: content.subject,
      html,
      text,
      headers,
      idempotencyKey: `berth-${notice.type}-${ref}`.slice(0, 256),
    },
  };
}

/** Read at every step: the kill switch, and a key (or a test transport) to send with. */
function sendingAllowed(): boolean {
  return process.env.EMAIL_SENDING !== "off" && (transportOverride !== null || emailSendingOn());
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendWithBackoff(email: OutgoingEmail): Promise<Awaited<ReturnType<EmailTransport>>> {
  let result = await transport()(email);
  for (const wait of backoffMs) {
    if (result.ok || !result.error.startsWith("http_429")) break;
    await sleep(wait);
    if (!sendingAllowed()) break;
    result = await transport()(email);
  }
  return result;
}

/** The checks before a claim: whether this person, at this address, may get this notice now. */
async function recipient(input: NoticeInput): Promise<{ to: string } | DeliverOutcome> {
  const kind = NOTICE_KIND[input.notice.type];
  if (kind !== "security") {
    const prefs = await readPrefs(input.userId);
    if (!prefs[kind]) return "pref_off";
  }
  const to = await primaryEmail(input.userId);
  if (!to) return "no_address";
  if (await isSuppressed(to)) return "suppressed";
  return { to };
}

/** Renders and sends a claimed row, and records how it went. */
async function sendClaimed(sendId: string, input: NoticeInput, to: string): Promise<DeliverOutcome> {
  if (!sendingAllowed()) {
    // Switched off between the claim and now: left pending, sent by a later pass once it is on again.
    return "off";
  }
  let result: Awaited<ReturnType<EmailTransport>>;
  try {
    const { email } = await buildEmail({ ...input, to });
    result = await sendWithBackoff(email);
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? `build:${error.name}` : "build" };
  }
  if (result.ok) {
    await finishSend(sendId, { ok: true, providerId: result.id });
    return "sent";
  }
  if (result.error.startsWith("http_429") && NOTICE_KIND[input.notice.type] === "security") {
    await finishSend(sendId, { later: result.error });
    return "deferred";
  }
  await finishSend(sendId, { ok: false, error: result.error });
  return "failed";
}

export async function deliver(input: NoticeInput): Promise<DeliverOutcome> {
  if (!sendingAllowed()) return "off";
  const checked = await recipient(input);
  if (typeof checked === "string") return checked;
  if (NOTICE_KIND[input.notice.type] !== "security" && (await sendsToday()) >= dailyCap()) return "daily_volume";
  const claim = await claimSend(input.userId, input.notice.type, input.ref, input.notice);
  if (typeof claim === "string") return claim;
  return sendClaimed(claim.id, input, checked.to);
}

export type RetrySummary = { retried: number; sent: number; gaveUp: number };

/**
 * The morning and evening passes: every send pending more than ten minutes
 * (one that died midway, or a security notice deferred by a rate limit) is
 * checked again against the person's switches and address and sent, at
 * most `limit` a pass. A row past its last attempt is given up.
 */
export async function retryPendingSends({ limit = 20 }: { limit?: number } = {}): Promise<RetrySummary> {
  if (!sendingAllowed()) return { retried: 0, sent: 0, gaveUp: 0 };
  const { rows, gaveUp } = await takeStalePending(limit);
  let sent = 0;
  for (const row of rows) {
    const input: NoticeInput = { userId: row.user_id, ref: row.ref, notice: row.notice as unknown as Notice };
    const checked = await recipient(input);
    if (typeof checked === "string") {
      await finishSend(row.id, { ok: false, error: checked });
      continue;
    }
    if ((await sendClaimed(row.id, input, checked.to)) === "sent") sent += 1;
  }
  return { retried: rows.length, sent, gaveUp };
}

async function deliverQuietly(input: NoticeInput): Promise<void> {
  try {
    const outcome = await deliver(input);
    if (outcome === "failed") console.warn(`[email] ${input.notice.type} failed for ${input.userId.slice(0, 8)}`);
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    console.warn(
      `[email] ${input.notice.type} not sent for ${input.userId.slice(0, 8)}: ${error instanceof Error ? error.name : "error"}${typeof code === "string" ? ` (${code})` : ""}`,
    );
  }
}

/**
 * Schedules one notice after the response. Call it once the event's own
 * write has succeeded. Never throws and never waits; with sending off (no
 * key, or EMAIL_SENDING=off) it does nothing at all.
 */
export function sendNotice(input: NoticeInput): void {
  if (!sendingAllowed()) return;
  try {
    after(() => deliverQuietly(input));
  } catch {
    // Outside a request (a script, a test): run now, still unawaited.
    void deliverQuietly(input);
  }
}

/** For the dev gallery and the shots: every notice, rendered with sample data. */
export const SAMPLE_NOTICES: readonly { name: string; notice: Notice }[] = [
  { name: "wallet-added", notice: { type: "wallet_added", family: "evm", address: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" } },
  { name: "wallet-removed", notice: { type: "wallet_removed", family: "solana", address: "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV" } },
  { name: "accounts-merged", notice: { type: "accounts_merged" } },
  { name: "assistant-connected", notice: { type: "assistant_connected", app: "Claude", scopes: ["berth.read", "berth.draft"] } },
  { name: "order-filled", notice: { type: "order_filled", side: "buy", name: "NVIDIA", price: "$198.20", received: "0.5046 NVIDIA" } },
  { name: "order-expired", notice: { type: "order_expired", side: "buy", name: "NVIDIA" } },
  { name: "friend-request", notice: { type: "friend_request", username: "harbourmaster" } },
];

/** Renders a sample to HTML and text without a database, a token secret or a provider. */
export async function renderSample(notice: Notice): Promise<{ subject: string; html: string; text: string }> {
  const baseUrl = emailBaseUrl();
  const content = composeNotice(notice, baseUrl);
  const unsubscribe = NOTICE_KIND[notice.type] === "security" ? null : unsubscribeUrl(baseUrl, "sample-token");
  const html = await render(
    <NoticeEmail content={content} markUrl={emailMarkUrl()} unsubscribeUrl={unsubscribe} contact={emailReplyTo()} />,
  );
  return { subject: content.subject, html, text: noticeText({ content, unsubscribeUrl: unsubscribe, contact: emailReplyTo() }) };
}
