// pnpm verify: the one gate every ship passes. Run it on the branch, after
// merging origin/master and committing, before the squash ship.
//
//   pnpm verify                         # the usual run
//   pnpm verify --reviewed              # a large diff whose review is done
//   pnpm verify --terms-bump-approved   # TERMS_VERSION changed, David agreed
//   pnpm verify --solver-down-ack       # the quote smoke found only the solver's
//                                       # -4 on stock routes, control green: proceed, logged
//
// Steps, stopping at the first failure:
//   1. preflight: nothing uncommitted or untracked (gitignored files aside),
//      origin/master merged in; the tree is read here and must be the same
//      at the end, or nothing is recorded
//   2. ship risks read from the diff against origin/master:
//      size (review required above REVIEW_LINES), db/schema.sql changed
//      (pnpm db:push must have applied this exact schema), TERMS_VERSION
//      changed (needs --terms-bump-approved), SDK or Privy bumped
//      (runs pnpm listings:verify)
//   3. the Privy patch check, tsc, lint, pnpm test
//   4. pnpm smoke:quotes, the live quote smoke of the core money journey
//      (scripts/smoke-quotes.mjs). Exit 2 means solver side (only stock
//      routes refused with -4 while the crypto control quoted): verify
//      stops unless --solver-down-ack, which proceeds and is logged to
//      .git/berth-verify/overrides.log. Ship then only if nothing on the
//      quote path changed, and tell the SODAX solver team.
//
// On success it writes a record keyed by the tree hash into the git common
// dir (scripts/lib/verify-marker.mjs). The PreToolUse ship guard
// (scripts/ship-guard.mjs) refuses a push to master whose tree has no record.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { git, logOverride, schemaWasPushed, treeOf, writeVerifyRecord } from "./lib/verify-marker.mjs";
import { quotePathTouched } from "./lib/quote-path.mjs";

const REVIEW_LINES = 1500;
const NOTE_LINES = 400;
const SMOKE_SCRIPT = "smoke:quotes";
// Lines in these paths do not count toward the review size.
const SIZE_EXEMPT = [/^pnpm-lock\.yaml$/, /^docs\//, /^public\//, /\.md$/];
const SDK_DEPS = /^@sodax\/|^@privy-io\//;

const args = new Set(process.argv.slice(2));
const flags = {
  reviewed: args.has("--reviewed"),
  termsBumpApproved: args.has("--terms-bump-approved"),
  solverDownAck: args.has("--solver-down-ack"),
};

const steps = [];
function fail(message) {
  console.error(`\nverify: FAILED. ${message}`);
  process.exit(1);
}
function note(message) {
  console.log(`verify: ${message}`);
}
function run(name, cmd, cmdArgs) {
  note(`running ${name}`);
  const started = Date.now();
  const result = spawnSync(cmd, cmdArgs, { stdio: "inherit" });
  if (result.status !== 0) fail(`${name} did not pass.`);
  steps.push({ name, seconds: Math.round((Date.now() - started) / 1000) });
}

// 1. Preflight. tsc and the tests read the disk, the record names the
// committed tree: they must be the same files, from start to end.
const dirty = git(["status", "--porcelain", "--untracked-files=normal"]);
if (dirty) {
  fail(
    "The working tree is not exactly the commit: uncommitted or untracked files (not gitignored) are here.\n" +
      dirty.split("\n").slice(0, 10).join("\n") +
      "\nCommit them, gitignore them or remove them: the record is keyed to the committed tree, and tsc and the tests would otherwise check files that do not ship.",
  );
}
const startHead = git(["rev-parse", "HEAD"]);
const startTree = treeOf("HEAD");
try {
  execFileSync("git", ["fetch", "-q", "origin", "master"], { stdio: "ignore", timeout: 30_000 });
} catch {
  note("could not fetch origin/master, using the local copy");
}
if (spawnSync("git", ["merge-base", "--is-ancestor", "origin/master", "HEAD"]).status !== 0) {
  fail("origin/master is not merged into this branch. Merge it, rerun, then ship.");
}

// The flags that pass a gate are logged where the overrides are, every time they are used.
for (const [flag, used] of [["--reviewed", flags.reviewed], ["--terms-bump-approved", flags.termsBumpApproved], ["--solver-down-ack", flags.solverDownAck]]) {
  if (used) logOverride(`verify ${flag} ${git(["rev-parse", "--abbrev-ref", "HEAD"])} ${startTree.slice(0, 12)}`);
}

// 2. Ship risks
const numstat = git(["diff", "--numstat", "origin/master...HEAD"])
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [added, removed, path] = line.split("\t");
    return { path, lines: (Number(added) || 0) + (Number(removed) || 0) };
  });
const changed = new Set(numstat.map((entry) => entry.path));
const sizedLines = numstat
  .filter((entry) => !SIZE_EXEMPT.some((pattern) => pattern.test(entry.path)))
  .reduce((sum, entry) => sum + entry.lines, 0);
note(`${changed.size} files, ${sizedLines} changed lines that count toward review size`);
if (sizedLines > REVIEW_LINES && !flags.reviewed) {
  fail(
    `${sizedLines} lines is above ${REVIEW_LINES}. A diff this size ships only after the Opus review lenses ` +
      `have read it and their blockers and majors are fixed. Then rerun with --reviewed. Better: split it.`,
  );
}
if (sizedLines > NOTE_LINES) note(`above ${NOTE_LINES} lines: this round wants a review before it ships`);

const risks = { sizedLines, schema: false, terms: false, sdk: [] };

