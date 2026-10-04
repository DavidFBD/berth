/**
 * The campaign review queue, in the terminal (lib/server/campaigns/queue):
 * every campaign's budget meter and every claim past "invited, not set up yet",
 * with the evidence the staff page shows. Emails and wallets are masked
 * unless --reveal.
 *
 * It reads LOCAL_DATABASE_URL by default. --prod reads DATABASE_URL (which
 * .env.local points at production) and writes one row to staff_audit
 * saying the queue was read from the terminal, by whom on this machine,
 * and whether it was revealed: the one write it ever makes. --json prints
 * the queue as JSON.
 *
 *   pnpm campaign:queue
 *   pnpm campaign:queue --prod
 *   pnpm campaign:queue --prod --reveal --json
 */
import "./lib/load-env.mjs";
import { userInfo } from "node:os";

const PROD = process.argv.includes("--prod");
const REVEAL = process.argv.includes("--reveal");
const JSON_OUT = process.argv.includes("--json");

if (PROD) {
  // lib/server/db prefers LOCAL_DATABASE_URL when it is set; --prod means DATABASE_URL, said out loud.
  delete process.env.LOCAL_DATABASE_URL;
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set; it is read from .env.local.");
    process.exit(1);
  }
} else if (!process.env.LOCAL_DATABASE_URL) {
  console.error("No LOCAL_DATABASE_URL (postgres://…@localhost/…). Add --prod to read production.");
  process.exit(1);
}

const { staffQueue, formatQueue } = await import("../src/lib/server/campaigns/queue.ts");
if (PROD) {
  // The same row staffAudit (lib/server/staff-auth) writes, without loading the web gate here.
  const { getSql } = await import("../src/lib/server/db.ts");
  await getSql().query(`insert into staff_audit (staff_user_id, action, target, detail) values (null, 'campaign.queue_cli', null, $1::jsonb)`, [
    JSON.stringify({ reveal: REVEAL, json: JSON_OUT, by: userInfo().username }),
  ]);
}
const queue = await staffQueue({ reveal: REVEAL });
console.error(`${PROD ? "production (logged to staff_audit)" : "local"}, ${REVEAL ? "revealed" : "masked"}`);
console.log(JSON_OUT ? JSON.stringify(queue, null, 2) : formatQueue(queue) || "No campaigns.");
