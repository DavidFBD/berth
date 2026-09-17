// Privy app settings from the terminal, as far as Privy allows: the API
// READS them with the app id + app secret (.env.local, read by hand like
// db-push.mjs) but refuses every write (`PATCH /api/v1/apps/{id}` answers
// 405 Method not allowed, verified 2026-09-17), so allowed domains, the
// name and the logo can only be changed in the dashboard. The write
// subcommands therefore do the next best thing: compute the exact new
// value from the live one, print it beside the dashboard path where it
// goes, and leave `show` to confirm afterwards. That still beats editing a
// list from memory, since Privy replaces arrays rather than merging them.
//
// Usage:
//   pnpm privy:config show
//   pnpm privy:config domains add https://www.example.com [more…]
//   pnpm privy:config domains remove https://www.example.com [more…]
//   pnpm privy:config set name "Berth"
//   pnpm privy:config set logo_url https://www.berthmarkets.com/berth-brand/mark/berth-logo.png
//
// Dashboard: dashboard.privy.io > the app > Settings > Basics. Allowed URLs
// live on the "Domains and clients" tab; name and logo on "Privy Home".
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}

const APP_ID = process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const APP_SECRET = process.env.PRIVY_APP_SECRET;
if (!APP_ID || !APP_SECRET) {
  console.error("PRIVY_APP_ID and PRIVY_APP_SECRET must be set (.env.local).");
  process.exit(1);
}

const URL = `https://auth.privy.io/api/v1/apps/${APP_ID}`;
const HEADERS = {
  "privy-app-id": APP_ID,
  Authorization: `Basic ${Buffer.from(`${APP_ID}:${APP_SECRET}`).toString("base64")}`,
  "Content-Type": "application/json",
};
const SCALAR_FIELDS = new Set([
  "name",
  "logo_url",
  "icon_url",
  "terms_and_conditions_url",
  "privacy_policy_url",
]);
/** The settings this script shows and edits; the app object carries much more. */
const SHOWN = [
  "name",
  "logo_url",
  "icon_url",
  "terms_and_conditions_url",
  "privacy_policy_url",
  "allowed_domains",
  "custom_api_url",
];

async function getApp() {
  const response = await fetch(URL, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`GET answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

/**
 * Where a setting is changed by hand. Privy's API has no write for app
 * settings (405 on PATCH, 2026-09-17); if that ever changes, this is the
 * one place to swap a fetch back in.
 */
function dashboardPath(tab) {
  return `dashboard.privy.io > app ${APP_ID} > Settings > Basics > ${tab}`;
}

function show(app) {
  for (const key of SHOWN) {
    const value = app[key];
    console.log(`${key.padEnd(26)} ${Array.isArray(value) ? value.join("  ") || "(none)" : value ?? "(unset)"}`);
  }
}

function isHttpsOrigin(value) {
  try {
    const parsed = new globalThis.URL(value);
    return (
      (parsed.protocol === "https:" || parsed.hostname === "localhost") &&
      parsed.pathname === "/" &&
      !parsed.search &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

const [command, sub, ...rest] = process.argv.slice(2);
const before = await getApp();

if (command === "show" || command === undefined) {
  show(before);
  process.exit(0);
}

if (command === "domains" && (sub === "add" || sub === "remove")) {
  const targets = rest.map((value) => value.replace(/\/$/, ""));
  if (targets.length === 0) {
    console.error("Give at least one origin, e.g. https://www.berthmarkets.com");
    process.exit(1);
  }
  const bad = targets.filter((value) => !isHttpsOrigin(value));
  if (bad.length > 0) {
    console.error(`Not an origin (https://host, no path): ${bad.join(", ")}`);
    process.exit(1);
  }
  const current = before.allowed_domains ?? [];
  const next =
    sub === "add"
      ? [...current, ...targets.filter((value) => !current.includes(value))]
      : current.filter((value) => !targets.includes(value));
  if (sub === "remove" && next.length === 0) {
    console.error("Refusing to remove the last allowed domain; that locks everyone out.");
    process.exit(1);
  }
  console.log("allowed_domains now:", current.join("  ") || "(none)");
  if (next.length === current.length && next.every((value, index) => value === current[index])) {
    console.log("Nothing to change.");
    process.exit(0);
  }
  console.log(`\nPrivy's API is read-only for this. In ${dashboardPath("Domains and clients")}`);
  console.log(`make the list exactly:\n`);
  for (const value of next) console.log(`  ${value}`);
  console.log(`\nThen run \`pnpm privy:config show\` to confirm.`);
  process.exit(0);
}

if (command === "set" && SCALAR_FIELDS.has(sub)) {
  const value = rest.join(" ");
  if (!value) {
    console.error(`Give a value for ${sub}.`);
    process.exit(1);
  }
  console.log(`${sub} now:`, before[sub] ?? "(unset)");
  console.log(`\nPrivy's API is read-only for this. In ${dashboardPath("Privy Home")} set`);
  console.log(`  ${sub} = ${value}\n`);
  console.log(`Then run \`pnpm privy:config show\` to confirm.`);
  process.exit(0);
}

console.error(
  "Usage: privy-config show | domains add <origin…> | domains remove <origin…> | set <field> <value>\n" +
    `Settable fields: ${[...SCALAR_FIELDS].join(", ")}`,
);
process.exit(1);
