import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RECURRING_UNAVAILABLE, RecurringError, readRecurringResponse } from "@/lib/recurring-response";
import { RecurringSectionView } from "@/components/recurring/recurring-section-view";
import type { PlanView } from "@/lib/recurring";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("readRecurringResponse", () => {
  it("reads a 451 as Berth not being available here, not as a failure", async () => {
    const refused = readRecurringResponse(json(451, { code: "unavailable_here", reason: "united-states" }));
    await expect(refused).rejects.toBeInstanceOf(RecurringError);
    await expect(readRecurringResponse(json(451, {}))).rejects.toMatchObject({ reason: RECURRING_UNAVAILABLE });
  });

  it("keeps every other refusal's own reason", async () => {
    await expect(readRecurringResponse(json(409, { error: "too_many" }))).rejects.toMatchObject({ reason: "too_many" });
    await expect(readRecurringResponse(json(200, { plans: [], ready: [], limitAllowed: false }))).resolves.toEqual({ plans: [], ready: [], limitAllowed: false });
  });
});

const PAUSED: PlanView = {
  id: "p1", symbol: "SPY", usd: 20, cadence: "weekly", weekday: 1, monthDay: null, timeZone: "UTC",
  orderType: "market", dipPct: null, paused: true, nextDueAt: null, createdVia: "app", runs: [],
} as unknown as PlanView;
const LIVE = { ...PAUSED, id: "p2", paused: false, nextDueAt: "2026-10-05T00:00:00.000Z" } as PlanView;

describe("the recurring section where Berth is not available", () => {
  const noop = () => {};
  const render = (mayResume: boolean) =>
    renderToStaticMarkup(createElement(RecurringSectionView, { plans: [PAUSED, LIVE], mayResume, onAdd: noop, onEdit: noop, onPause: noop, onDelete: noop }));

  it("offers no Resume on a paused plan, while Pause and Remove stay", () => {
    const away = render(false);
    expect(away).not.toContain(">Resume<");
    expect(away).toContain(">Pause<");
    expect(render(true)).toContain(">Resume<");
  });
});
