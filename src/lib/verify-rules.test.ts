import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { quotePathTouched, lockTouchesSdk } from "../../scripts/lib/quote-path.mjs";

/** pnpm verify's rules from the guards review of 2026-10-09 (M3, M4). */

describe("--solver-down-ack and the quote path (M3)", () => {
  it.each([
    ["src/lib/listings.ts"],
    ["src/lib/sodax-config.ts"],
    ["src/hooks/use-pour-quote.ts"],
    ["src/lib/quote-hold.ts"],
    ["src/lib/quote-smoke.ts"],
    ["src/lib/server/sodax-proxy.ts"],
    ["src/app/api/sodax/[...path]/route.ts"],
  ])("%s is on it", (path) => {
    expect(quotePathTouched({ changed: new Set([path]) })).toEqual([path]);
  });

  it("an SDK or Privy version in package.json is on it", () => {
    expect(quotePathTouched({ changed: new Set(["package.json"]), sdkPackages: ["@sodax/sdk"] })).toEqual(["package.json @sodax/sdk"]);
  });

  it("a lockfile line naming @sodax or @privy-io is on it, others are not", () => {
    expect(lockTouchesSdk("+  '@sodax/sdk@2.2.0-rc.9':\n")).toBe(true);
    expect(lockTouchesSdk("-  /@privy-io/react-auth@3.35.2:\n")).toBe(true);
    expect(lockTouchesSdk("+  vitest@4.1.11:\n--- a/pnpm-lock.yaml\n")).toBe(false);
  });

  it("an unrelated change is not", () => {
    expect(quotePathTouched({ changed: new Set(["src/app/page.tsx", "README.md"]) })).toEqual([]);
  });
});

describe("verify refuses an untracked file (M4)", () => {
  it("before it checks anything", () => {
    const repo = mkdtempSync(join(tmpdir(), "verify-"));
    try {
      const git = (args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
      git(["init", "-q", "-b", "master"]);
      git(["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "x"]);
      writeFileSync(join(repo, "forgotten.ts"), "export const x = 1;\n");
      const result = spawnSync("node", [resolve("scripts/verify.mjs")], { cwd: repo, encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/untracked/);
      expect(result.stderr).toMatch(/forgotten\.ts/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
