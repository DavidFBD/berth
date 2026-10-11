"use client";

import { lazy, Suspense, useState } from "react";
import { ChatCircleDots } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useCopy } from "@/components/settings-provider";
import { BERTH_BETA } from "@/lib/beta";

/**
 * Two quiet things beside the wordmark, never one merged pill. The Beta tag
 * is a plain uppercase badge, ink/muted with a hairline border and no
 * action. Feedback is its own ghost pill beside it, sentence case, which
 * opens the feedback sheet (components/feedback), signed in or not: signed
 * out, the sheet asks for a sign in rather than taking words it could not
 * keep. Both are muted, never the accent.
 *
 * On the narrowest phones the word "Feedback" steps aside and the glyph
 * stays (named by aria-label); below 340px the Beta tag steps aside too.
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
      <span className={cn("flex shrink-0 items-center gap-1.5 self-center", className)}>
        <span className="inline-flex items-center rounded-full border border-border px-1.5 py-[0.1875rem] text-[10px] font-medium uppercase leading-none tracking-wide text-muted-foreground max-[339px]:hidden">
          {copy.beta.tag}
        </span>
        <button
          type="button"
          aria-label={copy.beta.feedbackShort}
          onClick={() => {
            setOpened(true);
            setSheet(true);
          }}
          className={cn(
            "relative inline-flex h-6 items-center gap-1 rounded-full border border-border px-2 text-xs leading-none text-muted-foreground outline-none transition-colors duration-150 ease-lift before:absolute before:-inset-y-1 before:inset-x-0 before:content-[''] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 max-[359px]:px-1.5",
            sheet && "text-foreground",
          )}
        >
          <ChatCircleDots weight="duotone" aria-hidden className="size-3.5 shrink-0" />
          <span className="max-[359px]:hidden">{copy.beta.feedback}</span>
        </button>
      </span>
      {opened && (
        <Suspense fallback={null}>
          <FeedbackSheet open={sheet} onOpenChange={setSheet} />
        </Suspense>
      )}
    </>
  );
}
