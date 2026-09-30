"use client";

import { BerthMark } from "@/components/berth-mark";
import { NotHereCard } from "@/components/availability/availability";
import { useCopy } from "@/components/settings-provider";
import type { Availability } from "@/lib/availability";

/**
 * The consent screen where Berth is not available: the same card as the
 * welcome page, and a plain line that nothing was connected.
 */
export function AuthorizeUnavailable({ availability }: { availability: Availability }) {
  const copy = useCopy().unavailable;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[34rem] flex-col items-center justify-center gap-5 px-4 py-10">
      <BerthMark className="size-10" title="Berth" />
      <p className="text-center text-sm text-muted-foreground">{copy.authorizeBody}</p>
      <NotHereCard availability={availability} anonymous={false} />
    </main>
  );
}
