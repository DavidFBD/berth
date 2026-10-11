"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";
import { useAccountHeaders, useProfile, useSendFeedback } from "@/hooks/use-profile";
import { FEEDBACK_MAX_CHARS, type FeedbackOrder, type FeedbackRefusal } from "@/lib/feedback";
import { cn } from "@/lib/utils";

/**
 * The feedback form, one textarea and a Send pill, shared by the sheet
 * (feedback-sheet, opened from the Beta pill or an order that went wrong)
 * and the account drawer's own screen. It says plainly what rides along
 * before anything is sent, and sends nothing else (lib/feedback
 * sanitizeContext runs again on the server). Signed out, it asks for a
 * sign in instead of taking words it could not keep.
 *
 * `fixture` pins a state for the dev gallery (/dev/feedback); with it, Send
 * goes nowhere.
 */

export type FeedbackFixture = {
  signedIn: boolean;
  hasEmail: boolean;
  text?: string;
  mayReply?: boolean;
  /** "sent" shows the thanks; a refusal shows its line under the form. */
  state?: "idle" | "sent" | FeedbackRefusal;
  awarded?: number;
};

type Phase = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; awarded: number } | { kind: "refused"; refusal: FeedbackRefusal };

/** Autofocus only where a keyboard is already there: a fine pointer on a wide screen, never a phone. */
const DESKTOP_QUERY = "(pointer: fine) and (min-width: 64rem)";

/** The context the form says it sends, read at the moment of sending. */
function pageContext() {
  return {
    path: window.location.pathname,
    viewport: `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}`,
    userAgent: navigator.userAgent,
  };
}

export function FeedbackForm({
  order = null,
  onClose,
  signedIn: signedInOverride,
  fixture,
  className,
}: {
  order?: FeedbackOrder | null;
  /** The thanks' Close; without it the thanks stands alone. */
  onClose?: () => void;
  /** A place that is only ever signed in (the account drawer) says so. */
  signedIn?: boolean;
  fixture?: FeedbackFixture;
  className?: string;
}) {
  const copy = useCopy();
  const words = copy.feedback;
  const { key } = useAccountHeaders({ prompt: false });
  const profile = useProfile();
  const send = useSendFeedback();
  const fieldId = useId();
  const area = useRef<HTMLTextAreaElement>(null);

  const [text, setText] = useState(fixture?.text ?? "");
  const [mayReply, setMayReply] = useState(fixture?.mayReply ?? false);
  const [phase, setPhase] = useState<Phase>(() => {
    if (fixture?.state === "sent") return { kind: "sent", awarded: fixture.awarded ?? 0 };
    if (fixture?.state && fixture.state !== "idle") return { kind: "refused", refusal: fixture.state };
    return { kind: "idle" };
  });

  const signedIn = fixture ? fixture.signedIn : (signedInOverride ?? key !== null);
  const hasEmail = fixture ? fixture.hasEmail : Boolean(profile.data?.hasEmail);

  useEffect(() => {
    if (fixture || !signedIn) return;
    if (typeof window !== "undefined" && window.matchMedia?.(DESKTOP_QUERY).matches) area.current?.focus();
  }, [fixture, signedIn]);

  if (phase.kind === "sent") {
    return (
      <div role="status" className={cn("flex flex-col items-center gap-3 px-2 py-6 text-center", className)}>
        <CheckCircle weight="duotone" className="size-10 text-foreground" aria-hidden />
        <div className="flex flex-col gap-1">
          <p className="font-display text-lg text-foreground">{words.thanksTitle}</p>
          <p className="text-sm text-muted-foreground">{words.thanksBody}</p>
          {phase.awarded > 0 && <p className="money text-sm text-foreground">{words.thanksXp(phase.awarded)}</p>}
        </div>
        {onClose && (
          <Button variant="outline" className="mt-2 h-11 w-full text-base" onClick={onClose}>
            {words.close}
          </Button>
        )}
      </div>
    );
  }

  if (!signedIn) {
    return <p className={cn("rounded-xl bg-muted/50 px-3 py-2.5 text-sm text-foreground", className)}>{words.signedOut}</p>;
  }

  const trimmed = text.trim();
  const tooLong = trimmed.length > FEEDBACK_MAX_CHARS;
  const sending = phase.kind === "sending";

  const submit = async () => {
    if (fixture || !trimmed || tooLong || sending) return;
    setPhase({ kind: "sending" });
    const result = await send.mutateAsync({ body: trimmed, mayReply: hasEmail && mayReply, context: pageContext(), order }).catch(() => null);
    if (!result) setPhase({ kind: "refused", refusal: "failed" });
    else if (result.ok) setPhase({ kind: "sent", awarded: result.awarded });
    else setPhase({ kind: "refused", refusal: result.refusal });
  };

  const refusal = phase.kind === "refused" ? phase.refusal : tooLong ? "too_long" : null;
  const refusalLine =
    refusal === "too_long"
      ? words.tooLong(FEEDBACK_MAX_CHARS)
      : refusal === "too_many"
        ? words.tooMany
        : refusal === "signed_out"
          ? words.signedOut
          : refusal === "failed"
            ? words.failed
            : null;

  return (
    <form
      className={cn("flex flex-col gap-3", className)}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={fieldId} className="sr-only">
        {words.label}
      </label>
      <textarea
        id={fieldId}
        ref={area}
        rows={7}
        value={text}
        maxLength={FEEDBACK_MAX_CHARS + 200}
        onChange={(event) => {
          setText(event.target.value);
          if (phase.kind === "refused") setPhase({ kind: "idle" });
        }}
        placeholder={words.placeholder}
        // 16px keeps iOS from zooming the page when the field takes focus.
        className="min-h-40 w-full resize-y rounded-xl border border-input bg-background px-3 py-2.5 text-base leading-6 text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      />
      {trimmed.length > FEEDBACK_MAX_CHARS * 0.9 && (
        <p className={cn("money -mt-1.5 text-right text-xs", tooLong ? "text-foreground" : "text-muted-foreground")}>
          {words.count(trimmed.length, FEEDBACK_MAX_CHARS)}
        </p>
      )}
      {hasEmail && (
        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
          <input
            type="checkbox"
            checked={mayReply}
            onChange={(event) => setMayReply(event.target.checked)}
            className="size-4 shrink-0 accent-foreground"
          />
          {words.mayReply}
        </label>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">{order ? words.sentWithOrder : words.sentWith}</p>
      {refusalLine && (
        <p role="alert" className="rounded-xl bg-muted/50 px-3 py-2.5 text-sm text-foreground">
          {refusalLine}
        </p>
      )}
      <Button type="submit" className="h-11 w-full text-base" disabled={!trimmed || tooLong || sending}>
        {sending ? words.sending : words.send}
      </Button>
    </form>
  );
}
