import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "../db";
import { makeTestDb } from "../pglite-test-db";
import { campaign } from "./test-kit";
import { linkOpensByCampaign, recordLinkOpen } from "./link-opens";

/**
 * The link open counter against the real schema: one row per campaign per
 * UTC day, an unknown code writes nothing, and the row holds a count only.
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

describe("campaign link opens", () => {
  it("counts per campaign per UTC day, and nothing for an unknown code", async () => {
    const launch = await campaign("launch");
    const other = await campaign("other-one");
    const day1 = new Date("2026-10-11T08:00:00Z");
    const day1Late = new Date("2026-10-11T23:59:00Z");
    const day2 = new Date("2026-10-12T00:01:00Z");
    await recordLinkOpen("launch", day1);
    await recordLinkOpen("LAUNCH", day1Late);
    await recordLinkOpen("launch", day2);
    await recordLinkOpen("other-one", day2);
    await recordLinkOpen("no-such-campaign", day2);
    await recordLinkOpen("!!", day2);

    const rows = (await sql.query(`select campaign_id, day::text as day, opens from campaign_link_opens order by day, opens desc`)) as {
      campaign_id: string;
      day: string;
      opens: number;
    }[];
    expect(rows).toEqual([
      { campaign_id: launch, day: "2026-10-11", opens: 2 },
      { campaign_id: launch, day: "2026-10-12", opens: 1 },
      { campaign_id: other, day: "2026-10-12", opens: 1 },
    ]);
    const totals = await linkOpensByCampaign();
    expect(totals.get(launch)).toBe(3);
    expect(totals.get(other)).toBe(1);
  });

  it("keeps a count only: no column could hold anything about a visitor", async () => {
    const columns = (await sql.query(
      `select column_name from information_schema.columns where table_name = 'campaign_link_opens' order by ordinal_position`,
    )) as { column_name: string }[];
    expect(columns.map((column) => column.column_name)).toEqual(["campaign_id", "day", "opens"]);
  });

  it("goes with its campaign", async () => {
    const gone = await campaign("gone-soon", { active: false });
    await recordLinkOpen("gone-soon");
    await sql.query(`delete from campaigns where id = $1`, [gone]);
    expect((await linkOpensByCampaign()).has(gone)).toBe(false);
  });
});
