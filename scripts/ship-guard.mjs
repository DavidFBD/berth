// Claude Code PreToolUse hook (.claude/settings.json). Local only: it reads
// git and the verify records, never the network.
//
// Bash:
//   - a push to master is refused unless `pnpm verify` passed on that exact
//     tree (scripts/verify.mjs writes the record)
//   - a push the guard cannot resolve is refused, not waved through: a shell
//     variable or substitution in the directory or the ref, `git -C $X`, a
//     push inside `bash -c`, `sh -c`, `eval`, `command`, `env`, `xargs`,
//     `exec` or a subshell, a ref that does not exist. Push from a literal
//     path with a literal ref instead.
//   - a force push (including -uf style clusters), --all or --mirror is refused
//   - `gh pr merge` (and the merge API) asks David: a GitHub merge skips
//     pnpm verify, which is how a 6.7k line PR shipped unreviewed
//   - BERTH_SHIP_OVERRIDE="<reason>" as a LEADING assignment of the push or
//     merge segment, with a reason of 3 characters or more, lets it through
//     and is logged (.git/berth-verify/overrides.log). Agents use it only when
//     David said so in chat.
// Edit, Write, MultiEdit, and Bash writes it can see (`>`, `>>`, `tee`,
// `sed -i` into a path):
//   - the files that define the checks ask David first, so a check is never
//     weakened to make a change pass. A Bash write it cannot see (a script, an
//     interpreter, a variable path) is not caught: this is a speed bump, not a
//     wall.
//
// The guard allows only when it crashes itself, and logs that.
import { appendFileSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { git, logOverride, readVerifyRecord, recordDir, treeOf } from "./lib/verify-marker.mjs";

const PROTECTED = [
  /^eslint\.config\.m?[jt]s$/,
  /^tsconfig(\..+)?\.json$/,
  /^vitest\.config\.m?[jt]s$/,
  /^\.claude\/settings(\.local)?\.json$/,
  /^scripts\/(ship-guard|verify|smoke-quotes|db-push|check-privy-patch)\.mjs$/,
  /^scripts\/lib\/verify-marker\.mjs$/,
  /^src\/lib\/quote-smoke\.ts$/,
  /^package\.json$/,
  /^\.github\/workflows\//,
];

/** Words that run their arguments as a command the guard cannot read. */
const WRAPPERS = new Set(["bash", "sh", "zsh", "dash", "eval", "command", "env", "xargs", "exec", "sudo", "nohup", "time"]);

const CANNOT_VERIFY =
  "cannot verify this push to master. Push from a literal path with a literal ref, for example " +
  "`cd /Users/david/Github/_scratch-berth/ship && git push origin HEAD:master`, with no shell variables, " +
  "substitutions, `git -C $X`, subshells or `bash -c`.";

function deny(reason) {
  process.stderr.write(`ship guard: ${reason}\n`);
  process.exit(2);
}
function ask(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason },
    }),
  );
  process.exit(0);
}

// Split a shell segment into words, honouring simple quotes.
function words(segment) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(segment))) out.push(match[1] ?? match[2] ?? match[3]);
  return out;
}

