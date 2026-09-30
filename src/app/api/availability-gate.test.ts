import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Availability } from "@/lib/availability";

/**
 * The routes that start something refuse it where Berth is not available
 * (HTTP 451, code unavailable_here), and nothing that gets money out is
 * ever refused: a sell is recorded, a limit sell is placed, a plan can be
 * paused or deleted, an assistant can be declined. A buy that happened
 * anyway is recorded, so the ledger stays true, and pays nothing. The account and chain
 * work behind each route is stubbed; the gate is what is under test.
 */

let availability: Availability | undefined;

vi.mock("@/lib/server/rewards-route", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/rewards-route")>();
  return {
    ...actual,
    readRewardsCaller: vi.fn(async (request: Request) => ({
      ok: true,
      caller: { did: "did:privy:x", wallet: "0x00000000000000000000000000000000000000aa", body: await request.json(), availability },
    })),
    resolveRewardsUser: vi.fn(async () => ({
      ok: true,
      created: false,
      user: { id: "u1", wallet_address: "0x00000000000000000000000000000000000000aa", xp: 0 },
    })),
  };
});

// xp/pour: verification stands in for everything past the gate.
const verifyPourTx = vi.fn(async (): Promise<unknown> => ({ ok: false, reason: "stubbed" }));
vi.mock("@/lib/server/pour-verify", () => ({ verifyPourTx: () => verifyPourTx() }));
vi.mock("@/lib/server/identities", () => ({
  linkedWallets: vi.fn(async () => []),
  accountEvmAddresses: vi.fn(async () => ({ home: null })),
}));
const claims = {
  awardFilledPour: vi.fn(async () => ({ rewards: [{ kind: "pour_in", amount: 50 }], xp: 50 })),
  closePourClaim: vi.fn(async () => undefined),
  fillVerdict: vi.fn(async (): Promise<string> => "filled"),
  savePourClaim: vi.fn(async () => undefined),
};
vi.mock("@/lib/server/pour-claims", () => claims);
// The no XP marks (lib/server/no-xp) and the paid pours, in memory.
const marked = new Set<string>();
const paidPours = new Set<string>();
const noXp = {
  markNoXp: vi.fn(async (tx: string) => void marked.add(tx)),
  isNoXp: vi.fn(async (tx: string) => marked.has(tx)),
  pourPaid: vi.fn(async (tx: string) => paidPours.has(tx)),
  forgoHold: vi.fn(async () => undefined),
};
vi.mock("@/lib/server/no-xp", () => noXp);
const recordOrder = vi.fn(async () => ({ id: "order-1" }));
vi.mock("@/lib/server/orders", () => ({ orderListingSymbol: vi.fn(() => "NVDA"), recordOrder: (...args: unknown[]) => recordOrder(...(args as [])) }));
vi.mock("@/lib/server/accounts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/accounts")>()),
  flushUnannounced: vi.fn(async () => []),
}));

// limit-orders
const placeLimitOrder = vi.fn(async () => ({ ok: true, order: { id: "o1" } }));
vi.mock("@/lib/server/limit-orders", () => ({
  hasWaitingOrders: vi.fn(async () => false),
  limitOrdersOn: vi.fn(() => true),
  listLimitOrders: vi.fn(async () => []),
  markCancelAsked: vi.fn(async () => true),
  placeLimitOrder: (...args: unknown[]) => placeLimitOrder(...(args as [])),
  sweepMissing: (...args: unknown[]) => sweepMissing(...(args as [])),
}));
const sweepMissing = vi.fn(async () => 0);
vi.mock("@/lib/server/portfolio", () => ({ hubWalletFor: vi.fn(async () => "0x00000000000000000000000000000000000000bb") }));

// recurring
const createPlan = vi.fn(async () => "ok");
const setPaused = vi.fn(async () => true);
const deletePlan = vi.fn(async () => true);
vi.mock("@/lib/server/recurring", () => ({
  ageRuns: vi.fn(async () => undefined),
  createPlan: (...args: unknown[]) => createPlan(...(args as [])),
  deletePlan: (...args: unknown[]) => deletePlan(...(args as [])),
  listPlans: vi.fn(async () => []),
  makeDueRuns: vi.fn(async () => []),
  openRun: vi.fn(async () => "opened"),
  readyRuns: vi.fn(async () => []),
  setPaused: (...args: unknown[]) => setPaused(...(args as [])),
  skipRun: vi.fn(async () => "skipped"),
  updatePlan: vi.fn(async () => true),
}));
vi.mock("@/lib/server/morning", () => ({ lazyPrices: vi.fn(() => async () => undefined) }));

