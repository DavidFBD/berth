import { describe, expect, it } from "vitest";
import { getSwapQuoteQueryOptions } from "@sodax/dapp-kit";
import {
  EMPTY_HOLD,
  FAILURES_TO_SHOW,
  HOLD_MS,
  SDK_QUOTE_REFRESH_MS,
  classifyQuoteError,
  errorNumber,
  freshForSigning,
  holdReduce,
  holdView,
  refusalReason,
  refusalWords,
  type HoldState,
  type QuoteAnswer,
} from "./quote-hold";
import { COPY } from "./copy";

const K = "pair-a";
const noPath = { detail: { code: -4, message: "No path was found between 0xaa and 0xbb" } };
const tooLow = { detail: { code: -23, message: "Input amount too low" } };
const proxyDown = { detail: { code: -999, message: "SODAX API unreachable: timeout" } };
const ok = (quoted: bigint, at: number): QuoteAnswer => ({ ok: true, quoted, at });
const fail = (error: unknown, at: number): QuoteAnswer => ({ ok: false, error, at });

function run(answers: QuoteAnswer[], key = K): HoldState {
  return answers.reduce((s, a) => holdReduce(s, key, a), EMPTY_HOLD);
}

describe("classifyQuoteError", () => {
  it.each([
    ["-4 no path", noPath, "noPath", -4],
    ["too low", tooLow, "tooSmall", -23],
    ["-999 from the proxy or a failed fetch", proxyDown, "unavailable", -999],
    ["a body with no code (401, 429 or HTML)", { detail: "Unauthorized" }, "unavailable", undefined],
    ["nothing at all", undefined, "unavailable", undefined],
    ["another solver refusal", { detail: { code: -5, message: "No private liquidity" } }, "noRoute", -5],
  ])("%s", (_, error, refusal, code) => {
    expect(classifyQuoteError(error)).toEqual({ refusal, code });
  });
});

describe("holdView: a blip does not flip the drawer", () => {
  it("shows a good quote", () => {
    const s = run([ok(100n, 0)]);
    expect(holdView(s, K, 0)).toMatchObject({ quoted: 100n, held: false, refusal: undefined });
  });

  it("holds the last good quote across one refusal", () => {
    const s = run([ok(100n, 0), fail(noPath, 3_000)]);
    expect(holdView(s, K, 3_000)).toMatchObject({ quoted: 100n, held: true, refusal: undefined });
  });

  it("keeps holding for about 10 s even after two refusals", () => {
    const s = run([ok(100n, 0), fail(noPath, 3_000), fail(noPath, 6_000), fail(noPath, 9_000)]);
    expect(holdView(s, K, 9_000)).toMatchObject({ quoted: 100n, held: true });
  });

  it("shows the refusal once the hold has run out and the refusals keep coming", () => {
    const s = run([ok(100n, 0), fail(noPath, 3_000), fail(noPath, 6_000), fail(noPath, 9_000), fail(noPath, 12_000)]);
    expect(holdView(s, K, 12_000)).toMatchObject({ quoted: undefined, refusal: "noPath", code: -4 });
  });

  it("with nothing to hold, waits for a second refusal before saying so", () => {
    expect(holdView(run([fail(noPath, 0)]), K, 0)).toMatchObject({ quoted: undefined, refusal: undefined });
    expect(FAILURES_TO_SHOW).toBe(2);
    expect(holdView(run([fail(noPath, 0), fail(noPath, 3_000)]), K, 3_000)).toMatchObject({ refusal: "noPath" });
  });

  it("does not hold past HOLD_MS when one refusal follows a long silence", () => {
    const s = run([ok(100n, 0), fail(proxyDown, HOLD_MS + 1)]);
    expect(holdView(s, K, HOLD_MS + 1)).toMatchObject({ quoted: undefined, refusal: undefined });
  });

  it("a good answer clears the count", () => {
    const s = run([fail(noPath, 0), fail(noPath, 3_000), ok(90n, 6_000), fail(noPath, 9_000)]);
    expect(holdView(s, K, 9_000)).toMatchObject({ quoted: 90n, held: true, refusal: undefined });
  });

  it("too small shows at once and is never held over", () => {
    const s = run([ok(100n, 0), fail(tooLow, 3_000)]);
    expect(holdView(s, K, 3_000)).toMatchObject({ quoted: undefined, refusal: "tooSmall" });
  });

  it("a new pair or amount starts clean", () => {
    const s = run([ok(100n, 0)]);
    expect(holdView(s, "pair-b", 0)).toMatchObject({ quoted: undefined, refusal: undefined });
    const next = holdReduce(s, "pair-b", fail(noPath, 1_000));
    expect(next.good).toBeUndefined();
    expect(next.failures).toBe(1);
  });

  it("a throw from the SDK reads as no route, not as prices down", () => {
    const s = run([
      { ok: false, error: new Error("unsupported token_src"), at: 0, thrown: true },
      { ok: false, error: new Error("unsupported token_src"), at: 3_000, thrown: true },
    ]);
    expect(holdView(s, K, 3_000).refusal).toBe("noRoute");
  });
});

describe("freshForSigning: a held quote is never signed", () => {
  const max = 3_000;
  it("signs a good quote within the SDK's refresh", () => {
    expect(freshForSigning(run([ok(100n, 0)]), K, 2_999, max)).toBe(100n);
  });
  it("asks again for one older than that", () => {
    expect(freshForSigning(run([ok(100n, 0)]), K, 3_001, max)).toBeUndefined();
  });
  it("asks again when the quote on screen is held over a refusal", () => {
    expect(freshForSigning(run([ok(100n, 0), fail(noPath, 500)]), K, 600, max)).toBeUndefined();
  });
  it("never signs another pair's quote", () => {
    expect(freshForSigning(run([ok(100n, 0)]), "pair-b", 0, max)).toBeUndefined();
  });
  it("uses the SDK's own refresh, which is still 3 s", () => {
    const interval = getSwapQuoteQueryOptions({
      sodax: { swaps: { partnerFee: undefined } } as never,
      payload: undefined,
    }).refetchInterval;
    expect(interval).toBe(SDK_QUOTE_REFRESH_MS);
  });
});

describe("words and codes", () => {
  it("a stock's -4 is its market, a crypto -4 is no route, a failed proxy is prices", () => {
    expect(refusalWords("noPath", "stock")).toBe("marketQuiet");
    expect(refusalWords("noPath", "crypto")).toBe("noRoute");
    expect(refusalWords("unavailable", "stock")).toBe("pricesQuiet");
    expect(refusalWords("unavailable", "crypto")).toBe("pricesQuiet");
    expect(refusalWords("noRoute", "stock")).toBe("noRoute");
  });

  it("the copy is calm and has no dash as punctuation", () => {
    for (const text of [COPY.marketQuietForPair, COPY.pricesQuietForPair, COPY.quoteRefreshFailed, COPY.ctaMarketQuiet, COPY.ctaPricesQuiet]) {
      expect(text).not.toMatch(/[—–]| - /);
      expect(text).not.toMatch(/no route/i);
    }
  });

  it("analytics codes are short and carry no sign", () => {
    expect(refusalReason("noPath")).toBe("no_path");
    expect(refusalReason("unavailable")).toBe("unavailable");
    expect(errorNumber(-4)).toBe("4");
    expect(errorNumber(-999)).toBe("999");
    expect(errorNumber(undefined)).toBe("none");
  });
});
