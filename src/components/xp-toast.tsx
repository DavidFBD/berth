"use client";

import { motion } from "motion/react";
import { Coffee, Sparkle } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { Reward, RewardList } from "@/lib/profile-types";
import { levelUpRank, type RankInfo, type XpKind } from "@/lib/xp";

/**
 * The achievement announcer. Every XP payout gets a small ceremony instead
 * of a plain toast: a spring-popped pill per reward (each naming what it was
 * FOR — field feedback 2026-08-07: an unexplained balance reads as a bug),
 * and a steam-wreathed card when a rank boundary is crossed. Ceremonies
 * queue while Privy's overlay owns the screen and flush once it's gone, so
 * nothing celebrates behind a blur.
 */

/**
 * Why each kind pays, in toast-sized words. Theme-agnostic on purpose, same
 * exception as the rewards panel: ranks and rewards read identically in
 * every parlour. The ledger in tea-service reuses these.
 */
export const REWARD_REASONS: Record<XpKind, string> = {
  pour_in: "for pouring a cup",
  pour_out: "for pouring back",
  account_created: "for taking your seat",
  email_linked: "for saving your seat",
  avatar_set: "for picking a face",
  theme_tried: "for tasting a new parlour",
  friend_poured: "a friend poured their first cup",
  invite_accepted: "for joining on a friend's invite",
};

type Announcement = { rewards: RewardList; oldXp?: number; newXp?: number };

const queue: Announcement[] = [];
let pump: ReturnType<typeof setInterval> | null = null;
let heldSince = 0;

/** How long a ceremony will wait for the stage before going on anyway. */
const MAX_HOLD_MS = 20_000;

export function announceRewards(
  rewards: RewardList | undefined,
  oldXp?: number,
  newXp?: number,
) {
  if (!rewards?.length) return;
  queue.push({ rewards, oldXp, newXp });
  if (!pump) {
    heldSince = Date.now();
    flush();
    if (queue.length) pump = setInterval(flush, 300);
  }
}

/**
 * Whether Privy's modal currently owns the screen. Selector-based and
 * deliberately loose: if Privy renames its containers the check simply
 * returns false and ceremonies fire immediately — the old behaviour, not a
 * swallowed reward. (The always-mounted embedded-wallet iframe is NOT
 * matched; only dialog-shaped things are.)
 */
function stageBlocked(): boolean {
  if (typeof document === "undefined") return false;
  if (Date.now() - heldSince > MAX_HOLD_MS) return false;
  return (
    document.querySelector(
      '#privy-dialog, [id^="privy-dialog"], #privy-modal-root [role="dialog"], div[id^="privy-modal"]',
    ) !== null
  );
}

function flush() {
  if (stageBlocked()) return;
  if (pump) {
    clearInterval(pump);
    pump = null;
  }
  while (queue.length) {
    const next = queue.shift();
    if (next) present(next);
  }
}

function present({ rewards, oldXp, newXp }: Announcement) {
  const total = rewards.reduce((sum, reward) => sum + reward.amount, 0);
  const reached = levelUpRank(oldXp, newXp);

  if (reached) {
    // A single reward folds its reason into the card; a batch gets the card
    // for the rank and a pill per reward for the attribution.
    const reason = rewards.length === 1 ? REWARD_REASONS[rewards[0].kind] : null;
    toast.custom(() => <LevelUpCard rank={reached} total={total} reason={reason} />, {
      duration: 5000,
    });
    if (rewards.length === 1) return;
  }
  rewards.forEach((reward, index) => {
    toast.custom(() => <XpPill reward={reward} />, {
      duration: 3200 + index * 400,
    });
  });
}

const POP = { type: "spring", stiffness: 480, damping: 24 } as const;

/** "+100 XP for pouring a cup", popped in with a spring and a late sparkle. */
function XpPill({ reward }: { reward: Reward }) {
  return (
    <motion.div
      initial={{ scale: 0.6, y: 14, opacity: 0 }}
      animate={{ scale: 1, y: 0, opacity: 1 }}
      transition={POP}
      className="flex w-fit items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 shadow-lg"
    >
      <motion.span
        initial={{ rotate: -90, scale: 0 }}
        animate={{ rotate: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 18, delay: 0.08 }}
        className="flex"
      >
        <Sparkle className="size-5 text-primary" />
      </motion.span>
      <span className="money text-sm font-semibold text-foreground">
        +{reward.amount} XP
      </span>
      <span className="text-xs text-muted-foreground">
        {REWARD_REASONS[reward.kind]}
      </span>
    </motion.div>
  );
}

/**
 * Crossing a rank boundary earns steam: three wisps rise off the card while
 * the new rank's name settles in. Deliberately quiet for what it is — the
 * app celebrates like a tea house, not a casino.
 */
function LevelUpCard({
  rank,
  total,
  reason,
}: {
  rank: RankInfo;
  total: number;
  reason: string | null;
}) {
  return (
    <motion.div
      initial={{ scale: 0.7, y: 18, opacity: 0 }}
      animate={{ scale: 1, y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 360, damping: 20 }}
      className="relative flex w-fit items-center gap-3 rounded-2xl border border-primary/40 bg-card px-4 py-3 shadow-lg"
    >
      <div aria-hidden className="absolute -top-2 left-5 flex gap-1.5">
        {[0, 1, 2].map((wisp) => (
          <motion.span
            key={wisp}
            className="block h-3 w-1 rounded-full bg-primary/50"
            initial={{ opacity: 0, y: 8, scaleY: 0.4 }}
            animate={{ opacity: [0, 0.8, 0], y: -14, scaleY: 1 }}
            transition={{
              duration: 1.6,
              delay: 0.25 + wisp * 0.18,
              repeat: Infinity,
              repeatDelay: 0.5,
              ease: "easeOut",
            }}
          />
        ))}
      </div>
      <motion.span
        aria-hidden
        initial={{ rotate: -90, scale: 0 }}
        animate={{ rotate: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 16, delay: 0.1 }}
        className="leading-none"
      >
        <Coffee className="size-6 text-primary" />
      </motion.span>
      <div className="flex flex-col">
        <motion.span
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 24, delay: 0.18 }}
          className="text-sm font-semibold text-foreground"
        >
          You brewed up to {rank.name}
        </motion.span>
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.32 }}
          className="text-xs text-muted-foreground"
        >
          Level {rank.level} · +{total} XP{reason ? ` ${reason}` : ""}
        </motion.span>
      </div>
    </motion.div>
  );
}
