import { describe, expect, it } from "vitest";
import {
  isApplePlatform,
  isCommandMenuKey,
  isTypingTarget,
  moveIndex,
  rankOf,
  searchListings,
  shortcutAction,
  shortcutLabel,
  type KeyLike,
} from "@/lib/command-menu";
import { STOCK_LISTINGS, type TokenListing } from "@/lib/listings";

const fake = (symbol: string, name: string): TokenListing =>
  ({ symbol, name, issuerName: `${name} • Robinhood Stock Token`, kind: "stock" }) as TokenListing;

const key = (over: Partial<KeyLike> = {}): KeyLike => ({ key: "k", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });

describe("searchListings", () => {
  const set = [fake("MSTR", "Strategy"), fake("TSLA", "Tesla"), fake("TSM", "Taiwan Semiconductor"), fake("NVDA", "NVIDIA"), fake("AMD", "Advanced Micro Devices")];

  it("ranks a name prefix above a word prefix above a ticker above a substring", () => {
    const listings = [fake("XYZ", "Retail Micro"), fake("MICRO", "Zeta"), fake("ABC", "Micro One"), fake("DEF", "Alphamicro")];
    expect(searchListings(listings, "micro").map((l) => l.symbol)).toEqual(["ABC", "XYZ", "MICRO", "DEF"]);
  });

  it("is case-insensitive and matches names and tickers", () => {
    expect(searchListings(set, "nvidia")[0].symbol).toBe("NVDA");
    expect(searchListings(set, "tsla")[0].symbol).toBe("TSLA");
    expect(searchListings(set, "SEMI")[0].symbol).toBe("TSM");
  });

  it("keeps registry order within a rank and honours the limit", () => {
    expect(searchListings(set, "t").map((l) => l.symbol).slice(0, 2)).toEqual(["TSLA", "TSM"]);
    expect(searchListings(set, "t", 1)).toHaveLength(1);
  });

  it("returns the first listings for an empty query and nothing for no match", () => {
    expect(searchListings(set, "  ", 3).map((l) => l.symbol)).toEqual(["MSTR", "TSLA", "TSM"]);
    expect(searchListings(set, "zzzz")).toEqual([]);
  });

  it("finds real registry listings", () => {
    expect(searchListings(STOCK_LISTINGS, "nvda")[0].symbol).toBe("NVDA");
  });

  it("names the rank", () => {
    expect(rankOf(fake("AMD", "Advanced Micro Devices"), "micro")).toBe("word-prefix");
    expect(rankOf(fake("AMD", "Advanced Micro Devices"), "amd")).toBe("ticker");
    expect(rankOf(fake("AMD", "Advanced Micro Devices"), "vanced")).toBe("substring");
    expect(rankOf(fake("AMD", "Advanced Micro Devices"), "")).toBeNull();
  });
});

describe("the shortcut key", () => {
  it("is Command K on a Mac and Control K elsewhere", () => {
    expect(isCommandMenuKey(key({ metaKey: true }), true)).toBe(true);
    expect(isCommandMenuKey(key({ ctrlKey: true }), true)).toBe(false);
    expect(isCommandMenuKey(key({ ctrlKey: true }), false)).toBe(true);
    expect(isCommandMenuKey(key({ metaKey: true }), false)).toBe(false);
    expect(isCommandMenuKey(key({ metaKey: true, key: "K" }), true)).toBe(true);
  });

  it("ignores other keys and extra modifiers", () => {
    expect(isCommandMenuKey(key({ metaKey: true, key: "j" }), true)).toBe(false);
    expect(isCommandMenuKey(key({ metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(isCommandMenuKey(key({ metaKey: true, altKey: true }), true)).toBe(false);
    expect(isCommandMenuKey(key(), true)).toBe(false);
  });

  it("reads the platform and labels the chip", () => {
    expect(isApplePlatform("MacIntel")).toBe(true);
    expect(isApplePlatform("iPhone")).toBe(true);
    expect(isApplePlatform("Win32")).toBe(false);
    expect(isApplePlatform(undefined)).toBe(false);
    expect(shortcutLabel(true)).toBe("⌘K");
    expect(shortcutLabel(false)).toBe("Ctrl K");
  });
});

describe("typing targets and shortcutAction", () => {
  const input = (type?: string) => ({ tagName: "INPUT", getAttribute: (n: string) => (n === "type" ? (type ?? null) : null) });

  it("treats text fields and editable regions as typing", () => {
    expect(isTypingTarget(input())).toBe(true);
    expect(isTypingTarget(input("email"))).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", getAttribute: (n) => (n === "contenteditable" ? "" : null) })).toBe(true);
  });

  it("does not treat buttons, checkboxes or nothing as typing", () => {
    expect(isTypingTarget(input("checkbox"))).toBe(false);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget({ tagName: "DIV", getAttribute: () => "false" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  const base = { event: key({ metaKey: true }), apple: true, open: false, target: null, busy: false };

  it("opens when idle", () => {
    expect(shortcutAction(base)).toBe("open");
  });

  it("is ignored while typing or while a signing window or order drawer holds the screen", () => {
    expect(shortcutAction({ ...base, target: input() })).toBe("ignore");
    expect(shortcutAction({ ...base, busy: true })).toBe("ignore");
  });

  it("closes an open menu even from its own search box or over a busy screen", () => {
    expect(shortcutAction({ ...base, open: true, target: input() })).toBe("close");
    expect(shortcutAction({ ...base, open: true, busy: true })).toBe("close");
  });

  it("ignores any other key", () => {
    expect(shortcutAction({ ...base, event: key({ key: "j", metaKey: true }) })).toBe("ignore");
  });
});

describe("moveIndex", () => {
  it("wraps and handles an empty list", () => {
    expect(moveIndex(0, -1, 3)).toBe(2);
    expect(moveIndex(2, 1, 3)).toBe(0);
    expect(moveIndex(-1, 1, 3)).toBe(0);
    expect(moveIndex(-1, -1, 3)).toBe(2);
    expect(moveIndex(0, 1, 0)).toBe(-1);
  });
});
