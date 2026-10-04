import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { setSqlClient, type SqlClient } from "../db";
import { makeTestDb } from "../pglite-test-db";
import { getOrCreateUser, type UserRow } from "../accounts";
import { requireFreshStaff, requireStaff, staffAdminIds } from "../staff-auth";
import { createStaffSession } from "../staff-sessions";
import { mintStaffCookie, staffCookieName, staffSessionKey } from "../staff-session";
import { claimById } from "./store";
import { campaignById } from "./store";
import { addPayoutSource, approveClaim, createCampaign, deleteCampaign, markClaimPaid, rejectClaim, setCampaignActive } from "./actions";

const FUNDING_WALLET = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
import { deriveSignals, foldEmail, revealClaim, staffQueue } from "./queue";
import { TRANSFER_TOPIC, USDC_BASE, type Receipt } from "./usdc";
import { advance, joined, qualifiedClaim, username } from "./test-kit";

/**
 * The staff side against the real schema: the gate (STAFF_ADMIN_IDS, never
 * the @sodax.com rule), every action audited, activation only with counsel
 * review confirmed and never for a retired campaign, approval fixing the
 * payout address to the signup's own home wallet, mark paid checked against
 * a mocked Base RPC, deleting a campaign that never took on money, and the
 * queue's evidence, signals and meter.
 */

vi.mock("@/lib/server/privy", async () => {
  const { decodeJwt } = await import("jose");
  return {
    verifyPrivyAuth: async (authorization: string | null) => {
      if (authorization === "Bearer broken") throw new Error("bad token");
      if (authorization?.startsWith("Bearer did:")) return authorization.slice("Bearer ".length);
      if (authorization?.startsWith("Bearer ey")) return String(decodeJwt(authorization.slice("Bearer ".length)).sub);
      return null;
    },
    fetchPrivyWallet: async () => ({ ok: true, address: null }),
    fetchPrivyEmail: async () => null,
    fetchPrivyEmailProofs: async () => null,
  };
});


let sql: SqlClient;
let close: () => Promise<void>;

beforeAll(async () => {
  process.env.STAFF_SESSION_SECRET = "c".repeat(48);
  const db = await makeTestDb();
  sql = db.sql;
  close = db.close;
  setSqlClient(sql);
});

afterAll(async () => {
  setSqlClient(null);
  await close();
});

afterEach(() => {
  delete process.env.STAFF_ADMIN_IDS;
});

let seq = 0;
const hex = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

async function person({ email = true, did }: { email?: boolean; did?: string } = {}): Promise<UserRow> {
  seq += 1;
  const user = (await getOrCreateUser({ did: did ?? `did:privy:staff-${seq}`, wallet: hex(0x7000 + seq) }))!.user;
  if (email) await sql.query(`update users set email = $2 where id = $1`, [user.id, `s${seq}@example.com`]);
  return { ...user, email: email ? `s${seq}@example.com` : null };
}

