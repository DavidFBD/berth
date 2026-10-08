import { readFileSync } from "node:fs";
import { ChainKeys } from "@sodax/sdk";
import { minReceivedFor } from "./pour-amount";
import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_HOLD,
  FRESH_ASK_TIMEOUT_MS,
  HOLD_MS,
  PERSISTENT_NO_PATH_MS,
  classifyQuoteError,
  freshMinimum,
  holdReduce,
  holdView,
  judgeFresh,
  minimumToSign,
  refusalWords,
  type FreshAskSlot,
  type HoldState,
  type PriceCheck,
  type QuoteAnswer,
} from "./quote-hold";

/**
 * The signing review of 2026-10-09 (reports/quote-guards-review-signing.md):
 * a worse fresh quote never signs silently (B1), the check runs again just
 * before the signature (M1), the fresh ask is one at a time and bounded
 * (M2), a hanging request marks the quote held (m1), honest words for a
 * coded 4xx and a long -4 (m3), and the drawers never sign `quote.minOut`
 * as such (m5).
 */

const K = "pair";
const run = (answers: QuoteAnswer[], key = K): HoldState => answers.reduce((s, a) => holdReduce(s, key, a), EMPTY_HOLD);
const ok = (quoted: bigint, at: number): QuoteAnswer => ({ ok: true, quoted, at });
const noPath = (at: number): QuoteAnswer => ({ ok: false, error: { detail: { code: -4, message: "No path" } }, at });
const toMin = (q: bigint) => (q * 99n) / 100n;

describe("judgeFresh (B1, delta major): the fresh QUOTED amount against the confirmed minimum", () => {
  // Confirmed: a quote of 1000 at 0.5% slippage, "At least 995" on screen.
  const confirmed = minReceivedFor(1000n, ChainKeys.BASE_MAINNET)!;

  it("a one unit drop inside the slippage band proceeds with the confirmed minimum", () => {
    expect(confirmed).toBe(995n);
    expect(judgeFresh(confirmed, 999n)).toEqual({ kind: "ok", minOut: 995n });
    expect(judgeFresh(confirmed, 995n)).toEqual({ kind: "ok", minOut: 995n });
  });

  it("a fresh quote below the confirmed minimum stops the order", () => {
    expect(judgeFresh(confirmed, 994n)).toEqual({ kind: "moved", quoted: 994n });
  });

  it("at the tap and in the run: a drop inside the band goes, one below the floor stops", async () => {
    let fresh = 999n;
    const checkPrice = async (c: bigint | undefined) => judgeFresh(c, fresh);
    const plan = await minimumToSign({ shown: confirmed, checkPrice, sendHeld: () => false });
    expect(plan).toMatchObject({ kind: "go", minOut: 995n });
    if (plan.kind !== "go") throw new Error();
    fresh = 996n;
    expect(await plan.check!()).toBe("ok");
    fresh = 990n;
    expect(await plan.check!()).toBe("moved");
    expect(await minimumToSign({ shown: confirmed, checkPrice, sendHeld: () => false })).toEqual({ kind: "moved" });
  });

  it("a lower fresh quote below the floor stops the order with the new figure", () => {
    expect(judgeFresh(100n, 99n)).toEqual({ kind: "moved", quoted: 99n });
  });
  it("equal or better signs the confirmed minimum", () => {
    expect(judgeFresh(100n, 100n)).toEqual({ kind: "ok", minOut: 100n });
    expect(judgeFresh(100n, 140n)).toEqual({ kind: "ok", minOut: 100n });
  });
  it("no fresh answer, or nothing confirmed, starts nothing", () => {
    expect(judgeFresh(100n, undefined)).toEqual({ kind: "unavailable" });
    expect(judgeFresh(undefined, 100n)).toEqual({ kind: "unavailable" });
  });
});

