"use client";

import { useEffect, useMemo } from "react";
import { Trash } from "@phosphor-icons/react";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";
import { ChatPanel } from "@/components/chat/chat-panel";
import type { ChatDraft } from "@/components/chat/chat-parts";
import { berthChatTransport, useBerthChat, type BerthChat } from "@/components/chat/use-berth-chat";
import { useAccountHeaders, useChatStatus, useProfile } from "@/hooks/use-profile";
import type { ChatStatusResponse } from "@/app/api/chat/status/route";
import { CHAT_UNLOCK_LEVEL, RANKS, rankForXp } from "@/lib/xp";

/**
 * Ask: the assistant inside Berth. A header button beside the info button
 * (Phosphor ChatCircleText), opening a sheet on the shared drawer, so it is
 * a bottom sheet on a phone and a side sheet from `lg`, like the order
 * drawer. The conversation is held here, above the sheet, so closing the
 * sheet to look at a drafted order and coming back finds it as it was.
 *
 * A draft's card only calls `onOpenDraft`: Home closes the sheet, opens
 * the order drawer filled in (the same rule a link from a connected
 * assistant follows, lib/draft-open), and reopens the sheet after.
 */

/** A status guessed from the profile while the real one loads, so a locked account never sees an open composer first. */
function guessStatus(xp: number | undefined): ChatStatusResponse | undefined {
  if (xp === undefined) return undefined;
  const unlock = RANKS[CHAT_UNLOCK_LEVEL - 1];
  const level = rankForXp(xp).level;
  if (level >= CHAT_UNLOCK_LEVEL) return undefined;
  return { state: "locked", level, unlockLevel: CHAT_UNLOCK_LEVEL, unlockRankName: unlock.name, xpToUnlock: Math.max(0, unlock.xp - xp), left: null };
}

export function useAppChat(): { chat: BerthChat; accountKey: string | null } {
  const { key, headers } = useAccountHeaders();
  const transport = useMemo(() => berthChatTransport(), []);
  const chat = useBerthChat({ storageKey: key ? `berth.chat.${key.toLowerCase()}` : null, transport, headers });
  return { chat, accountKey: key };
}


export function ChatSheet({
  chat,
  open,
  onOpenChange,
  onOpenDraft,
}: {
  chat: BerthChat;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenDraft: (draft: ChatDraft) => void;
}) {
  const profile = useProfile();
  const status = useChatStatus(open);
  const shown = status.data ?? guessStatus(profile.data?.xp);
  // Each finished message changes what is left today, and a refusal what
  // the server would say next: ask it again.
  const refetch = status.refetch;
  const settled = chat.status === "ready" || chat.status === "error";
  useEffect(() => {
    if (open && settled && chat.messages.length > 0) void refetch();
  }, [open, settled, chat.messages.length, refetch]);

  return <ChatSheetFrame chat={chat} open={open} onOpenChange={onOpenChange} status={shown} onOpenDraft={onOpenDraft} />;
}

/** The sheet around the panel, with no data of its own: the app and the dev gallery (app/dev/chat) both render it. */
export function ChatSheetFrame({
  chat,
  open,
  onOpenChange,
  status,
  onOpenDraft,
}: {
  chat: BerthChat;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: ChatStatusResponse | undefined;
  onOpenDraft: (draft: ChatDraft) => void;
}) {
  const copy = useCopy();
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="flex h-[calc(100svh-6rem)] min-h-0 flex-col group-data-[swipe-axis=x]/drawer-popup:h-dvh">
          <div className="flex shrink-0 items-start justify-between gap-3 px-4 pt-4 pb-2 group-data-[swipe-axis=x]/drawer-popup:pt-6">
            <div className="flex min-w-0 flex-col gap-0.5">
              <DrawerTitle className="font-display text-lg font-semibold">{copy.chatTitle}</DrawerTitle>
              <DrawerDescription className="text-sm text-muted-foreground">{copy.chatSub}</DrawerDescription>
            </div>
            {chat.messages.length > 0 && (
              <Button variant="ghost" size="sm" className="shrink-0 gap-1 text-muted-foreground" onClick={chat.clear}>
                <Trash className="size-4" />
                {copy.chatClear}
              </Button>
            )}
          </div>
          <ChatPanel chat={chat} status={status} prompts={copy.assistantPrompts} onOpenDraft={onOpenDraft} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * Everything Ask needs, as one component Home loads on first open
 * (next/dynamic), so the AI SDK stays out of the page everyone loads. It
 * stays mounted after that, which keeps the conversation while the sheet
 * is closed for a drafted order.
 */
export default function ChatHost({
  open,
  onOpenChange,
  onOpenDraft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenDraft: (draft: ChatDraft) => void;
}) {
  const { chat } = useAppChat();
  return <ChatSheet chat={chat} open={open} onOpenChange={onOpenChange} onOpenDraft={onOpenDraft} />;
}
