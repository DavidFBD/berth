import { describe, expect, it } from "vitest";
import type { ErrorReportPayload } from "@/lib/error-report";
import {
  MAX_LOGS,
  buildIssueBody,
  codeBlock,
  fingerprintMarker,
  issueTitle,
} from "./issue-body";

function payload(overrides: Partial<ErrorReportPayload> = {}): ErrorReportPayload {
  return {
    action: "deposit",
    step: "signing",
    vaultName: "lsodaWEETH",
    srcChainKey: "0x2105.base",
    tokenSymbol: "USDC",
    amount: "2000000 (raw, 6dp)",
    walletMode: "email",
    addressHint: "0xcFCd…4165",
    errorCode: "TX_SUBMIT_FAILED",
    friendlyMessage: "The kettle's acting up. Try again.",
    rawMessage: "boom",
    fingerprint: "0a1b2c3d",
    logs: [],
    page: {
      url: "https://lsteatime.com",
      userAgent: "test",
      viewport: "390x844",
      at: "2026-08-07T12:00:00.000Z",
    },
    ...overrides,
  };
}

describe("codeBlock", () => {
  it("fences the text", () => {
    expect(codeBlock("hello")).toBe("```\nhello\n```");
  });

  it("neuters fences inside attacker-influenced text", () => {
    // Log text is browser input: a raw ``` must not close the block and
    // let the rest inject markdown (or @-mentions) into the issue.
    const body = codeBlock("before\n```\n@here injected");
    const inner = body.slice(4, -4);
    expect(inner.includes("```")).toBe(false);
  });
});

describe("issueTitle", () => {
  it("names what failed, where, and the tersest cause", () => {
    expect(issueTitle(payload())).toBe(
      "deposit failed at signing on 0x2105.base: TX_SUBMIT_FAILED",
    );
  });

  it("falls back to the friendly copy without a code, omits a missing chain", () => {
    const p = payload({ errorCode: undefined, srcChainKey: undefined });
    expect(issueTitle(p)).toBe(
      "deposit failed at signing: The kettle's acting up. Try again.",
    );
  });

  it("caps at 200 characters", () => {
    const p = payload({ errorCode: undefined, friendlyMessage: "x".repeat(500) });
    expect(issueTitle(p).length).toBe(200);
  });
});

describe("buildIssueBody", () => {
  it("carries the dedup marker verbatim", () => {
    expect(buildIssueBody(payload(), "abc1234")).toContain(
      fingerprintMarker("0a1b2c3d"),
    );
  });

  it("renders present fields as table rows and drops missing ones", () => {
    const body = buildIssueBody(payload({ dstChainKey: undefined }), "abc1234");
    expect(body).toContain("| Wallet mode | `email` |");
    expect(body).toContain("| Deploy | `abc1234` |");
    expect(body).not.toContain("Destination chain");
  });

  it("omits optional sections when empty", () => {
    const body = buildIssueBody(
      payload({ rawMessage: undefined, txHashes: undefined, logs: [] }),
      undefined,
    );
    expect(body).not.toContain("### Raw error");
    expect(body).not.toContain("### Transactions");
    expect(body).not.toContain("### Console");
    expect(body).toContain("### Client");
  });

  it("keeps only the tail of a long console capture", () => {
    const logs = Array.from({ length: MAX_LOGS + 10 }, (_, i) => ({
      at: "t",
      level: "error" as const,
      text: `line-${i}`,
    }));
    const body = buildIssueBody(payload({ logs }), undefined);
    expect(body).not.toContain("line-0");
    expect(body).toContain(`line-${MAX_LOGS + 9}`);
  });

  it("lists transactions when present", () => {
    const body = buildIssueBody(payload({ txHashes: ["0xaaa", "0xbbb"] }), undefined);
    expect(body).toContain("### Transactions");
    expect(body).toContain("- `0xaaa`");
    expect(body).toContain("- `0xbbb`");
  });
});

describe("buildIssueBody diagnostics", () => {
  it("fences per-occurrence diagnostics so their values cannot break the body", () => {
    const body = buildIssueBody(
      payload({
        diagnostics: { hubTxHash: "0xabc", statusEndpoint: "erroring: ```boom" },
      }),
      undefined,
    );
    expect(body).toContain("### Diagnostics");
    expect(body).toContain("hubTxHash: 0xabc");
    expect(body).not.toContain("erroring: ```boom");
  });

  it("leaves the section out when there is nothing to say", () => {
    expect(buildIssueBody(payload(), undefined)).not.toContain("### Diagnostics");
  });
});

describe("issue-body redaction", () => {
  it("strips RPC keys a stale client left in, from every free-text field", () => {
    const key = "Xk3vQ9pLm2RtY7uW8zA1bC4dE";
    const body = buildIssueBody(
      payload({
        rawMessage: `HTTP request failed. URL: https://base-mainnet.g.alchemy.com/v2/${key}`,
        diagnostics: { statusEndpoint: "erroring: https://x.io/rpc?apikey=SECRET123" },
        logs: [
          {
            at: "2026-09-25T10:00:00.000Z",
            level: "error",
            text: "fetch https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161 failed",
          },
        ],
      }),
      undefined,
    );
    expect(body).not.toContain(key);
    expect(body).not.toContain("SECRET123");
    expect(body).not.toContain("9aa3d95b3bc440fa88ea12eaa4456161");
    expect(body).toContain("/v2/[redacted]");
  });
});

describe("issueTitle for an unsettled order", () => {
  it("says unsettled, not failed at settling", () => {
    const p = payload({ step: "settling", errorCode: "SOLVER_FILL_UNSETTLED" });
    expect(issueTitle(p)).toBe(
      "deposit unsettled on 0x2105.base: SOLVER_FILL_UNSETTLED",
    );
  });
});