// oauth decision
const issueCode = vi.fn(async () => "code-1");
vi.mock("@/lib/server/oauth/authorize", () => ({
  readConsent: vi.fn(async () => ({ clientId: "c1", redirectUri: "https://claude.ai/cb", state: "s" })),
  buildRedirect: vi.fn((uri: string, params: Record<string, string>) => `${uri}?${new URLSearchParams(params)}`),
}));
vi.mock("@/lib/server/oauth/clients", () => ({ getClient: vi.fn(async () => ({ redirectUris: ["https://claude.ai/cb"] })) }));
vi.mock("@/lib/server/oauth/tokens", () => ({ issueCode: (...args: unknown[]) => issueCode(...(args as [])) }));

const pour = await import("./xp/pour/route");
const limit = await import("./limit-orders/route");
const recurring = await import("./recurring/route");
const decision = await import("./oauth/decision/route");

const AWAY: Availability = { available: false, reason: "united-states" };
const TX = `0x${"a".repeat(64)}`;
const PLAN_ID = "11111111-1111-4111-8111-111111111111";

const post = (path: string, body: Record<string, unknown>) =>
  new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body) });

async function expectRefused(response: Response) {
  expect(response.status).toBe(451);
  expect(await response.json()).toMatchObject({ code: "unavailable_here" });
}

beforeEach(() => {
  availability = undefined;
  vi.clearAllMocks();
  verifyPourTx.mockResolvedValue({ ok: false, reason: "stubbed" });
  marked.clear();
  paidPours.clear();
});

describe("recording a pour", () => {
  const verified = () => verifyPourTx.mockResolvedValue({ ok: true, intent: { id: "i" }, sodax: {} });
  const buy = () => pour.POST(post("/api/xp/pour", { direction: "in", intentTxHash: TX }));
  const HOME: Availability = { available: true };

  it("records a filled buy from where Berth is not available, marks it, pays no XP, judges no hold, logs no place", async () => {
    availability = AWAY;
    verified();
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await buy();
    expect(response.status).toBe(200);
    // The ledger stays true: the order (with its marks and recurring run, inside recordOrder) is written.
    expect(recordOrder).toHaveBeenCalledOnce();
    expect(noXp.markNoXp).toHaveBeenCalledWith(TX);
    expect(noXp.forgoHold).toHaveBeenCalledWith(TX);
    expect(claims.closePourClaim).toHaveBeenCalledWith(TX, expect.any(Date), "recorded_no_xp");
    expect(claims.awardFilledPour).not.toHaveBeenCalled();
    expect((await response.json()).rewards).toEqual([]);
    expect(log).toHaveBeenCalledWith("[availability] buy recorded from an excluded place");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/US|united/i);
    log.mockRestore();
  });

  it("marks it too when the fill is not known yet, so the evening pass pays nothing", async () => {
    availability = AWAY;
    verified();
    claims.fillVerdict.mockResolvedValueOnce("unknown");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    expect((await buy()).status).toBe(200);
    expect(noXp.markNoXp).toHaveBeenCalledWith(TX);
    expect(claims.savePourClaim).toHaveBeenCalledWith("u1", TX, "buy", null, "NVDA");
    expect(claims.awardFilledPour).not.toHaveBeenCalled();
  });

  it("pays nothing when the same buy is reported again from an allowed country, filled or not", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    verified();
    // First from abroad, fill unknown; then from home with the fill known.
    availability = AWAY;
    claims.fillVerdict.mockResolvedValueOnce("unknown");
    await buy();
    availability = HOME;
    const replay = await buy();
    expect(replay.status).toBe(200);
    expect(claims.awardFilledPour).not.toHaveBeenCalled();
    expect(noXp.forgoHold).toHaveBeenCalledWith(TX);
    expect(claims.closePourClaim).toHaveBeenLastCalledWith(TX, expect.any(Date), "recorded_no_xp");
    // And once more, filled from the start abroad, then replayed at home.
    marked.clear();
    availability = AWAY;
    await buy();
    availability = HOME;
    await buy();
    expect(claims.awardFilledPour).not.toHaveBeenCalled();
  });

  it("never marks a buy already paid: reported again from abroad, it is a replay, its hold untouched", async () => {
    availability = AWAY;
    verified();
    paidPours.add(TX);
    expect((await buy()).status).toBe(200);
    expect(noXp.markNoXp).not.toHaveBeenCalled();
    expect(noXp.forgoHold).not.toHaveBeenCalled();
  });

  it("records and pays a sell there as always, and never marks it: the travel exception", async () => {
    availability = AWAY;
    verified();
    const response = await pour.POST(post("/api/xp/pour", { direction: "out", intentTxHash: TX }));
    expect(response.status).toBe(200);
    expect(recordOrder).toHaveBeenCalledOnce();
    expect(claims.awardFilledPour).toHaveBeenCalledOnce();
    expect(noXp.markNoXp).not.toHaveBeenCalled();
    expect(noXp.forgoHold).not.toHaveBeenCalled();
  });

  it("pays a buy where Berth is available, as before", async () => {
    availability = HOME;
    verified();
    expect((await buy()).status).toBe(200);
    expect(claims.awardFilledPour).toHaveBeenCalledOnce();
    expect(noXp.forgoHold).not.toHaveBeenCalled();
    expect(noXp.markNoXp).not.toHaveBeenCalled();
  });

  it("marks nothing for what is not a real pour of this account's, wherever it comes from", async () => {
    availability = AWAY;
    expect((await buy()).status).toBe(422);
    expect(recordOrder).not.toHaveBeenCalled();
    expect(noXp.markNoXp).not.toHaveBeenCalled();
  });
});

