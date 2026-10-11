"use client";

import { lazy, Suspense, useState } from "react";
import { useCopy } from "@/components/settings-provider";
import type { FeedbackOrderKind } from "@/lib/feedback";

/**
 * The sheet loads on the first tap, not with the order drawer: it reads the
 * account (hooks/use-profile), which the order screens never need, and most
 * orders never go wrong.
 */
const FeedbackSheet = lazy(() => import("@/components/feedback/feedback-sheet").then((module) => ({ default: module.FeedbackSheet })));

/**
 * The one quiet link under an order that failed or whose outcome is
 * unclear: "Something feel off? Tell us.", opening the sheet with that
 * order's kind, and its hub transaction for the server to find the order's
 * own id (never stored itself).
 */
export function OrderFeedbackLink({ kind, hubTxHash, className }: { kind: FeedbackOrderKind; hubTxHash?: string; className?: string }) {
  const words = useCopy().feedback;
  const [open, setOpen] = useState(false);
  // Kept mounted once opened, so it can animate closed.
  const [opened, setOpened] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpened(true);
          setOpen(true);
        }}
        className={
          className ??
          "self-center text-xs text-muted-foreground underline underline-offset-2 transition-colors duration-150 ease-lift hover:text-foreground"
        }
      >
        {words.orderLink}
      </button>
      {opened && (
        <Suspense fallback={null}>
          <FeedbackSheet open={open} onOpenChange={setOpen} order={{ kind, ref: hubTxHash ?? null }} />
        </Suspense>
      )}
    </>
  );
}
