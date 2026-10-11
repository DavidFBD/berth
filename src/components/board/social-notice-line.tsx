"use client";

import { AnimatePresence, motion } from "motion/react";
import { Scroll, UsersThree } from "@phosphor-icons/react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";
import { useAccountNotice, useMySocial } from "@/hooks/use-social";
import { EASE_LIFT } from "@/lib/motion";
import { POLICY_NOTICE_ID, SOCIAL_NOTICE_ID } from "@/lib/social-proof";

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
  // Already sharing: the switch it points to is on, so it says nothing.
  const sharing = me.data?.shareHoldings === true;
  return (
    <SocialNoticeLineView
      show={due && !hidden && !sharing}
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

/**
 * Said once per account, before the new terms and privacy policy apply, as
 * both promise for a change that matters (Most held on Berth among them).
 * It waits while another strip holds the slot, the social notice included,
 * so only one notice speaks at a time. The links open each page's "What
 * changed"; "Got it" closes it for good.
 */
export function PolicyNoticeLine({ hidden }: { hidden: boolean }) {
  const social = useAccountNotice(SOCIAL_NOTICE_ID);
  const { due, close } = useAccountNotice(POLICY_NOTICE_ID);
  return <PolicyNoticeLineView show={due && !hidden && !social.due} onDismiss={close} />;
}

/** The strip itself, given whether to show it; /dev/social renders it without an account. */
export function PolicyNoticeLineView({ show, onDismiss }: { show: boolean; onDismiss: () => void }) {
  const copy = useCopy().policyNotice;
  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div
          key="policy-notice"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24, ease: EASE_LIFT }}
          role="status"
          data-testid="policy-notice"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-card py-2.5 pr-2.5 pl-[18px] lg:pl-5"
        >
          <Scroll weight="duotone" aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 basis-[calc(100%-1.75rem)] text-sm text-foreground sm:basis-0 sm:flex-1">{copy.text}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <Link href="/terms#what-changed" className={buttonVariants({ size: "xs", variant: "ghost" })}>
              {copy.terms}
            </Link>
            <Link href="/privacy#what-changed" className={buttonVariants({ size: "xs", variant: "ghost" })}>
              {copy.privacy}
            </Link>
            <Button size="xs" className="ml-1" onClick={onDismiss}>
              {copy.dismiss}
            </Button>
          </span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
