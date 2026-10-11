import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "../db";
import { makeTestDb } from "../pglite-test-db";
import { getOrCreateUser } from "../accounts";
import { campaign, joined } from "./test-kit";
import { campaignById, claimById, renamedCampaignCode } from "./store";
import { createCampaign, renameCampaignCode, setCampaignAnnounce } from "./actions";
import { linkOpensByCampaign, recordLinkOpen } from "./link-opens";
import { staffQueue } from "./queue";
import { readLiveCampaign } from "../x-autopost";

/**
 * Changing a campaign's link against the real schema: the create rules for
 * the code, a code taken by any campaign now or before, the old code kept
 * as an alias that redirects and still attributes, the counts carried by
 * campaign, Berth's own X posts on the new link, and the audit row.
 */

let sql: SqlClient;
let close: () => Promise<void>;
let staff: string;

beforeAll(async () => {
  const db = await makeTestDb();
  sql = db.sql;
  close = db.close;
  setSqlClient(sql);
  staff = (await getOrCreateUser({ did: "did:privy:rename-staff", wallet: `0x${"7".repeat(40)}` }))!.user.id;
});

afterAll(async () => {
  setSqlClient(null);
  await close();
});

const audits = async () =>
  (await sql.query(`select action, target, detail from staff_audit where action = 'campaign.rename' order by id`)) as {
    action: string;
    target: string;
    detail: Record<string, unknown>;
  }[];

