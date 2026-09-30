import { describe, expect, it } from "vitest";
import { groupStories, overlap, pairCall, pairKey, pairsToAsk, storyWords } from "@/lib/story-groups";

const HOUR = 60 * 60 * 1000;
const T = Date.UTC(2026, 8, 30, 12);
const post = (id: string, text: string, symbol = "TSLA", publishedAt = T) => ({ id, text, symbol, publishedAt });

describe("storyWords", () => {
  it("reads a cashtag, a possessive and capitals as the plain word", () => {
    expect([...storyWords("IRAN'S speaker: $TSLA up")]).toEqual(["iran", "speaker", "tsla"]);
  });
});

describe("overlap", () => {
  it("is zero when the shorter post has too few words to tell", () => {
    expect(overlap(new Set(["tesla"]), new Set(["tesla", "credit"]))).toBe(0);
  });
});

describe("pairCall", () => {
  it("calls a squawk and its lowercase copy the same story", () => {
    const a = post("1", "ELON MUSK: SPACEX AND TESLA TARGET 200 GIGAWATTS OF ANNUAL SOLAR OUTPUT");
    const b = post("2", "Elon Musk: SpaceX and Tesla target 200 gigawatts of annual solar output by 2030");
    expect(pairCall(a, b)).toBe("same");
  });

  it("asks about two wordings of one deal", () => {
    const a = post("1", "Tesla Secures $30 Billion in New Credit Facilities $TSLA");
    const b = post("2", "Tesla takes on $30 billion in credit as it approaches unprofitability");
    expect(pairCall(a, b)).toBe("ask");
  });

  it("never joins two listings, or two days", () => {
    const text = "Elon Musk: SpaceX and Tesla target 200 gigawatts of annual solar output";
    expect(pairCall(post("1", text, "TSLA"), post("2", text, "SPCX"))).toBe("different");
    expect(pairCall(post("1", text), post("2", text, "TSLA", T + 25 * HOUR))).toBe("different");
  });

  it("leaves two different stories alone", () => {
    const a = post("1", "Apple CEO John Ternus is reportedly planning layoffs and project cuts", "AAPL");
    const b = post("2", "Apple Will Sell 6M iPhone Duos In 2026, Counterpoint Says", "AAPL");
    expect(pairCall(a, b)).toBe("different");
  });
});

describe("groupStories", () => {
  const first = post("1", "Strategy has acquired 1,665 $BTC and repurchased $152M of $STRC", "MSTR", T);
  const copy = post("2", "Strategy has acquired 1,665 $BTC and repurchased $152M of $STRC. As of 9/28", "MSTR", T + HOUR);
  const other = post("3", "Digital Credit. Transparent by design. Model the risk.", "MSTR", T + 2 * HOUR);

  it("leads with the first report and names the rest", () => {
    const groups = groupStories([copy, other, first]);
    expect(groups).toHaveLength(2);
    const story = groups.find((group) => group.others.length > 0)!;
    expect(story.lead.id).toBe("1");
    expect(story.others.map((p) => p.id)).toEqual(["2"]);
  });

  it("joins an asked pair only on Jev's yes, and never without an answer", () => {
    const a = post("a", "Tesla Secures $30 Billion in New Credit Facilities $TSLA");
    const b = post("b", "Tesla takes on $30 billion in credit as it approaches unprofitability", "TSLA", T + HOUR);
    expect(groupStories([a, b])).toHaveLength(2);
    expect(groupStories([a, b], new Map([[pairKey(a, b), false]]))).toHaveLength(2);
    expect(groupStories([a, b], new Map([[pairKey(b, a), true]]))).toHaveLength(1);
  });

  it("joins transitively", () => {
    const a = post("a", "Tesla Secures $30 Billion in New Credit Facilities $TSLA");
    const b = post("b", "TESLA SECURES $30 BILLION IN NEW CREDIT FACILITIES", "TSLA", T + HOUR);
    const c = post("c", "Tesla takes on $30 billion in credit as it approaches unprofitability", "TSLA", T + 2 * HOUR);
    const judged = new Map([[pairKey(b, c), true]]);
    const groups = groupStories([a, b, c], judged);
    expect(groups).toHaveLength(1);
    expect(groups[0].lead.id).toBe("a");
  });
});

describe("pairsToAsk", () => {
  it("lists only the pairs code cannot settle, closest first", () => {
    const a = post("a", "Tesla Secures $30 Billion in New Credit Facilities $TSLA");
    const b = post("b", "Tesla takes on $30 billion in credit as it approaches unprofitability");
    const c = post("c", "TESLA SECURES $30 BILLION IN NEW CREDIT FACILITIES");
    const pairs = pairsToAsk([a, b, c]).map(([x, y]) => pairKey(x, y));
    expect(pairs).toContain(pairKey(a, b));
    expect(pairs).not.toContain(pairKey(a, c));
  });
});
