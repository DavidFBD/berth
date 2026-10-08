import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The ship guard (scripts/ship-guard.mjs) as Claude Code runs it: a JSON
 * hook input on stdin, exit 2 to deny, an "ask" decision on stdout, exit 0
 * to allow. Against a throwaway repo whose path has spaces, with one
 * verified tree. The guards review of 2026-10-09 (M1, M5, M6, minors 1, 2).
 */

const GUARD = resolve("scripts/ship-guard.mjs");
let root: string;
let repo: string;
let verifiedTree: string;

function git(args: string[], cwd = repo) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

type Outcome = "allow" | "deny" | "ask";
function guard(input: Record<string, unknown>, cwd = repo): { outcome: Outcome; stderr: string } {
  const result = spawnSync("node", [GUARD], { input: JSON.stringify({ cwd, ...input }), encoding: "utf8", env: { ...process.env, HOME: root } });
  if (result.status === 2) return { outcome: "deny", stderr: result.stderr };
  if (result.stdout.includes('"permissionDecision":"ask"')) return { outcome: "ask", stderr: result.stderr };
  return { outcome: "allow", stderr: result.stderr };
}
const bash = (command: string, cwd?: string) => guard({ tool_name: "Bash", tool_input: { command } }, cwd).outcome;
const edit = (file_path: string) => guard({ tool_name: "Edit", tool_input: { file_path } }).outcome;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ship guard "));
  repo = join(root, "guard test repo");
  mkdirSync(repo);
  git(["init", "-q", "-b", "master"]);
  git(["config", "user.email", "t@example.com"]);
  git(["config", "user.name", "t"]);
  git(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(repo, "a.txt"), "one\n");
  git(["add", "a.txt"]);
  git(["commit", "-q", "-m", "one"]);
  verifiedTree = git(["rev-parse", "HEAD^{tree}"]);
  const records = join(repo, ".git", "berth-verify");
  mkdirSync(records, { recursive: true });
  writeFileSync(join(records, `${verifiedTree}.json`), JSON.stringify({ tree: verifiedTree, smoke: "passed" }));
  git(["checkout", "-q", "-b", "feature"]);
  writeFileSync(join(repo, "a.txt"), "two\n");
  git(["commit", "-q", "-am", "two"]);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("pushes to master", () => {
  it.each([
    ["a verified tree from a literal quoted path", () => `cd "${repo}" && git push origin master:master`, "allow"],
    ["an unverified tree", () => `cd "${repo}" && git push origin HEAD:master`, "deny"],
    ["a non-master branch", () => `cd "${repo}" && git push origin feature`, "allow"],
    ["tags only", () => `cd "${repo}" && git push origin --tags`, "allow"],
    ["a shell variable directory", () => `WT="${repo}"; cd "$WT" && git push origin master:master`, "deny"],
    ["git -C with a variable", () => `git -C "$WT" push origin master:master`, "deny"],
    ["a ref that does not exist", () => `cd "${repo}" && git push origin nonexistentref:master`, "deny"],
    ["bash -c", () => `bash -c "git push origin master"`, "deny"],
    ["a subshell", () => `(git push origin master)`, "deny"],
    ["command git", () => `command git push origin master`, "deny"],
    ["a substituted ref", () => `cd "${repo}" && git push origin $(git rev-parse HEAD):master`, "deny"],
    ["a force cluster -uf", () => `cd "${repo}" && git push -uf origin master:master`, "deny"],
    ["--force", () => `cd "${repo}" && git push --force origin master:master`, "deny"],
    ["--all", () => `cd "${repo}" && git push --all origin`, "deny"],
    ["deleting master", () => `cd "${repo}" && git push origin :master`, "deny"],
  ])("%s", (_, command, expected) => {
    expect(bash(command())).toBe(expected);
  });

  it("a cannot-verify refusal says how to push instead", () => {
    const { stderr } = guard({ tool_name: "Bash", tool_input: { command: `cd "$WT" && git push origin HEAD:master` } });
    expect(stderr).toMatch(/literal path/);
  });
});

describe("BERTH_SHIP_OVERRIDE", () => {
  const log = () => join(repo, ".git", "berth-verify", "overrides.log");

  it("counts as a leading assignment with a reason, and is logged", () => {
    expect(bash(`cd "${repo}" && BERTH_SHIP_OVERRIDE="David said so in chat" git push origin HEAD:master`)).toBe("allow");
    expect(readFileSync(log(), "utf8")).toMatch(/push override \(David said so in chat\)/);
  });

  it("does not count inside a commit message", () => {
    expect(bash(`cd "${repo}" && git commit -m "x; BERTH_SHIP_OVERRIDE=yes" && git push origin HEAD:master`)).toBe("deny");
  });

  it("does not count with an empty or too short reason", () => {
    expect(bash(`cd "${repo}" && BERTH_SHIP_OVERRIDE="" git push origin HEAD:master`)).toBe("deny");
    expect(bash(`cd "${repo}" && BERTH_SHIP_OVERRIDE=x git push origin HEAD:master`)).toBe("deny");
  });

  it("gh pr merge asks, and with an override is let through and logged", () => {
    expect(bash(`cd "${repo}" && gh pr merge 5`)).toBe("ask");
    expect(bash(`cd "${repo}" && BERTH_SHIP_OVERRIDE="merge this one" gh pr merge 5`)).toBe("allow");
    expect(readFileSync(log(), "utf8")).toMatch(/gh pr merge override \(merge this one\)/);
  });
});

describe("the files that define the checks", () => {
  it.each(["package.json", "scripts/smoke-quotes.mjs", "src/lib/quote-smoke.ts", "scripts/db-push.mjs", "scripts/check-privy-patch.mjs", ".claude/settings.local.json", "scripts/ship-guard.mjs", ".github/workflows/checks.yml"])(
    "%s asks",
    (file) => {
      expect(edit(join(repo, file))).toBe("ask");
    },
  );

  it("an ordinary file does not", () => {
    expect(edit(join(repo, "src/app/page.tsx"))).toBe("allow");
  });

  it("a Bash write it can see asks too", () => {
    expect(bash(`cd "${repo}" && echo '{}' > package.json`)).toBe("ask");
    expect(bash(`cd "${repo}" && sed -i '' 's/a/b/' scripts/verify.mjs`)).toBe("ask");
    expect(bash(`cd "${repo}" && echo hi > notes.txt`)).toBe("allow");
  });
});

describe("a crash", () => {
  it("allows, says so and logs it", () => {
    const result = spawnSync("node", [GUARD], { input: "not json", encoding: "utf8", cwd: repo, env: { ...process.env, HOME: root } });
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/could not run/);
    expect(existsSync(join(repo, ".git", "berth-verify", "guard-crashes.log"))).toBe(true);
  });
});