/** Something the shell would expand, which the guard cannot. */
const dynamic = (text) => /[$`]/.test(text);

/** Leading VAR=value assignments of a segment: their values, and the rest. */
function leadingAssignments(segment) {
  const assignments = {};
  let rest = segment.trim();
  const re = /^([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S*)\s*/;
  let match;
  while ((match = re.exec(rest))) {
    assignments[match[1]] = match[2].replace(/^["']|["']$/g, "");
    rest = rest.slice(match[0].length);
  }
  return { assignments, rest };
}

/** The override, only as a leading assignment with a real reason. */
function overrideOf(assignments) {
  const reason = assignments.BERTH_SHIP_OVERRIDE;
  return typeof reason === "string" && reason.trim().length >= 3 ? reason.trim() : null;
}

function logSafely(line, dir) {
  try {
    logOverride(line, dir);
  } catch {
    try {
      appendFileSync(join(process.env.HOME ?? "/tmp", ".berth-ship-guard.log"), `${new Date().toISOString()} ${line}\n`);
    } catch {
      // Nowhere to write; the override still stands, as before.
    }
  }
}

function checkPush(tokens, dir, override, segment) {
  let i = tokens.indexOf("push");
  const positional = [];
  let force = false;
  let wholesale = false;
  let tags = false;
  let deleting = false;
  for (i += 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.startsWith("--force")) force = true;
    else if (/^-[a-zA-Z]+$/.test(token) && token.includes("f")) force = true;
    else if (token === "--all" || token === "--mirror") wholesale = true;
    else if (token === "--tags") tags = true;
    else if (token === "--delete" || (/^-[a-zA-Z]+$/.test(token) && token.includes("d"))) deleting = true;
    else if (token === "-o" || token === "--push-option" || token === "--repo") i += 1;
    else if (!token.startsWith("-")) positional.push(token);
  }
  const refspecs = positional.slice(1);
  if (positional.some(dynamic)) deny(CANNOT_VERIFY);
  if (wholesale && !override) deny("--all and --mirror pushes are refused. Push the one branch you mean.");

  let toMaster = [];
  if (refspecs.length === 0) {
    // `git push --tags` pushes tags only, never a branch.
    if (tags) return;
    if (dir === null || !existsSync(dir)) deny(CANNOT_VERIFY);
    let branch;
    let upstream = "";
    try {
      branch = git(["rev-parse", "--abbrev-ref", "HEAD"], dir);
    } catch {
      deny(CANNOT_VERIFY);
    }
    try {
      upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{push}"], dir);
    } catch {
      // No push target configured: git itself refuses the push.
    }
    if (branch === "master" || upstream === "origin/master") toMaster = ["HEAD"];
  } else {
    for (const spec of refspecs) {
      if (spec.startsWith("+")) force = true;
      const clean = spec.replace(/^\+/, "");
      const [src, dst = src] = clean.split(":");
      if (dst === "master" || dst === "refs/heads/master") {
        if (deleting || src === "") deny("deleting master is refused.");
        toMaster.push(src || "HEAD");
      }
    }
  }
  if (toMaster.length === 0) return;
  if (override) {
    logSafely(`push override (${override}) ${dir ?? "?"}: ${segment.slice(0, 300)}`, dir ?? undefined);
    return;
  }
  if (force) deny("a force push to master is refused. Master is production.");
  if (dir === null || !existsSync(dir)) deny(CANNOT_VERIFY);
  for (const src of toMaster) {
    let tree;
    try {
      tree = treeOf(src, dir);
    } catch {
      deny(`${CANNOT_VERIFY} (The ref \`${src}\` does not resolve here.)`);
    }
    const record = readVerifyRecord(tree, dir);
    if (!record || (record.tree !== undefined && record.tree !== tree)) {
      deny(
        `no passing \`pnpm verify\` for the tree you are pushing to master (${tree.slice(0, 12)}). ` +
          "Run `pnpm verify` on the branch after merging origin/master and committing, then squash and push. " +
          "If the squash tree differs from the verified branch, origin/master moved: merge it and verify again.",
      );
    }
    if (record.smoke === "solver-down-acked") {
      process.stderr.write("ship guard: verified with the solver down for stock routes (--solver-down-ack). Smoke production right after the deploy.\n");
    } else if (record.smoke !== "passed") {
      process.stderr.write("ship guard: verified, but the live quote smoke was skipped. Quote a buy on production right after the deploy.\n");
    }
  }
}

