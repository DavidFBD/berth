import { NextResponse, type NextRequest } from "next/server";
import { nextNotFound } from "@/lib/server/not-found-response";
import { requireFreshStaff, requireStaff, staffAudit } from "@/lib/server/staff-auth";
import { sameOrigin } from "@/lib/server/staff-gate";
import type { StaffEmailsResponse, StaffEmailsResult } from "@/lib/staff-emails-types";
import {
  cancel,
  getAnnouncement,
  lineUp,
  queue,
  SEND_NOW_MS,
  sendNow,
  sendTest,
  setExcludedByKey,
  updateDraft,
  type ActResult,
  type Audit,
  type DraftPatch,
} from "@/lib/server/new-listings";
import { previewOf, staffEmailsState } from "@/lib/server/staff/emails";

export const dynamic = "force-dynamic";
/**
 * A press that sends does it inside the request, for at most SEND_NOW_MS
 * (15 s) after the request began: a slow provider call (8 s, and waits on a
 * rate limit) started at the last moment, then the state read, still end
 * well inside this.
 */
export const maxDuration = 50;

const id = (value: unknown): string | null =>
  typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value.toLowerCase() : null;
const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * The acts that send or approve sending: a sign in from the last fifteen
 * minutes, by email (requireFreshStaff). Stopping (cancel) is the safe
 * direction and needs only a staff session.
 */
const FRESH_ACTIONS = new Set(["queue", "test", "send_now"]);

/**
 * The staff emails endpoint (app/staff/emails): the New stocks announcement
 * staff line up, edit, test, queue, send and cancel. To anyone not on
 * STAFF_ADMIN_IDS, and for every method but POST, this is Next's own 404.
 * Every act that changes something is audited, the audit row written in the
 * act's own statement (lib/server/new-listings), a refused act in its own
 * row; a test and a press of send are audited before they send. It answers
 * the fresh state, with the act's result; a failure is audited and answered
 * as a refusal, never a 500. The page never receives a full address or an
 * account id.
 */
