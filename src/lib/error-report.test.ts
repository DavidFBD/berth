import { describe, expect, it, vi } from "vitest";
import {
  fingerprintOf,
  redactSecrets,
  submitErrorReport,
  type ErrorReportContext,
} from "./error-report";

/**
 * The fingerprint groups failures by cause so one bug is one issue. Issues
 * #16 through #20 are what happens when it doesn't: a single Solana RPC
 * outage, filed five times, because the node echoed a fresh request id into
 * every message and the id survived normalisation. These tests pin the
 * volatile shapes that must never reach the hash.
 */
const context = (rawMessage: string): ErrorReportContext => ({
  action: "deposit",
  step: "signing",
  errorCode: "INTENT_CREATION_FAILED",
  srcChainKey: "solana",
  friendlyMessage: "The order did not go through. Try again.",
  rawMessage,
});

describe("fingerprintOf", () => {
  it("groups one RPC outage into one issue, whatever request id it quotes", () => {
    // Verbatim from #16 and #17, which differ only in the echoed id.
    const sixteen = context(
      'SodaxError: failed to get info about account 2bLSKgpPTS4r5YSzCYFUfdzDn7pG4nVxRiMKPWFJjpHC: Error: 403 : {"jsonrpc":"2.0","error":{"code": 403, "message":"Access forbidden"}, "id": "38ba2844-c29b-4179-8bcf-f9c8378c0a4a" }',
    );
    const seventeen = context(
      'SodaxError: failed to get info about account 2bLSKgpPTS4r5YSzCYFUfdzDn7pG4nVxRiMKPWFJjpHC: Error: 403 : {"jsonrpc":"2.0","error":{"code": 403, "message":"Access forbidden"}, "id": "5f876c5f-f0b8-4cf5-aecf-3d5c29d23215" }',
    );
    expect(fingerprintOf(sixteen)).toBe(fingerprintOf(seventeen));
  });

  it("groups the same failure from two different accounts", () => {
    const mine = context("failed to get info about account 2bLSKgpPTS4r5YSzCYFUfdzDn7pG4nVxRiMKPWFJjpHC: 403");
    const yours = context("failed to get info about account 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin: 403");
    expect(fingerprintOf(mine)).toBe(fingerprintOf(yours));
  });

  it("groups an unpayable fee whatever the balance was", () => {
    const poorer = context("have 743300593668700 want 975917986270590");
    const richer = context("have 12 want 9759179862705900");
    expect(fingerprintOf(poorer)).toBe(fingerprintOf(richer));
  });

  it("still tells genuinely different causes apart", () => {
    const forbidden = context("Access forbidden");
    const unpayable = context("exceeds the balance of the account");
    expect(fingerprintOf(forbidden)).not.toBe(fingerprintOf(unpayable));
  });

  it("keeps one cause per chain, since a chain is a different fix", () => {
    const solana = context("Access forbidden");
    const base = { ...context("Access forbidden"), srcChainKey: "0x2105.base" };
    expect(fingerprintOf(solana)).not.toBe(fingerprintOf(base));
  });
});