describe("limit orders", () => {
  it("refuses a limit buy where Berth is not available, and places nothing", async () => {
    availability = AWAY;
    await expectRefused(await limit.POST(post("/api/limit-orders", { action: "record", intentTxHash: TX, direction: "buy" })));
    expect(placeLimitOrder).not.toHaveBeenCalled();
  });

  it("places a limit sell there, lists, and lets an order be cancelled", async () => {
    availability = AWAY;
    const sell = await limit.POST(post("/api/limit-orders", { action: "record", intentTxHash: TX, direction: "sell" }));
    expect(sell.status).toBe(200);
    expect(placeLimitOrder).toHaveBeenCalledOnce();
    expect((await limit.POST(post("/api/limit-orders", { action: "list" }))).status).toBe(200);
    // The sweep that keeps a refused limit buy visible marks what it finds as paying nothing.
    expect(sweepMissing).toHaveBeenLastCalledWith("u1", expect.any(Set), expect.objectContaining({ noXpBuys: true }));
    expect((await limit.POST(post("/api/limit-orders", { action: "cancelAsked", intentTxHash: TX, cancelTxHash: TX }))).status).toBe(200);
  });
});

describe("recurring plans", () => {
  const plan = { listing: "SPY", usd: 20, cadence: "weekly", weekday: 1, timeZone: "Europe/Amsterdam" };

  it("refuses making, changing or resuming a plan where Berth is not available", async () => {
    availability = AWAY;
    await expectRefused(await recurring.POST(post("/api/recurring", { action: "create", plan })));
    await expectRefused(await recurring.POST(post("/api/recurring", { action: "update", planId: PLAN_ID, plan })));
    await expectRefused(await recurring.POST(post("/api/recurring", { action: "resume", planId: PLAN_ID })));
    expect(createPlan).not.toHaveBeenCalled();
  });

  it("always lets a plan be listed, paused or deleted", async () => {
    availability = AWAY;
    expect((await recurring.POST(post("/api/recurring", { action: "list" }))).status).toBe(200);
    expect((await recurring.POST(post("/api/recurring", { action: "pause", planId: PLAN_ID }))).status).toBe(200);
    expect((await recurring.POST(post("/api/recurring", { action: "delete", planId: PLAN_ID }))).status).toBe(200);
    expect(setPaused).toHaveBeenCalledOnce();
    expect(deletePlan).toHaveBeenCalledOnce();
  });

  it("makes a plan where Berth is available", async () => {
    availability = { available: true };
    expect((await recurring.POST(post("/api/recurring", { action: "create", plan }))).status).toBe(200);
    expect(createPlan).toHaveBeenCalledOnce();
  });
});

describe("connecting an assistant", () => {
  it("refuses an approval where Berth is not available, and issues no code", async () => {
    availability = AWAY;
    await expectRefused(await decision.POST(post("/api/oauth/decision", { request: "signed", decision: "approve" })));
    expect(issueCode).not.toHaveBeenCalled();
  });

  it("lets it be declined there", async () => {
    availability = AWAY;
    const response = await decision.POST(post("/api/oauth/decision", { request: "signed", decision: "decline" }));
    expect(response.status).toBe(200);
    expect((await response.json()).redirect).toContain("access_denied");
  });

  it("approves where Berth is available", async () => {
    availability = { available: true };
    const response = await decision.POST(post("/api/oauth/decision", { request: "signed", decision: "approve" }));
    expect(response.status).toBe(200);
    expect(issueCode).toHaveBeenCalledOnce();
  });
});
