import { describe, expect, it } from "vitest";
import {
  NO_RETURN,
  RETURN_TTL_MS,
  backMode,
  initialScreen,
  isPlainClick,
  readMark,
  resolveLink,
  resolveReturn,
  waitingInDrawer,
  writeMark,
  type ReturnMark,
} from "@/lib/drawer-return";

const NOW = 1_800_000_000_000;
const mark = (over: Partial<ReturnMark> = {}): ReturnMark => ({ view: "friends", scroll: 240, target: "/u/marta", at: NOW - 5_000, ...over });
const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

describe("isPlainClick", () => {
  it("takes a plain left click only", () => {
    expect(isPlainClick(click)).toBe(true);
    expect(isPlainClick({ ...click, metaKey: true })).toBe(false);
    expect(isPlainClick({ ...click, ctrlKey: true })).toBe(false);
    expect(isPlainClick({ ...click, shiftKey: true })).toBe(false);
    expect(isPlainClick({ ...click, altKey: true })).toBe(false);
    expect(isPlainClick({ ...click, button: 1 })).toBe(false);
    expect(isPlainClick({ ...click, defaultPrevented: true })).toBe(false);
  });
});

describe("readMark", () => {
  it("reads back what was written", () => {
    expect(readMark(writeMark(mark()), NOW)).toEqual(mark());
  });
  it("refuses stale, malformed or foreign marks", () => {
    expect(readMark(null, NOW)).toBeNull();
    expect(readMark("not json", NOW)).toBeNull();
    expect(readMark(writeMark(mark({ at: NOW - RETURN_TTL_MS - 1 })), NOW)).toBeNull();
    expect(readMark(JSON.stringify({ ...mark(), view: "elsewhere" }), NOW)).toBeNull();
    expect(readMark(JSON.stringify({ ...mark(), scroll: -1 }), NOW)).toBeNull();
    expect(readMark(JSON.stringify({ ...mark(), target: "https://evil.example/u/x" }), NOW)).toBeNull();
  });
});

describe("resolveReturn", () => {
  it("opens the asked screen at its scroll when this tab holds a fresh mark for it, and spends the mark", () => {
    expect(resolveReturn({ param: "friends", mark: mark(), signedIn: true })).toEqual({
      open: { view: "friends", scroll: 240 },
      strip: true,
      spend: true,
    });
  });
  it("never opens without the mark: a new tab, a copied address", () => {
    expect(resolveReturn({ param: "friends", mark: null, signedIn: true })).toEqual({ open: null, strip: true, spend: false });
  });
  it("never opens signed out, and still strips the address and spends the mark", () => {
    expect(resolveReturn({ param: "friends", mark: mark(), signedIn: false })).toEqual({ open: null, strip: true, spend: true });
  });
  it("spends a mark the address does not ask for (left by the address bar)", () => {
    expect(resolveReturn({ param: null, mark: mark(), signedIn: true })).toEqual({ open: null, strip: false, spend: true });
    expect(resolveReturn({ param: "rewards", mark: mark(), signedIn: true }).open).toBeNull();
  });
  it("ignores a parameter that names no screen", () => {
    expect(resolveReturn({ param: "nope", mark: mark(), signedIn: true }).open).toBeNull();
  });
});

describe("backMode", () => {
  it("offers Back only with ?from=account and this tab's mark for this page", () => {
    expect(backMode({ from: "account", mark: mark(), path: "/u/marta" })).toBe("drawer");
    expect(backMode({ from: "account", mark: mark(), path: "/u/Marta/" })).toBe("drawer");
    expect(backMode({ from: "account", mark: mark({ target: "/friends" }), path: "/friends" })).toBe("drawer");
  });
  it("keeps the way home for a copied address, another page or no mark", () => {
    expect(backMode({ from: "account", mark: null, path: "/u/marta" })).toBe("home");
    expect(backMode({ from: null, mark: mark(), path: "/u/marta" })).toBe("home");
    expect(backMode({ from: "account", mark: mark(), path: "/u/kees" })).toBe("home");
  });
});

describe("initialScreen", () => {
  it("opens a wallet account's Add money on the wallets screen", () => {
    expect(initialScreen({ assistant: false, focusEmail: false, money: true, pending: NO_RETURN })).toEqual({ view: "money", scroll: null });
  });
  const pending = { view: "friends" as const, scroll: 240 };
  it("starts on a pending return", () => {
    expect(initialScreen({ assistant: false, focusEmail: false, pending })).toEqual(pending);
  });
  it("lets a deep link win", () => {
    expect(initialScreen({ assistant: true, focusEmail: false, pending })).toEqual({ view: "ai", scroll: null });
    expect(initialScreen({ assistant: false, focusEmail: true, pending })).toEqual(NO_RETURN);
  });
  it("starts on the first screen once the return is spent", () => {
    expect(initialScreen({ assistant: false, focusEmail: false, pending: NO_RETURN })).toEqual(NO_RETURN);
  });
});

describe("Settings as a drawer screen", () => {
  it("is a screen a return can name", () => {
    expect(resolveReturn({ param: "settings", mark: mark({ view: "settings" }), signedIn: true }).open).toEqual({ view: "settings", scroll: 240 });
  });
});

describe("resolveLink", () => {
  it("opens Friends for an email's ?open=friends, and always strips the parameter", () => {
    expect(resolveLink("friends")).toEqual({ open: "friends", strip: true });
  });
  it("opens nothing for another value, and strips whatever is there", () => {
    expect(resolveLink("money")).toEqual({ open: null, strip: true });
    expect(resolveLink(null)).toEqual({ open: null, strip: false });
  });
});

describe("waitingInDrawer", () => {
  it("counts friend requests and nothing else", () => {
    expect(waitingInDrawer({ requests: 3 })).toBe(3);
  });
  it("is zero for none, a missing answer or nonsense", () => {
    expect(waitingInDrawer({ requests: 0 })).toBe(0);
    expect(waitingInDrawer({ requests: undefined })).toBe(0);
    expect(waitingInDrawer({ requests: null })).toBe(0);
    expect(waitingInDrawer({ requests: -2 })).toBe(0);
    expect(waitingInDrawer({ requests: Number.NaN })).toBe(0);
  });
});
