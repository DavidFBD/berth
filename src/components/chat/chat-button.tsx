"use client";

import { ChatCircleText } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";

/** The header button that opens Ask. Light on purpose: the chat itself loads on first open. */
export function ChatButton({ onOpen }: { onOpen: () => void }) {
  const copy = useCopy();
  return (
    <Button variant="ghost" size="sm" aria-label={copy.chatOpenLabel} className="shrink-0 gap-1 px-2 text-sm" onClick={onOpen}>
      <ChatCircleText className="size-5" />
      {/* A wallet account's bar carries two pills; on a phone the word gives way to the icon so nothing leaves the screen. */}
      <span className="max-[430px]:group-has-[[data-wallet-pill]]/bar:sr-only">{copy.chatOpen}</span>
    </Button>
  );
}