describe("redactSecrets", () => {
  it("takes the key out of an Alchemy URL", () => {
    const text =
      'HTTP request failed. URL: https://base-mainnet.g.alchemy.com/v2/Xk3vQ9pLm2RtY7uW8zA1bC4dE Status: 429';
    const out = redactSecrets(text);
    expect(out).not.toContain("Xk3vQ9pLm2RtY7uW8zA1bC4dE");
    expect(out).toContain("https://base-mainnet.g.alchemy.com/v2/[redacted]");
    expect(out).toContain("Status: 429");
  });

  it("takes the project id out of an Infura URL", () => {
    const out = redactSecrets("fetch https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161 failed");
    expect(out).toBe("fetch https://mainnet.infura.io/v3/[redacted] failed");
  });

  it("takes keys out of query strings", () => {
    const out = redactSecrets(
      "https://mainnet.helius-rpc.com/?api-key=1f2e3d4c-aaaa-bbbb-cccc-123456789abc&commitment=confirmed and https://api.example.io/rpc?apikey=SECRET123",
    );
    expect(out).toBe(
      "https://mainnet.helius-rpc.com/?api-key=[redacted]&commitment=confirmed and https://api.example.io/rpc?apikey=[redacted]",
    );
  });

  it("takes the token out of QuickNode and Ankr URLs", () => {
    expect(redactSecrets("https://x-y.base-mainnet.quiknode.pro/abc123def456/")).toBe(
      "https://x-y.base-mainnet.quiknode.pro/[redacted]/",
    );
    expect(
      redactSecrets("https://rpc.ankr.com/eth/0123456789abcdef0123456789abcdef"),
    ).toBe("https://rpc.ankr.com/eth/[redacted]");
  });

  it("takes dRPC's dkey out of a query string", () => {
    expect(
      redactSecrets("https://lb.drpc.org/ogrpc?network=base&dkey=AsdF123qwerty456zxcv"),
    ).toBe("https://lb.drpc.org/ogrpc?network=base&dkey=[redacted]");
  });

  it("takes a bare hex key out of the first path segment", () => {
    expect(
      redactSecrets("https://nd-123-456-789.p2pify.com/0123456789abcdef0123456789abcdef failed"),
    ).toBe("https://nd-123-456-789.p2pify.com/[redacted] failed");
    expect(
      redactSecrets("POST https://go.getblock.io/abcdef0123456789abcdef0123456789/ 403"),
    ).toBe("POST https://go.getblock.io/[redacted]/ 403");
  });

  it("never mistakes a 0x hash or address in a URL for a key", () => {
    const hash = "0x5f4e3d2c1b0a99887766554433221100aabbccddeeff00112233445566778899";
    const address = "0xcFCd8a9b0c1d2e3f40516273849506a7b8c94165";
    for (const text of [
      `https://sonicscan.org/tx/${hash}`,
      `https://example.org/${hash}`,
      `https://example.org/${address}`,
    ]) {
      expect(redactSecrets(text)).toBe(text);
    }
  });

  it("leaves hashes, addresses and plain errors alone", () => {
    const text =
      "execution reverted for 0x5f4e3d2c1b0a99887766554433221100aabbccddeeff00112233445566778899 at 0xcFCd8a9b0c1d2e3f40516273849506a7b8c94165";
    expect(redactSecrets(text)).toBe(text);
    expect(redactSecrets("Access forbidden")).toBe("Access forbidden");
  });
});

describe("submitErrorReport", () => {
  it("sends raw text and diagnostics with the keys taken out", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => Response.json({ status: "filed", issueNumber: 1 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await submitErrorReport({
        ...context("https://base-mainnet.g.alchemy.com/v2/Xk3vQ9pLm2RtY7uW8zA1bC4dE 429"),
        step: "redaction-wiring",
        diagnostics: { statusEndpoint: "erroring: https://x.io/?apikey=SECRET123" },
      });
      const body = String(fetchMock.mock.calls[0][1]?.body);
      expect(body).not.toContain("Xk3vQ9pLm2RtY7uW8zA1bC4dE");
      expect(body).not.toContain("SECRET123");
      expect(body).toContain("[redacted]");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("submitErrorReport session dedup", () => {
  const stubFetch = () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => Response.json({ status: "filed", issueNumber: 1 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("sends every settling report, so each stuck order reaches the issue", async () => {
    const fetchMock = stubFetch();
    try {
      const stuck = (hash: string): ErrorReportContext => ({
        ...context("Solver status never turned terminal"),
        step: "settling",
        diagnostics: { hubTxHash: hash },
      });
      await submitErrorReport(stuck("0x" + "1".repeat(64)));
      await submitErrorReport(stuck("0x" + "2".repeat(64)));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("still sends a repeated failure at any other step only once", async () => {
    const fetchMock = stubFetch();
    try {
      const failure = { ...context("dedup-check boom"), step: "dedup-check" };
      await submitErrorReport(failure);
      await submitErrorReport(failure);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
