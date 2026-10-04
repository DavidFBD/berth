import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getAddress } from "viem";
import { setSqlClient, type SqlClient } from "../db";
import { makeTestDb } from "../pglite-test-db";
import { addPayoutSource, approveClaim, checksummedAddress, markClaimPaid, removePayoutSource } from "./actions";
import { claimById } from "./store";
import { staffQueue } from "./queue";
import { TRANSFER_TOPIC, USDC_BASE, type Receipt } from "./usdc";
import { campaign, hex, person, qualifiedClaim } from "./test-kit";

/**
 * Per campaign payout sources (campaign_payout_sources): added and removed
 * by admins with a checksummed address and a reason, audited in the same
 * statement, every admin told by email; Mark paid accepts USDC only from an
 * active source of the claim's own campaign (or the optional global
 * STAFF_PAYOUT_ADDRESSES), and removing one never un-pays a claim.
 */

const sent: { userId: string; ref: string; notice: { type: string; change?: string } }[] = [];
vi.mock("@/lib/server/email/notify", () => ({
  sendNotice: (input: { userId: string; ref: string; notice: { type: string } }) => void sent.push(input),
}));
vi.mock("@/lib/server/privy", () => ({
  verifyPrivyAuth: async (authorization: string | null) => (authorization?.startsWith("Bearer did:") ? authorization.slice(7) : null),
  fetchPrivyWallet: async () => ({ ok: true, address: null }),
  fetchPrivyEmail: async () => null,
  fetchPrivyEmailProofs: async () => null,
}));

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

const HOUSE = getAddress(hex(0xc0ffee));
const OTHER_HOUSE = getAddress(hex(0xbeefcafe));
const NO_ENV = {};
const pad = (address: string) => `0x${address.toLowerCase().slice(2).padStart(64, "0")}`;
const usdc = (to: string, raw: bigint, from: string): Receipt => ({
  status: "0x1",
  blockNumber: "0x1",
  logs: [{ address: USDC_BASE, topics: [TRANSFER_TOPIC, pad(from), pad(to)], data: `0x${raw.toString(16)}` }],
});

async function staff() {
  return person();
}

async function approvedClaim(code: string) {
  const existing = (await sql.query(`select id from campaigns where code = $1`, [code])) as { id: string }[];
  const id = existing[0]?.id ?? (await campaign(code));
  const arrived = await qualifiedClaim(code);
  const admin = (await sql.query(`select id from users order by created_at limit 1`)) as { id: string }[];
  expect((await approveClaim(admin[0].id, arrived.claimId)).ok).toBe(true);
  return { campaignId: id, claimId: arrived.claimId, to: (await claimById(arrived.claimId))!.payout_address! };
}

async function audits(action: string) {
  return (await sql.query(`select target, detail from staff_audit where action = $1 order by id`, [action])) as {
    target: string;
    detail: Record<string, unknown>;
  }[];
}

describe("checksummedAddress", () => {
  it("takes a checksummed, all lowercase or all uppercase address, and refuses a wrong checksum", () => {
    const lower = HOUSE.toLowerCase();
    expect(checksummedAddress(` ${HOUSE} `)).toBe(lower);
    expect(checksummedAddress(lower)).toBe(lower);
    expect(checksummedAddress(`0x${lower.slice(2).toUpperCase()}`)).toBe(lower);
    // Mixed case with one letter's case flipped: the checksum no longer checks out.
    const index = [...HOUSE].findIndex((c, i) => i > 1 && /[a-fA-F]/.test(c));
    const flipped = HOUSE.slice(0, index) + (HOUSE[index] === HOUSE[index].toLowerCase() ? HOUSE[index].toUpperCase() : HOUSE[index].toLowerCase()) + HOUSE.slice(index + 1);
    expect(flipped).not.toBe(HOUSE);
    expect(checksummedAddress(flipped)).toBe(null);
    expect(checksummedAddress("0x1234")).toBe(null);
    expect(checksummedAddress(`0x${"g".repeat(40)}`)).toBe(null);
  });
});

