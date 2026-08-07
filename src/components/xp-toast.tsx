"use client";

import { motion } from "motion/react";
import { Coffee, Sparkle } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { RewardList } from "@/lib/profile-types";
import { levelUpRank, type RankInfo } from "@/lib/xp";

/**
 * The achievement announcer. Every XP payout gets a small ceremony instead
 * of a plain toast: a spring-popped pill for ordinary rewards, and a
 * steam-wreathed card when a rank boundary is crossed (the boundary logic is
 * levelUpRank in lib/xp). Same motion stack as the rest of the app; sonner
 * only provides the placement.
 */
export function announceRewards(
  rewards: RewardList | undefined,
  oldXp?: number,
  newXp?: number,
) {
  if (!rewards?.length) return;
  const total = rewards.reduce((sum, reward) => sum + reward.amount, 0);
  const reached = levelUpRank(oldXp, newXp);

  if (reached) {
    toast.custom(() => <LevelUpCard rank={reached} total={total} />, {
      duration: 5000,
    });
  } else {
    toast.custom(() => <XpPill total={total} />, { duration: 3200 });
  }
}

const POP = { type: "spring", stiffness: 480, damping: 24 } as const;

/** "+100 XP", popped in with a spring and a sparkle that unfurls late. */
function XpPill({ total }: { total: number }) {
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
        +{total} XP
      </span>
      <span className="text-xs text-muted-foreground">for playing</span>
    </motion.div>
  );
}

/**
 * Crossing a rank boundary earns steam: three wisps rise off the card while
 * the new rank's name settles in. Deliberately quiet for what it is — the
 * app celebrates like a tea house, not a casino.
 */
function LevelUpCard({ rank, total }: { rank: RankInfo; total: number }) {
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
          Level {rank.level} · +{total} XP
        </motion.span>
      </div>
    </motion.div>
  );
}
