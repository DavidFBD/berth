import { describe, expect, it } from "vitest";
import {
  earnedUnderlying,
  nextAnchor,
  realizedUnderlying,
  type EarnedAnchor,
} from "./earned-yield";

const WAD = 10n ** 18n;
const OWNER = "0xabc|0xdef";

const fresh = (shares: bigint, pps: bigint) =>
  nextAnchor(undefined, {
    shares,
    pps,
    owner: OWNER,
    now: "2026-08-06T00:00:00.000Z",
  });

describe("nextAnchor", () => {
  it("anchors a first sighting at today's price, exact only from zero", () => {
    expect(fresh(0n, WAD).exact).toBe(true);
    expect(fresh(5n * WAD, WAD).exact).toBe(false);
    expect(fresh(5n * WAD, WAD).realized).toBe("0");
  });

  it("share-weights newly minted shares into the basis", () => {
    const anchor = fresh(10n * WAD, WAD);
    const grown = nextAnchor(anchor, {
      shares: 20n * WAD,
      pps: 2n * WAD, // ten more shares acquired at double the price
      owner: OWNER,
      now: "2026-08-07T00:00:00.000Z",
    });
    // (10×1 + 10×2) / 20 = 1.5
    expect(BigInt(grown.anchorPps)).toBe((3n * WAD) / 2n);
    expect(grown.since).toBe(anchor.since);
  });

  it("banks the redeemed shares' gain into realized, leaving the basis alone", () => {
    const anchor = fresh(10n * WAD, WAD);
    const afterPourBack = nextAnchor(anchor, {
      shares: 4n * WAD,
      pps: (11n * WAD) / 10n, // pps grew 10% before the pour-back
      owner: OWNER,
      now: "2026-08-08T00:00:00.000Z",
    });
    // 6 shares × 0.1 gain each = 0.6 underlying banked.
    expect(realizedUnderlying(afterPourBack)).toBe((6n * WAD) / 10n);
    expect(afterPourBack.anchorPps).toBe(anchor.anchorPps);
    // The remaining 4 shares keep earning on the original basis.
    expect(
      earnedUnderlying(afterPourBack, 4n * WAD, (11n * WAD) / 10n),
    ).toBe((4n * WAD) / 10n);
  });

  it("accumulates realized across successive pour-backs", () => {
    const anchor = fresh(10n * WAD, WAD);
    const first = nextAnchor(anchor, {
      shares: 6n * WAD,
      pps: (11n * WAD) / 10n,
      owner: OWNER,
      now: "2026-08-08T00:00:00.000Z",
    });
    const second = nextAnchor(first, {
      shares: 0n,
      pps: (12n * WAD) / 10n,
      owner: OWNER,
      now: "2026-08-09T00:00:00.000Z",
    });
    // 4 × 0.1 + 6 × 0.2 = 1.6 underlying, all banked.
    expect(realizedUnderlying(second)).toBe((16n * WAD) / 10n);
  });

  it("treats a pre-realized-field anchor as zero banked", () => {
    const legacy: EarnedAnchor = {
      shares: (10n * WAD).toString(),
      anchorPps: WAD.toString(),
      owner: OWNER,
      exact: true,
      since: "2026-08-06T00:00:00.000Z",
      // no `realized` — written before the field existed
    };
    expect(realizedUnderlying(legacy)).toBe(0n);
    const afterPourBack = nextAnchor(legacy, {
      shares: 5n * WAD,
      pps: 2n * WAD,
      owner: OWNER,
      now: "2026-08-08T00:00:00.000Z",
    });
    expect(realizedUnderlying(afterPourBack)).toBe(5n * WAD);
  });

  it("a different holder set starts a fresh count", () => {
    const anchor = fresh(10n * WAD, WAD);
    const other = nextAnchor(anchor, {
      shares: 10n * WAD,
      pps: 2n * WAD,
      owner: "0xother",
      now: "2026-08-08T00:00:00.000Z",
    });
    expect(other.owner).toBe("0xother");
    expect(BigInt(other.anchorPps)).toBe(2n * WAD);
    expect(realizedUnderlying(other)).toBe(0n);
  });

  it("documents WHY readings must be settled: a transient zero erases the basis", () => {
    // This is the pure function faithfully recording what it is told — a
    // loading-time partial sum looks identical to a real redemption, so the
    // guard lives in useEarnedYield's `ready` gate, not here.
    const anchor = fresh(10n * WAD, WAD);
    const zeroed = nextAnchor(anchor, {
      shares: 0n,
      pps: 2n * WAD,
      owner: OWNER,
      now: "2026-08-08T00:00:00.000Z",
    });
    const refilled = nextAnchor(zeroed, {
      shares: 10n * WAD,
      pps: 2n * WAD,
      owner: OWNER,
      now: "2026-08-08T00:00:01.000Z",
    });
    // The basis has been re-anchored at today's price: earned reads zero.
    expect(earnedUnderlying(refilled, 10n * WAD, 2n * WAD)).toBe(0n);
  });
});
