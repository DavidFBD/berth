// Sends ONE sample security notice to one address, to see a real Berth
// email in a real inbox. Dry unless DRY=0: it builds the whole message and
// prints its subject, headers and text, and sends nothing.
//
//   pnpm email:test you@example.com           # dry run
//   DRY=0 pnpm email:test you@example.com     # sends one email through Resend
//
// Reads RESEND_API_KEY (and EMAIL_FROM, EMAIL_BASE_URL) from .env.local.
// Touches no database: the send log and the switches are for real events.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
}

const to = process.argv[2];
if (!to || !/^[^@\s]+@[^@\s]+$/.test(to)) {
  console.error("usage: pnpm email:test <address>");
  process.exit(1);
}
const dry = process.env.DRY !== "0";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  fsCache: false,
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
});
const { buildEmail } = await jiti.import("../src/lib/server/email/send.tsx");
const { resendTransport } = await jiti.import("../src/lib/server/email/resend.ts");

const { email } = await buildEmail({
  userId: "email-test",
  ref: `test-${Date.now()}`,
  notice: { type: "wallet_added", family: "evm", address: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" },
  to,
});
email.subject = "Berth test: security notice";

console.log(`from: ${email.from}\nreply-to: ${email.replyTo}\nsubject: ${email.subject}\nheaders: ${JSON.stringify(email.headers)}\n\n${email.text}\n`);
if (dry) {
  console.log("DRY: nothing sent. Run with DRY=0 to send this one email.");
  process.exit(0);
}
if (!process.env.RESEND_API_KEY) {
  console.error("RESEND_API_KEY is not set.");
  process.exit(1);
}
const result = await resendTransport(process.env.RESEND_API_KEY)(email);
console.log(result.ok ? `sent: ${result.id}` : `failed: ${result.error}`);
process.exit(result.ok ? 0 : 1);
