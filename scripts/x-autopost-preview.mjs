// Read only: what Berth's automatic X post would say if it ran now, from
// the production database (lib/server/x-autopost draftChoice), and every
// other candidate behind it. Posts nothing, refreshes no token, and refuses
// any statement that is not a SELECT.
//
// Usage: pnpm x:preview
//        pnpm x:preview --at 2026-11-23T22:00:00Z
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { setSqlClient } from "@/lib/server/db";
import { draftChoice } from "@/lib/server/x-autopost";
import { composePost, postLength, postProblems, postRefusals, withCampaignCta } from "@/lib/x-autopost";

if (!process.env.DATABASE_URL) {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // fall through to the check below
  }
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set. Run `vercel env pull` first.");
  process.exit(1);
}

const neonSql = neon(process.env.DATABASE_URL);
setSqlClient({
  query: (text, params) => {
    if (!/^\s*(select|with)\b/i.test(text)) throw new Error(`read only: refused ${text.trim().split(/\s+/)[0]}`);
    // Before db:push has made the log, read it as empty.
    return neonSql.query(text, params).catch((error) => {
      if (error?.code === "42P01" && /x_autopost_log/.test(text)) return [];
      throw error;
    });
  },
});

const atFlag = process.argv.indexOf("--at");
const now = atFlag > -1 ? Date.parse(process.argv[atFlag + 1]) : Date.now();
const { choice, inputs, headlines, refusals } = await draftChoice({ now });

const show = (label, draft) => {
  const text = composePost(draft);
  const issues = [...postProblems(text), ...postRefusals(text, headlines)];
  console.log(`\n[${label}] ${draft.key}  (${postLength(text)} of 280${issues.length ? `, ${issues.join(", ")}` : ""})\n${text}`);
};

console.log(`As of ${new Date(now).toISOString()}. Live campaign: ${inputs.campaign ? inputs.campaign.code : "none"}. Last source: ${inputs.lastSource ?? "none"}.`);
console.log(`\nChosen:\n${choice ? choice.text : "(nothing to say)"}`);
if (refusals.length) console.log(`The guard would refuse it and log a skip: ${refusals.join("; ")}`);
console.log("\nEvery candidate, in order of preference:");
for (const draft of inputs.calendar) {
  show(draft.source, inputs.campaign ? withCampaignCta(draft, inputs.campaign) : draft);
}