if (changed.has("db/schema.sql")) {
  risks.schema = true;
  const schema = readFileSync("db/schema.sql", "utf8");
  if (!schemaWasPushed(schema)) {
    fail(
      "db/schema.sql changed and this exact schema has not been applied. Run `pnpm db:push` " +
        "(symlink the main checkout's .env.local into this worktree first, remove it after), then rerun. " +
        "The schema reaches Neon before the code that reads it reaches production.",
    );
  }
  note("schema change: this exact db/schema.sql was applied by pnpm db:push");
}

if (changed.has("src/lib/legal-version.ts")) {
  const versionOf = (text) => text.match(/TERMS_VERSION\s*=\s*"([^"]+)"/)?.[1];
  const before = versionOf(git(["show", "origin/master:src/lib/legal-version.ts"]));
  const after = versionOf(readFileSync("src/lib/legal-version.ts", "utf8"));
  if (before !== after) {
    risks.terms = true;
    const lastBump = git(["log", "-1", "--format=%cr", "origin/master", "--", "src/lib/legal-version.ts"]);
    note(`TERMS_VERSION ${before} -> ${after}; the last change on master was ${lastBump}`);
    if (!flags.termsBumpApproved) {
      fail(
        "TERMS_VERSION changed, which asks every account to accept again before its next buy. " +
          "Batch legal edits and bump at most once a week. Rerun with --terms-bump-approved only once David has agreed in chat.",
      );
    }
  }
}

if (changed.has("package.json")) {
  const depsOf = (text) => {
    const pkg = JSON.parse(text);
    return { ...pkg.dependencies, ...pkg.devDependencies };
  };
  const before = depsOf(git(["show", "origin/master:package.json"]));
  const after = depsOf(readFileSync("package.json", "utf8"));
  risks.sdk = Object.keys({ ...before, ...after }).filter((name) => SDK_DEPS.test(name) && before[name] !== after[name]);
}

// The quote path (scripts/lib/quote-path.mjs): what --solver-down-ack may not wave through.
const quotePath = quotePathTouched({
  changed,
  sdkPackages: risks.sdk,
  lockDiff: changed.has("pnpm-lock.yaml") ? git(["diff", "origin/master...HEAD", "--", "pnpm-lock.yaml"]) : "",
});

// 3. Static checks and tests
run("privy patch check", "node", ["scripts/check-privy-patch.mjs"]);
run("tsc", "pnpm", ["exec", "tsc", "--noEmit"]);
run("lint", "pnpm", ["lint"]);
run("test", "pnpm", ["test"]);
if (risks.sdk.length > 0) {
  note(`SDK or Privy changed (${risks.sdk.join(", ")}): checking the listing pins`);
  run("listings:verify", "pnpm", ["listings:verify"]);
}

// 4. Live smoke of the core money journey
const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
let smoke = "absent";
if (scripts[SMOKE_SCRIPT]) {
  note(`running ${SMOKE_SCRIPT}`);
  const started = Date.now();
  const result = spawnSync("pnpm", [SMOKE_SCRIPT], { stdio: "inherit" });
  steps.push({ name: SMOKE_SCRIPT, seconds: Math.round((Date.now() - started) / 1000) });
  if (result.status === 0) {
    smoke = "passed";
  } else if (result.status === 2) {
    // Only stock routes refused with the solver's -4 while the crypto control quoted.
    if (flags.solverDownAck && quotePath.length > 0) {
      fail(
        `${SMOKE_SCRIPT}: SOLVER SIDE, but --solver-down-ack is refused: this branch changes the quote path ` +
          `(${quotePath.join(", ")}), and a change there can make the solver answer -4 just as an outage does. ` +
          `Wait for the solver and rerun, or check the same pairs against production (pnpm smoke:quotes) to show it is red there too.`,
      );
    }
    if (!flags.solverDownAck) {
      fail(
        `${SMOKE_SCRIPT}: SOLVER SIDE. The SODAX solver is refusing stock routes (-4 "No path") while the ` +
          `crypto control quotes; this is not Berth's request. Wait and rerun, or, if nothing on the quote path ` +
          `changed, rerun with --solver-down-ack (logged) and tell the SODAX solver team.`,
      );
    }
    logOverride(`solver-down-ack ${git(["rev-parse", "--abbrev-ref", "HEAD"])} ${treeOf("HEAD").slice(0, 12)}: smoke:quotes was solver side`);
    note(`${SMOKE_SCRIPT} was SOLVER SIDE; proceeding on --solver-down-ack, logged to overrides.log.`);
    smoke = "solver-down-acked";
  } else {
    fail(`${SMOKE_SCRIPT} did not pass, and not in the solver's known way. Read its table before anything ships.`);
  }
} else {
  note(`no \`${SMOKE_SCRIPT}\` script yet: the live quote smoke was SKIPPED. Quote a buy by hand before shipping.`);
}

// Nothing may have moved while the checks ran (another agent, a commit in this worktree).
const tree = treeOf("HEAD");
if (git(["rev-parse", "HEAD"]) !== startHead || tree !== startTree || git(["status", "--porcelain", "--untracked-files=normal"])) {
  fail("HEAD or the working tree changed while verify ran, so what passed is not what would be recorded. Rerun on a still tree.");
}
writeVerifyRecord(tree, {
  tree,
  head: git(["rev-parse", "HEAD"]),
  branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
  at: new Date().toISOString(),
  steps,
  smoke,
  flags,
  risks,
});
note(`PASSED. Recorded tree ${tree.slice(0, 12)}; the ship guard will let it reach master.`);
