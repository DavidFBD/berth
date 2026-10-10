import { describe, expect, it } from "vitest";
import { COPY } from "@/lib/copy";
import { dayLineDate, describeMover, describeYou } from "./day-line";

const intel = (usd: number, pct: number | null) => ({ symbol: "INTC", usd, pct });

describe("the day line under the week strip", () => {
  it("calls a day flat when what is shown rounds to zero, and still names the stock that moved most", () => {
    // The old line read "You $0.00" beside "Intel −2.5%, −$0.03": the other holdings made it back.
    const facts = { change: -0.004, changePct: 0.01, mover: intel(-0.03, -2.5) };
    expect(describeYou(facts)).toEqual({ kind: "flat" });
    expect(describeMover(facts)).toEqual({ symbol: "INTC", direction: "down", pct: 2.5, usd: 0.03 });
  });

  it("says up and down with unsigned sizes, the direction carrying the sign", () => {
    expect(describeYou({ change: 4.1, changePct: 1.24 })).toEqual({ kind: "up", pct: 1.24, usd: 4.1 });
    expect(describeYou({ change: -0.3, changePct: -0.8 })).toEqual({ kind: "down", pct: 0.8, usd: 0.3 });
  });

  it("drops dollars that round to zero but keeps a percent that does not", () => {
    expect(describeYou({ change: 0.003, changePct: 0.3 })).toEqual({ kind: "up", pct: 0.3, usd: null });
  });

  it("falls back to dollars when there is no percent, flat when they round to zero", () => {
    expect(describeYou({ change: 2, changePct: null })).toEqual({ kind: "up", pct: null, usd: 2 });
    expect(describeYou({ change: 0.001, changePct: null })).toEqual({ kind: "flat" });
    expect(describeYou({ change: null, changePct: null })).toEqual({ kind: "unknown" });
  });

  it("leaves out a mover whose own move rounds to zero both ways", () => {
    expect(describeMover({ change: 0, changePct: 0, mover: intel(0.001, 0.01) })).toBeNull();
    expect(describeMover({ change: 0, changePct: 0 })).toBeNull();
  });

  it("does not say the dollars twice when one holding made the whole day", () => {
    const facts = { change: -0.03, changePct: -0.9, mover: intel(-0.03, -2.5) };
    expect(describeMover(facts)).toEqual({ symbol: "INTC", direction: "down", pct: 2.5, usd: null });
    // A first day, told from what was paid, says both.
    expect(describeMover({ ...facts, fromBuy: true })?.usd).toBe(0.03);
  });

  it("takes the largest by dollars when no percent mover is known", () => {
    expect(describeMover({ change: 1, changePct: 1, top: { symbol: "AAPL", usd: 0.6, pct: null } })).toEqual({
      symbol: "AAPL",
      direction: "up",
      pct: null,
      usd: 0.6,
    });
  });

  it("dates the line in the card's one format, Fri, Oct 9, in UTC", () => {
    expect(dayLineDate("2026-10-09")).toBe("Fri, Oct 9");
  });

  it("reads in plain words, with no dash as punctuation", () => {
    const flat = COPY.portfolioDayYou({ direction: "flat", pct: null, usd: null, usdSigned: null, today: false, fromBuy: false });
    const mover = COPY.portfolioDayMover({ name: "Intel", direction: "down", pct: "2.5%", usd: "$0.03", usdSigned: "−$0.03", today: false });
    expect(`${flat}. ${mover}.`).toBe("Your portfolio was flat. Intel moved most, down 2.5% (−$0.03).");
    expect(COPY.portfolioDayYou({ direction: "up", pct: "1.2%", usd: "$4.10", usdSigned: "+$4.10", today: true, fromBuy: false })).toBe(
      "Your portfolio is up 1.2% (+$4.10)",
    );
    expect(COPY.portfolioDayYou({ direction: "down", pct: null, usd: "$2.00", usdSigned: "−$2.00", today: false, fromBuy: true })).toBe(
      "Since you bought, your portfolio was down $2.00",
    );
    for (const text of [COPY.portfolioWeekLabel, COPY.portfolioFirstWeek(3), flat, mover]) {
      expect(text).not.toMatch(/ [-–—] /);
      expect(text).not.toMatch(/\b(INTC|NVDA)\b/);
    }
  });
});
