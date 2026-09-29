"use client";

import { ChatCircleText } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";

/**
 * The header button that opens Ask while the Assistant is still locked, as
 * a ghost pill so the board keeps its one accent. Light on
 * purpose: the chat itself loads on first open. Shown whatever the chat's
 * state, so a locked account learns from the sheet what opens it.
 */
export function ChatButton({ onOpen }: { onOpen: () => void }) {
  const copy = useCopy();
  return (
    <Button size="sm" variant="outline" aria-label={copy.chatOpenLabel} className="h-8 shrink-0 gap-1.5 rounded-full px-3 text-sm" onClick={onOpen}>
      <ChatCircleText weight="duotone" className="size-[18px]" />
      {/* A wallet account's bar carries two pills; on a phone the word gives way to the icon so nothing leaves the screen. */}
      <span className="max-[430px]:group-has-[[data-wallet-pill]]/bar:sr-only">{copy.chatOpen}</span>
    </Button>
  );
}
