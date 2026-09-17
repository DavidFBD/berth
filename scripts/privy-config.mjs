// Privy app settings from the terminal, through Privy's own API, so a domain
// or a rename never depends on remembering where the dashboard hides it.
// Auth is the app id + app secret in .env.local (Node doesn't auto-load it;
// read by hand like db-push.mjs). Every write sends the WHOLE new value and
// prints the setting before and after, because Privy replaces arrays rather
// than merging them: a partial list would silently drop a domain.
//
// Usage:
//   pnpm privy:config show
//   pnpm privy:config domains add https://www.example.com [more…]
//   pnpm privy:config domains remove https://www.example.com [more…]
//   pnpm privy:config set name "Berth"
//   pnpm privy:config set logo_url https://www.berthmarkets.com/berth-brand/mark/berth-logo.png
//
// Settable scalar fields (the rest of the app object is read-only here on
// purpose; the login methods and wallet settings stay in the dashboard):
//   name, logo_url, icon_url, terms_and_conditions_url, privacy_policy_url
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

async function patchApp(body) {
  const response = await fetch(URL, {
    method: "PATCH",
    headers: HEADERS,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`PATCH answered ${response.status}: ${text.slice(0, 300)}`);
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
  console.log("allowed_domains before:", current.join("  ") || "(none)");
  if (next.length === current.length && next.every((value, index) => value === current[index])) {
    console.log("Nothing to change.");
    process.exit(0);
  }
  await patchApp({ allowed_domains: next });
  const after = await getApp();
  console.log("allowed_domains after: ", (after.allowed_domains ?? []).join("  ") || "(none)");
  process.exit(0);
}

if (command === "set" && SCALAR_FIELDS.has(sub)) {
  const value = rest.join(" ");
  if (!value) {
    console.error(`Give a value for ${sub}.`);
    process.exit(1);
  }
  console.log(`${sub} before:`, before[sub] ?? "(unset)");
  await patchApp({ [sub]: value });
  const after = await getApp();
  console.log(`${sub} after: `, after[sub] ?? "(unset)");
  process.exit(0);
}

console.error(
  "Usage: privy-config show | domains add <origin…> | domains remove <origin…> | set <field> <value>\n" +
    `Settable fields: ${[...SCALAR_FIELDS].join(", ")}`,
);
process.exit(1);
