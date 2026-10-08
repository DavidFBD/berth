// Where `pnpm verify` records what passed, and where `pnpm db:push` records
// which schema it applied. Both live in the git common dir, so every
// worktree of this clone sees the same records and nothing is committed.
//
// A verify record is keyed by the TREE hash, not the commit: the squash
// commit made in the ship worktree has a new commit id but the same tree as
// the verified branch tip (once the branch has merged origin/master), so a
// verify on the branch counts for the squash that ships it.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export function recordDir(cwd = process.cwd()) {
  const common = git(["rev-parse", "--git-common-dir"], cwd);
  const dir = join(isAbsolute(common) ? common : resolve(cwd, common), "berth-verify");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function treeOf(ref, cwd = process.cwd()) {
  return git(["rev-parse", `${ref}^{tree}`], cwd);
}

export function verifyRecordPath(tree, cwd) {
  return join(recordDir(cwd), `${tree}.json`);
}

export function readVerifyRecord(tree, cwd) {
  const path = verifyRecordPath(tree, cwd);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function writeVerifyRecord(tree, record, cwd) {
  writeFileSync(verifyRecordPath(tree, cwd), JSON.stringify(record, null, 2) + "\n");
}

export function schemaHash(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function schemaRecordPath(hash, cwd) {
  return join(recordDir(cwd), `schema-${hash}`);
}

export function markSchemaPushed(text, cwd) {
  writeFileSync(schemaRecordPath(schemaHash(text), cwd), new Date().toISOString() + "\n");
}

export function schemaWasPushed(text, cwd) {
  return existsSync(schemaRecordPath(schemaHash(text), cwd));
}

export function logOverride(line, cwd) {
  appendFileSync(join(recordDir(cwd), "overrides.log"), `${new Date().toISOString()} ${line}\n`);
}
