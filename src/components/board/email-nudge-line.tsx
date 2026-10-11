"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { EnvelopeSimple } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";
import { useEmailNudge } from "@/hooks/use-email-nudge";
import { EASE_LIFT } from "@/lib/motion";

/**
 * A quiet strip asking a wallet-only account to add an email, so it can
 * keep its account and pick a username (docs/plans/social.md). Shown after
 * the first buy, or after two visits with nothing bought yet; dismissible
 * ("Not now"), and comes back at most once a week (lib/email-nudge). It
 * ranks below the limit-order waiting strip and the unlinked-wallet prompt,
 * so at most one of the three ever shows; the caller says which by
 * `otherStripShowing`.
 */
export function EmailNudgeLine({
  otherStripShowing,
  onOpen,
  onShowingChange,
}: {
  otherStripShowing: boolean;
  onOpen: () => void;
  /** Told whether the strip shows, so a lower strip (the feedback ask) can wait its turn. */
  onShowingChange?: (showing: boolean) => void;
}) {
  const { show, dismiss } = useEmailNudge(otherStripShowing);
  useEffect(() => {
    onShowingChange?.(show);
  }, [show, onShowingChange]);
  return <EmailNudgeLineView show={show} onOpen={onOpen} onDismiss={dismiss} />;
}

/** The strip itself, given whether to show it; /dev/board renders it without an account. */
export function EmailNudgeLineView({
  show,
  onOpen,
  onDismiss,
}: {
  show: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const copy = useCopy();
  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div
          key="email-nudge"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24, ease: EASE_LIFT }}
          role="status"
          data-testid="email-nudge"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-card py-2.5 pr-2.5 pl-[18px] lg:pl-5"
        >
          <EnvelopeSimple weight="duotone" aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-sm text-foreground">{copy.emailNudgeText}</span>
          <span className="flex shrink-0 gap-1">
            <Button size="xs" onClick={onOpen}>
              {copy.emailNudgeAction}
            </Button>
            <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={onDismiss}>
              {copy.emailNudgeDismiss}
            </Button>
          </span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