describe("changing a campaign's link", () => {
  it("moves the link, keeps the old code as an alias, and audits both codes with the reason", async () => {
    const id = await campaign("launch");
    await recordLinkOpen("launch");
    const result = await renameCampaignCode(staff, id, " Launch-Campaign ", "A clearer link for the launch post");
    expect(result).toEqual({ ok: true, detail: { from: "launch", code: "launch-campaign" } });
    expect((await campaignById(id))!.code).toBe("launch-campaign");
    expect(await renamedCampaignCode("launch")).toBe("launch-campaign");
    expect(await renamedCampaignCode("LAUNCH")).toBe("launch-campaign");
    expect(await renamedCampaignCode("launch-campaign")).toBeNull();
    expect(await renamedCampaignCode("nobody-here")).toBeNull();
    expect((await audits()).at(-1)).toMatchObject({
      target: id,
      detail: { from: "launch", to: "launch-campaign", reason: "A clearer link for the launch post", outcome: "done" },
    });
    // Counted by campaign, so the opens carry on under the new link.
    await recordLinkOpen("launch-campaign");
    expect((await linkOpensByCampaign()).get(id)).toBe(2);
    expect((await staffQueue()).campaigns.find((entry) => entry.id === id)).toMatchObject({ code: "launch-campaign", aliases: ["launch"], opens: 2 });
  });

  it("still counts an account that pocketed the old code before the change", async () => {
    const id = (await campaignById((await staffQueue()).campaigns.find((entry) => entry.code === "launch-campaign")!.id))!.id;
    const { claimId } = await joined({ code: "launch" });
    expect((await claimById(claimId))!.campaign_id).toBe(id);
  });

  it("posts the new link on X when Announce on X is ticked", async () => {
    const id = (await staffQueue()).campaigns.find((entry) => entry.code === "launch-campaign")!.id;
    await setCampaignAnnounce(staff, id, true);
    expect((await readLiveCampaign(Date.now()))?.code).toBe("launch-campaign");
  });

  it("can go back to one of its own earlier codes, which then leaves the aliases", async () => {
    const id = (await staffQueue()).campaigns.find((entry) => entry.code === "launch-campaign")!.id;
    expect((await renameCampaignCode(staff, id, "launch", "Back to the short one")).ok).toBe(true);
    expect((await staffQueue()).campaigns.find((entry) => entry.id === id)).toMatchObject({ code: "launch", aliases: ["launch-campaign"] });
    expect(await renamedCampaignCode("launch-campaign")).toBe("launch");
    expect(await renamedCampaignCode("launch")).toBeNull();
  });

  it("refuses a bad code, no reason, the same code, and a code any campaign has or had, audited", async () => {
    const id = (await staffQueue()).campaigns.find((entry) => entry.code === "launch")!.id;
    await campaign("old-buy", { kind: "buy", active: false });
    const other = await campaign("other-offer");
    await renameCampaignCode(staff, other, "other-two", "Trying a name");
    expect(await renameCampaignCode(staff, id, "a!", "x")).toMatchObject({ ok: false, refusal: "bad_input" });
    expect(await renameCampaignCode(staff, id, "spring", "  ")).toMatchObject({ ok: false, refusal: "no_rename_reason" });
    expect(await renameCampaignCode(staff, id, "launch", "same")).toMatchObject({ ok: false, refusal: "same_code" });
    expect(await renameCampaignCode(staff, id, "old-buy", "taken by a retired one")).toMatchObject({ ok: false, refusal: "code_taken" });
    expect(await renameCampaignCode(staff, id, "other-offer", "taken as another's earlier link")).toMatchObject({ ok: false, refusal: "code_taken" });
    expect(await renameCampaignCode(staff, id, "other-two", "taken now")).toMatchObject({ ok: false, refusal: "code_taken" });
    expect((await campaignById(id))!.code).toBe("launch");
    expect((await audits()).filter((row) => row.detail.outcome !== "done").map((row) => row.detail.outcome)).toEqual([
      "bad_input",
      "no_rename_reason",
      "same_code",
      "code_taken",
      "code_taken",
      "code_taken",
    ]);
  });

  it("never renames a retired campaign, and a new campaign cannot take an earlier link", async () => {
    const retired = await campaign("retired-one", { kind: "invite", active: false });
    expect(await renameCampaignCode(staff, retired, "fresh-name", "why")).toMatchObject({ ok: false, refusal: "retired" });
    const created = await createCampaign(staff, {
      code: "launch-campaign",
      title: "Clash",
      amountUsd: 5,
      budgetUsd: 100,
      maxClaims: 20,
      stayDays: 14,
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    expect(created).toMatchObject({ ok: false, refusal: "code_taken" });
  });

  it("frees its earlier codes when the campaign is deleted", async () => {
    const id = await campaign("short-lived", { active: false });
    await renameCampaignCode(staff, id, "short-lived-two", "test");
    await sql.query(`delete from campaigns where id = $1`, [id]);
    expect(await renamedCampaignCode("short-lived")).toBeNull();
    expect(((await sql.query(`select 1 from campaign_code_aliases where code = 'short-lived'`)) as unknown[]).length).toBe(0);
  });
});

describe("the code lock", () => {
  it("takes a lock per code, in order, before a create or a rename writes, in one ReadCommitted transaction", async () => {
    const seen: { texts: string[]; params: unknown[][]; options: unknown }[] = [];
    setSqlClient({
      query: sql.query,
      transaction: (statements, options) => {
        seen.push({ texts: statements.map((statement) => statement.text), params: statements.map((statement) => statement.params ?? []), options });
        return sql.transaction!(statements, options);
      },
    });
    try {
      const created = await createCampaign(staff, {
        code: "locked-one",
        title: "Locked",
        amountUsd: 5,
        budgetUsd: 100,
        maxClaims: 20,
        stayDays: 14,
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      });
      expect(created.ok).toBe(true);
      const id = String(created.detail?.id);
      expect((await renameCampaignCode(staff, id, "a-locked-two", "lock test")).ok).toBe(true);
      const [create, rename] = seen;
      expect(create.options).toEqual({ isolationLevel: "ReadCommitted" });
      expect(create.texts[0]).toMatch(/pg_advisory_xact_lock/);
      expect(create.params[0]).toEqual(["locked-one"]);
      expect(create.texts[1]).toMatch(/insert into campaigns/);
      expect(rename.texts.slice(0, 2).every((text) => /pg_advisory_xact_lock/.test(text))).toBe(true);
      expect(rename.params.slice(0, 2)).toEqual([["a-locked-two"], ["locked-one"]]);
      expect(rename.texts[2]).toMatch(/update campaigns set code/);
    } finally {
      setSqlClient(sql);
    }
  });
});
