import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireStaff = vi.fn();
const requireFreshStaff = vi.fn();
const staffAudit = vi.fn(async () => undefined);
vi.mock("@/lib/server/staff-auth", () => ({
  requireStaff: (...args: unknown[]) => requireStaff(...args),
  requireFreshStaff: (...args: unknown[]) => requireFreshStaff(...args),
  staffAudit: (...args: unknown[]) => staffAudit(...(args as [])),
}));
const sameOrigin = vi.fn((request: Request) => request instanceof Request);
vi.mock("@/lib/server/staff-gate", () => ({ sameOrigin: (request: Request) => sameOrigin(request) }));
vi.mock("@/lib/server/not-found-response", () => ({ nextNotFound: async () => new NextResponse(null, { status: 404 }) }));
const state = { detected: [], switchOn: true, production: true, baselineRecorded: true, today: { cap: 22, used: 0 }, lastQueuedAt: null, recentlyQueued: false, current: null, history: [] };
const readState = vi.fn(async () => state);
const previewOf = vi.fn(async () => ({ subject: "s", html: "<p>x</p>" }));
vi.mock("@/lib/server/staff/emails", () => ({ staffEmailsState: () => readState(), previewOf: () => previewOf() }));
const queue = vi.fn();
const lineUp = vi.fn();
const sendNow = vi.fn();
const cancel = vi.fn();
vi.mock("@/lib/server/new-listings", () => ({
  SEND_NOW_MS: 20_000,
  cancel: (...args: unknown[]) => cancel(...args),
  sendNow: (...args: unknown[]) => sendNow(...args),
  getAnnouncement: vi.fn(),
  lineUp: (...args: unknown[]) => lineUp(...args),
  queue: (...args: unknown[]) => queue(...args),
  sendTest: vi.fn(),
  setExcludedByKey: vi.fn(),
  updateDraft: vi.fn(),
}));

import { GET, POST } from "./route";

const call = (action: string, extra: Record<string, unknown> = {}) =>
  POST(new NextRequest("http://localhost/api/staff/emails", { method: "POST", body: JSON.stringify({ action, ...extra }) }));

const STAFF = { ok: true, staff: { userId: "11111111-1111-1111-1111-111111111111", role: "admin" } };
const REFUSED = { ok: false, response: new NextResponse(null, { status: 404 }) };
const STALE = { ok: false, stale: true, response: new NextResponse(null, { status: 401 }) };
const ID = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  sameOrigin.mockReturnValue(true);
  requireStaff.mockResolvedValue(STAFF);
  requireFreshStaff.mockResolvedValue(STAFF);
});

