import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "../db";
import { makeTestDb } from "../pglite-test-db";
import { getOrCreateUser } from "../accounts";
import { claimById } from "./store";
import { approveClaim, markClaimPaid } from "./actions";
import { TRANSFER_TOPIC, USDC_BASE, type Receipt } from "./usdc";
import { campaign, hex, next, qualifiedClaim } from "./test-kit";

/**
 * The delta review's probes (reports/campaigns-delta-probe.db.test.ts,
 * 2026-10-01), turned around: the payment ones, which outlived the buy
 * campaigns. Q3 to Q6 were about the retired buy rules and went with them.
 */

vi.mock("@/lib/server/privy", () => ({
  verifyPrivyAuth: async () => null,
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

async function user() {
  const n = next();
  const u = (await getOrCreateUser({ did: `did:privy:delta-${n}`, wallet: hex(0x800000 + n) }))!.user;
  await sql.query(`update users set email = $2 where id = $1`, [u.id, `d${n}@example.com`]);
  return u;
}
const HOUSE = hex(0xc0ffee);
const ENV = { STAFF_PAYOUT_ADDRESSES: HOUSE };
const pad = (a: string) => `0x${a.slice(2).padStart(64, "0")}`;
const usdc = (pays: [string, bigint][]): Receipt => ({
  status: "0x1",
  blockNumber: "0x1",
  logs: pays.map(([to, raw]) => ({ address: USDC_BASE, topics: [TRANSFER_TOPIC, pad(HOUSE), pad(to)], data: `0x${raw.toString(16)}` })),
});

async function approvedClaim(code: string) {
  const { claimId } = await qualifiedClaim(code);
  const staff = await user();
  expect((await approveClaim(staff.id, claimId)).ok).toBe(true);
  return { claimId, staff, to: (await claimById(claimId))!.payout_address! };
}

describe("delta regressions", () => {
  it("Q1: one 5 USDC transfer, two claims at one address, marked paid at once: only one is paid", async () => {
    await campaign("dq1");
    const a = await approvedClaim("dq1");
    const b = await approvedClaim("dq1");
    await sql.query(`update campaign_claims set payout_address = $2 where id = $1`, [b.claimId, a.to]);
    const hash = `0x${"77".repeat(32)}`;
    const slow = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return usdc([[a.to, 5_000_000n]]);
    };
    const results = await Promise.all([markClaimPaid(a.staff.id, a.claimId, hash, slow, ENV), markClaimPaid(b.staff.id, b.claimId, hash, slow, ENV)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const states = [(await claimById(a.claimId))!.state, (await claimById(b.claimId))!.state].sort();
    expect(states).toEqual(["approved", "paid"]);
  });

  it("Q2: one transaction cannot pay two campaigns' claims at one address", async () => {
    await campaign("dq2a");
    await campaign("dq2b");
    const a = await approvedClaim("dq2a");
    const b = await approvedClaim("dq2b");
    await sql.query(`update campaign_claims set payout_address = $2 where id = $1`, [b.claimId, a.to]);
    const hash = `0x${"78".repeat(32)}`;
    const receipt = async () => usdc([[a.to, 5_000_000n]]);
    expect((await markClaimPaid(a.staff.id, a.claimId, hash, receipt, ENV)).ok).toBe(true);
    expect(await markClaimPaid(b.staff.id, b.claimId, hash, receipt, ENV)).toMatchObject({ ok: false, refusal: "mismatch" });
  });
});
