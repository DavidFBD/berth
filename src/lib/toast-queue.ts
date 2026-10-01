import type { RewardList } from "@/lib/profile-types";

/**
 * The one toast queue (field bug 2026-10-01: a buy said "Bought." and
 * "+100 XP" in two toasts drawn over each other). Pure and framework free:
 * it decides what is on screen, what waits, and what folds into what; a sink
 * (components/toast-stack) draws its decisions with sonner.
 *
 * Rules, in order, for every push:
 *   1. An id already known replaces that toast's content in place.
 *   2. The same message again while the first is still around is the first
 *      one, kept a little longer, not a second toast.
 *   3. XP that arrives within MERGE_WINDOW_MS of a success message joins it
 *      ("Bought." with "+100 XP for a buy" under it), and XP joins XP.
 *      A rank crossing keeps its own card: it is the bigger news.
 *   4. Anything else waits its turn. At most MAX_VISIBLE show at once; an
 *      error waits ahead of the calmer things, never ahead of another error.
 */

export const MAX_VISIBLE = 2;
/** How long after a message its action's XP may still join it. */
export const MERGE_WINDOW_MS = 8_000;

/** Calm lifetimes, ms. Errors stay longer: they ask for something. */
export const DURATIONS = {
  message: 5_000,
  error: 7_000,
  action: 8_000,
  xp: 4_500,
  levelup: 6_500,
} as const;

export type ToastTone = "default" | "success" | "error" | "info";

export type ToastAction = { label: string; onClick: () => void };

export type ToastContent =
  | {
      kind: "message";
      tone: ToastTone;
      title: string;
      description?: string;
      action?: ToastAction;
      /** XP folded in from the same action (rule 3). */
      rewards?: RewardList;
    }
  | { kind: "xp"; rewards: RewardList; newXp: number }
  | { kind: "levelup"; rewards: RewardList; newXp: number };

export type ToastEntry = {
  id: string;
  content: ToastContent;
  /** When it was first pushed; merges look back from here. */
  createdAt: number;
  duration: number;
  /** Bumps on every in-place change, so a renderer can tell one from the next. */
  revision: number;
  /** Push order, which the line itself does not keep (errors go ahead). */
  sequence: number;
};

export type ToastPush = ToastContent & { id?: string; duration?: number };

export interface ToastSink {
  show(entry: ToastEntry): void;
  update(entry: ToastEntry): void;
  hide(id: string): void;
}

export function defaultDuration(content: ToastContent): number {
  if (content.kind === "xp") return DURATIONS.xp;
  if (content.kind === "levelup") return DURATIONS.levelup;
  if (content.action) return DURATIONS.action;
  if (content.tone === "error") return DURATIONS.error;
  return DURATIONS.message;
}

const isError = (entry: ToastEntry) =>
  entry.content.kind === "message" && entry.content.tone === "error";

function sameMessage(a: ToastContent, b: ToastContent): boolean {
  return (
    a.kind === "message" &&
    b.kind === "message" &&
    a.tone === b.tone &&
    a.title === b.title &&
    (a.description ?? "") === (b.description ?? "")
  );
}

/** Rewards of one kind add up, so two buys' XP reads as one line, not two. */
export function combineRewards(a: RewardList, b: RewardList): RewardList {
  const out = a.map((reward) => ({ ...reward }));
  for (const reward of b) {
    const same = out.find((existing) => existing.kind === reward.kind);
    if (same) same.amount += reward.amount;
    else out.push({ ...reward });
  }
  return out;
}

export class ToastQueue {
  private visible: ToastEntry[] = [];
  private waiting: ToastEntry[] = [];
  private sink: ToastSink | null = null;
  private counter = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Attach the renderer; whatever waited for it shows now. */
  attach(sink: ToastSink | null) {
    this.sink = sink;
    if (sink) {
      for (const entry of this.visible) sink.show(entry);
      this.pump();
    }
  }

