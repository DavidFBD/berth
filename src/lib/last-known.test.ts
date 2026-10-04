import { describe, expect, it } from "vitest";
import {
  RESAVE_AFTER_MS,
  decideHomeStage,
  parseSnapshot,
  sameSnapshot,
  shouldSave,
  shownPart,
  snapshotFromDay,
  type LastKnown,
  type LastKnownSnapshot,
} from "@/lib/last-known";
import { homeStage, type FundsRead, type StageDecision } from "@/lib/home-stage";
import { TOKEN_LISTINGS } from "@/lib/listings";

const snapshot = (over: Partial<LastKnownSnapshot> = {}): LastKnownSnapshot => ({
  v: 1,
  stage: "owns",
  stocks: 6.5,
  cash: 2.2,
  funds: 41.37,
  waiting: 0,
  holdings: [{ symbol: "NVDA", quantity: 0.031, worth: 6.5 }],
  ...over,
});
const known = (over: Partial<LastKnownSnapshot> = {}, asOf = 1_000, source: LastKnown["source"] = "live"): LastKnown => ({
  snapshot: snapshot(over),
  asOf,
  source,
});
const WAIT: StageDecision = { stage: undefined, proven: false };

describe("parseSnapshot", () => {
  it("keeps a well formed reading", () => {
    expect(parseSnapshot(snapshot())).toEqual(snapshot());
    expect(parseSnapshot(snapshot({ funds: null, waiting: null }))).toEqual(snapshot({ funds: null, waiting: null }));
  });
  it("refuses anything that is not one", () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot("owns")).toBeNull();
    expect(parseSnapshot({ ...snapshot(), v: 2 })).toBeNull();
    expect(parseSnapshot({ ...snapshot(), stage: "rich" })).toBeNull();
    expect(parseSnapshot({ ...snapshot(), stocks: -1 })).toBeNull();
    expect(parseSnapshot({ ...snapshot(), cash: Number.NaN })).toBeNull();
    expect(parseSnapshot({ ...snapshot(), funds: 1e12 })).toBeNull();
    expect(parseSnapshot({ ...snapshot(), funds: "41" })).toBeNull();
    expect(parseSnapshot({ ...snapshot(), holdings: "NVDA" })).toBeNull();
  });
  it("takes only listed symbols, and a bounded list", () => {
    expect(parseSnapshot(snapshot({ holdings: [{ symbol: "<script>", quantity: 1, worth: 1 }] }))).toBeNull();
    expect(parseSnapshot(snapshot({ holdings: [{ symbol: "NVDA", quantity: -1, worth: 1 }] }))).toBeNull();
    const many = Array.from({ length: 61 }, () => ({ symbol: "NVDA", quantity: 1, worth: 1 }));
    expect(parseSnapshot(snapshot({ holdings: many }))).toBeNull();
  });
  it("drops fields it does not know", () => {
    expect(parseSnapshot({ ...snapshot(), address: "0xbe59" })).toEqual(snapshot());
  });
});

