import { describe, expect, it } from "vitest";
import { foldHandle, lookupKey, parseHandle, refusedName } from "./handle";

const refused = (value: string) => {
  const parsed = parseHandle(value);
  if (!parsed.ok) throw new Error(`shape failed for ${value}`);
  return refusedName(parsed);
};

describe("the username shape", () => {
  it("takes 3 to 20 letters, digits and underscores, lowercase only", () => {
    expect(parseHandle("mira_k")).toEqual({ ok: true, handle: "mira_k", norm: "mirak" });
    expect(parseHandle("Mira_K")).toEqual({ ok: true, handle: "mira_k", norm: "mirak" });
    expect(parseHandle("abc")).toMatchObject({ ok: true });
    expect(parseHandle("a".repeat(20))).toMatchObject({ ok: true });
  });

  it("refuses the wrong length, charset and edges, each with its reason", () => {
    expect(parseHandle("ab")).toEqual({ ok: false, reason: "short" });
    expect(parseHandle("a".repeat(21))).toEqual({ ok: false, reason: "long" });
    expect(parseHandle("mira k")).toEqual({ ok: false, reason: "charset" });
    expect(parseHandle("mira-k")).toEqual({ ok: false, reason: "charset" });
    expect(parseHandle("mïra")).toEqual({ ok: false, reason: "charset" });
    expect(parseHandle("_mira")).toEqual({ ok: false, reason: "edge" });
    expect(parseHandle("mira_")).toEqual({ ok: false, reason: "edge" });
    expect(parseHandle(42)).toEqual({ ok: false, reason: "charset" });
  });

  it("a name whose fold is under three letters is too short", () => {
    expect(parseHandle("a_b")).toEqual({ ok: false, reason: "short" });
  });

  it("NFKC turns full width letters into plain ones, and a leading @ is forgiven", () => {
    expect(parseHandle("ｍｉｒａ")).toEqual({ ok: true, handle: "mira", norm: "mira" });
    expect(parseHandle("@mira")).toMatchObject({ ok: true, handle: "mira" });
  });
});

describe("the fold", () => {
  it("makes digit lookalikes, rn and vv one name with what they imitate", () => {
    expect(foldHandle("harb0_ur")).toBe(foldHandle("harbour"));
    expect(foldHandle("m1ra")).toBe(foldHandle("mlra"));
    expect(foldHandle("5ail")).toBe("sail");
    expect(foldHandle("s_a__il")).toBe("sail");
    expect(foldHandle("h3ll0")).toBe("hello");
    expect(foldHandle("4ll_7h3_8est")).toBe("allthebest");
    expect(foldHandle("rnike")).toBe(foldHandle("mike"));
    expect(foldHandle("vvave")).toBe(foldHandle("wave"));
  });

  it("never folds one letter into another", () => {
    for (const [a, b] of [["kai", "kal"], ["neil", "nell"], ["ian", "lan"], ["ali", "all"], ["paui", "paul"]]) {
      expect(foldHandle(a), `${a} and ${b}`).not.toBe(foldHandle(b));
    }
  });

  it("a capital I can no longer pose as an l: names are lowercase", () => {
    expect(parseHandle("PauI")).toMatchObject({ ok: true, handle: "paui" });
    expect(foldHandle("paui")).not.toBe(foldHandle("paul"));
  });

  it("lookup folds whatever sits in the URL, and refuses what could never be a name", () => {
    expect(lookupKey("Mira_K")).toBe("mirak");
    expect(lookupKey("%40mira")).toBe("mira");
    expect(lookupKey("mi")).toBeNull();
    expect(lookupKey("%E0%A4%A")).toBeNull();
    expect(lookupKey("mira%")).toBeNull();
  });
});

describe("names nobody may take", () => {
  it("reserves house words, rank names and listings", () => {
    expect(refused("Berth")).toBe("reserved");
    expect(refused("b3rth")).toBe("reserved");
    expect(refused("SUPPORT")).toBe("reserved");
    expect(refused("Harbour_Master")).toBe("reserved");
    expect(refused("harbourmaster")).toBe("reserved");
    expect(refused("NVDA")).toBe("reserved");
    expect(refused("NVIDIA")).toBe("reserved");
    expect(refused("Sodax")).toBe("reserved");
    expect(refused("s0dax")).toBe("reserved");
  });

  it("refuses offensive stems anywhere, and through letter swaps", () => {
    expect(refused("xfuckx")).toBe("offensive");
    expect(refused("fvck")).toBeNull();
    expect(refused("sh1t_happens")).toBe("offensive");
    expect(refused("5hit")).toBe("offensive");
    expect(refused("b1tch")).toBe("offensive");
    expect(refused("h1tl3r")).toBe("offensive");
    expect(refused("r4pe")).toBe("offensive");
  });

  it("refuses short words only whole or as a segment, so ordinary words pass", () => {
    expect(refused("ass")).toBe("offensive");
    expect(refused("big_ass")).toBe("offensive");
    expect(refused("classic")).toBeNull();
    expect(refused("passage")).toBeNull();
    // The known price of a stem list: Scunthorpe cannot be a username.
    expect(refused("scunthorpe")).toBe("offensive");
    expect(refused("peacock")).toBeNull();
    expect(refused("torpedo")).toBeNull();
    expect(refused("grape")).toBeNull();
    expect(refused("crisis")).toBeNull();
    expect(refused("canal")).toBeNull();
    expect(refused("raccoon")).toBeNull();
  });

  it("refuses a house word or a listing as a word of the name", () => {
    for (const name of ["berth_team", "support_desk", "the_berth_team", "sodax_fan", "real_admin", "mod_erator", "team_berth", "staff2", "b3rth_help", "nvda_guy", "tesla_owner", "apple_news", "spy_watch", "gme4life", "robinhood_hq", "spacex_fan"]) {
      expect(refused(name), name).toBe("reserved");
    }
  });

  it("refuses a house word joined to another or to an official suffix, sodax at the start, and the telling endings", () => {
    for (const name of ["berthsupport", "berthteam", "berthhq", "sodaxhq", "sodaxian", "teamsupport", "supportteam", "cybersupport", "techadmin", "theofficial", "b3rthsupp0rt", "iloveberth"]) {
      expect(refused(name), name).toBe("reserved");
    }
  });

  it("lets ordinary words that only contain a house word or a ticker through", () => {
    for (const name of ["steam", "steamboat", "teammate", "teamlead", "pineapple", "applebee", "badminton", "officially", "staffy", "berthold", "armstrong", "musky", "spyglass", "classic", "supportive"]) {
      expect(refused(name), name).toBeNull();
    }
  });

  it("keeps short tickers to the whole name, so ordinary words pass", () => {
    expect(refused("SPY")).toBe("reserved");
    expect(refused("spyglass")).toBeNull();
    expect(refused("musky")).toBeNull();
  });

  it("lets an ordinary name through", () => {
    expect(refused("mira")).toBeNull();
    expect(refused("old_salt")).toBeNull();
    expect(refused("quay_side")).toBeNull();
  });
});