describe("payout sources", () => {
  beforeAll(async () => {
    await campaign("staff-home");
  });

  it("are added with a checksummed address and a reason, audited, and every admin is told", async () => {
    const admin = await staff();
    const other = await staff();
    vi.stubEnv("STAFF_ADMIN_IDS", `${admin.id},${other.id}`);
    const id = await campaign("sources-add");
    sent.length = 0;
    expect(await addPayoutSource(admin.id, id, "0x1234", "the house wallet")).toMatchObject({ ok: false, refusal: "bad_address" });
    expect(await addPayoutSource(admin.id, id, HOUSE, "  ")).toMatchObject({ ok: false, refusal: "bad_reason" });
    // All lowercase is taken and normalised.
    const added = await addPayoutSource(admin.id, id, HOUSE.toLowerCase(), "the house wallet");
    expect(added.ok).toBe(true);
    expect(await addPayoutSource(admin.id, id, HOUSE, "again")).toMatchObject({ ok: false, refusal: "source_exists" });
    const rows = (await sql.query(`select address, added_by, added_reason from campaign_payout_sources where campaign_id = $1`, [id])) as Record<string, unknown>[];
    expect(rows).toEqual([{ address: HOUSE.toLowerCase(), added_by: admin.id, added_reason: "the house wallet" }]);
    expect((await audits("campaign.add_payout_source")).map((entry) => entry.detail.outcome)).toEqual(["bad_address", "bad_reason", "done", "source_exists"]);
    expect(sent.map((entry) => [entry.userId, entry.notice.type, entry.notice.change])).toEqual([
      [admin.id, "payout_source_changed", "added"],
      [other.id, "payout_source_changed", "added"],
    ]);
    const card = (await staffQueue()).campaigns.find((entry) => entry.id === id)!;
    expect(card.payoutSources).toMatchObject([{ address: HOUSE, reason: "the house wallet" }]);
    vi.unstubAllEnvs();
  });

  it("let Mark paid accept a transfer only from an active source of the claim's own campaign", async () => {
    const admin = await staff();
    const a = await approvedClaim("sources-pay-a");
    const b = await approvedClaim("sources-pay-b");
    await addPayoutSource(admin.id, b.campaignId, OTHER_HOUSE, "campaign b only");
    const hash = `0x${"a1".repeat(32)}`;
    // No source on a, no global fallback: nothing can pay it.
    expect(await markClaimPaid(admin.id, a.claimId, hash, async () => usdc(a.to, 5_000_000n, OTHER_HOUSE), NO_ENV)).toMatchObject({
      ok: false,
      refusal: "no_payout_senders",
    });
    await addPayoutSource(admin.id, a.campaignId, HOUSE, "campaign a");
    // b's source is not a's.
    expect(await markClaimPaid(admin.id, a.claimId, hash, async () => usdc(a.to, 5_000_000n, OTHER_HOUSE), NO_ENV)).toMatchObject({
      ok: false,
      refusal: "mismatch",
    });
    expect(await markClaimPaid(admin.id, a.claimId, hash, async () => usdc(a.to, 5_000_000n, HOUSE), NO_ENV)).toEqual({ ok: true, detail: { verified: true } });
    // The global fallback still counts, for any campaign.
    const fallback = `0x${"b2".repeat(32)}`;
    const stranger = getAddress(hex(0x1234567));
    expect(await markClaimPaid(admin.id, b.claimId, fallback, async () => usdc(b.to, 5_000_000n, stranger), { STAFF_PAYOUT_ADDRESSES: stranger })).toEqual({
      ok: true,
      detail: { verified: true },
    });
  });

  it("are removed with a reason, audited, and never un-pay a claim", async () => {
    const admin = await staff();
    vi.stubEnv("STAFF_ADMIN_IDS", admin.id);
    const paid = await approvedClaim("sources-remove");
    const waiting = await approvedClaim("sources-remove");
    await addPayoutSource(admin.id, paid.campaignId, HOUSE, "october");
    const sourceId = ((await sql.query(`select id from campaign_payout_sources where campaign_id = $1`, [paid.campaignId])) as { id: string }[])[0].id;
    expect((await markClaimPaid(admin.id, paid.claimId, `0x${"c3".repeat(32)}`, async () => usdc(paid.to, 5_000_000n, HOUSE), NO_ENV)).ok).toBe(true);
    sent.length = 0;
    expect(await removePayoutSource(admin.id, sourceId, "")).toMatchObject({ ok: false, refusal: "bad_reason" });
    expect((await removePayoutSource(admin.id, sourceId, "rotated")).ok).toBe(true);
    expect(await removePayoutSource(admin.id, sourceId, "again")).toMatchObject({ ok: false, refusal: "not_found" });
    expect((await claimById(paid.claimId))!).toMatchObject({ state: "paid", paid_verified: true });
    expect(await markClaimPaid(admin.id, waiting.claimId, `0x${"d4".repeat(32)}`, async () => usdc(waiting.to, 5_000_000n, HOUSE), NO_ENV)).toMatchObject({
      ok: false,
      refusal: "no_payout_senders",
    });
    expect((await audits("campaign.remove_payout_source")).map((entry) => entry.detail.outcome)).toEqual(["bad_reason", "done", "not_found"]);
    expect(sent.map((entry) => entry.notice.change)).toEqual(["removed"]);
    // Re-adding after a removal is allowed: the old row stays as history.
    expect((await addPayoutSource(admin.id, paid.campaignId, HOUSE, "back again")).ok).toBe(true);
    vi.unstubAllEnvs();
  });

  it("need a fresh staff sign in through the route", async () => {
    const admin = await staff();
    const id = await campaign("sources-route");
    vi.stubEnv("STAFF_ADMIN_IDS", admin.id);
    vi.stubEnv("STAFF_SESSION_SECRET", "p".repeat(48));
    const { createStaffSession } = await import("@/lib/server/staff-sessions");
    const { mintStaffCookie, staffCookieName, staffSessionKey } = await import("@/lib/server/staff-session");
    // A live staff session whose email code is an hour old: staff, but not fresh.
    const session = await createStaffSession(admin.id, Date.now() - 3_600_000, Date.now() + 3_600_000);
    const cookie = `${staffCookieName()}=${await mintStaffCookie({ sessionId: session.id, expiresAt: session.expiresAt }, staffSessionKey()!)}`;
    const { POST } = await import("@/app/api/staff/campaigns/route");
    const response = await POST(
      new NextRequest("http://localhost/api/staff/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json", cookie, host: "localhost", origin: "http://localhost" },
        body: JSON.stringify({ action: "add_source", campaignId: id, address: HOUSE, reason: "x" }),
      }),
    );
    // Staff, but not fresh: turned away, nothing written.
    expect(response.status).toBe(401);
    expect((await sql.query(`select 1 from campaign_payout_sources where campaign_id = $1`, [id])) as unknown[]).toHaveLength(0);
    vi.unstubAllEnvs();
  });
});
