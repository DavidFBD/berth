"use client";

import { lazy, Suspense, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChatCircleDots, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";
import { useAccountNotice } from "@/hooks/use-social";
import { FEEDBACK_PROMPT_ID } from "@/lib/feedback";
import { EASE_LIFT } from "@/lib/motion";
import { POLICY_NOTICE_ID, SOCIAL_NOTICE_ID } from "@/lib/social-proof";
import { XP_ACTIONS } from "@/lib/xp";

/** Loaded on the first tap, like the Beta pill's. */
const FeedbackSheet = lazy(() => import("@/components/feedback/feedback-sheet").then((module) => ({ default: module.FeedbackSheet })));

/**
 * The board's one gentle ask, once per account: a day after the first
 * completed buy, how did it go? Due by the server's rule (lib/feedback
 * feedbackPromptDue, through lib/server/notices), so it shows on no device
 * once feedback is sent or the ask is closed. "Tell us" opens the feedback
 * sheet; the close button ends it for good. It waits while any other strip
 * or notice holds the slot, the other notices included, so only one speaks
 * at a time.
 *
 * The XP line shows only while the server says the ask is due, which is
 * only for an account that never sent feedback, so feedback_first is
 * always still to be had there; the view takes it as a prop all the same.
 */
export function FeedbackPromptLine({ hidden }: { hidden: boolean }) {
  const social = useAccountNotice(SOCIAL_NOTICE_ID);
  const policy = useAccountNotice(POLICY_NOTICE_ID);
  const { due, close } = useAccountNotice(FEEDBACK_PROMPT_ID);
  const [sheet, setSheet] = useState(false);
  const [opened, setOpened] = useState(false);
  return (
    <>
      <FeedbackPromptLineView
        show={due && !hidden && !social.due && !policy.due}
        xp={XP_ACTIONS.feedback_first.amount}
        onOpen={() => {
          setOpened(true);
          setSheet(true);
        }}
        onDismiss={close}
      />
      {opened && (
        <Suspense fallback={null}>
          <FeedbackSheet open={sheet} onOpenChange={setSheet} />
        </Suspense>
      )}
    </>
  );
}

/** The strip itself, given whether to show it; /dev/feedback renders it without an account. `xp` null drops the XP. */
export function FeedbackPromptLineView({
  show,
  xp,
  onOpen,
  onDismiss,
}: {
  show: boolean;
  xp: number | null;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const copy = useCopy().feedbackPrompt;
  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div
          key="feedback-prompt"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24, ease: EASE_LIFT }}
          role="status"
          data-testid="feedback-prompt"
          className="flex items-center gap-3 rounded-lg border border-border bg-card py-2.5 pr-1.5 pl-[18px] lg:pl-5"
        >
          <ChatCircleDots weight="duotone" aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-sm text-foreground">
            {copy.text}
            {xp !== null && xp > 0 && <span className="money ml-1.5 whitespace-nowrap text-muted-foreground">{copy.xp(xp)}</span>}
          </span>
          <span className="flex shrink-0 items-center gap-0.5">
            {/* Outline, never the accent: the Buy button above holds it. */}
            <Button size="xs" variant="outline" onClick={onOpen}>
              {copy.action}
            </Button>
            <Button size="icon-sm" variant="ghost" className="text-muted-foreground" aria-label={copy.dismissLabel} onClick={onDismiss}>
              <X aria-hidden />
            </Button>
          </span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
