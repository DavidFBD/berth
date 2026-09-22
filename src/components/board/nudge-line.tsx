"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";
import { useNudge } from "@/hooks/use-nudge";
import { EASE_LIFT } from "@/lib/motion";
import type { Nudge } from "@/lib/nudge";

/**
 * One quiet line under the account total: the most useful true thing to say
 * right now, or nothing. Which line is decided in lib/server/nudge; the words
 * are copy.ts's. Dismissing it sends the next true line, or none, and a
 * standing line stays away for a week.
 *
 * Deliberately a sentence and not a banner: no accent, no box, set in the
 * muted tone at the size of the total's own sub line, so the page's first
 * read is still the figure above it.
 */
type Actions = {
  onAddFunds: () => void;
  onParkCash: () => void;
  onOpenAccount: () => void;
};

export function NudgeLine(actions: Actions) {
  const { nudge, dismiss } = useNudge();
  return <NudgeLineView nudge={nudge} onDismiss={dismiss} {...actions} />;
}

/** The line itself, given a nudge; /dev/board renders it without an account. */
export function NudgeLineView({
  nudge,
  onDismiss,
  onAddFunds,
  onParkCash,
  onOpenAccount,
}: Actions & { nudge: Nudge | null; onDismiss: () => void }) {
  const copy = useCopy();

  const line = (nudge: Nudge): { text: string; action?: { label: string; run?: () => void; href?: string } } => {
    switch (nudge.kind) {
      case "addFunds":
        return { text: copy.nudgeAddFunds, action: { label: copy.nudgeAddFundsAction, run: onAddFunds } };
      case "firstBuy":
        return { text: copy.nudgeFirstBuy };
      case "heldNews":
        return {
          text: copy.nudgeHeldNews(nudge.name),
          action: { label: copy.nudgeHeldNewsAction, href: nudge.postUrl },
        };
      case "parkCash":
        return { text: copy.nudgeParkCash, action: { label: copy.nudgeParkCashAction, run: onParkCash } };
      case "invite":
        return { text: copy.nudgeInvite, action: { label: copy.nudgeInviteAction, run: onOpenAccount } };
    }
  };

  const shown = nudge ? line(nudge) : undefined;

  return (
    <AnimatePresence initial={false}>
      {nudge && shown ? (
        <motion.div
          key={nudge.kind === "heldNews" ? nudge.postUrl : nudge.kind}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24, ease: EASE_LIFT }}
          className="-mt-2 mb-5 flex items-start gap-2 px-1"
          role="status"
        >
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            {shown.text}
            {shown.action ? (
              <>
                {" "}
                {shown.action.href ? (
                  <a
                    href={shown.action.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {shown.action.label}
                    <ArrowUpRight weight="duotone" className="size-3.5" aria-hidden />
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={shown.action.run}
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {shown.action.label}
                  </button>
                )}
              </>
            ) : null}
          </p>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onDismiss}
            aria-label={copy.nudgeDismissLabel}
            className="text-muted-foreground"
          >
            <X weight="duotone" aria-hidden />
          </Button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