  snapshot(): { visible: ToastEntry[]; waiting: ToastEntry[] } {
    return { visible: [...this.visible], waiting: [...this.waiting] };
  }

  push(input: ToastPush): string {
    const { id: givenId, duration: givenDuration, ...content } = input;
    const now = this.now();

    // 1. A known id is the same toast with new words.
    if (givenId) {
      const known = this.find(givenId);
      if (known) {
        this.revise(known, content, givenDuration ?? defaultDuration(content));
        return known.id;
      }
    }

    const recent = (entry: ToastEntry) => now - entry.createdAt <= MERGE_WINDOW_MS;
    const all = () => [...this.visible, ...this.waiting];

    // 2. The same message twice is one message.
    if (content.kind === "message") {
      const twin = all().find((entry) => recent(entry) && sameMessage(entry.content, content));
      if (twin) {
        this.revise(twin, { ...twin.content }, givenDuration ?? defaultDuration(content));
        return twin.id;
      }
    }

    // 3. XP joins its action's message, or the XP already on its way: the
    //    last thing said, if that was a success or XP (a rank card in
    //    between does not count; anything else said since means the XP is
    //    not that message's).
    if (content.kind === "xp") {
      const last = all()
        .filter((entry) => entry.content.kind !== "levelup")
        .sort((a, b) => b.sequence - a.sequence)[0];
      const host =
        last &&
        recent(last) &&
        ((last.content.kind === "message" && last.content.tone === "success") || last.content.kind === "xp")
          ? last
          : undefined;
      if (host) {
        const before = host.content;
        if (before.kind === "message") {
          this.revise(
            host,
            { ...before, rewards: combineRewards(before.rewards ?? [], content.rewards) },
            Math.max(DURATIONS.message, DURATIONS.xp),
          );
        } else if (before.kind === "xp") {
          this.revise(
            host,
            { kind: "xp", rewards: combineRewards(before.rewards, content.rewards), newXp: Math.max(before.newXp, content.newXp) },
            DURATIONS.xp,
          );
        }
        return host.id;
      }
    }

    // 4. Its turn in line.
    const sequence = ++this.counter;
    const entry: ToastEntry = {
      id: givenId ?? `t${sequence}`,
      sequence,
      content,
      createdAt: now,
      duration: givenDuration ?? defaultDuration(content),
      revision: 0,
    };
    if (isError(entry)) {
      const firstCalm = this.waiting.findIndex((waiting) => !isError(waiting));
      if (firstCalm === -1) this.waiting.push(entry);
      else this.waiting.splice(firstCalm, 0, entry);
    } else this.waiting.push(entry);
    this.pump();
    return entry.id;
  }

  /** Gone: closed by its timer, a swipe, or a caller. Safe to call twice. */
  close(id?: string) {
    if (id === undefined) {
      const shown = this.visible;
      this.visible = [];
      this.waiting = [];
      for (const entry of shown) this.sink?.hide(entry.id);
      return;
    }
    const shownAt = this.visible.findIndex((entry) => entry.id === id);
    if (shownAt > -1) {
      this.visible.splice(shownAt, 1);
      this.sink?.hide(id);
      this.pump();
      return;
    }
    this.waiting = this.waiting.filter((entry) => entry.id !== id);
  }

  private find(id: string): ToastEntry | undefined {
    return this.visible.find((entry) => entry.id === id) ?? this.waiting.find((entry) => entry.id === id);
  }

  private revise(entry: ToastEntry, content: ToastContent, duration: number) {
    entry.content = content;
    entry.duration = duration;
    entry.revision += 1;
    if (this.visible.includes(entry)) this.sink?.update(entry);
  }

  private pump() {
    if (!this.sink) return;
    while (this.visible.length < MAX_VISIBLE && this.waiting.length) {
      const next = this.waiting.shift()!;
      this.visible.push(next);
      this.sink.show(next);
    }
  }
}
