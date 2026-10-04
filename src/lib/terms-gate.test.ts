import { describe, expect, it, vi } from "vitest";
import { acceptedFromAnswer, confirmBuy, latchGate, readAtConfirm, termsGate, type TermsGate } from "./terms-gate";
import { COPY, LEGAL_EFFECTIVE_DATE } from "./copy";
import { TERMS_VERSION } from "./legal-version";
import { FEE_PCT_LABEL } from "./sodax-config";

describe("the terms gate", () => {
  it("opens every drawer once the current terms are accepted", () => {
    expect(termsGate("buy", "accepted", false)).toBe("drawer");
    expect(termsGate("sell", "accepted", false)).toBe("drawer");
  });

  it("asks before a buy, and holds a buy while the answer is on its way", () => {
    expect(termsGate("buy", "due", false)).toBe("sheet");
    expect(termsGate("buy", "due", true)).toBe("sheet");
    expect(termsGate("buy", "loading", false)).toBe("wait");
  });

  it("never blocks a sell: asked once, then on without a yes, and never held for the answer", () => {
    expect(termsGate("sell", "due", false)).toBe("sheet");
    expect(termsGate("sell", "due", true)).toBe("drawer");
    expect(termsGate("sell", "loading", false)).toBe("drawer");
    expect(termsGate("sell", "loading", true)).toBe("drawer");
  });
});

describe("one opening, decided once", () => {
  /** Walks an opening through the live answers, as home does on each render. */
  const walk = (lives: TermsGate[]) => lives.reduce<TermsGate[]>((shown, live) => [...shown, latchGate(shown.at(-1) ?? null, live)], []);

  it("never closes a drawer once it shows, whatever answer comes later", () => {
    // A sell opened while the answer loads, then the answer says due.
    expect(walk([termsGate("sell", "loading", false), termsGate("sell", "due", false)])).toEqual(["drawer", "drawer"]);
    // A buy opened signed out, then a sign in inside it starts a fresh read.
    expect(walk([termsGate("buy", "accepted", false), termsGate("buy", "loading", false), termsGate("buy", "due", false)])).toEqual(["drawer", "drawer", "drawer"]);
  });

  it("waits, then asks, then opens the drawer once accepted", () => {
    expect(walk(["wait", "sheet", "drawer"])).toEqual(["wait", "sheet", "drawer"]);
    expect(walk(["wait", "drawer"])).toEqual(["wait", "drawer"]);
  });

  it("keeps the sheet while the answer is read again", () => {
    expect(walk(["sheet", "wait", "sheet"])).toEqual(["sheet", "sheet", "sheet"]);
  });
});

describe("the check when a buy is confirmed", () => {
  it("goes on at once when the terms are accepted, and never asks", async () => {
    const ask = vi.fn(async () => true);
    expect(await confirmBuy({ check: async () => true, ask })).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks someone who signed in inside the drawer, and goes on with the same order after Accept", async () => {
    const ask = vi.fn(async () => true);
    expect(await confirmBuy({ check: async () => false, ask })).toBe(true);
    expect(ask).toHaveBeenCalledOnce();
  });

  it("holds the buy on Not now, without closing anything", async () => {
    expect(await confirmBuy({ check: async () => false, ask: async () => false })).toBe(false);
  });

  it("fails open when the check itself breaks", async () => {
    const ask = vi.fn(async () => false);
    expect(await confirmBuy({ check: async () => Promise.reject(new Error("down")), ask })).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("the read at confirm", () => {
  it("makes no request when the session already knows the terms are accepted", async () => {
    const read = vi.fn(async () => false);
    expect(await readAtConfirm(true, read)).toBe(true);
    expect(read).not.toHaveBeenCalled();
  });

  it("reads afresh otherwise, and takes the answer", async () => {
    expect(await readAtConfirm(false, async () => false)).toBe(false);
    expect(await readAtConfirm(undefined, async () => true)).toBe(true);
  });

  it("fails open after the timeout, or on an error", async () => {
    vi.useFakeTimers();
    try {
      const slow = readAtConfirm(false, () => new Promise<boolean>(() => {}), 3_000);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(await slow).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    expect(await readAtConfirm(false, async () => Promise.reject(new Error("down")))).toBe(true);
  });
});

describe("reading the answer", () => {
  it("takes a real answer as it is", () => {
    expect(acceptedFromAnswer(200, { accepted: true })).toBe(true);
    expect(acceptedFromAnswer(200, { accepted: false })).toBe(false);
  });

  it("asks when there is no session to read with", () => {
    expect(acceptedFromAnswer(401, null)).toBe(false);
    expect(acceptedFromAnswer(403, null)).toBe(false);
  });

  it("fails open on a server error, a lost request or a garbled answer, so a buy is never blocked by infrastructure", () => {
    for (const status of [500, 502, 503, 429, null]) expect(acceptedFromAnswer(status, null)).toBe(true);
    expect(acceptedFromAnswer(200, null)).toBe(true);
    expect(acceptedFromAnswer(200, { accepted: "yes" })).toBe(true);
  });
});

describe("the terms version", () => {
  it("is the legal pages' effective date", () => {
    expect(new Date(`${LEGAL_EFFECTIVE_DATE} UTC`).toISOString().slice(0, 10)).toBe(TERMS_VERSION);
  });
});

describe("the sheet's words", () => {
  const sheet = COPY.termsSheet;
  const text = [sheet.title, sheet.lede, ...sheet.summary(FEE_PCT_LABEL), sheet.read, sheet.terms, sheet.privacy, sheet.accept, sheet.notNow, sheet.buyNote, sheet.continueSell, sheet.sellNote, sheet.failed].join("\n");

  it("are calm: no dashes as punctuation, no emoji, never a brokerage", () => {
    expect(text).not.toMatch(/ [-–—] |—|–/);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(text).not.toMatch(/brokerage/i);
  });

  it("state the fee the code charges, and that selling never waits", () => {
    expect(sheet.summary(FEE_PCT_LABEL).join(" ")).toContain(`${FEE_PCT_LABEL} fee on every order`);
    expect(sheet.buyNote).toMatch(/Selling and withdrawing never wait/);
  });
});
