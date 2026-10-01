import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { setSqlClient, type SqlClient } from "../db";
import { makeTestDb } from "../pglite-test-db";
import { getOrCreateUser, type UserRow } from "../accounts";
import { requireFreshStaff, requireStaff, staffAdminIds } from "../staff-auth";
import { STOCK_LISTINGS } from "@/lib/listings";
import { attributeCampaign, claimById } from "./store";
import { advanceClaim, runCampaignStep } from "./eligibility";
import { campaignById } from "./store";
import { approveClaim, createCampaign, markClaimPaid, rejectClaim, setCampaignActive } from "./actions";
import { deriveSignals, foldEmail, revealClaim, staffQueue } from "./queue";
import { TRANSFER_TOPIC, USDC_BASE, type Receipt } from "./usdc";
import { DEPS, hubOf, verifier } from "./test-kit";

/**
 * The staff side against the real schema: the gate (STAFF_ADMIN_IDS, never
 * the @sodax.com rule), every action audited, activation only with counsel
 * review confirmed, approval fixing the payout address, mark paid checked
 * against a mocked Base RPC, and the queue's evidence, signals and meter.
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

function request(authorization?: string, body: Record<string, unknown> = { action: "queue" }): NextRequest {
  return new NextRequest("http://localhost/api/staff/campaigns", {
    method: "POST",
    headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
    body: JSON.stringify(body),
  });
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

  it("lets in only a signed in account on the allowlist, with one 404 for everyone else, and keeps the probes", async () => {
    const staff = await person({ did: "did:privy:the-admin" });
    const sodax = await person({ did: "did:privy:someone-at-sodax" });
    await sql.query(`update users set email = 'someone@sodax.com' where id = $1`, [sodax.id]);
    expect((await requireStaff(request("Bearer did:privy:the-admin"), "admin", {})).ok).toBe(false);
    const env = { STAFF_ADMIN_IDS: staff.id };
    const ok = await requireStaff(request("Bearer did:privy:the-admin"), "admin", env);
    expect(ok).toEqual({ ok: true, staff: { userId: staff.id, role: "admin" } });
    for (const authorization of [undefined, "Bearer did:privy:someone-at-sodax", "Bearer did:privy:nobody-yet", "Bearer broken"]) {
      const gate = await requireStaff(request(authorization), "admin", env);
      expect(gate.ok).toBe(false);
      if (!gate.ok) expect(gate.response.status).toBe(404);
    }
    expect((await sql.query(`select 1 from users where privy_did = 'did:privy:nobody-yet'`)) as unknown[]).toHaveLength(0);
    // The signed in non staff account asking was kept; the anonymous ones leave nothing.
    const denied = (await sql.query(`select staff_user_id, target from staff_audit where action = 'staff.denied'`)) as { staff_user_id: string; target: string }[];
    expect(denied).toEqual([
      { staff_user_id: staff.id, target: "/api/staff/campaigns" },
      { staff_user_id: sodax.id, target: "/api/staff/campaigns" },
    ]);
  });

  it("does not pass an id merged into another account to the survivor", async () => {
    const absorbed = await person({ did: "did:privy:absorbed-admin" });
    const survivor = await person();
    await sql.query(`update users set retired_into = $1, privy_did = 'merged:' || privy_did, wallet_address = null where id = $2`, [
      survivor.id,
      absorbed.id,
    ]);
    const gate = await requireStaff(request("Bearer did:privy:absorbed-admin"), "admin", { STAFF_ADMIN_IDS: absorbed.id });
    expect(gate.ok).toBe(false);
  });

  it("asks Privy for a fresh email code on the account's own email for the acts that matter", async () => {
    const staff = await person({ did: "did:privy:fresh-admin" });
    const env = { STAFF_ADMIN_IDS: staff.id };
    const now = Date.now();
    const proof = (address: string, minutesAgo: number | null) => async () => [{ address, at: minutesAgo === null ? null : now - minutesAgo * 60_000 }];
    const ask = (proofs: Parameters<typeof requireFreshStaff>[4]) => requireFreshStaff(request("Bearer did:privy:fresh-admin"), "admin", env, now, proofs);
    expect((await ask(proof(staff.email!, 2))).ok).toBe(true);
    expect(await ask(proof(staff.email!, 20))).toMatchObject({ ok: false, stale: true });
    expect(await ask(proof(staff.email!, null))).toMatchObject({ ok: false, stale: true });
    // A fresh code to some other address of the Privy user is not this account's email.
    expect(await ask(proof("other@example.com", 1))).toMatchObject({ ok: false, stale: true });
    // Privy not answering: stale, never let through.
    expect(await ask(async () => null)).toMatchObject({ ok: false, stale: true });
    // Not staff at all: the plain 404, never "stale".
    const stranger = await requireFreshStaff(request("Bearer did:privy:someone-at-sodax"), "admin", env, now, proof("x@example.com", 1));
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
        await route.POST(request("Bearer did:privy:nobody-at-all", { action: "create", campaign: { code: "sneaky" } })),
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
    const response = await POST(request("Bearer did:privy:route-admin"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { campaigns: unknown[]; claims: unknown[] };
    expect(Array.isArray(body.campaigns)).toBe(true);
    expect((await audits("campaign.queue_view")).length).toBeGreaterThanOrEqual(1);
    const stale = await POST(request("Bearer did:privy:route-admin", { action: "approve", claimId: "00000000-0000-4000-8000-000000000000" }));
    expect(stale.status).toBe(403);
    expect(await stale.json()).toEqual({ error: "fresh_session" });
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
      minBuyUsd: 10,
      holdDays: 7,
      startsAt: new Date(Date.now() - 1000).toISOString(),
      endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    expect(created.ok).toBe(true);
    const row = ((await sql.query(`select id, active from campaigns where code = 'autumn-5'`)) as { id: string; active: boolean }[])[0];
    expect(row.active).toBe(false);
    expect(await setCampaignActive(staff.id, row.id, true, undefined)).toEqual({ ok: false, refusal: "counsel_required" });
    expect(await setCampaignActive(staff.id, row.id, true, "yes")).toEqual({ ok: false, refusal: "counsel_required" });
    expect((await setCampaignActive(staff.id, row.id, true, true)).ok).toBe(true);
    expect((await campaignById(row.id))!.active).toBe(true);
    expect((await setCampaignActive(staff.id, row.id, false, undefined)).ok).toBe(true);
    const activations = await audits("campaign.activate");
    expect(activations.map((entry) => entry.detail.outcome)).toEqual(["counsel_required", "counsel_required", "done"]);
    expect(activations[2].detail.counselReviewed).toBe(true);
    expect((await audits("campaign.pause")).at(-1)?.detail.outcome).toBe("done");
  });

  it("refuses a bad campaign and a taken code, audited", async () => {
    const staff = await person();
    const base = {
      title: "T",
      amountUsd: 5,
      budgetUsd: 100,
      maxClaims: 20,
      minBuyUsd: 10,
      holdDays: 7,
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    expect(await createCampaign(staff.id, { ...base, code: "x" })).toMatchObject({ ok: false, refusal: "bad_input" });
    expect(await createCampaign(staff.id, { ...base, code: "ok-code", amountUsd: 500 })).toMatchObject({ ok: false, refusal: "bad_input" });
    expect(await createCampaign(staff.id, { ...base, code: "ok-code", endsAt: base.startsAt })).toMatchObject({ ok: false, refusal: "bad_input" });
    expect((await createCampaign(staff.id, { ...base, code: "ok-code" })).ok).toBe(true);
    expect(await createCampaign(staff.id, { ...base, code: "ok-code" })).toMatchObject({ ok: false, refusal: "code_taken" });
    expect((await audits("campaign.create")).map((entry) => entry.detail.outcome)).toContain("code_taken");
  });
});

describe("a claim from qualified to paid", () => {
  const STOCK = STOCK_LISTINGS[0];
  const HOUSE = hex(0xc0ffee);
  const ENV = { STAFF_PAYOUT_ADDRESSES: HOUSE };
  const pad = (address: string) => `0x${address.slice(2).padStart(64, "0")}`;
  const usdc = (pays: [string, bigint][], { status = "0x1", from = HOUSE } = {}): Receipt => ({
    status,
    blockNumber: "0x1",
    logs: pays.map(([to, raw]) => ({ address: USDC_BASE, topics: [TRANSFER_TOPIC, pad(from), pad(to)], data: `0x${raw.toString(16)}` })),
  });
  const held = { verifyHold: verifier(() => "held") };

  async function qualified(code: string) {
    await sql.query(
      `insert into campaigns (code, title, starts_at, ends_at, active) values ($1, $1, now() - interval '1 day', now() + interval '30 days', true)
       on conflict (code) do nothing`,
      [code],
    );
    const user = await person();
    const claimId = (await attributeCampaign(user.id, code))!;
    seq += 1;
    await sql.query(
      `insert into orders (user_id, wallet_address, intent_tx, direction, listing_symbol, listing_address, quantity, usd_value, delivered_to, filled_at)
       values ($1, $2, $3, 'buy', $4, $5, '0.05', 12, $6, now() + interval '1 second')`,
      [user.id, user.wallet_address, `0x${seq.toString(16).padStart(64, "0")}`, STOCK.symbol, STOCK.address, hubOf(user.wallet_address!)],
    );
    const claim = (await claimById(claimId))!;
    expect(await advanceClaim(claim, (await campaignById(claim.campaign_id))!, new Date(Date.now() + 2_000), DEPS)).toBe("holding");
    await runCampaignStep({ now: new Date(Date.now() + 8 * 86_400_000), verifyHold: verifier(() => "held"), deps: DEPS });
    expect((await claimById(claimId))!.state).toBe("qualified");
    return { user, claimId };
  }

  async function approved(code: string) {
    const staff = await person();
    const arrived = await qualified(code);
    expect((await approveClaim(staff.id, arrived.claimId, held)).ok).toBe(true);
    return { staff, ...arrived, to: (await claimById(arrived.claimId))!.payout_address! };
  }

  it("approves, fixing the person's own home address on Base, with the audit row in the same write", async () => {
    const staff = await person();
    const { user, claimId } = await qualified("pay-me");
    expect((await approveClaim(staff.id, claimId, held)).ok).toBe(true);
    const claim = (await claimById(claimId))!;
    expect(claim).toMatchObject({ state: "approved", payout_address: user.wallet_address, payout_chain: "base", approved_by: staff.id });
    expect((await audits("claim.approve")).filter((entry) => entry.target === claimId).map((entry) => entry.detail.outcome)).toEqual(["done"]);
    expect(await approveClaim(staff.id, claimId, held)).toEqual({ ok: false, refusal: "wrong_state" });
  });

  it("reads the hold again at approval, and refuses one no longer kept or unreadable", async () => {
    const staff = await person();
    const { claimId } = await qualified("approve-recheck");
    expect(await approveClaim(staff.id, claimId, { verifyHold: verifier(() => "unknown") })).toMatchObject({ ok: false, refusal: "hold_unknown" });
    expect(await approveClaim(staff.id, claimId, { verifyHold: verifier(() => "not_held") })).toMatchObject({ ok: false, refusal: "not_held" });
    expect((await claimById(claimId))!.state).toBe("qualified");
  });

  it("asks one per person again at approval: a claim merged into another claimant since is refused", async () => {
    const staff = await person();
    const a = await qualified("approve-merged");
    const b = await qualified("approve-merged");
    await sql.query(`update users set retired_into = $1, privy_did = 'merged:' || privy_did, wallet_address = null where id = $2`, [a.user.id, b.user.id]);
    expect(await approveClaim(staff.id, b.claimId, held)).toEqual({ ok: false, refusal: "one_per_person" });
  });

  it("refuses to approve an account with no home address", async () => {
    const staff = await person();
    const { user, claimId } = await qualified("no-home");
    await sql.query(`update users set wallet_address = null where id = $1`, [user.id]);
    expect(await approveClaim(staff.id, claimId, held)).toEqual({ ok: false, refusal: "no_payout_address" });
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

  it("masks emails and wallets in the queue, and reveals one claim's in full", async () => {
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
    expect(claim).toMatchObject({ state: "qualified", userId: user.id, campaignCode: "evidence" });
    expect(claim.buy).toMatchObject({ listing: STOCK.name, usd: 12, quantity: "0.05" });
    expect(claim.hold).toMatchObject({ needed: "0.05", balanceRaw: "50000000000000000", lowestRaw: "50000000000000000", outflows: 0 });
    expect(claim.payout).toMatchObject({ chain: "Base", token: "USDC", amountUsd: 5 });
    const meter = queue.campaigns.find((campaign) => campaign.code === "evidence")!;
    expect(meter).toMatchObject({ slots: 1, reservedUsd: 5, paidUsd: 0, budgetUsd: 100, maxClaims: 20 });
  });
});

describe("signals", () => {
  it("folds email aliases", () => {
    expect(foldEmail("A.Bc+campaign@googlemail.com")).toBe("abc@gmail.com");
    expect(foldEmail("a.b+x@example.com")).toBe("a.b@example.com");
    expect(foldEmail(null)).toBeNull();
  });

  it("flags shared payers, aliases, close signups, invites and shared wallets within one campaign only", () => {
    const base = { campaignId: "c1", referredBy: null, deliveredTo: null, wallets: [] as string[] };
    const signals = deriveSignals([
      { ...base, id: "1", userId: "u1", email: "ann.lee@gmail.com", signupAt: 0, payer: "0xp", wallets: ["0xw"] },
      { ...base, id: "2", userId: "u2", email: "annlee+2@gmail.com", signupAt: 5 * 60_000, payer: "0xp", referredBy: "u1" },
      { ...base, id: "3", userId: "u3", email: "bob@example.com", signupAt: 3 * 3_600_000, payer: "0xq", wallets: ["0xw"] },
      { ...base, campaignId: "c2", id: "4", userId: "u4", email: "ann.lee@gmail.com", signupAt: 0, payer: "0xp" },
    ]);
    expect(signals.get("2")).toEqual(["same_payer", "email_alias", "close_signup", "referred_by_claimant"]);
    expect(signals.get("3")).toEqual(["shared_wallet"]);
    expect(signals.get("4")).toEqual([]);
    const payouts = deriveSignals([
      { ...base, id: "5", userId: "u5", email: null, signupAt: 0, payer: null, payout: "0xpay" },
      { ...base, id: "6", userId: "u6", email: null, signupAt: 9e9, payer: null, payout: "0xpay" },
    ]);
    expect(payouts.get("5")).toEqual(["same_payout"]);
  });
});