export async function POST(request: NextRequest) {
  const started = Date.now();
  if (!sameOrigin(request)) return nextNotFound(request);
  const body = (await request.clone().json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  const gate = FRESH_ACTIONS.has(action) ? await requireFreshStaff(request, "admin") : await requireStaff(request, "admin");
  if (!gate.ok) {
    if ("stale" in gate) return NextResponse.json({ error: "stale" }, { status: 401, headers: { "cache-control": "no-store" } });
    return nextNotFound(request);
  }
  const staff = gate.staff.userId;
  const announcementId = id(body.announcementId);
  const headers = { "cache-control": "no-store" };
  const asResult = (done: ActResult<unknown>): StaffEmailsResult =>
    done.ok ? { ok: true } : { ok: false, reason: done.reason, ...(done.problems ? { problems: done.problems } : {}) };
  const audit = (name: string, detail: Record<string, unknown> = {}): Audit => ({ staffUserId: staff, action: `emails.${name}`, detail });
  /** A refused act leaves its own row (an act that went through wrote its row itself). */
  const refused = async (name: string, done: ActResult<unknown>) => {
    if (!done.ok) await staffAudit({ staffUserId: staff, action: `emails.${name}`, target: announcementId, detail: { outcome: done.reason } }).catch(() => undefined);
  };

  if (action === "preview") {
    try {
      // The words as typed, saved or not: rendered by the real template, never stored or sent.
      const current = announcementId ? await getAnnouncement(announcementId) : null;
      if (!current) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
      const words = {
        subject: text(body.subject) ?? current.words.subject,
        preview: text(body.preview) ?? current.words.preview,
        intro: text(body.intro) ?? current.words.intro,
        extra: text(body.extra) ?? current.words.extra,
      };
      const chosen = Array.isArray(body.chosen) ? body.chosen.filter((value): value is string => typeof value === "string") : current.chosen;
      return NextResponse.json(await previewOf(words, chosen.filter((symbol) => current.detected.includes(symbol))), { headers });
    } catch (error) {
      console.warn("[staff/emails] preview", error instanceof Error ? error.name : "error");
      return NextResponse.json({ error: "preview_failed" }, { status: 503, headers });
    }
  }

  let result: StaffEmailsResult = { ok: true };
  try {
    switch (action) {
      case "state":
        await staffAudit({ staffUserId: staff, action: "emails.view" });
        break;
      case "line_up": {
        const done = await lineUp({ staffId: staff, audit: audit("line_up") });
        result = asResult(done);
        await refused("line_up", done);
        break;
      }
      case "update": {
        if (!announcementId) {
          result = { ok: false, reason: "bad_input" };
          break;
        }
        const patch: DraftPatch = {
          subject: text(body.subject),
          preview: text(body.preview),
          intro: text(body.intro),
          extra: text(body.extra),
          chosen: Array.isArray(body.chosen) ? body.chosen.filter((value): value is string => typeof value === "string") : undefined,
        };
        const fields = Object.keys(patch).filter((key) => patch[key as keyof DraftPatch] !== undefined);
        const done = await updateDraft(announcementId, patch, audit("update", { fields }));
        result = asResult(done);
        await refused("update", done);
        break;
      }
      case "exclude":
      case "include": {
        const key = text(body.key);
        if (!announcementId || !key) {
          result = { ok: false, reason: "bad_input" };
          break;
        }
        const done = await setExcludedByKey(announcementId, key, action === "exclude", audit(action));
        result = asResult(done);
        if (!done.ok) await staffAudit({ staffUserId: staff, action: `emails.${action}`, target: announcementId, detail: { outcome: done.reason, key } }).catch(() => undefined);
        break;
      }
      case "test": {
        if (!announcementId) {
          result = { ok: false, reason: "bad_input" };
          break;
        }
        const done = await sendTest(announcementId, staff);
        result = done.ok ? { ok: done.value === "sent", reason: done.value === "sent" ? undefined : done.value, detail: { outcome: done.value } } : asResult(done);
        await staffAudit({ staffUserId: staff, action: "emails.test", target: announcementId, detail: { outcome: done.ok ? done.value : done.reason } });
        break;
      }
      case "queue": {
        const hash = text(body.hash);
        if (!announcementId || !hash) {
          result = { ok: false, reason: "bad_input" };
          break;
        }
        const done = await queue(announcementId, staff, { hash, audit: audit("queue") });
        result = asResult(done);
        await refused("queue", done);
        if (done.ok) {
          // Starts at once, within the day's share and this request's 15 seconds; staff's next presses and the mornings carry on.
          const started_ = await sendNow({ deadline: started + SEND_NOW_MS }).catch((error) => {
            console.warn("[staff/emails] first send failed", error instanceof Error ? error.name : "error");
            return null;
          });
          result = { ok: true, detail: { sentNow: started_?.ok ? started_.value.sent : 0 } };
        }
        break;
      }
      case "send_now": {
        // Recorded first: a send that cannot be recorded does not happen.
        await staffAudit({ staffUserId: staff, action: "emails.send_now", target: announcementId, detail: { outcome: "started" } });
        const done = await sendNow({ deadline: started + SEND_NOW_MS });
        result = done.ok ? { ok: true, detail: { sentNow: done.value.sent, notSent: done.value.notSent, finished: done.value.finished } } : asResult(done);
        if (!done.ok) await staffAudit({ staffUserId: staff, action: "emails.send_now", target: announcementId, detail: { outcome: done.reason } }).catch(() => undefined);
        break;
      }
      case "cancel": {
        if (!announcementId) {
          result = { ok: false, reason: "bad_input" };
          break;
        }
        const done = await cancel(announcementId, audit("cancel"));
        result = asResult(done);
        await refused("cancel", done);
        break;
      }
      default:
        result = { ok: false, reason: "bad_input" };
    }
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : "error";
    console.warn("[staff/emails]", action, message);
    await staffAudit({ staffUserId: staff, action: `emails.${action || "unknown"}.error`, target: announcementId, detail: { outcome: "error", message } }).catch(() => undefined);
    result = { ok: false, reason: "error" };
  }
  // The state is read last and never fails the answer: the page refetches when it is missing.
  const state = await staffEmailsState().catch((error) => {
    console.warn("[staff/emails] state", error instanceof Error ? error.name : "error");
    return null;
  });
  return NextResponse.json({ state, result } satisfies StaffEmailsResponse, { headers });
}

/** Every other method is a path that is not there. */
function missing(request: Request): Promise<NextResponse> {
  return nextNotFound(request);
}
export const GET = missing;
export const PUT = missing;
export const PATCH = missing;
export const DELETE = missing;
export const OPTIONS = missing;
export const HEAD = missing;
