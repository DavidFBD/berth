import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setSqlClient, type SqlClient } from "../db";
import { makeTestDb } from "../pglite-test-db";
import { getOrCreateUser } from "../accounts";
import { attributeCampaign, claimById } from "./store";
import { runCampaignStep } from "./eligibility";
import { advance, buy, campaign, DAY, DEPS, hex, next, state, verifier } from "./test-kit";

/**
 * The abuse review's probes (reports/campaigns-review-abuse-probe.db.test.ts,
 * 2026-10-01), each turned around: every one showed a hole, and each test
 * here holds it shut.
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

async function user(email: boolean) {
  const n = next();
  const u = (await getOrCreateUser({ did: `did:privy:regress-${n}`, wallet: hex(0x700000 + n) }))!.user;
  if (email) await sql.query(`update users set email = $2 where id = $1`, [u.id, `r${n}@example.com`]);
  return u;
}

describe("abuse regressions", () => {
  it("P1: an old customer merging a fresh link account into the old one is refused, and the old buy never counts", async () => {
    await campaign("regress-1", { startsInDays: -10 });
    const old = await user(true);
    await buy(old, { filledAt: new Date(Date.now() - 5 * DAY) });
    await sql.query(`update users set created_at = now() - interval '200 days' where id = $1`, [old.id]);
    const fresh = await user(false);
    const claimId = (await attributeCampaign(fresh.id, "regress-1"))!;
    expect(claimId).toBeTruthy();
    await sql.query(`update users set retired_into = $1, privy_did = 'merged:' || privy_did, wallet_address = null where id = $2`, [old.id, fresh.id]);
    expect(await advance(claimId)).toBe("existing_customer");
    expect(await state(claimId)).toEqual({ state: "rejected", reason: "existing_customer" });
  });

  it("P2: a claim that found every place taken waits, and gets the place a farmer's rejected claim frees", async () => {
    await campaign("regress-2", { maxClaims: 1 });
    const farmer = await user(true);
    const fc = (await attributeCampaign(farmer.id, "regress-2"))!;
    await buy(farmer);
    expect(await advance(fc)).toBe("holding");
    const real = await user(true);
    const rc = (await attributeCampaign(real.id, "regress-2"))!;
    await buy(real);
    expect(await advance(rc)).toBe("waitlisted");
    const farmerHub = ((await sql.query(`select delivered_to from orders where user_id = $1`, [farmer.id])) as { delivered_to: string }[])[0].delivered_to;
    await runCampaignStep({
      now: new Date(Date.now() + 8 * DAY),
      verifyHold: verifier((query) => (query.holder === farmerHub ? "not_held" : "held")),
      deps: DEPS,
    });
    expect((await claimById(fc))!.state).toBe("rejected");
    expect((await claimById(rc))!.state).toBe("holding");
  });

  it("P3: past the deadline (the end plus the hold's days), a late email no longer reserves a slot", async () => {
    await campaign("regress-3", { startsInDays: -30, endsInDays: -1 });
    const u = await user(false);
    await sql.query(`insert into campaign_claims (campaign_id, user_id, created_at) select id, $1, now() - interval '20 days' from campaigns where code = 'regress-3'`, [u.id]);
    const claimId = ((await sql.query(`select id from campaign_claims where user_id = $1`, [u.id])) as { id: string }[])[0].id;
    await buy(u, { filledAt: new Date(Date.now() - 5 * DAY) });
    await sql.query(`update users set email = 'late@example.com' where id = $1`, [u.id]);
    expect(await advance(claimId, new Date(Date.now() + 7 * DAY))).toBe("expired");
  });

  it("B1: a stranger's buy recorded on a farmer's fresh account by its hash never counts", async () => {
    await campaign("regress-b1");
    const farmer = await user(true);
    const claimId = (await attributeCampaign(farmer.id, "regress-b1"))!;
    // A Solana sourced buy delivered to a stranger's hub wallet, claimed by hash.
    await buy(farmer, { payer: "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV", deliveredTo: `0xb${hex(0x5157).slice(3)}` });
    expect(await advance(claimId)).toBe("buying");
    expect((await sql.query(`select 1 from campaign_claim_wallets where claim_id = $1`, [claimId])) as unknown[]).toHaveLength(0);
  });
});
