"use client";

import { AnimatePresence, motion } from "motion/react";
import { UsersThree } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";
import { useAccountNotice, useMySocial } from "@/hooks/use-social";
import { EASE_LIFT } from "@/lib/motion";
import { SOCIAL_NOTICE_ID } from "@/lib/social-proof";

/**
 * Said once per account (lib/server/notices), as the privacy policy
 * promises for a change that matters: the board now shows Most bought on
 * Berth this week, and there is a new switch, off by default, to let
 * friends see which stocks and funds you hold. "See the switch" opens the
 * profile screen where it lives; either button closes the notice for good.
 * It waits while another strip holds the slot.
 */
export function SocialNoticeLine({ hidden, onOpen }: { hidden: boolean; onOpen: () => void }) {
  const { due, close } = useAccountNotice(SOCIAL_NOTICE_ID);
  // The switch exists only once there is a username; without one, the
  // notice says its piece and offers only "Got it" (m-d).
  const me = useMySocial(due && !hidden, { prompt: false });
  const hasSwitch = Boolean(me.data?.handle);
  return (
    <SocialNoticeLineView
      show={due && !hidden}
      onOpen={
        hasSwitch
          ? () => {
              close();
              onOpen();
            }
          : undefined
      }
      onDismiss={close}
    />
  );
}

/** The strip itself, given whether to show it; /dev/board renders it without an account. */
export function SocialNoticeLineView({ show, onOpen, onDismiss }: { show: boolean; onOpen?: () => void; onDismiss: () => void }) {
  const copy = useCopy().socialNotice;
  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div
          key="social-notice"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24, ease: EASE_LIFT }}
          role="status"
          data-testid="social-notice"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-card py-2.5 pr-2.5 pl-[18px] lg:pl-5"
        >
          <UsersThree weight="duotone" aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 basis-[calc(100%-1.75rem)] text-sm text-foreground sm:basis-0 sm:flex-1">{copy.text}</span>
          <span className="ml-auto flex shrink-0 gap-1">
            {onOpen && (
              <Button size="xs" onClick={onOpen}>
                {copy.action}
              </Button>
            )}
            <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={onDismiss}>
              {copy.dismiss}
            </Button>
          </span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
