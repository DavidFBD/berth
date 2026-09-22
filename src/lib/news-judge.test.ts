import { describe, expect, it } from "vitest";
import { TOKEN_LISTINGS } from "@/lib/listings";
import {
  LISTING_BRIEFS,
  keepHeadline,
  postQuestions,
  readPostAnswers,
  substanceToWeight,
  verdictFor,
  type PostAnswers,
} from "@/lib/news-judge";

/** Answers shaped like Jev's, with only the numbers that matter here. */
function answers({
  listing,
  substance,
  selling = 0.02,
}: {
  listing: Record<string, number>;
  substance: number;
  selling?: number;
}): PostAnswers {
  const [choice] = Object.entries(listing).sort((a, b) => b[1] - a[1])[0];
  return {
    listing: { type: "choice", choice, probabilities: listing, confidence: 0.8 },
    substance: { type: "score", score: substance, probabilities: {}, confidence: 0.8 },
    selling: { type: "noul", noul: selling },
  };
}

describe("listing briefs", () => {
  it("describes every listing, so none is invisible to placement", () => {
    for (const listing of TOKEN_LISTINGS) {
      expect(LISTING_BRIEFS[listing.symbol], listing.symbol).toBeTruthy();
    }
  });

  it("offers none beside the listings", () => {
    const criteria = postQuestions().listing.criteria;
    expect(Object.keys(criteria)).toContain("none");
    expect(Object.keys(criteria).length).toBeLessThanOrEqual(255);
  });
});

/** Cases from the live run of 2026-09-22, with the answers Jev gave. */
describe("reading post answers", () => {
  it("keeps a wire scoop and places it", () => {
    // Reuters: "Nasdaq notches record-high close..."
    const verdict = readPostAnswers(answers({ listing: { QQQ: 0.89, none: 0.05 }, substance: 3.25 }), "press");
    expect(verdict).toEqual({ keep: true, symbol: "QQQ", weight: substanceToWeight(3.25) });
  });

  it("drops a roundup that lists names and says nothing", () => {
    // CNBC: "Here are Tuesday's biggest analyst calls: Nvidia, Netflix..."
    const verdict = readPostAnswers(answers({ listing: { NVDA: 0.75, none: 0.2 }, substance: 0.54 }), "press");
    expect(verdict).toEqual({ keep: false, why: "no substance" });
  });

  it("drops a wire post about nothing of ours", () => {
    const verdict = readPostAnswers(answers({ listing: { none: 0.82, AAPL: 0.1 }, substance: 2.92 }), "press");
    expect(verdict).toEqual({ keep: false, why: "off topic" });
  });

  it("drops advertising however substantive it sounds", () => {
    const verdict = readPostAnswers(
      answers({ listing: { SPY: 0.68 }, substance: 2.5, selling: 0.69 }),
      "press",
    );
    expect(verdict).toEqual({ keep: false, why: "selling" });
  });

  it("leaves placement to the keywords when Jev is unsure", () => {
    const verdict = readPostAnswers(answers({ listing: { TSLA: 0.31, SPCX: 0.3, none: 0.3 }, substance: 2.4 }), "press");
    expect(verdict).toMatchObject({ keep: true, symbol: undefined });
  });

  it("keeps a company's own general remark, placed among what it speaks for", () => {
    const verdict = readPostAnswers(
      answers({ listing: { none: 0.6, TSLA: 0.3, SLV: 0.1 }, substance: 1.2 }),
      "company",
      ["SGOV", "SLV"],
    );
    // Tesla is not an iShares fund, so it is never the placement; SLV is
    // below the floor, so the caller keeps its own.
    expect(verdict).toMatchObject({ keep: true, symbol: undefined });
  });

  it("holds the press tier to a higher floor than a company", () => {
    const slogan = answers({ listing: { MSTR: 0.9 }, substance: 1.2 });
    expect(readPostAnswers(slogan, "company").keep).toBe(true);
    expect(readPostAnswers(slogan, "press").keep).toBe(false);
  });
});

describe("substanceToWeight", () => {
  it("sits on the heuristic's scale and clamps", () => {
    expect(substanceToWeight(-1)).toBe(0.4);
    expect(substanceToWeight(2)).toBe(1);
    expect(substanceToWeight(4)).toBe(1.6);
    expect(substanceToWeight(9)).toBe(1.6);
  });
});

describe("keepHeadline", () => {
  const headline = (about: number, score: number) => ({
    about: { type: "noul" as const, noul: about },
    substance: { type: "score" as const, score, probabilities: {}, confidence: 0.8 },
  });

  it("keeps news about the listing", () => {
    expect(keepHeadline(headline(0.9, 3.2))).toBe(true);
  });

  it("drops a list that only names it", () => {
    expect(keepHeadline(headline(0.2, 3))).toBe(false);
  });

  it("drops a pitch with no event behind it", () => {
    expect(keepHeadline(headline(0.95, 0.4))).toBe(false);
  });

  it("drops the past-returns what-if, which scores just under the floor", () => {
    // "If You Invested $1000 in Nvidia a Decade Ago..." scored 2.08.
    expect(keepHeadline(headline(0.97, 2.08))).toBe(false);
  });
});

describe("verdictFor", () => {
  it("reads a weight back as the rubric level a reader sees", () => {
    expect(verdictFor(substanceToWeight(3.6))).toBe("material");
    expect(verdictFor(substanceToWeight(2.9))).toBe("fact");
    expect(verdictFor(substanceToWeight(2.1))).toBe("analysis");
  });
});
