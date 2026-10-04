"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCopy } from "@/components/settings-provider";
import { ProfileCardView, type CardHandlers } from "@/components/social/profile-card";
import { useFindFriend, useSocialAction } from "@/hooks/use-social";
import { HANDLE_MAX, parseHandle } from "@/lib/handle";
import type { CardAnswer } from "@/lib/social-types";

/**
 * "Find a friend": one field for an exact username, lowercased as it is
 * typed (the picker's rule), and a Find button. Nothing is asked until Find
 * is pressed: no suggestions, no partial search. A found card comes with the
 * usual relation actions; every miss (no such name, hidden, blocked either
 * way) reads the same "No one by that name." The server allows 30 lookups an
 * hour and only to an account with a verified email (lib/server/social/ops).
 */

export type FindResult = { kind: "answer"; answer: CardAnswer } | { kind: "slow" } | null;

export function FindFriendView({
  value,
  onChange,
  onFind,
  busy,
  result,
  handlers,
}: {
  value: string;
  onChange: (value: string) => void;
  onFind: () => void;
  busy: boolean;
  result: FindResult;
  handlers: CardHandlers;
}) {
  const copy = useCopy().social;
  const ready = parseHandle(value).ok;
  const answer = result?.kind === "answer" ? result.answer : null;
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !busy) onFind();
        }}
      >
        <div className="flex flex-col">
          <span className="text-sm font-medium text-foreground">{copy.findTitle}</span>
          <span className="text-xs text-muted-foreground">{copy.findSub}</span>
        </div>
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(event) => onChange(event.target.value.toLowerCase())}
            placeholder={copy.pickPlaceholder}
            aria-label={copy.findLabel}
            maxLength={HANDLE_MAX + 2}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            className="h-10 flex-1"
          />
          <Button type="submit" variant="outline" className="h-10" disabled={!ready || busy}>
            {copy.findButton}
          </Button>
        </div>
      </form>
      <div aria-live="polite" data-ph-mask>
        {result?.kind === "slow" && <p className="text-xs text-muted-foreground">{copy.findSlow}</p>}
        {answer && !answer.found && <p className="text-sm text-muted-foreground">{copy.notFound}</p>}
        {answer?.found && <ProfileCardView answer={answer} handlers={handlers} heading="h2" />}
      </div>
    </div>
  );
}

/** The field, live: the lookup on Find, and the card's actions answered in place. */
export function FindFriend({ demo }: { demo?: { value: string; result: FindResult } }) {
  const copy = useCopy().social;
  const [value, setValue] = useState(demo?.value ?? "");
  const [result, setResult] = useState<FindResult>(demo?.result ?? null);
  const find = useFindFriend();
  const action = useSocialAction();
  const answer = result?.kind === "answer" && result.answer.found ? result.answer : null;

  const run = async (vars: Parameters<typeof action.mutateAsync>[0], success?: (next: CardAnswer | null) => string | null) => {
    if (demo) return;
    try {
      const outcome = await action.mutateAsync(vars);
      if (outcome.card) setResult({ kind: "answer", answer: outcome.card });
      const message = success?.(outcome.card);
      if (message) toast.success(message);
    } catch {
      toast.error(copy.actionFailed);
    }
  };

  const handle = answer?.card.handle ?? "";
  return (
    <FindFriendView
      value={value}
      onChange={(next) => {
        setValue(next);
        setResult(null);
      }}
      busy={find.isPending || action.isPending}
      result={result}
      onFind={() => {
        if (demo) return;
        find.mutate(value, {
          onSuccess: (outcome) => {
            if (outcome.kind === "failed") toast.error(copy.actionFailed);
            else setResult(outcome);
          },
          onError: () => toast.error(copy.actionFailed),
        });
      }}
      handlers={{
        busy: action.isPending,
        onSalute: (on) => void run({ kind: "salute", handle, on }),
        onFriend: (friendAction) =>
          void run({ kind: "friend", handle, action: friendAction }, (next) =>
            next?.found && next.viewer.relation === "friends" && friendAction !== "remove"
              ? copy.youAreFriends(handle)
              : friendAction === "request" && next?.found && next.viewer.relation === "sent"
                ? copy.requestSent
                : null,
          ),
        onBlock: () => void run({ kind: "block", handle, on: true }, () => copy.blockDone),
        onReport: (reason) => void run({ kind: "report", handle, reason }, () => copy.reportDone),
      }}
    />
  );
}