/** A request carrying a staff session cookie (the staff area's one session system), or none. */
function request(cookie?: string, body: Record<string, unknown> = { action: "queue" }, origin: string | null = "http://localhost"): NextRequest {
  return new NextRequest("http://localhost/api/staff/campaigns", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost", ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

/** A live staff session for this account, its email code entered `minutesAgo` (null: never), as a Cookie header. */
async function sessionCookie(userId: string, minutesAgo: number | null = 1): Promise<string> {
  const session = await createStaffSession(userId, minutesAgo === null ? null : Date.now() - minutesAgo * 60_000, Date.now() + 3_600_000);
  return `${staffCookieName()}=${await mintStaffCookie({ sessionId: session.id, expiresAt: session.expiresAt }, staffSessionKey()!)}`;
}

async function audits(action: string): Promise<{ target: string | null; detail: Record<string, unknown> }[]> {
  return (await sql.query(`select target, detail from staff_audit where action = $1 order by id`, [action])) as {
    target: string | null;
    detail: Record<string, unknown>;
  }[];
}

describe("requireStaff", () => {
  it("reads the allowlist of account ids, and nothing else", () => {
    expect([...staffAdminIds({ STAFF_ADMIN_IDS: " 0F0E0D0C-0000-4000-8000-000000000001 , junk,," })]).toEqual([
      "0f0e0d0c-0000-4000-8000-000000000001",
    ]);
    expect(staffAdminIds({}).size).toBe(0);
  });

  it("lets in only a live staff session of an account on the allowlist, with one 404 for everyone else", async () => {
    const staff = await person({ did: "did:privy:the-admin" });
    const sodax = await person({ did: "did:privy:someone-at-sodax" });
    await sql.query(`update users set email = 'someone@sodax.com' where id = $1`, [sodax.id]);
    const cookie = await sessionCookie(staff.id);
    expect((await requireStaff(request(cookie), "admin", {})).ok).toBe(false);
    const env = { STAFF_ADMIN_IDS: staff.id };
    process.env.STAFF_ADMIN_IDS = staff.id;
    const ok = await requireStaff(request(cookie), "admin", env);
    expect(ok).toEqual({ ok: true, staff: { userId: staff.id, role: "admin" } });
    for (const header of [undefined, await sessionCookie(sodax.id), `${staffCookieName()}=forged`]) {
      const gate = await requireStaff(request(header), "admin", env);
      expect(gate.ok).toBe(false);
      if (!gate.ok) expect(gate.response.status).toBe(404);
    }
    // A Privy token or a wallet session alone is never a staff pass.
    const bearer = new NextRequest("http://localhost/api/staff/campaigns", { method: "POST", headers: { authorization: "Bearer did:privy:the-admin", "x-wallet-session": "x" } });
    expect((await requireStaff(bearer, "admin", env)).ok).toBe(false);
  });

  it("does not pass an id merged into another account to the survivor", async () => {
    const absorbed = await person({ did: "did:privy:absorbed-admin" });
    const survivor = await person();
    const cookie = await sessionCookie(absorbed.id);
    await sql.query(`update users set retired_into = $1, privy_did = 'merged:' || privy_did, wallet_address = null where id = $2`, [
      survivor.id,
      absorbed.id,
    ]);
    const gate = await requireStaff(request(cookie), "admin", { STAFF_ADMIN_IDS: absorbed.id });
    expect(gate.ok).toBe(false);
  });

  it("is fresh only with an email code from the last 15 minutes, the staff area's one rule", async () => {
    const staff = await person({ did: "did:privy:fresh-admin" });
    const env = { STAFF_ADMIN_IDS: staff.id };
    process.env.STAFF_ADMIN_IDS = staff.id;
    expect((await requireFreshStaff(request(await sessionCookie(staff.id, 2)), "admin", env)).ok).toBe(true);
    expect(await requireFreshStaff(request(await sessionCookie(staff.id, 20)), "admin", env)).toMatchObject({ ok: false, stale: true });
    expect(await requireFreshStaff(request(await sessionCookie(staff.id, null)), "admin", env)).toMatchObject({ ok: false, stale: true });
    // Not staff at all: the plain 404, never "stale".
    const stranger = await requireFreshStaff(request(), "admin", env);
    expect(stranger.ok).toBe(false);
    expect("stale" in stranger).toBe(false);
  });

  it("the route is Next's 404 to anyone not on the list and for every other method, and writes nothing", async () => {
    const route = await import("@/app/api/staff/campaigns/route");
    const before = ((await sql.query(`select count(*)::int as n from campaigns where code = 'sneaky'`)) as { n: number }[])[0].n;
    const page = "<html><title>This page isn't here</title></html>";
    vi.stubGlobal("fetch", async () => new Response(page, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } }));
    try {
      for (const response of [
        await route.POST(request(`${staffCookieName()}=forged`, { action: "create", campaign: { code: "sneaky" } })),
        await route.GET(request()),
        await route.DELETE(request()),
      ]) {
        expect(response.status).toBe(404);
        expect(response.headers.get("content-type")).toContain("text/html");
        expect(await response.text()).toBe(page);
      }
    } finally {
      vi.unstubAllGlobals();
    }
    expect(((await sql.query(`select count(*)::int as n from campaigns where code = 'sneaky'`)) as { n: number }[])[0].n).toBe(before);
  });

  it("the route serves the masked queue to staff, audits the look, and turns a stale sign in away from approving", async () => {
    const staff = await person({ did: "did:privy:route-admin" });
    process.env.STAFF_ADMIN_IDS = staff.id;
    const { POST } = await import("@/app/api/staff/campaigns/route");
    const cookie = await sessionCookie(staff.id, 30);
    const response = await POST(request(cookie));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { campaigns: unknown[]; claims: unknown[] };
    expect(Array.isArray(body.campaigns)).toBe(true);
    expect((await audits("campaign.queue_view")).length).toBeGreaterThanOrEqual(1);
    const stale = await POST(request(cookie, { action: "approve", claimId: "00000000-0000-4000-8000-000000000000" }));
    expect(stale.status).toBe(401);
    expect(await stale.json()).toEqual({ error: "stale" });
    // Deleting a campaign is a fresh sign in act too.
    const draft = (await sql.query(
      `insert into campaigns (code, title, kind, starts_at, ends_at) values ('route-del', 'x', 'signup', now(), now() + interval '9 days') returning id`,
    )) as { id: string }[];
    const staleDelete = await POST(request(cookie, { action: "delete", campaignId: draft[0].id, reason: "Test" }));
    expect(staleDelete.status).toBe(401);
    expect(await campaignById(draft[0].id)).toBeDefined();
    const fresh = await sessionCookie(staff.id, 1);
    const deleted = await POST(request(fresh, { action: "delete", campaignId: draft[0].id, reason: "Test" }));
    expect(((await deleted.json()) as { result: unknown }).result).toEqual({ ok: true, detail: { code: "route-del" } });
    expect(await campaignById(draft[0].id)).toBeUndefined();
  });

  it("refuses a write from another origin or none, even with a fresh staff session, and writes nothing", async () => {
    const staff = await person({ did: "did:privy:origin-admin" });
    process.env.STAFF_ADMIN_IDS = staff.id;
    const cookie = await sessionCookie(staff.id, 1);
    const { POST } = await import("@/app/api/staff/campaigns/route");
    const page = "<html>not here</html>";
    vi.stubGlobal("fetch", async () => new Response(page, { status: 404, headers: { "content-type": "text/html" } }));
    try {
      for (const origin of ["https://evil.berthmarkets.com", null]) {
        const response = await POST(request(cookie, { action: "create", campaign: { code: "cross-site" } }, origin));
        expect(response.status).toBe(404);
        expect(response.headers.get("content-type")).toContain("text/html");
      }
    } finally {
      vi.unstubAllGlobals();
    }
    expect((await sql.query(`select 1 from campaigns where code = 'cross-site'`)) as unknown[]).toHaveLength(0);
  });
});

