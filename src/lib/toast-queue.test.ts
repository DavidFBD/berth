import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  combineRewards,
  DURATIONS,
  MAX_VISIBLE,
  MERGE_WINDOW_MS,
  ToastQueue,
  type ToastEntry,
  type ToastSink,
} from "@/lib/toast-queue";

let clock = 0;
let queue: ToastQueue;
let log: string[];
let sink: ToastSink;

const titles = (entries: ToastEntry[]) =>
  entries.map((entry) => (entry.content.kind === "message" ? entry.content.title : entry.content.kind));

beforeEach(() => {
  clock = 1_000;
  log = [];
  sink = {
    show: (entry) => log.push(`show ${entry.id}`),
    update: (entry) => log.push(`update ${entry.id}`),
    hide: (id) => log.push(`hide ${id}`),
  };
  queue = new ToastQueue(() => clock);
  queue.attach(sink);
});

const message = (title: string, tone: "default" | "success" | "error" | "info" = "default") =>
  ({ kind: "message", tone, title }) as const;

describe("ToastQueue", () => {
  it("shows at most two and queues the rest in order", () => {
    for (const title of ["a", "b", "c", "d"]) queue.push(message(title));
    const { visible, waiting } = queue.snapshot();
    expect(MAX_VISIBLE).toBe(2);
    expect(titles(visible)).toEqual(["a", "b"]);
    expect(titles(waiting)).toEqual(["c", "d"]);
  });

  it("shows the next in line when one closes, and closing twice is harmless", () => {
    const first = queue.push(message("a"));
    queue.push(message("b"));
    queue.push(message("c"));
    queue.close(first);
    queue.close(first);
    expect(titles(queue.snapshot().visible)).toEqual(["b", "c"]);
    expect(log.filter((line) => line === `hide ${first}`)).toHaveLength(1);
  });

  it("holds everything until a renderer attaches", () => {
    const detached = new ToastQueue(() => clock);
    detached.push(message("early"));
    expect(detached.snapshot().visible).toHaveLength(0);
    detached.attach(sink);
    expect(titles(detached.snapshot().visible)).toEqual(["early"]);
  });

  it("folds a buy's XP into its Bought toast: one toast, not two", () => {
    const bought = queue.push(message("Bought.", "success"));
    clock += 1_500;
    const xp = queue.push({ kind: "xp", rewards: [{ kind: "pour_in", amount: 100 }], newXp: 350 });
    expect(xp).toBe(bought);
    const { visible } = queue.snapshot();
    expect(visible).toHaveLength(1);
    expect(visible[0].content).toMatchObject({ title: "Bought.", rewards: [{ kind: "pour_in", amount: 100 }] });
    expect(visible[0].revision).toBe(1);
    expect(log).toContain(`update ${bought}`);
  });

  it("folds XP into a success still waiting its turn", () => {
    queue.push(message("a"));
    queue.push(message("b"));
    const saved = queue.push(message("Saved.", "success"));
    queue.push({ kind: "xp", rewards: [{ kind: "avatar_set", amount: 50 }], newXp: 80 });
    const { waiting } = queue.snapshot();
    expect(waiting).toHaveLength(1);
    expect(waiting[0].id).toBe(saved);
    expect(waiting[0].content).toMatchObject({ rewards: [{ kind: "avatar_set", amount: 50 }] });
    // Not shown yet, so nothing to redraw.
    expect(log).not.toContain(`update ${saved}`);
  });

  it("does not fold XP into an error, a plain notice, or a message from long ago", () => {
    queue.push(message("Failed", "error"));
    queue.push(message("Plan opened"));
    queue.push({ kind: "xp", rewards: [{ kind: "pour_in", amount: 100 }], newXp: 350 });
    expect(queue.snapshot().waiting.map((entry) => entry.content.kind)).toEqual(["xp"]);

    const fresh = new ToastQueue(() => clock);
    fresh.attach(sink);
    fresh.push(message("Bought.", "success"));
    clock += MERGE_WINDOW_MS + 1;
    fresh.push({ kind: "xp", rewards: [{ kind: "pour_in", amount: 100 }], newXp: 350 });
    expect(fresh.snapshot().visible.map((entry) => entry.content.kind)).toEqual(["message", "xp"]);
  });

  it("folds XP only into the last thing said, so a copy toast does not take a buy's XP", () => {
    queue.push(message("Address copied", "success"));
    queue.push(message("Link copied"));
    queue.push({ kind: "xp", rewards: [{ kind: "pour_in", amount: 100 }], newXp: 350 });
    expect([...queue.snapshot().visible, ...queue.snapshot().waiting].map((entry) => entry.content.kind)).toEqual([
      "message",
      "message",
      "xp",
    ]);
  });

  it("looks past a rank card to the message the XP belongs with", () => {
    const bought = queue.push(message("Bought.", "success"));
    queue.push({ kind: "levelup", rewards: [{ kind: "avatar_set", amount: 50 }], newXp: 130 });
    expect(queue.push({ kind: "xp", rewards: [{ kind: "pour_in", amount: 100 }], newXp: 230 })).toBe(bought);
  });

  it("joins XP to XP already on screen, adding like kinds", () => {
    const first = queue.push({ kind: "xp", rewards: [{ kind: "theme_tried", amount: 25 }], newXp: 25 });
    queue.push({ kind: "xp", rewards: [{ kind: "theme_tried", amount: 25 }, { kind: "email_linked", amount: 100 }], newXp: 150 });
    const { visible } = queue.snapshot();
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe(first);
    expect(visible[0].content).toMatchObject({
      kind: "xp",
      newXp: 150,
      rewards: [{ kind: "theme_tried", amount: 50 }, { kind: "email_linked", amount: 100 }],
    });
  });

  it("keeps a rank crossing as its own card", () => {
    queue.push(message("Bought.", "success"));
    queue.push({ kind: "levelup", rewards: [{ kind: "pour_in", amount: 100 }], newXp: 120 });
    expect(queue.snapshot().visible.map((entry) => entry.content.kind)).toEqual(["message", "levelup"]);
  });

  it("says the same thing once while the first is still around", () => {
    const first = queue.push(message("Link copied", "success"));
    clock += 800;
    const again = queue.push(message("Link copied", "success"));
    expect(again).toBe(first);
    expect(queue.snapshot().visible).toHaveLength(1);
    expect(queue.snapshot().visible[0].revision).toBe(1);
  });

  it("replaces a toast in place by id, wherever it is", () => {
    queue.push(message("a"));
    queue.push(message("b"));
    queue.push({ ...message("Confirm in your wallet"), id: "wallet-switch" });
    queue.push({ ...message("Still waiting"), id: "wallet-switch", duration: 30_000 });
    const waiting = queue.snapshot().waiting;
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ id: "wallet-switch", duration: 30_000, content: { title: "Still waiting" } });
    queue.close("wallet-switch");
    expect(queue.snapshot().waiting).toHaveLength(0);
  });

  it("lets an error wait ahead of calmer things, but behind earlier errors", () => {
    queue.push(message("a"));
    queue.push(message("b"));
    queue.push(message("calm"));
    queue.push(message("first error", "error"));
    queue.push(message("second error", "error"));
    expect(titles(queue.snapshot().waiting)).toEqual(["first error", "second error", "calm"]);
  });

  it("gives calm durations, longer for errors and actions", () => {
    queue.push(message("a"));
    queue.push(message("e", "error"));
    queue.push({ ...message("act"), action: { label: "Go", onClick: vi.fn() } });
    queue.push({ kind: "xp", rewards: [{ kind: "pour_in", amount: 100 }], newXp: 100 });
    const all = [...queue.snapshot().visible, ...queue.snapshot().waiting];
    expect(all.map((entry) => entry.duration)).toEqual([DURATIONS.message, DURATIONS.error, DURATIONS.action, DURATIONS.xp]);
  });

  it("dismisses everything at once", () => {
    for (const title of ["a", "b", "c"]) queue.push(message(title));
    queue.close();
    expect(queue.snapshot()).toEqual({ visible: [], waiting: [] });
    expect(log.filter((line) => line.startsWith("hide"))).toHaveLength(2);
  });
});

describe("combineRewards", () => {
  it("adds like kinds and keeps the order they first came in", () => {
    expect(
      combineRewards([{ kind: "pour_in", amount: 100 }], [{ kind: "email_linked", amount: 50 }, { kind: "pour_in", amount: 100 }]),
    ).toEqual([{ kind: "pour_in", amount: 200 }, { kind: "email_linked", amount: 50 }]);
  });
});