/** A Bash write the guard can see into a protected file: `>`, `>>`, `tee`, `sed -i`. */
function checkBashWrite(segment, dir) {
  if (dir === null) return;
  const targets = [];
  for (const match of segment.matchAll(/>>?\s*("[^"]+"|'[^']+'|[^\s;|&]+)/g)) targets.push(match[1]);
  const tokens = words(segment);
  if (tokens[0] === "tee") targets.push(...tokens.slice(1).filter((t) => !t.startsWith("-")));
  if (tokens[0] === "sed" && tokens.some((t) => t === "-i" || t.startsWith("-i"))) targets.push(...tokens.slice(1).filter((t) => !t.startsWith("-")).slice(1));
  for (const target of targets) checkEdit(target.replace(/^["']|["']$/g, ""), dir);
}

/** The directory `cd` or `git -C` lands in; null when the shell would have to expand it. */
function resolveDir(from, next) {
  if (dynamic(next)) return null;
  if (isAbsolute(next)) return next;
  return from === null ? null : resolve(from, next);
}

function checkBash(command, cwd) {
  let dir = cwd;
  for (const raw of command.split(/&&|\|\||;|\n|\|/)) {
    const { assignments, rest } = leadingAssignments(raw);
    const override = overrideOf(assignments);
    const segment = rest.trim();
    if (!segment) continue;
    const tokens = words(segment);
    const first = tokens[0] ?? "";

    // Wrapped or substituted: the guard cannot read what runs. Refuse a push to master in there.
    const wrapped = WRAPPERS.has(first) || segment.startsWith("(") || segment.startsWith("{") || /\$\(|`/.test(segment);
    if (wrapped && /\bpush\b/.test(segment) && (/\bmaster\b/.test(segment) || !/\bpush\s+\S+\s+\S/.test(segment))) {
      if (override) {
        logSafely(`wrapped push override (${override}) ${dir ?? "?"}: ${segment.slice(0, 300)}`, dir ?? undefined);
        continue;
      }
      deny(CANNOT_VERIFY);
    }

    if (first === "cd" && tokens[1]) {
      const next = tokens[1].replace(/^~(?=\/|$)/, process.env.HOME ?? "~");
      dir = resolveDir(dir, next);
      continue;
    }
    if (first === "gh" && tokens[1] === "pr" && tokens[2] === "merge") {
      if (override) {
        logSafely(`gh pr merge override (${override}) ${dir ?? "?"}: ${segment.slice(0, 300)}`, dir ?? undefined);
        continue;
      }
      ask("A GitHub merge to master skips `pnpm verify` and the review gate. Merge only if David wants this one merged on GitHub.");
    }
    if (first === "gh" && tokens[1] === "api" && /\/pulls\/\d+\/merge/.test(segment)) {
      if (override) {
        logSafely(`gh api merge override (${override}) ${dir ?? "?"}: ${segment.slice(0, 300)}`, dir ?? undefined);
        continue;
      }
      ask("Merging a pull request through the API skips `pnpm verify` and the review gate.");
    }
    checkBashWrite(segment, dir);
    if (first !== "git") continue;
    let gitDir = dir;
    const args = tokens.slice(1);
    while (args.length && args[0].startsWith("-")) {
      const flag = args.shift();
      if (flag === "-C" && args.length) {
        const target = args.shift();
        gitDir = resolveDir(gitDir, target);
      } else if (flag === "-c" && args.length) args.shift();
    }
    if (args[0] === "push") checkPush(args, gitDir, override, segment);
  }
}

function checkEdit(filePath, cwd) {
  if (!filePath || dynamic(filePath)) return;
  const absolute = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
  // The checkout the file lives in, which may be a worktree, not the session's.
  let dir = dirname(absolute);
  while (!existsSync(dir) && dir !== dirname(dir)) dir = dirname(dir);
  let root;
  try {
    root = git(["rev-parse", "--show-toplevel"], dir);
  } catch {
    return;
  }
  // Symlinked paths (macOS /var is /private/var) compare by their real path.
  const real = join(realpathSync(dir), relative(dir, absolute));
  const rel = relative(realpathSync(root), real);
  if (rel.startsWith("..")) return;
  if (PROTECTED.some((pattern) => pattern.test(rel))) {
    ask(`${rel} defines a check (lint, types, tests, the smoke or the ship guard). Changing it needs David's yes, and never to make a failing change pass.`);
  }
}

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
  const cwd = input.cwd || process.cwd();
  if (input.tool_name === "Bash") checkBash(String(input.tool_input?.command ?? ""), cwd);
  else checkEdit(input.tool_input?.file_path, cwd);
} catch (error) {
  // Fail open only here: a broken guard must not stop every tool call. Say so, and log it.
  const message = `ship guard could not run: ${error instanceof Error ? error.message : error}`;
  process.stderr.write(`${message}\n`);
  try {
    appendFileSync(join(recordDir(input?.cwd || process.cwd()), "guard-crashes.log"), `${new Date().toISOString()} ${message} :: ${String(input?.tool_input?.command ?? input?.tool_input?.file_path ?? "").slice(0, 300)}\n`);
  } catch {
    // Not in a git checkout: nowhere to log.
  }
}
process.exit(0);
