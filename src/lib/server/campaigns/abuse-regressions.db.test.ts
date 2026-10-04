import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "../db";
import { makeTestDb } from "../pglite-test-db";
import { claimById } from "./store";
import { runCampaignStep } from "./eligibility";
import { advance, campaign, DAY, heldWallet, invited, person, state, username } from "./test-kit";

/**
 * Farming the invite campaigns, turned around: a person refused once does
 * not come back on a new account, a ring of one inviter's fresh friends
 * hits the cap, and an inviter's second account shares the first one's.
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

describe("invite abuse regressions", () => {
  it("F1: a friend refused for not coming back cannot return on a fresh account with the same wallet", async () => {
    await campaign("farm-1", { stayDays: 7 });
    const first = await invited(await person());
    await username(first.user);
    expect(await advance(first.claimId)).toBe("holding");
    const eligible = (await claimById(first.claimId))!.eligible_at!;
    await runCampaignStep({ now: new Date(eligible.getTime() + 60_000) });
    expect(await state(first.claimId)).toEqual({ state: "rejected", reason: "not_active" });
    const again = await invited(await person());
    await username(again.user);
    await heldWallet(again.user, first.user.home);
    expect(await advance(again.claimId)).toBe("wallet_used");
  });

  it("F2: a fresh account with an alias of a counted friend's email is the same person", async () => {
    await campaign("farm-2");
    const first = await invited(await person(), { email: "sam.farmer@gmail.com" });
    await username(first.user);
    expect(await advance(first.claimId)).toBe("holding");
    const again = await invited(await person(), { email: "samfarmer+2@googlemail.com" });
    await username(again.user);
    expect(await advance(again.claimId)).toBe("email_used");
  });

  it("F3: an expired claim, which never took a place, frees nothing it never held and blocks nobody", async () => {
    await campaign("farm-3", { endsInDays: 1, stayDays: 7 });
    const first = await invited(await person());
    expect(await advance(first.claimId, new Date(Date.now() + 9 * DAY))).toBe("expired");
    const marks = (await sql.query(`select 1 from campaign_invitee_marks where claim_id = $1`, [first.claimId])) as unknown[];
    expect(marks).toHaveLength(0);
  });
});
