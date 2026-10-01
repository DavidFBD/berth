"use client";

import { motion, useReducedMotion } from "motion/react";
import { Sparkle } from "@phosphor-icons/react";
import type { RewardList } from "@/lib/profile-types";
import { REWARD_REASONS, type RankInfo } from "@/lib/xp";
import { SPRING_POP } from "@/lib/motion";
import { unlocksBetween } from "@/lib/unlocks";
import { toast } from "@/lib/toast";
import { RankGlyph } from "@/components/rank-glyph";
import { useCopy } from "@/components/settings-provider";

/**
 * The achievement announcer. Every XP payout gets a small ceremony instead
 * of a plain line: a spring-popped pill naming what it was FOR (field
 * feedback 2026-08-07: an unexplained balance reads as a bug; the reasons
 * live beside the ladder in lib/xp), and a bordered card when a rank
 * boundary is crossed. Both render through the one toast stack
 * (lib/toast, components/toast-stack): XP that arrives with its action's
 * message joins that message instead of drawing over it. Ceremonies wait
 * while Privy's overlay owns the screen and go on once it's gone, so
 * nothing celebrates behind a blur.
 */

type Announcement = { rewards: RewardList; newXp: number };

const queue: Announcement[] = [];
let pump: ReturnType<typeof setInterval> | null = null;
let heldSince = 0;

/** How long a ceremony will wait for the stage before going on anyway. */
const MAX_HOLD_MS = 20_000;

/**
 * `newXp` is the response's fresh total; the crossing derives in lib/toast
 * as `newXp - sum(rewards)` to `newXp`. No caller assembles before/after
 * pairs (the old optional-args shape silently dropped the level-up card
 * whenever a caller had no cached "before").
 */
export function announceRewards(
  rewards: RewardList | undefined,
  newXp: number,
) {
  if (!rewards?.length) return;
  queue.push({ rewards, newXp });
  if (!pump) {
    heldSince = Date.now();
    flush();
    if (queue.length) pump = setInterval(flush, 300);
  }
}

/**
 * Whether Privy's modal currently owns the screen. Selector-based and
 * deliberately loose: if Privy renames its containers the check simply
 * returns false and ceremonies fire immediately, not a swallowed reward.
 * (The always-mounted embedded-wallet iframe is NOT matched; only
 * dialog-shaped things are.)
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
    if (next) toast.rewards(next.rewards, next.newXp);
  }
}

const totalOf = (rewards: RewardList) => rewards.reduce((sum, reward) => sum + reward.amount, 0);

/** "for a buy", or "for a buy and for adding an email" when one batch paid twice. */
function useReasons(rewards: RewardList): string {
  const copy = useCopy();
  return copy.xpReasons(rewards.map((reward) => REWARD_REASONS[reward.kind]));
}

/** "+100 XP for placing your first order", popped in with a spring and a late sparkle. */
export function XpPill({ rewards }: { rewards: RewardList }) {
  const copy = useCopy();
  const reasons = useReasons(rewards);
  return (
    <motion.div
      initial={{ scale: 0.85, y: 10, opacity: 0 }}
      animate={{ scale: 1, y: 0, opacity: 1 }}
      transition={SPRING_POP}
      className="flex w-fit items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 shadow-lg"
    >
      <motion.span
        aria-hidden
        initial={{ rotate: -90, scale: 0.4, opacity: 0 }}
        animate={{ rotate: 0, scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 18, delay: 0.08 }}
        className="flex"
      >
        <Sparkle className="size-5 text-primary" />
      </motion.span>
      <span className="money text-sm font-semibold text-foreground">
        {copy.xpPlus(totalOf(rewards))}
      </span>
      <span className="text-xs text-muted-foreground">{reasons}</span>
    </motion.div>
  );
}

/**
 * The same XP said inside the message it came with ("Bought." then
 * "+100 XP for a buy"): the pill's sparkle and figure, at the message's
 * scale, so one action is one toast.
 */
export function XpLine({ rewards }: { rewards: RewardList }) {
  const copy = useCopy();
  const reasons = useReasons(rewards);
  return (
    <motion.span
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING_POP}
      className="mt-1 flex items-center gap-1.5"
    >
      <Sparkle aria-hidden className="size-4 shrink-0 text-primary" />
      <span className="money text-[13px] font-semibold text-foreground">{copy.xpPlus(totalOf(rewards))}</span>
      <span className="text-xs text-muted-foreground">{reasons}</span>
    </motion.span>
  );
}

/**
 * Crossing a rank boundary earns a small flourish: three wisps rise off the
 * card while the new rank's glyph turns in and its name settles. When the
 * rung opened something (lib/unlocks), a second line says what, once and
 * plainly. Deliberately quiet for what it is: the app celebrates like a
 * brokerage, not a casino. Exported for the dev gallery (/dev/account).
 */
export function LevelUpCard({
  rank,
  fromLevel = rank.level - 1,
  total,
  reason,
}: {
  rank: RankInfo;
  /** The rung left behind; a jump of several rungs shows every opening passed. */
  fromLevel?: number;
  total: number;
  reason: string | null;
}) {
  const copy = useCopy();
  // Every opening passed, lowest rung first: a jump from First Line past
  // Slip must still say that Ask opened, not only the latest opening.
  const unlocks = unlocksBetween(fromLevel, rank.level);
  // The wisps loop; with reduced motion asked for they are left out.
  const still = useReducedMotion();
  return (
    <motion.div
      initial={{ scale: 0.88, y: 14, opacity: 0 }}
      animate={{ scale: 1, y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 360, damping: 20 }}
      className="relative flex w-fit items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-lg"
    >
      {!still && <div aria-hidden className="absolute -top-2 left-5 flex gap-1.5">
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
              ease: "linear",
            }}
          />
        ))}
      </div>}
      <motion.span
        aria-hidden
        initial={{ rotate: -90, scale: 0.4, opacity: 0 }}
        animate={{ rotate: 0, scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 16, delay: 0.1 }}
        className="flex leading-none"
      >
        <RankGlyph level={rank.level} className="size-6 text-foreground" />
      </motion.span>
      <div className="flex flex-col">
        <motion.span
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 24, delay: 0.18 }}
          className="text-sm font-semibold text-foreground"
        >
          {copy.levelUpTitle(rank.name)}
        </motion.span>
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 24, delay: 0.32 }}
          className="text-xs text-muted-foreground"
        >
          {copy.levelUpLine(rank.level, total, reason)}
        </motion.span>
        {unlocks.map((unlock, index) => (
          <motion.span
            key={unlock.kind === "avatar" ? unlock.avatarId : unlock.kind}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 24, delay: 0.46 + index * 0.12 }}
            className="text-xs text-foreground"
          >
            {copy.levelUpUnlock(unlock)}
          </motion.span>
        ))}
      </div>
    </motion.div>
  );
}
