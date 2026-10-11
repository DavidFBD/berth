"use client";

import { lazy, Suspense, useState } from "react";
import { ChatCircleDots } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useCopy } from "@/components/settings-provider";
import { BERTH_BETA } from "@/lib/beta";

/**
 * The quiet "Beta · Feedback" pill beside the wordmark: ink/muted with a
 * hairline border, never the accent. One tap opens the feedback sheet
 * (components/feedback), signed in or not: signed out, the sheet asks for
 * a sign in rather than taking words it could not keep. The sheet's intro
 * opens with the beta line, and its foot keeps the support address.
 *
 * On the narrowest phones the word "Feedback" steps aside and the glyph
 * and "Beta" stay; the button always reads out "Send feedback".
 *
 * BERTH_BETA (lib/beta.ts) is the one switch: false hides this everywhere
 * it's rendered, with nothing else to change.
 */
/** Loaded on the first tap: the sheet reads the account, which the pill itself never needs. */
const FeedbackSheet = lazy(() => import("@/components/feedback/feedback-sheet").then((module) => ({ default: module.FeedbackSheet })));

export function BetaPill({ className }: { className?: string }) {
  const copy = useCopy();
  const [sheet, setSheet] = useState(false);
  // Kept mounted once opened, so it can animate closed.
  const [opened, setOpened] = useState(false);
  if (!BERTH_BETA) return null;

  return (
    <>
      <button
        type="button"
        aria-label={copy.beta.openLabel}
        onClick={() => {
          setOpened(true);
          setSheet(true);
        }}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 self-center rounded-full border border-border py-[0.1875rem] pr-1.5 pl-1 text-[10px] font-medium uppercase leading-none tracking-wide text-muted-foreground outline-none transition-colors duration-150 ease-lift hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
          sheet && "text-foreground",
          className,
        )}
      >
        <ChatCircleDots weight="duotone" aria-hidden className="size-3 shrink-0" />
        <span aria-hidden>
          {copy.beta.tag}
          <span className="max-[359px]:hidden"> · {copy.beta.feedback}</span>
        </span>
      </button>
      {opened && (
        <Suspense fallback={null}>
          <FeedbackSheet open={sheet} onOpenChange={setSheet} />
        </Suspense>
      )}
    </>
  );
}
