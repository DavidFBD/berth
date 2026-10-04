// Fails the build when the installed @privy-io/js-sdk-core lacks Berth's
// patch (patches/@privy-io__js-sdk-core@0.68.4.patch). Without it, Privy's
// client would retry a sponsored send on a 502 and could move the money
// twice. Runs before `next build`, so Vercel stops loudly instead of
// shipping an unpatched client. Resolved through react-auth, the copy the
// app actually loads; both the ESM and the CJS build must carry it.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const MARKER = "berth patch: a sponsored wallet rpc POST";

const fromReactAuth = createRequire(createRequire(import.meta.url).resolve("@privy-io/react-auth"));
const sdkRoot = join(dirname(fromReactAuth.resolve("@privy-io/js-sdk-core")), "..", "..");
const files = ["dist/esm/client/PrivyInternal.mjs", "dist/cjs/client/PrivyInternal.js"].map((file) => join(sdkRoot, file));

const missing = files.filter((file) => {
  try {
    return !readFileSync(file, "utf8").includes(MARKER);
  } catch {
    return true;
  }
});

if (missing.length > 0) {
  console.error("check-privy-patch: Berth's js-sdk-core patch is missing from:");
  for (const file of missing) console.error(`  ${file}`);
  console.error("A sponsored send could be retried and paid twice. Reinstall with pnpm 11 (see packageManager) or re-make the patch.");
  process.exit(1);
}
console.log("check-privy-patch: js-sdk-core patch present in ESM and CJS.");
