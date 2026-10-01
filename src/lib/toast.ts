import type { RewardList } from "@/lib/profile-types";
import { levelUpRank } from "@/lib/xp";
import { ToastQueue, type ToastAction, type ToastTone } from "@/lib/toast-queue";

/**
 * The one way to say something in a toast. Same shape as sonner's `toast`
 * for the calls Berth makes, but every call goes through the one queue
 * (lib/toast-queue), so two things said at once stack, wait or merge
 * instead of drawing over each other. Import this, never "sonner" (lint
 * enforces it); components/toast-stack is the only renderer.
 */

export const toastQueue = new ToastQueue();

type Options = {
  id?: string;
  description?: string;
  duration?: number;
  action?: ToastAction;
};

function say(tone: ToastTone) {
  return (title: string, options: Options = {}) =>
    toastQueue.push({
      kind: "message",
      tone,
      title,
      description: options.description,
      action: options.action,
      id: options.id,
      duration: options.duration,
    });
}

/**
 * XP just paid. `newXp` is the fresh total; the rewards are exactly the
 * delta, so the rank crossing derives here with no cached "before". A
 * crossing gets its own card; the XP line itself still joins the action
 * that earned it, so one batch is at most a card and a line.
 */
function rewards(list: RewardList | undefined, newXp: number) {
  if (!list?.length) return;
  const total = list.reduce((sum, reward) => sum + reward.amount, 0);
  if (levelUpRank(newXp - total, newXp)) {
    toastQueue.push({ kind: "levelup", rewards: list, newXp });
    // A single reward's reason is already on the card.
    if (list.length === 1) return;
  }
  toastQueue.push({ kind: "xp", rewards: list, newXp });
}

export const toast = Object.assign(say("default"), {
  success: say("success"),
  error: say("error"),
  info: say("info"),
  rewards,
  dismiss: (id?: string) => toastQueue.close(id),
});
