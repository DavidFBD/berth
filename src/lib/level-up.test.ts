import { describe, expect, it } from "vitest";
import {
  CelebrationQueue,
  SETTLED_S,
  celebrationFor,
  foldCelebrations,
  isNewLevel,
  seenLevelKey,
  stageBusy,
  STAGE_BUSY_SELECTOR,
  TAKEOVER_EVENTS,
  takeoverEventAction,
} from "@/lib/level-up";
import { RANKS, XP_ACTIONS } from "@/lib/xp";

describe("what a crossing says", () => {
  it("names the rung reached, the rung left, the XP and the one reason", () => {
    expect(celebrationFor([{ kind: "friends_all_on", amount: 100 }], 300)).toEqual({
      level: 3,
      rankName: "Berth Holder",
      fromLevel: 2,
      total: 100,
      reason: "for turning on friend features",
      newXp: 300,
    });
  });

  it("is nothing when the rung did not change", () => {
    expect(celebrationFor([{ kind: "avatar_set", amount: 25 }], 130)).toBeNull();
  });

  it("names no single reason when several rewards crossed together", () => {
    const c = celebrationFor([{ kind: "pour_in", amount: 100 }, { kind: "invite_accepted", amount: 250 }], 375);
    expect(c?.reason).toBeNull();
    expect(c?.fromLevel).toBe(1);
    expect(c?.level).toBe(3);
  });
});

describe("one queue, one takeover", () => {
  const a = celebrationFor([{ kind: "pour_in", amount: 100 }], 100)!;
  const b = celebrationFor([{ kind: "friends_all_on", amount: 100 }], 260)!;

  it("folds two crossings into one: the highest rung, from the lowest left, the XP of both", () => {
    expect(foldCelebrations(a, b)).toMatchObject({ level: 3, fromLevel: 1, total: 200, reason: null, newXp: 260 });
  });

  it("refuses when no takeover is mounted, so the caller falls back to the toast", () => {
    const queue = new CelebrationQueue();
    expect(queue.push(a)).toBe(false);
    expect(queue.peek()).toBeNull();
  });

  it("holds what waits until it is taken, and tells the takeover", () => {
    const queue = new CelebrationQueue();
    let told = 0;
    const stop = queue.subscribe(() => (told += 1));
    expect(queue.push(a)).toBe(true);
    expect(queue.push(b)).toBe(true);
    expect(told).toBe(2);
    expect(queue.take()).toMatchObject({ level: 3, fromLevel: 1 });
    expect(queue.take()).toBeNull();
    stop();
    expect(queue.push(a)).toBe(false);
  });
});

describe("never over a signature or an order", () => {
  const doc = (match: string | null) => ({ querySelector: (selector: string) => (match && selector.includes(match) ? ({} as Element) : null) });

  it("waits while an order drawer or Privy's window is open", () => {
    expect(STAGE_BUSY_SELECTOR).toContain("[data-order-drawer]");
    expect(stageBusy(doc("[data-order-drawer]"))).toBe(true);
    expect(stageBusy(doc("#privy-dialog"))).toBe(true);
    expect(stageBusy(doc(null))).toBe(false);
    expect(stageBusy(undefined)).toBe(false);
  });
});

describe("once per rung", () => {
  it("is new only above the highest rung this account celebrated here", () => {
    expect(isNewLevel(null, 2)).toBe(true);
    expect(isNewLevel("2", 3)).toBe(true);
    expect(isNewLevel("3", 3)).toBe(false);
    expect(isNewLevel("5", 3)).toBe(false);
    expect(isNewLevel("garbage", 3)).toBe(true);
  });

  it("keeps the record per account", () => {
    expect(seenLevelKey("0xABC")).toBe("berth.level-celebrated.0xabc");
    expect(seenLevelKey(null)).toBeNull();
  });
});

describe("the takeover's timing", () => {
  it("has settled in under two seconds", () => {
    expect(SETTLED_S).toBeLessThan(2);
  });

  it("a friend features bonus can be the crossing itself", () => {
    expect(celebrationFor([{ kind: "friends_all_on", amount: XP_ACTIONS.friends_all_on.amount }], RANKS[2].xp)?.rankName).toBe("Berth Holder");
  });
});

describe("over an open drawer, the takeover closes alone", () => {
  it("closes on Esc anywhere, and on a click on the scrim or Nice", () => {
    expect(takeoverEventAction({ type: "keydown", key: "Escape", inside: false })).toBe("close");
    expect(takeoverEventAction({ type: "keydown", key: "Escape", inside: true })).toBe("close");
    expect(takeoverEventAction({ type: "click", inside: true, onClose: true })).toBe("close");
  });

  it("keeps the focus inside on Tab, and every other key to itself", () => {
    expect(takeoverEventAction({ type: "keydown", key: "Tab", inside: true })).toBe("trap");
    expect(takeoverEventAction({ type: "keydown", key: "Tab", inside: false })).toBe("trap");
    expect(takeoverEventAction({ type: "keydown", key: "Enter", inside: true })).toBe("swallow");
  });

  it("never lets a press, touch or focus move inside it reach the drawer behind", () => {
    for (const type of ["pointerdown", "mousedown", "touchstart", "pointerup", "click", "focusin", "focusout"]) {
      expect(takeoverEventAction({ type, inside: true }), type).toBe("swallow");
    }
    expect(TAKEOVER_EVENTS).toEqual(expect.arrayContaining(["pointerdown", "mousedown", "touchstart", "click", "keydown", "focusin", "focusout"]));
  });

  it("leaves alone what happens outside it", () => {
    expect(takeoverEventAction({ type: "pointerdown", inside: false })).toBe("pass");
    expect(takeoverEventAction({ type: "focusout", inside: false })).toBe("pass");
  });
});

describe("a crossing while a takeover is on screen", () => {
  it("joins the one shown: the higher rung, from the rung first left, every opening passed", () => {
    const shown = celebrationFor([{ kind: "friends_all_on", amount: 100 }], 300)!;
    const next = celebrationFor([{ kind: "pour_in", amount: 250 }], 550)!;
    expect(shown).toMatchObject({ level: 3, fromLevel: 2 });
    expect(next).toMatchObject({ level: 4, fromLevel: 3 });
    expect(foldCelebrations(shown, next)).toMatchObject({ level: 4, rankName: "Cleat", fromLevel: 2, total: 350, newXp: 550 });
  });
});
