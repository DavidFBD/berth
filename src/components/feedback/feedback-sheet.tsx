"use client";

import { useState } from "react";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useCopy } from "@/components/settings-provider";
import { FeedbackForm, type FeedbackFixture } from "@/components/feedback/feedback-form";
import type { FeedbackOrder } from "@/lib/feedback";

/**
 * The feedback sheet: a short title, the intro (Berth is new, then what to
 * write), the form, and the support address in one small line for anyone
 * who would rather write an email. A
 * bottom sheet on a phone, a side sheet on a desktop, like every drawer.
 * Rendered where it is opened from, so opened inside another drawer (an
 * order that went wrong) it nests in that drawer rather than fighting it.
 * Each opening starts a fresh form.
 */
export function FeedbackSheet({
  open,
  onOpenChange,
  order = null,
  fixture,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order?: FeedbackOrder | null;
  fixture?: FeedbackFixture;
}) {
  const copy = useCopy();
  const words = copy.feedback;
  const [round, setRound] = useState(0);
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setRound((value) => value + 1);
      }}
    >
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{words.title}</DrawerTitle>
          <DrawerDescription>
            {copy.beta.body} {words.intro}
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <FeedbackForm key={round} order={order} fixture={fixture} onClose={() => onOpenChange(false)} />
          <p className="mt-4 text-center text-xs text-muted-foreground">
            {words.writeTo}{" "}
            <a href={copy.beta.contactHref} className="font-medium text-foreground underline underline-offset-2 hover:text-muted-foreground">
              {copy.beta.contactLabel}
            </a>
          </p>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
