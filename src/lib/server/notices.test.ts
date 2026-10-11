import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("@/lib/server/db", () => ({ getSql: () => ({ query }) }));

import { markNoticeSeen, pendingNotices } from "./notices";
import { FEEDBACK_PROMPT_DELAY_MS, FEEDBACK_PROMPT_ID } from "@/lib/feedback";
import { POLICY_NOTICE_ID, SOCIAL_NOTICE_ID } from "@/lib/social-proof";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const USER = "a1b2c3d4-0000-4000-8000-000000000001";

/** An account created after every dated notice, so only the feedback ask can be due. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    created_at: "2026-10-09T08:00:00Z",
    share_holdings: false,
    seen: [],
    accepted: [],
    first_buy_at: new Date(NOW - FEEDBACK_PROMPT_DELAY_MS - 60_000).toISOString(),
    sent_feedback: false,
    ...overrides,
  };
}

beforeEach(() => {
  query.mockReset();
});

describe("pendingNotices, the feedback ask", () => {
  it("is due a day after the first completed buy, for an account that never wrote", async () => {
    query.mockResolvedValueOnce([row()]);
    expect(await pendingNotices(USER, NOW)).toEqual([FEEDBACK_PROMPT_ID]);
  });

  it("waits while the first buy is under a day old", async () => {
    query.mockResolvedValueOnce([row({ first_buy_at: new Date(NOW - 60_000).toISOString() })]);
    expect(await pendingNotices(USER, NOW)).toEqual([]);
  });

  it("is not due without a completed buy", async () => {
    query.mockResolvedValueOnce([row({ first_buy_at: null })]);
    expect(await pendingNotices(USER, NOW)).toEqual([]);
  });

  it("is never due again once feedback is sent", async () => {
    query.mockResolvedValueOnce([row({ sent_feedback: true })]);
    expect(await pendingNotices(USER, NOW)).toEqual([]);
  });

  it("is never due again once closed", async () => {
    query.mockResolvedValueOnce([row({ seen: [FEEDBACK_PROMPT_ID] })]);
    expect(await pendingNotices(USER, NOW)).toEqual([]);
  });

  it("rides after the dated notices, so they speak first", async () => {
    query.mockResolvedValueOnce([row({ created_at: "2026-09-01T00:00:00Z" })]);
    expect(await pendingNotices(USER, NOW)).toEqual([SOCIAL_NOTICE_ID, POLICY_NOTICE_ID, FEEDBACK_PROMPT_ID]);
  });

  it("counts only completed buys, and feedback_first as sent feedback", async () => {
    query.mockResolvedValueOnce([row()]);
    await pendingNotices(USER, NOW);
    const [text] = query.mock.calls[0] as [string];
    expect(text).toMatch(/o\.direction = 'buy'/);
    expect(text).toMatch(/o\.fill_tx is not null or o\.filled_at is not null/);
    expect(text).toMatch(/kind = 'feedback_first'/);
  });
});

describe("markNoticeSeen", () => {
  it("closes the feedback ask like any other notice", async () => {
    query.mockResolvedValueOnce([]);
    expect(await markNoticeSeen(USER, FEEDBACK_PROMPT_ID)).toBe(true);
    expect(query.mock.calls[0][1]).toEqual([USER, FEEDBACK_PROMPT_ID]);
  });

  it("refuses an id that is not a notice", async () => {
    expect(await markNoticeSeen(USER, "anything-else")).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});
