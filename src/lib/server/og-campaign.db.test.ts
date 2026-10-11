import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { campaign } from "./campaigns/test-kit";
import { campaignCardResponse, campaignImageUrl } from "./og-campaign";

/** /og/c/<code> against the real schema: a live card only at its own v, the fallback for anything else. */

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

const search = (v: string | null) => new URLSearchParams(v === null ? {} : { v });
const vOf = (url: string) => new URLSearchParams(url.split("?")[1]).get("v");

describe("the campaign card's answer", () => {
  it("sends any other v, or none, to the card's own address, and draws it there", async () => {
    await campaign("og-live", { amount: 12.5, budget: 250 });
    const own = campaignImageUrl("og-live", 12.5);
    for (const wrong of ["made-up", "", null]) {
      const response = await campaignCardResponse("og-live", search(wrong));
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(own);
    }
    const drawn = await campaignCardResponse("og-live", search(vOf(own)));
    expect(drawn.status).toBe(200);
    expect(drawn.headers.get("content-type")).toBe("image/png");
  }, 60_000);

  it("answers the fallback for a paused or unknown campaign, whatever the v", async () => {
    await campaign("og-paused", { active: false });
    await sql.query(`update campaigns set activated_at = now() where code = 'og-paused'`);
    for (const code of ["og-paused", "no-such-code"]) {
      const response = await campaignCardResponse(code, search("anything"));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toMatch(/s-maxage=300/);
    }
  }, 60_000);
});
