"use client";

import { toast } from "@/lib/toast";
import { saluteLanded } from "@/lib/profile-more";
import { WayBack } from "@/components/social/way-back";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopy } from "@/components/settings-provider";
import { NotFoundCard, ProfileCardView, SignInCard } from "@/components/social/profile-card";
import { ProfileExtras } from "@/components/social/profile-extras";
import { useCard, useMySocial, useSocialAction } from "@/hooks/use-social";
import type { CardAnswer } from "@/lib/social-types";

/**
 * /u/<username> and /f/<token>: the profile a person opens, signed in or
 * not. The page carries no card in its HTML; it asks the same lookup the
 * app does, from the browser, once the session is known, so a block holds
 * for a signed in viewer and crawlers find nothing (the route is noindex).
 */
export function ProfilePage({ target }: { target: { handle: string } | { token: string } }) {
  const copy = useCopy();
  const card = useCard(target);
  const action = useSocialAction();
  const me = useMySocial(card.data?.found === true && card.data.viewer?.relation === "self");

  const answer: CardAnswer | undefined = card.data;
  const token = "token" in target ? target.token : undefined;

  /** Runs one action; the card it answers with, or null when it did not go through. */
  const run = async (
    vars: Parameters<typeof action.mutateAsync>[0],
    success?: (next: CardAnswer | null) => string | null,
  ): Promise<CardAnswer | null> => {
    try {
      const result = await action.mutateAsync(vars);
      const message = success?.(result.card);
      if (message) toast.success(message);
      void card.refetch();
      return result.card;
    } catch {
      toast.error(copy.social.actionFailed);
      return null;
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-4 pt-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
      <WayBack />
      {!answer ? (
        <Skeleton className="h-96 w-full rounded-2xl" />
      ) : !answer.found ? (
        "signIn" in answer ? <SignInCard /> : <NotFoundCard />
      ) : (
        <>
        <ProfileCardView
          answer={answer}
          hidden={me.data ? !me.data.visible : false}
          handlers={{
            busy: action.isPending,
            // Landed only when the answer shows the Salute as asked: a refusal (429, a network error) is not one.
            onSalute: (on) =>
              run({ kind: "salute", handle: answer.card.handle, on }).then((next) => saluteLanded(next, on)),
            onFriend: (friendAction) =>
              void run(
                { kind: "friend", handle: answer.card.handle, action: friendAction, token: friendAction === "request" ? token : undefined },
                (next) =>
                  next?.found && next.viewer.relation === "friends" && friendAction !== "remove"
                    ? copy.social.youAreFriends(answer.card.handle)
                    : friendAction === "request" && next?.found && next.viewer.relation === "sent"
                      ? copy.social.requestSent
                      : null,
              ),
            onBlock: () => void run({ kind: "block", handle: answer.card.handle, on: true }, () => copy.social.blockDone),
            onReport: (reason) => void run({ kind: "report", handle: answer.card.handle, reason }, () => copy.social.reportDone),
          }}
        />
        <ProfileExtras answer={answer} />
        </>
      )}
    </main>
  );
}
