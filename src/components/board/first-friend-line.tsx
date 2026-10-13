"use client";

import { AnimatePresence, motion } from "motion/react";
import { ShareNetwork } from "@phosphor-icons/react";
import { AvatarWithRank } from "@/components/rank-glyph";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";
import { useAccountNotice, useFirstFriend } from "@/hooks/use-social";
import { EASE_LIFT } from "@/lib/motion";
import { POLICY_NOTICE_ID, SOCIAL_NOTICE_ID } from "@/lib/social-proof";
import { FEEDBACK_PROMPT_ID } from "@/lib/feedback";
import type { FirstFriendAnswer } from "@/lib/social-types";
import { toast } from "@/lib/toast";
import { rankForXp } from "@/lib/xp";

/**
 * The first friend strip (lib/server/social/founder): for any account with
 * no friends, the founder as a ready-made first friend beside the person's
 * own friend link. The server decides whether there is an offer; "Not now"
 * and any first friend close it for good. It waits while another strip
 * holds the slot, the once per account notices included. Adding him pays
 * nothing; his referral code and invite link are never offered here.
 */
export function FirstFriendLine({ hidden, onShareLink }: { hidden: boolean; onShareLink: () => void }) {
  const copy = useCopy().firstFriend;
  const social = useAccountNotice(SOCIAL_NOTICE_ID);
  const policy = useAccountNotice(POLICY_NOTICE_ID);
  const feedback = useAccountNotice(FEEDBACK_PROMPT_ID);
  const waiting = hidden || social.due || policy.due || feedback.due;
  const { offer, add, adding, dismiss } = useFirstFriend(!waiting);
  return (
    <FirstFriendLineView
      offer={waiting ? null : offer}
      adding={adding}
      onAdd={() =>
        add({
          onDone: (done) => {
            if (done) toast.success(copy.added);
          },
        })
      }
      onShareLink={onShareLink}
      onDismiss={dismiss}
    />
  );
}

/** The strip itself, given the offer; /dev/board renders it without an account. */
export function FirstFriendLineView({
  offer,
  adding = false,
  onAdd,
  onShareLink,
  onDismiss,
}: {
  offer: FirstFriendAnswer["offer"];
  adding?: boolean;
  onAdd: () => void;
  onShareLink: () => void;
  onDismiss: () => void;
}) {
  const copy = useCopy().firstFriend;
  return (
    <AnimatePresence initial={false}>
      {offer ? (
        <motion.div
          key="first-friend"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24, ease: EASE_LIFT }}
          role="status"
          data-testid="first-friend"
          className="flex flex-col gap-2.5 rounded-lg border border-border bg-card py-2.5 pr-2.5 pl-[18px] lg:pl-5"
        >
          <div className="flex items-start gap-3">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
              <span className="text-sm font-medium text-foreground">{copy.title}</span>
              <span className="text-xs text-muted-foreground">{copy.text}</span>
            </span>
            <Button size="xs" variant="ghost" className="shrink-0 text-muted-foreground" onClick={onDismiss}>
              {copy.dismiss}
            </Button>
          </div>
          <FirstFriendRow offer={offer} adding={adding} onAdd={onAdd} />
          <div className="flex">
            <Button size="xs" variant="ghost" className="-ml-2 gap-1.5" onClick={onShareLink}>
              <ShareNetwork weight="duotone" aria-hidden className="size-4 text-muted-foreground" />
              {copy.shareLink}
            </Button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** The founder's row: face, "David, who builds Berth", and Add. Also the empty friends list's first row. */
export function FirstFriendRow({
  offer,
  adding = false,
  onAdd,
}: {
  offer: NonNullable<FirstFriendAnswer["offer"]>;
  adding?: boolean;
  onAdd: () => void;
}) {
  const copy = useCopy().firstFriend;
  return (
    <div data-first-friend-row className="flex min-h-11 items-center gap-3">
      <AvatarWithRank avatarId={offer.avatarId} level={rankForXp(offer.xp).level} size={32} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-foreground">{copy.founderName}</span>
        <span className="truncate text-xs text-muted-foreground">{copy.founderSub}</span>
      </span>
      <Button size="xs" className="shrink-0" disabled={adding} onClick={onAdd}>
        {copy.add}
      </Button>
    </div>
  );
}