describe("freshMinimum (m5)", () => {
  const slot = (): FreshAskSlot => ({ current: null });

  it("uses the quote on hand when its latest answer is good and within the SDK's refresh", async () => {
    const refetch = vi.fn();
    const min = await freshMinimum({ key: K, read: () => run([ok(1000n, 0)]), refetch, toMin, slot: slot(), clock: () => 2_000, maxAgeMs: 3_000 });
    expect(min).toBe(990n);
    expect(refetch).not.toHaveBeenCalled();
  });

  it("asks again when the quote on hand is older, or held over a refusal", async () => {
    const refetch = vi.fn(async () => run([ok(1000n, 0), ok(2000n, 5_000)]));
    expect(await freshMinimum({ key: K, read: () => run([ok(1000n, 0)]), refetch, toMin, slot: slot(), clock: () => 5_100, maxAgeMs: 3_000 })).toBe(1980n);
    const held = run([ok(1000n, 0), noPath(1_000)]);
    expect(await freshMinimum({ key: K, read: () => held, refetch, toMin, slot: slot(), clock: () => 5_100, maxAgeMs: 3_000 })).toBe(1980n);
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("gives nothing when the pair or amount changed while asking", async () => {
    const refetch = vi.fn(async () => run([ok(2000n, 5_000)], "other-amount"));
    expect(await freshMinimum({ key: K, read: () => EMPTY_HOLD, refetch, toMin, slot: slot(), clock: () => 5_100, maxAgeMs: 3_000 })).toBeUndefined();
  });

  it("a re-tap joins the ask in flight instead of starting or cancelling one", async () => {
    let answer!: (s: HoldState) => void;
    const refetch = vi.fn(() => new Promise<HoldState>((resolve) => (answer = resolve)));
    const shared = slot();
    const args = { key: K, read: () => EMPTY_HOLD, refetch, toMin, slot: shared, clock: () => 5_100, maxAgeMs: 3_000 };
    const first = freshMinimum(args);
    const second = freshMinimum(args);
    expect(refetch).toHaveBeenCalledTimes(1);
    answer(run([ok(1000n, 5_000)]));
    expect(await first).toBe(990n);
    expect(await second).toBe(990n);
    expect(shared.current).toBeNull();
  });

  it("fails closed after the deadline, and clears it", async () => {
    vi.useFakeTimers();
    try {
      const shared = slot();
      const pending = freshMinimum({ key: K, read: () => EMPTY_HOLD, refetch: () => new Promise(() => {}), toMin, slot: shared, clock: () => 0, maxAgeMs: 3_000 });
      await vi.advanceTimersByTimeAsync(FRESH_ASK_TIMEOUT_MS);
      expect(await pending).toBeUndefined();
      expect(shared.current).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
    expect(FRESH_ASK_TIMEOUT_MS).toBe(8_000);
  });
});

describe("minimumToSign (B1, M1, M2, m2)", () => {
  const priced = (fresh: bigint | undefined) => vi.fn(async (confirmed: bigint | undefined): Promise<PriceCheck> => judgeFresh(confirmed, fresh));

  it("signs the confirmed minimum and hands the run a check that asks against it again", async () => {
    const checkPrice = priced(105n);
    const plan = await minimumToSign({ shown: 100n, checkPrice, sendHeld: () => false });
    expect(plan).toMatchObject({ kind: "go", minOut: 100n });
    if (plan.kind !== "go") throw new Error();
    expect(await plan.check!()).toBe("ok");
    expect(checkPrice).toHaveBeenLastCalledWith(100n);
  });

  it("the check just before signing stops a price that moved during the approval", async () => {
    let fresh = 100n;
    const checkPrice = vi.fn(async (confirmed: bigint | undefined) => judgeFresh(confirmed, fresh));
    const plan = await minimumToSign({ shown: 100n, checkPrice, sendHeld: () => false });
    if (plan.kind !== "go") throw new Error();
    fresh = 97n;
    expect(await plan.check!()).toBe("moved");
  });

  it("a lower fresh minimum at the tap waits for a second tap", async () => {
    expect(await minimumToSign({ shown: 100n, checkPrice: priced(90n), sendHeld: () => false })).toEqual({ kind: "moved" });
  });

  it("no fresh answer starts nothing", async () => {
    expect(await minimumToSign({ shown: 100n, checkPrice: priced(undefined), sendHeld: () => false })).toEqual({ kind: "unavailable" });
  });

  it("a send hold that began during the ask starts nothing", async () => {
    expect(await minimumToSign({ shown: 100n, checkPrice: priced(100n), sendHeld: () => true })).toEqual({ kind: "held" });
  });

  it("the dust check runs on the minimum that would be signed", async () => {
    const belowDust = vi.fn((min: bigint) => min < 546n);
    expect(await minimumToSign({ shown: 500n, checkPrice: priced(600n), belowDust, sendHeld: () => false })).toEqual({ kind: "dust" });
    expect(belowDust).toHaveBeenCalledWith(500n);
  });

  it("a limit order signs its price's minimum and asks no quote", async () => {
    const checkPrice = priced(1n);
    expect(await minimumToSign({ limitMin: 42n, shown: undefined, checkPrice, sendHeld: () => false })).toEqual({ kind: "go", minOut: 42n, check: undefined });
    expect(checkPrice).not.toHaveBeenCalled();
  });
});

describe("holdView: a hanging request (m1)", () => {
  const s = run([ok(1000n, 0)]);
  it("is live until the next answer is HOLD_MS late", () => {
    expect(holdView(s, K, 3_000 + HOLD_MS, 3_000)).toMatchObject({ quoted: 1000n, held: false });
  });
  it("is marked held once the request has been in flight longer than HOLD_MS", () => {
    expect(holdView(s, K, 3_000 + HOLD_MS + 1, 3_000)).toMatchObject({ quoted: 1000n, held: true });
  });
  it("is held for HOLD_MS at most", () => {
    expect(holdView(s, K, 3_000 + 2 * HOLD_MS + 1, 3_000)).toMatchObject({ quoted: undefined, held: false });
  });
});

describe("honest words (m3)", () => {
  it.each([
    ["a 422 validation body", { detail: [{ loc: ["body", "amount"], msg: "value is not a valid integer" }] }, "noRoute"],
    ["a 400 with words and no code", { detail: "Invalid token pair" }, "noRoute"],
    ["a 401", { detail: "Unauthorized" }, "unavailable"],
    ["a 429", { detail: "Too many requests" }, "unavailable"],
    ["no body at all", undefined, "unavailable"],
    ["-999", { detail: { code: -999, message: "x" } }, "unavailable"],
  ])("%s", (_, error, refusal) => {
    expect(classifyQuoteError(error).refusal).toBe(refusal);
  });

  it("a stock's -4 that lasts over two minutes reads as no route", () => {
    const answers = [noPath(0), noPath(3_000)];
    const early = holdView(run(answers), K, 3_000);
    expect(early).toMatchObject({ refusal: "noPath", persistent: false });
    expect(refusalWords("noPath", "stock", early.persistent)).toBe("marketQuiet");
    const late = holdView(run([...answers, noPath(PERSISTENT_NO_PATH_MS + 1)]), K, PERSISTENT_NO_PATH_MS + 1);
    expect(late.persistent).toBe(true);
    expect(refusalWords("noPath", "stock", late.persistent)).toBe("noRoute");
  });

  it("a good answer starts the clock again", () => {
    const s = run([noPath(0), ok(1n, 60_000), noPath(PERSISTENT_NO_PATH_MS + 1), noPath(PERSISTENT_NO_PATH_MS + 3_001)]);
    expect(holdView(s, K, PERSISTENT_NO_PATH_MS + 20_000).persistent).toBe(false);
  });
});

describe("the drawers never sign the minimum on screen as such (m5)", () => {
  for (const file of ["src/components/flow/deposit-drawer.tsx", "src/components/flow/withdraw-drawer.tsx"]) {
    it(file, () => {
      const source = readFileSync(file, "utf8");
      const signed = [...source.matchAll(/minOutputAmount:\s*([^,\n]+)/g)].map((m) => m[1].trim());
      expect(signed).toEqual(["signMin"]);
      expect(source).toMatch(/const signMin = plan\.minOut;/);
      expect(source).toMatch(/priceCheck: plan\.check/);
      expect(source).not.toMatch(/freshMinOut/);
    });
  }

  it("every signature in the order machine comes after the price check (M1)", () => {
    const source = readFileSync("src/hooks/use-vault-action.ts", "utf8");
    const runs = source.slice(source.indexOf("const runDeposit = useCallback("));
    const signings = [...runs.matchAll(/advance\("signing"\)/g)].map((m) => m.index!);
    expect(signings).toHaveLength(3);
    for (const at of signings) {
      // The chain is asserted, then the price is checked: the last step before the signature.
      expect(runs.slice(at, at + 300)).toMatch(/advance\("signing"\);\s*if \(!\(await onRightChain\(\)\)\) return false;\s*\/\/[^\n]*\n\s*if \(!\(await priceHolds\(args\.priceCheck\)\)\) return false;/);
    }
  });
});
