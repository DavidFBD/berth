// Node does not read .env.local (only Next.js does); read it by hand, the
// way scripts/db-push.mjs does, without overriding what is already set.
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {
  // fall through to the caller's own check
}