describe("the staff emails endpoint", () => {
  it("is Next's 404 to anyone who is not staff, for every action and every other method", async () => {
    requireStaff.mockResolvedValue(REFUSED);
    requireFreshStaff.mockResolvedValue(REFUSED);
    for (const action of ["state", "line_up", "update", "preview", "exclude", "include", "test", "queue", "send_now", "cancel"]) {
      expect((await call(action, { announcementId: ID })).status).toBe(404);
    }
    expect((await GET(new Request("http://localhost/api/staff/emails"))).status).toBe(404);
    expect(queue).not.toHaveBeenCalled();
    expect(lineUp).not.toHaveBeenCalled();
  });

  it("is a 404 to a cross origin post, before anything is read or run", async () => {
    sameOrigin.mockReturnValue(false);
    expect((await call("line_up")).status).toBe(404);
    expect(requireStaff).not.toHaveBeenCalled();
    expect(lineUp).not.toHaveBeenCalled();
  });

  it("needs a fresh sign in to queue, test or send now, and answers stale, while cancel needs only a staff session", async () => {
    requireFreshStaff.mockResolvedValue(STALE);
    for (const action of ["queue", "test", "send_now"]) {
      const response = await call(action, { announcementId: ID });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "stale" });
    }
    expect(queue).not.toHaveBeenCalled();
    expect(sendNow).not.toHaveBeenCalled();
    // Reading, editing and stopping need only a staff session.
    expect(requireStaff).not.toHaveBeenCalled();
    expect((await call("state")).status).toBe(200);
    cancel.mockResolvedValue({ ok: true, value: {} });
    expect((await call("cancel", { announcementId: ID })).status).toBe(200);
    expect(requireStaff).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("queues only with the hash the page showed, sends in the same request within the window, and answers what went", async () => {
    queue.mockResolvedValue({ ok: true, value: {} });
    sendNow.mockResolvedValue({ ok: true, value: { sent: 22 } });
    expect(await (await call("queue", { announcementId: ID })).json()).toMatchObject({ result: { ok: false, reason: "bad_input" } });
    expect(queue).not.toHaveBeenCalled();
    const answer = await (await call("queue", { announcementId: ID, hash: "abc" })).json();
    expect(queue).toHaveBeenCalledWith(ID, STAFF.staff.userId, expect.objectContaining({ hash: "abc" }));
    expect(answer.result).toEqual({ ok: true, detail: { sentNow: 22 } });
    const window = (sendNow.mock.calls[0][0] as { deadline: number }).deadline - Date.now();
    expect(window).toBeLessThanOrEqual(20_000);
    expect(window).toBeGreaterThan(15_000);
  });

  it("sends the day's share now only after recording it, and answers a refusal calmly", async () => {
    sendNow.mockResolvedValue({ ok: false, reason: "share_used" });
    const answer = await (await call("send_now", { announcementId: ID })).json();
    expect(answer.result).toEqual({ ok: false, reason: "share_used" });
    expect(staffAudit.mock.invocationCallOrder[0]).toBeLessThan(sendNow.mock.invocationCallOrder[0]);
    // An audit that cannot be written stops the send.
    sendNow.mockClear();
    staffAudit.mockRejectedValueOnce(new Error("db down"));
    const failed = await (await call("send_now", { announcementId: ID })).json();
    expect(failed.result).toMatchObject({ ok: false, reason: "error" });
    expect(sendNow).not.toHaveBeenCalled();
  });

  it("audits a refusal in its own row, hands an act its audit to write in its own statement, and answers the state with the result", async () => {
    lineUp.mockResolvedValue({ ok: false, reason: "nothing_new" });
    const response = await call("line_up");
    expect(await response.json()).toEqual({ state, result: { ok: false, reason: "nothing_new" } });
    expect(staffAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "emails.line_up", detail: { outcome: "nothing_new" } }));
    staffAudit.mockClear();
    queue.mockResolvedValue({ ok: true, value: {} });
    sendNow.mockResolvedValue({ ok: true, value: { sent: 0 } });
    await call("queue", { announcementId: ID, hash: "h" });
    expect(queue).toHaveBeenCalledWith(ID, STAFF.staff.userId, expect.objectContaining({ audit: expect.objectContaining({ action: "emails.queue", staffUserId: STAFF.staff.userId }) }));
    // The act wrote its own row, so the route writes none for it.
    expect(staffAudit).not.toHaveBeenCalled();
  });

  it("answers a null state, not a 500, when the final read fails", async () => {
    readState.mockRejectedValueOnce(new Error("db down"));
    lineUp.mockResolvedValue({ ok: false, reason: "nothing_new" });
    const response = await call("line_up");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: null, result: { ok: false, reason: "nothing_new" } });
  });

  it("answers a failed preview as a plain 503", async () => {
    const { getAnnouncement } = await import("@/lib/server/new-listings");
    (getAnnouncement as ReturnType<typeof vi.fn>).mockResolvedValue({ words: { subject: "s", preview: "p", intro: "i", extra: "" }, chosen: [], detected: [] });
    previewOf.mockRejectedValueOnce(new Error("render failed"));
    expect((await call("preview", { announcementId: ID })).status).toBe(503);
  });
});