describe("snapshotFromDay", () => {
  it("splits a daily snapshot into stocks and cash, and never claims funds", () => {
    const day = snapshotFromDay([
      { symbol: "NVDA", quantity: 0.02, price: 180 },
      { symbol: "SGOV", quantity: 0.05, price: 100.5 },
      { symbol: "TSLA", quantity: 0.01, price: 440 },
    ]);
    expect(day.stage).toBe("owns");
    expect(day.stocks).toBeCloseTo(8);
    expect(day.cash).toBeCloseTo(5.025);
    expect(day.funds).toBeNull();
    expect(day.waiting).toBeNull();
    // In the registry's order, as the live list draws them.
    const order = TOKEN_LISTINGS.map((listing) => listing.symbol);
    expect(day.holdings.map((row) => row.symbol)).toEqual(["NVDA", "TSLA"].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
  });
  it("is funded when only cash was held, empty when nothing was", () => {
    expect(snapshotFromDay([{ symbol: "SGOV", quantity: 1, price: 100 }]).stage).toBe("funded");
    expect(snapshotFromDay([{ symbol: "NVDA", quantity: 0, price: 180 }]).stage).toBe("empty");
  });
});

describe("saving a live reading", () => {
  it("compares to the cent", () => {
    expect(sameSnapshot(snapshot(), snapshot({ funds: 41.371 }))).toBe(true);
    expect(sameSnapshot(snapshot(), snapshot({ funds: 41.38 }))).toBe(false);
    expect(sameSnapshot(snapshot(), snapshot({ stage: "funded" }))).toBe(false);
    expect(sameSnapshot(snapshot(), snapshot({ holdings: [] }))).toBe(false);
  });
  it("saves when there is none, when only a daily one is kept, when it changed, or when it aged", () => {
    const now = 10_000_000;
    expect(shouldSave(null, snapshot(), now)).toBe(true);
    expect(shouldSave(known({}, now, "day"), snapshot(), now)).toBe(true);
    expect(shouldSave(known({}, now - 1_000), snapshot({ stocks: 7 }), now)).toBe(true);
    expect(shouldSave(known({}, now - 1_000), snapshot(), now)).toBe(false);
    expect(shouldSave(known({}, now - RESAVE_AFTER_MS), snapshot(), now)).toBe(true);
  });
  it("does not let a reading short of its funds wipe a recent one that had them", () => {
    const now = 10_000_000;
    expect(shouldSave(known({}, now - 1_000), snapshot({ funds: null, stocks: 7 }), now)).toBe(false);
    expect(shouldSave(known({}, now - RESAVE_AFTER_MS), snapshot({ funds: null }), now)).toBe(true);
    expect(shouldSave(known({ funds: null }, now - 1_000), snapshot({ funds: null, stocks: 7 }), now)).toBe(true);
    expect(shouldSave(null, snapshot({ funds: null }), now)).toBe(true);
  });
});

describe("shownPart", () => {
  it("prefers live, falls back to the last reading marked as such, else waits", () => {
    expect(shownPart(12, 10)).toEqual({ value: 12, lastKnown: false });
    expect(shownPart(0, 10)).toEqual({ value: 0, lastKnown: false });
    expect(shownPart(undefined, 10)).toEqual({ value: 10, lastKnown: true });
    expect(shownPart(undefined, null)).toEqual({ value: undefined, lastKnown: false });
    expect(shownPart(undefined, undefined)).toEqual({ value: undefined, lastKnown: false });
  });
});

describe("decideHomeStage", () => {
  it("lets a proven live stage win over anything remembered", () => {
    const live: StageDecision = { stage: "empty", proven: true };
    expect(decideHomeStage({ live, remembered: "owns", lastKnown: known() })).toEqual({ stage: "empty", source: "live" });
  });
  it("opens on the last reading while nothing live is known yet", () => {
    expect(decideHomeStage({ live: WAIT, remembered: undefined, lastKnown: known() })).toEqual({ stage: "owns", source: "lastKnown" });
  });
  it("takes the further along of this browser's memory and the last reading", () => {
    expect(decideHomeStage({ live: WAIT, remembered: "funded", lastKnown: known() }).stage).toBe("owns");
    expect(decideHomeStage({ live: WAIT, remembered: "owns", lastKnown: known({ stage: "empty" }) })).toEqual({
      stage: "owns",
      source: "remembered",
    });
  });
  it("never shows Add money to a holder whose networks are slow", () => {
    // Every network but one answered with nothing; the last one is past its
    // deadline (lib/read-deadline), so the live stage is only provisional.
    const funds: FundsRead = {
      connected: true,
      unaddressedChains: 0,
      isLoading: false,
      erroredChains: 1,
      holdings: [],
      totalUsd: undefined,
    };
    const live = homeStage({ holdingsSettled: false, ownsStock: false, funds });
    expect(live).toEqual(WAIT);
    expect(decideHomeStage({ live, remembered: undefined, lastKnown: known() }).stage).toBe("owns");
    const settled = homeStage({ holdingsSettled: true, ownsStock: false, funds });
    expect(settled).toEqual({ stage: "empty", proven: false });
    expect(decideHomeStage({ live: settled, remembered: undefined, lastKnown: known({ stage: "funded" }) }).stage).toBe("funded");
  });
  it("shows a provisional live stage only when nothing is remembered", () => {
    const live: StageDecision = { stage: "empty", proven: false };
    expect(decideHomeStage({ live, remembered: undefined, lastKnown: null })).toEqual({ stage: "empty", source: "provisional" });
    expect(decideHomeStage({ live: WAIT, remembered: undefined, lastKnown: null })).toEqual({ stage: undefined, source: "none" });
  });
});
