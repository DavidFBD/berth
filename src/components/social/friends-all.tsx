"use client";

import { useId, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CaretDown, UsersThree } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";
import { PRIMARY } from "@/components/home-next-step";
import { useTurnOnAllFriends } from "@/hooks/use-social";
import { FRIEND_FEATURES, friendsAllPromisesXp, friendsAllState } from "@/lib/friends-all";
import type { MySocial } from "@/lib/social-types";
import { SPRING_SHELF } from "@/lib/motion";
import { XP_ACTIONS } from "@/lib/xp";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * "Turn on all friend features" (lib/friends-all, lib/server/social/handles
 * setAllFriends): one offer, drawn as the guided path's card body and as
 * the first row of the drawer's privacy switches. A layered notice, so the
 * consent is informed before the tap: what turning everything on shares,
 * in four short lines and the inference warning; that any of them can be
 * turned off later and the XP is not taken back; and the four switches'
 * full consent texts, word for word, behind Details.
 *
 * The XP promise stands only while the one time bonus is unclaimed. Once
 * it is paid the offer stays (someone who turned a few off may want them
 * all back in one tap), without the promise.
 */
export function FriendsAllOffer({
  social,
  variant,
  demo,
  detailsOpen: initialDetails = false,
}: {
  social: MySocial;
  /** "card": the guided path's step body. "row": the drawer's privacy section. */
  variant: "card" | "row";
  /** Dev galleries: the tap acts on the fixture instead of the server. */
  demo?: () => void;
  detailsOpen?: boolean;
}) {
  const all = useCopy();
  const copy = all.social.friendsAll;
  const turnOn = useTurnOnAllFriends();
  const [details, setDetails] = useState(initialDetails);
  const id = useId();
  const detailsId = `${id}-details`;
  const state = friendsAllState(social);
  const promise = friendsAllPromisesXp(social);
  const amount = XP_ACTIONS.friends_all_on.amount;
  const some = state.partial;

  const go = () => {
    if (demo) {
      demo();
      return;
    }
    turnOn.mutate(FRIEND_FEATURES, {
      // A paid bonus says itself (the XP ceremony); otherwise one calm line.
      onSuccess: (result) => {
        if (result.rewards.length === 0) toast.success(copy.done);
      },
      onError: () => toast.error(all.social.actionFailed),
    });
  };

  const button = (
    <Button
      className={variant === "card" ? PRIMARY : "w-full"}
      variant={variant === "card" ? "default" : "outline"}
      disabled={turnOn.isPending}
      onClick={go}
    >
      {some ? copy.actionRest : copy.action}
    </Button>
  );

  return (
    <div className={cn("flex flex-col", variant === "row" ? "gap-2.5 px-3 py-3" : "gap-3")}>
      {variant === "row" && (
        <div className="flex items-start gap-3">
          <UsersThree weight="duotone" aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm text-foreground">{copy.title}</span>
            <span className="text-xs text-muted-foreground">{some ? copy.count(state.on, state.total) : copy.line}</span>
          </span>
          {promise && <span className="money shrink-0 pt-0.5 text-xs font-medium text-foreground">{copy.xp(amount)}</span>}
        </div>
      )}

      <div className={cn("flex flex-col gap-1.5 rounded-lg bg-muted/60 px-3 py-2.5", variant === "row" && "ml-8")}>
        <span className="text-xs font-medium text-foreground">{copy.summaryTitle}</span>
        <ul className="flex flex-col gap-1">
          {/* One line per feature, in FRIEND_FEATURES order: the list the tap sends is the list read here. */}
          {FRIEND_FEATURES.map((feature, index) => ({ feature, line: copy.summary[index] })).map(({ feature, line }) => (
            <li key={feature} data-feature={feature} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
              <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground/60" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs leading-relaxed text-foreground">{copy.inference}</p>
        {!social.visible && !social.staffHidden && <p className="text-xs leading-relaxed text-foreground">{copy.showsAgain}</p>}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {copy.later}
          {promise && ` ${copy.xpKept}`}
        </p>
        <button
          type="button"
          aria-expanded={details}
          aria-controls={details ? detailsId : undefined}
          aria-label={copy.detailsLabel}
          onClick={() => setDetails((open) => !open)}
          className="-mx-1 inline-flex min-h-7 w-fit items-center gap-1 rounded-md px-1 text-xs text-muted-foreground underline-offset-2 transition-colors duration-150 ease-lift hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {all.social.details}
          <CaretDown className={cn("size-3 transition-transform", details && "rotate-180")} aria-hidden />
        </button>
        <AnimatePresence initial={false}>
          {details && (
            <motion.div
              id={detailsId}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={SPRING_SHELF}
              className="overflow-hidden"
            >
              <dl className="flex flex-col gap-2 pt-0.5">
                {[
                  { title: copy.hideOff(all.social.hide), text: all.social.hideSub },
                  { title: all.social.linkFace, text: all.social.linkFaceSub },
                  { title: all.social.shareHoldings, text: all.social.shareHoldingsSub },
                  { title: all.social.shareWeek, text: all.social.shareWeekSub },
                ].map((entry) => (
                  <div key={entry.title} className="flex flex-col gap-0.5">
                    <dt className="text-xs font-medium text-foreground">{entry.title}</dt>
                    <dd className="text-xs leading-relaxed text-muted-foreground">{entry.text}</dd>
                  </div>
                ))}
              </dl>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className={cn("flex flex-col gap-1.5", variant === "row" && "ml-8")}>
        {button}
        {variant === "card" && promise && <p className="money text-center text-xs text-muted-foreground">{copy.xp(amount)}</p>}
      </div>
    </div>
  );
}
