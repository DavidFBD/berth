import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "../db";
import { makeTestDb } from "../pglite-test-db";
import { claimById } from "./store";
import { runCampaignStep } from "./eligibility";
import { advance, campaign, DAY, heldWallet, joined, state, username } from "./test-kit";

/**
 * Farming the campaigns, turned around: a person refused once does not
 * come back on a new account, by wallet or by an alias of their email.
 */

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

describe("campaign abuse regressions", () => {
  it("F1: an account refused for not coming back cannot return on a fresh account with the same wallet", async () => {
    await campaign("farm-1", { stayDays: 7 });
    const first = await joined();
    await username(first.user);
    expect(await advance(first.claimId)).toBe("holding");
    const eligible = (await claimById(first.claimId))!.eligible_at!;
    await runCampaignStep({ now: new Date(eligible.getTime() + 60_000) });
    expect(await state(first.claimId)).toEqual({ state: "rejected", reason: "not_active" });
    const again = await joined();
    await username(again.user);
    await heldWallet(again.user, first.user.home);
    expect(await advance(again.claimId)).toBe("wallet_used");
  });

  it("F2: a fresh account with an alias of a counted account's email is the same person", async () => {
    await campaign("farm-2");
    const first = await joined({ email: "sam.farmer@gmail.com" });
    await username(first.user);
    expect(await advance(first.claimId)).toBe("holding");
    const again = await joined({ email: "samfarmer+2@googlemail.com" });
    await username(again.user);
    expect(await advance(again.claimId)).toBe("email_used");
  });

  it("F3: an expired claim, which never took a place, frees nothing it never held and blocks nobody", async () => {
    await campaign("farm-3", { endsInDays: 1, stayDays: 7 });
    const first = await joined();
    expect(await advance(first.claimId, new Date(Date.now() + 9 * DAY))).toBe("expired");
    const marks = (await sql.query(`select 1 from campaign_invitee_marks where claim_id = $1`, [first.claimId])) as unknown[];
    expect(marks).toHaveLength(0);
  });
});