describe("campaigns", () => {
  it("are created inactive, and activate only with counsel review confirmed", async () => {
    const staff = await person();
    const created = await createCampaign(staff.id, {
      code: "Autumn-5",
      title: "Autumn",
      amountUsd: 5,
      budgetUsd: 100,
      maxClaims: 20,
      stayDays: 14,
      startsAt: new Date(Date.now() - 1000).toISOString(),
      endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    expect(created.ok).toBe(true);
    const row = ((await sql.query(`select id, active from campaigns where code = 'autumn-5'`)) as { id: string; active: boolean }[])[0];
    expect(row.active).toBe(false);
    expect(await setCampaignActive(staff.id, row.id, true, undefined, true)).toEqual({ ok: false, refusal: "counsel_required" });
    expect(await setCampaignActive(staff.id, row.id, true, "yes", true)).toEqual({ ok: false, refusal: "counsel_required" });
    expect(await setCampaignActive(staff.id, row.id, true, true)).toEqual({ ok: false, refusal: "funding_check_required" });
    expect(await setCampaignActive(staff.id, row.id, true, true, "yes")).toEqual({ ok: false, refusal: "funding_check_required" });
    // No payout wallet of its own: nowhere a sponsor's USDC could be said to go.
    expect(await setCampaignActive(staff.id, row.id, true, true, true)).toEqual({ ok: false, refusal: "no_funding_wallet" });
    expect((await campaignById(row.id))!.active).toBe(false);
    expect((await addPayoutSource(staff.id, row.id, FUNDING_WALLET, "The sponsor's campaign")).ok).toBe(true);
    expect((await setCampaignActive(staff.id, row.id, true, true, true)).ok).toBe(true);
    expect((await campaignById(row.id))!.active).toBe(true);
    expect((await setCampaignActive(staff.id, row.id, false, undefined)).ok).toBe(true);
    const activations = await audits("campaign.activate");
    expect(activations.map((entry) => entry.detail.outcome)).toEqual([
      "counsel_required",
      "counsel_required",
      "funding_check_required",
      "funding_check_required",
      "no_funding_wallet",
      "done",
    ]);
    expect(activations[5].detail).toMatchObject({
      counselReviewed: true,
      fundingChecked: true,
      fundingWallet: FUNDING_WALLET.toLowerCase(),
      chain: "base",
      token: USDC_BASE,
    });
    expect((await audits("campaign.pause")).at(-1)?.detail.outcome).toBe("done");
  });

  it("refuses a bad campaign and a taken code, audited", async () => {
    const staff = await person();
    const base = {
      title: "T",
      amountUsd: 5,
      budgetUsd: 100,
      maxClaims: 20,
      stayDays: 14,
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    expect(await createCampaign(staff.id, { ...base, code: "x" })).toMatchObject({ ok: false, refusal: "bad_input" });
    expect(await createCampaign(staff.id, { ...base, code: "ok-code", amountUsd: 500 })).toMatchObject({ ok: false, refusal: "bad_input" });
    expect(await createCampaign(staff.id, { ...base, code: "ok-code", endsAt: base.startsAt })).toMatchObject({ ok: false, refusal: "bad_input" });
    expect(await createCampaign(staff.id, { ...base, code: "long-stay", stayDays: 61 })).toMatchObject({ ok: false, refusal: "stay_out_of_range" });
    expect(await createCampaign(staff.id, { ...base, code: "short-stay", stayDays: 6 })).toMatchObject({ ok: false, refusal: "stay_out_of_range" });
    expect((await createCampaign(staff.id, { ...base, code: "month-stay", stayDays: 60 })).ok).toBe(true);
    expect(await createCampaign(staff.id, { ...base, code: "over-budget", maxClaims: 21 })).toMatchObject({ ok: false, refusal: "places_over_budget" });
    expect((await createCampaign(staff.id, { ...base, code: "ok-code" })).ok).toBe(true);
    expect(await createCampaign(staff.id, { ...base, code: "ok-code" })).toMatchObject({ ok: false, refusal: "code_taken" });
    expect((await audits("campaign.create")).map((entry) => entry.detail.outcome)).toContain("code_taken");
    expect((await audits("campaign.create")).map((entry) => entry.detail.outcome)).toContain("stay_out_of_range");
    const made = ((await sql.query(`select kind, hold_days from campaigns where code = 'month-stay'`)) as Record<string, unknown>[])[0];
    expect(made).toEqual({ kind: "signup", hold_days: 60 });
  });

  it("never activates a retired buy or invite campaign", async () => {
    const staff = await person();
    for (const kind of ["buy", "invite"]) {
      const rows = (await sql.query(
        `insert into campaigns (code, title, kind, starts_at, ends_at, active) values ($1, 'Old', $2, now(), now() + interval '9 days', false) returning id`,
        [`old-${kind}`, kind],
      )) as { id: string }[];
      await addPayoutSource(staff.id, rows[0].id, FUNDING_WALLET, "A wallet");
      expect(await setCampaignActive(staff.id, rows[0].id, true, true, true)).toEqual({ ok: false, refusal: "retired" });
      expect((await campaignById(rows[0].id))!.active).toBe(false);
    }
  });

  it("creates a campaign with its funding wallet as its first payout source, and refuses a bad one first", async () => {
    const staff = await person();
    const base = {
      title: "Sponsored",
      amountUsd: 5,
      budgetUsd: 100,
      maxClaims: 20,
      stayDays: 14,
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const typo = FUNDING_WALLET.replace("aAeb", "aaEb");
    expect(await createCampaign(staff.id, { ...base, code: "fund-typo", payoutAddress: typo })).toMatchObject({ ok: false, refusal: "bad_address" });
    expect(await createCampaign(staff.id, { ...base, code: "fund-zero", payoutAddress: `0x${"0".repeat(40)}` })).toMatchObject({ ok: false, refusal: "zero_address" });
    expect(await sql.query(`select 1 from campaigns where code in ('fund-typo', 'fund-zero')`)).toHaveLength(0);
    const created = await createCampaign(staff.id, { ...base, code: "fund-ok", payoutAddress: FUNDING_WALLET });
    expect(created).toMatchObject({ ok: true, detail: { payoutSource: true } });
    const id = String(created.detail?.id);
    const sources = (await sql.query(`select address, added_reason from campaign_payout_sources where campaign_id = $1 and removed_at is null`, [id])) as {
      address: string;
      added_reason: string;
    }[];
    expect(sources).toEqual([{ address: FUNDING_WALLET.toLowerCase(), added_reason: "Funding wallet, set when the campaign was created" }]);
    expect(await addPayoutSource(staff.id, id, `0x${"0".repeat(40)}`, "no")).toMatchObject({ ok: false, refusal: "zero_address" });
  });
});

describe("a claim from qualified to paid", () => {
  const HOUSE = hex(0xc0ffee);
  const ENV = { STAFF_PAYOUT_ADDRESSES: HOUSE };
  const pad = (address: string) => `0x${address.slice(2).padStart(64, "0")}`;
  const usdc = (pays: [string, bigint][], { status = "0x1", from = HOUSE } = {}): Receipt => ({
    status,
    blockNumber: "0x1",
    logs: pays.map(([to, raw]) => ({ address: USDC_BASE, topics: [TRANSFER_TOPIC, pad(from), pad(to)], data: `0x${raw.toString(16)}` })),
  });

  async function qualified(code: string) {
    await sql.query(
      `insert into campaigns (code, title, starts_at, ends_at, active) values ($1, $1, now() - interval '1 day', now() + interval '30 days', true)
       on conflict (code) do nothing`,
      [code],
    );
    return qualifiedClaim(code);
  }

  async function approved(code: string) {
    const staff = await person();
    const arrived = await qualified(code);
    expect((await approveClaim(staff.id, arrived.claimId)).ok).toBe(true);
    return { staff, ...arrived, to: (await claimById(arrived.claimId))!.payout_address! };
  }

  it("approves, fixing the signup's own home address on Base, with the audit row in the same write", async () => {
    const staff = await person();
    const { user, claimId } = await qualified("pay-me");
    // Whoever invited the account personally is never the one paid.
    const inviter = await person();
    await sql.query(`update users set referred_by = $2 where id = $1`, [user.id, inviter.id]);
    expect((await approveClaim(staff.id, claimId)).ok).toBe(true);
    const claim = (await claimById(claimId))!;
    expect(claim).toMatchObject({ state: "approved", payout_address: user.wallet_address, payout_chain: "base", approved_by: staff.id, inviter_id: null });
    expect(claim.payout_address).not.toBe(inviter.wallet_address);
    expect((await audits("claim.approve")).find((entry) => entry.target === claimId)?.detail).toMatchObject({ paidTo: "signup" });
    expect((await audits("claim.approve")).filter((entry) => entry.target === claimId).map((entry) => entry.detail.outcome)).toEqual(["done"]);
    expect(await approveClaim(staff.id, claimId)).toEqual({ ok: false, refusal: "wrong_state" });
  });

  it("refuses to approve or pay a claim whose account staff marked not eligible", async () => {
    const staff = await person();
    const { user, claimId } = await qualified("marked-later");
    await sql.query(`update users set campaign_ineligible_at = now() where id = $1`, [user.id]);
    expect(await approveClaim(staff.id, claimId)).toMatchObject({ ok: false, refusal: "staff_ineligible" });
    await sql.query(`update users set campaign_ineligible_at = null where id = $1`, [user.id]);
    expect((await approveClaim(staff.id, claimId)).ok).toBe(true);
    await sql.query(`update users set campaign_ineligible_at = now() where id = $1`, [user.id]);
    expect(await markClaimPaid(staff.id, claimId, `0x${"ab".repeat(32)}`)).toMatchObject({ ok: false, refusal: "staff_ineligible" });
    // The queue says so on the approved claim, before anyone pays by hand.
    const flagged = (await staffQueue()).claims.find((claim) => claim.id === claimId)!;
    expect(flagged).toMatchObject({ state: "approved" });
    expect(flagged.staffIneligibleAt).not.toBeNull();
    await sql.query(`update users set campaign_ineligible_at = null where id = $1`, [user.id]);
    expect((await staffQueue()).claims.find((claim) => claim.id === claimId)!.staffIneligibleAt).toBeNull();
  });

  it("asks the guards again at approval: an account merged since into one that was on Berth before is refused", async () => {
    const staff = await person();
    const { user, claimId } = await qualified("approve-merged");
    const older = await person();
    await sql.query(`update users set created_at = now() - interval '30 days' where id = $1`, [older.id]);
    await sql.query(`update users set retired_into = $1, privy_did = 'merged:' || privy_did, wallet_address = null where id = $2`, [older.id, user.id]);
    expect(await approveClaim(staff.id, claimId)).toEqual({ ok: false, refusal: "existing_customer" });
  });

  it("refuses to approve when the account has no home address", async () => {
    const staff = await person();
    const { user, claimId } = await qualified("no-home");
    await sql.query(`update users set wallet_address = null where id = $1`, [user.id]);
    expect(await approveClaim(staff.id, claimId)).toEqual({ ok: false, refusal: "no_payout_address" });
  });

  it("never approves a claim of a retired buy campaign", async () => {
    const staff = await person();
    const friend = await person();
    const rows = (await sql.query(
      `insert into campaigns (code, title, kind, starts_at, ends_at, active) values ('retired-claim', 'Old', 'buy', now() - interval '9 days', now(), false) returning id`,
    )) as { id: string }[];
    const claim = (await sql.query(`insert into campaign_claims (campaign_id, user_id, state) values ($1, $2, 'qualified') returning id`, [rows[0].id, friend.id])) as {
      id: string;
    }[];
    expect(await approveClaim(staff.id, claim[0].id)).toEqual({ ok: false, refusal: "retired" });
  });

  it("marks paid only after a verified transfer from a house wallet, and refuses everything else", async () => {
    const { staff, claimId, to } = await approved("paid-check");
    const hash = `0x${"ab".repeat(32)}`;
    expect(await markClaimPaid(staff.id, claimId, "0x123", async () => null, ENV)).toEqual({ ok: false, refusal: "bad_hash" });
    expect(await markClaimPaid(staff.id, claimId, hash, async () => usdc([[to, 5_000_000n]]), {})).toMatchObject({ ok: false, refusal: "no_payout_senders" });
    expect(await markClaimPaid(staff.id, claimId, hash, async () => usdc([[to, 4_000_000n]]), ENV)).toMatchObject({ ok: false, refusal: "mismatch" });
    expect(await markClaimPaid(staff.id, claimId, hash, async () => usdc([[hex(0xdead), 5_000_000n]]), ENV)).toMatchObject({ ok: false, refusal: "mismatch" });
    // P5: somebody else's USDC to the same address never reads as paid.
    expect(await markClaimPaid(staff.id, claimId, hash, async () => usdc([[to, 5_000_000n]], { from: hex(0x5157) }), ENV)).toMatchObject({ ok: false, refusal: "mismatch" });
    expect(await markClaimPaid(staff.id, claimId, hash, async () => usdc([[to, 5_000_000n]], { status: "0x0" }), ENV)).toMatchObject({ ok: false, refusal: "tx_failed" });
    expect((await claimById(claimId))!.state).toBe("approved");
    expect(await markClaimPaid(staff.id, claimId, hash, async () => usdc([[to, 5_000_000n]]), ENV)).toEqual({ ok: true, detail: { verified: true } });
    expect((await claimById(claimId))!).toMatchObject({ state: "paid", paid_tx: hash, paid_verified: true, paid_by: staff.id });
    expect((await audits("claim.mark_paid")).map((entry) => entry.detail.outcome)).toEqual(
      expect.arrayContaining(["bad_hash", "no_payout_senders", "mismatch", "tx_failed", "done"]),
    );
  });

  it("P4: an unreadable hash keeps the claim approved, pending, and a failed recheck clears it; a right hash then pays", async () => {
    const { staff, claimId, to } = await approved("pending-hash");
    const typo = `0x${"cd".repeat(32)}`;
    const unreadable = async () => {
      throw new Error("rpc down");
    };
    expect(await markClaimPaid(staff.id, claimId, typo, unreadable, ENV)).toEqual({ ok: true, detail: { verified: false } });
    expect((await claimById(claimId))!).toMatchObject({ state: "approved", paid_tx: typo, paid_verified: false, paid_at: null });
    // The same hash read again, now reverted: cleared, still approved.
    expect(await markClaimPaid(staff.id, claimId, typo, async () => usdc([[to, 5_000_000n]], { status: "0x0" }), ENV)).toMatchObject({ refusal: "tx_failed" });
    expect((await claimById(claimId))!).toMatchObject({ state: "approved", paid_tx: null });
    expect((await audits("claim.clear_paid_tx")).at(-1)?.detail.because).toBe("tx_failed");
    // Pending again, then replaced by the right hash.
    await markClaimPaid(staff.id, claimId, typo, async () => null, ENV);
    const right = `0x${"ef".repeat(32)}`;
    expect(await markClaimPaid(staff.id, claimId, right, async () => usdc([[to, 5_000_000n]]), ENV)).toEqual({ ok: true, detail: { verified: true } });
    expect((await claimById(claimId))!).toMatchObject({ state: "paid", paid_tx: right });
    expect((await audits("claim.replace_paid_tx")).at(-1)?.detail).toMatchObject({ replaced: typo, outcome: "done" });
  });

  it("lets one batch transaction pay several claims, each recipient its own sum", async () => {
    const a = await approved("batch-pay");
    const b = await approved("batch-pay");
    const batch = `0x${"9a".repeat(32)}`;
    const receipt = async () => usdc([[a.to, 5_000_000n], [b.to, 5_000_000n]]);
    expect((await markClaimPaid(a.staff.id, a.claimId, batch, receipt, ENV)).ok).toBe(true);
    expect((await markClaimPaid(b.staff.id, b.claimId, batch, receipt, ENV)).ok).toBe(true);
    expect([(await claimById(a.claimId))!.state, (await claimById(b.claimId))!.state]).toEqual(["paid", "paid"]);
    // A third claim at an address the batch paid only once is refused cleanly, audited.
    const c = await approved("batch-pay");
    await sql.query(`update campaign_claims set payout_address = $2 where id = $1`, [c.claimId, a.to]);
    expect(await markClaimPaid(c.staff.id, c.claimId, batch, receipt, ENV)).toMatchObject({ ok: false, refusal: "mismatch" });
  });

  it("rejects with a reason from the list, audited with the note", async () => {
    const staff = await person();
    const { claimId } = await qualified("reject-me");
    expect(await rejectClaim(staff.id, claimId, "because", "")).toEqual({ ok: false, refusal: "bad_reason" });
    expect((await rejectClaim(staff.id, claimId, "abuse", "three accounts, one card")).ok).toBe(true);
    expect((await claimById(claimId))!).toMatchObject({ state: "rejected", reject_reason: "abuse", rejected_by: staff.id });
    expect((await audits("claim.reject")).at(-1)?.detail).toMatchObject({ reason: "abuse", note: "three accounts, one card", outcome: "done" });
    expect(await rejectClaim(staff.id, claimId, "abuse", "")).toMatchObject({ ok: false, refusal: "wrong_state" });
  });

  it("masks the email and wallets in the queue, and reveals one claim's in full", async () => {
    const { user, claimId } = await qualified("masked");
    const claim = (await staffQueue()).claims.find((entry) => entry.id === claimId)!;
    expect(claim.email).toBe(`${user.email!.slice(0, 1)}•••@example.com`);
    expect(claim.payout.address).toMatch(/^0x[0-9a-f]{4}…[0-9a-f]{4}$/);
    expect(claim.wallets.every((wallet) => wallet.address.includes("…"))).toBe(true);
    expect(await revealClaim(claimId, "email")).toEqual({ email: user.email });
    expect(await revealClaim(claimId, "wallets")).toMatchObject({ payout: user.wallet_address });
  });

  it("the queue carries the evidence and the meter", async () => {
    const { user, claimId } = await qualified("evidence");
    const queue = await staffQueue();
    const claim = queue.claims.find((entry) => entry.id === claimId)!;
    expect(claim).toMatchObject({ state: "qualified", userId: user.id, campaignCode: "evidence", campaignKind: "signup" });
    expect(claim.payout.address).toBe(`${user.wallet_address!.slice(0, 6)}…${user.wallet_address!.slice(-4)}`);
    const stored = (await claimById(claimId))!;
    expect(claim.onboardedAt).toBe(stored.onboarded_at!.toISOString());
    expect(claim.lastSeenAt).toBe(new Date(stored.eligible_at!.getTime() - 86_400_000).toISOString());
    expect(claim.payout).toMatchObject({ chain: "Base", token: "USDC", amountUsd: 5 });
    const meter = queue.campaigns.find((campaign) => campaign.code === "evidence")!;
    expect(meter).toMatchObject({ slots: 1, reservedUsd: 5, paidUsd: 0, budgetUsd: 100, maxClaims: 20, deletable: false });
  });
});

describe("signals", () => {
  it("folds email aliases", () => {
    expect(foldEmail("A.Bc+campaign@googlemail.com")).toBe("abc@gmail.com");
    expect(foldEmail("a.b+x@example.com")).toBe("a.b@example.com");
    expect(foldEmail(null)).toBeNull();
  });

  it("flags aliases, close signups and shared wallets within one campaign only", () => {
    const base = { campaignId: "c1", wallets: [] as string[] };
    const signals = deriveSignals([
      { ...base, id: "1", userId: "u1", email: "ann.lee@gmail.com", signupAt: 0, wallets: ["0xw"] },
      { ...base, id: "2", userId: "u2", email: "annlee+2@gmail.com", signupAt: 5 * 60_000 },
      { ...base, id: "3", userId: "u3", email: "bob@example.com", signupAt: 3 * 3_600_000, wallets: ["0xw"] },
      { ...base, campaignId: "c2", id: "4", userId: "u4", email: "ann.lee@gmail.com", signupAt: 0 },
    ]);
    expect(signals.get("2")).toEqual(["email_alias", "close_signup"]);
    expect(signals.get("3")).toEqual(["shared_wallet"]);
    expect(signals.get("4")).toEqual([]);
    const payouts = deriveSignals([
      { ...base, id: "5", userId: "u5", email: null, signupAt: 0, payout: "0xpay" },
      { ...base, id: "6", userId: "u6", email: null, signupAt: 9e9, payout: "0xpay" },
      { ...base, id: "8", userId: "u8", email: null, signupAt: 5e9, payout: "0xown" },
    ]);
    // Each claim pays its own account: two people at one address is the signal.
    expect(payouts.get("5")).toEqual(["same_payout"]);
    expect(payouts.get("8")).toEqual([]);
  });
});

describe("deleting a campaign", () => {
  async function draft(code: string, { active = false, kind = "signup" } = {}) {
    const rows = (await sql.query(
      `insert into campaigns (code, title, kind, starts_at, ends_at, active) values ($1, $1, $3, now() - interval '1 day', now() + interval '30 days', $2) returning id`,
      [code, active, kind],
    )) as { id: string }[];
    return rows[0].id;
  }
  const WHY = "Set up again with the right dates";

  it("deletes a draft with its payout wallets, audited with the reason in the same transaction, and frees its code", async () => {
    const staff = await person();
    const id = await draft("del-draft");
    expect((await addPayoutSource(staff.id, id, FUNDING_WALLET, "The sponsor")).ok).toBe(true);
    expect(await deleteCampaign(staff.id, id, WHY)).toEqual({ ok: true, detail: { code: "del-draft" } });
    expect(await campaignById(id)).toBeUndefined();
    expect(await sql.query(`select 1 from campaign_payout_sources where campaign_id = $1`, [id])).toHaveLength(0);
    const audit = (await audits("campaign.delete")).find((entry) => entry.target === id)!;
    expect(audit.detail).toMatchObject({ code: "del-draft", title: "del-draft", reason: WHY, neverActivated: true, sourcesRemoved: 1, claimsRemoved: 0, outcome: "done" });
    // The code is free: a new campaign takes it.
    const again = await createCampaign(staff.id, {
      code: "del-draft",
      title: "Again",
      amountUsd: 5,
      budgetUsd: 100,
      maxClaims: 20,
      stayDays: 14,
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(again.ok).toBe(true);
  });

  it("asks for a reason, audited", async () => {
    const staff = await person();
    const id = await draft("del-why");
    expect(await deleteCampaign(staff.id, id, "  ")).toMatchObject({ ok: false, refusal: "bad_reason" });
    expect(await deleteCampaign(staff.id, id, undefined)).toMatchObject({ ok: false, refusal: "bad_reason" });
    expect(await campaignById(id)).toBeDefined();
    expect((await audits("campaign.delete")).filter((entry) => entry.target === id).map((entry) => entry.detail.outcome)).toEqual(["bad_reason", "bad_reason"]);
  });

  it("refuses while the campaign is active, and for a retired buy or invite campaign", async () => {
    const staff = await person();
    const id = await draft("del-active", { active: true });
    expect(await deleteCampaign(staff.id, id, WHY)).toMatchObject({ ok: false, refusal: "active" });
    expect(await campaignById(id)).toBeDefined();
    expect((await audits("campaign.delete")).find((entry) => entry.target === id)?.detail.outcome).toBe("active");
    for (const kind of ["buy", "invite"]) {
      const old = await draft(`del-${kind}`, { kind });
      expect(await deleteCampaign(staff.id, old, WHY)).toMatchObject({ ok: false, refusal: "retired" });
      expect(await campaignById(old)).toBeDefined();
      expect((await staffQueue()).campaigns.find((campaign) => campaign.id === old)).toMatchObject({ deletable: false });
    }
  });

  it("deletes a paused campaign whose claims never held a place, with those claims", async () => {
    const staff = await person();
    const id = await draft("del-open", { active: true });
    const open = await joined({ code: "del-open" });
    const gone = await joined({ code: "del-open" });
    await sql.query(`update campaign_claims set state = 'rejected', reject_reason = 'abuse' where id = $1`, [gone.claimId]);
    await setCampaignActive(staff.id, id, false, undefined);
    expect((await staffQueue()).campaigns.find((campaign) => campaign.id === id)).toMatchObject({ deletable: true, draft: true });
    expect((await deleteCampaign(staff.id, id, WHY)).ok).toBe(true);
    expect(await claimById(open.claimId)).toBeUndefined();
    expect(await claimById(gone.claimId)).toBeUndefined();
  });

  it("refuses once any claim holds or ever held a place, was paid, or stands on marks: money history is never erased", async () => {
    const staff = await person();
    const holding = await draft("del-holding", { active: true });
    const signup = await joined({ code: "del-holding" });
    await username(signup.user);
    expect(await advance(signup.claimId)).toBe("holding");
    await setCampaignActive(staff.id, holding, false, undefined);
    expect((await staffQueue()).campaigns.find((campaign) => campaign.id === holding)).toMatchObject({ deletable: false });
    expect(await deleteCampaign(staff.id, holding, WHY)).toMatchObject({ ok: false, refusal: "has_places" });
    for (const state of ["qualified", "approved", "paid"]) {
      await sql.query(`update campaign_claims set state = $2 where id = $1`, [signup.claimId, state]);
      expect(await deleteCampaign(staff.id, holding, WHY)).toMatchObject({ ok: false, refusal: "has_places" });
    }
    // Rejected after it held a place: the place it once held still keeps the campaign.
    await sql.query(`update campaign_claims set state = 'rejected', reject_reason = 'not_active' where id = $1`, [signup.claimId]);
    expect(await deleteCampaign(staff.id, holding, WHY)).toMatchObject({ ok: false, refusal: "has_places" });
    expect((await staffQueue()).campaigns.find((campaign) => campaign.id === holding)).toMatchObject({ deletable: false });
    expect(await claimById(signup.claimId)).toBeDefined();
    expect(await campaignById(holding)).toBeDefined();
    // A claim that never held a place but stands on a mark keeps it too.
    const marked = await draft("del-marked");
    const other = await person();
    const claim = (await sql.query(`insert into campaign_claims (campaign_id, user_id, state) values ($1, $2, 'rejected') returning id`, [marked, other.id])) as { id: string }[];
    await sql.query(`insert into campaign_invitee_marks (mark, claim_id) values ('email:marked@example.com', $1)`, [claim[0].id]);
    expect((await staffQueue()).campaigns.find((campaign) => campaign.id === marked)).toMatchObject({ deletable: false });
    expect(await deleteCampaign(staff.id, marked, WHY)).toMatchObject({ ok: false, refusal: "has_places" });
  });

  it("answers not found for a campaign that is not there", async () => {
    const staff = await person();
    expect(await deleteCampaign(staff.id, "00000000-0000-4000-8000-000000000000", WHY)).toMatchObject({ ok: false, refusal: "not_found" });
  });
});
