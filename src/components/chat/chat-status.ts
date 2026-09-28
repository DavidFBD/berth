"use client";

import { useEffect } from "react";
import { useChatStatus, useProfile } from "@/hooks/use-profile";
import { useStoredChoice } from "@/hooks/use-stored-choice";
import type { ChatStatusResponse } from "@/app/api/chat/status/route";
import { CHAT_UNLOCK_LEVEL, RANKS, rankForXp } from "@/lib/xp";

/**
 * What Ask would say before anything is sent, kept out of the chat sheet's
 * module so the board can ask it without loading the AI SDK.
 */

/** A status guessed from the profile while the real one loads, so a locked account never sees an open composer first. */
export function guessStatus(xp: number | undefined): ChatStatusResponse | undefined {
  if (xp === undefined) return undefined;
  const unlock = RANKS[CHAT_UNLOCK_LEVEL - 1];
  const level = rankForXp(xp).level;
  if (level >= CHAT_UNLOCK_LEVEL) return undefined;
  return { state: "locked", level, unlockLevel: CHAT_UNLOCK_LEVEL, unlockRankName: unlock.name, xpToUnlock: Math.max(0, unlock.xp - xp), left: null };
}

/** The last answer, per browser, so a reload lays the board out as it was. */
const REMEMBERED_KEY = "berth.ask.available";

/**
 * Whether the board shows its Ask surfaces (the card, the phone's docked
 * field): only once the server says the chat is open for this person, or,
 * while it has not answered, when the profile is past the unlock rung.
 * Locked, closed for the day or the month, or closed for everyone, the
 * header's Ask stays and opens the sheet, which says why in words.
 *
 * Undefined while neither has answered: the last answer this browser saw
 * stands in when there is one, so the card's place does not appear and
 * vanish under a returning reader; with none, the board reserves it.
 */
export function useAskAvailable(): boolean | undefined {
  const profile = useProfile();
  const status = useChatStatus(Boolean(profile.data));
  const [remembered, remember] = useStoredChoice(REMEMBERED_KEY);
  const live = status.data
    ? status.data.state === "open"
    : profile.data
      ? guessStatus(profile.data.xp) === undefined
      : undefined;
  // Only the server's own answer is worth remembering.
  const settled = status.data ? status.data.state === "open" : undefined;
  useEffect(() => {
    if (settled === undefined) return;
    const next = settled ? "1" : "0";
    if (remembered !== next) remember(next);
  }, [settled, remembered, remember]);
  if (live !== undefined) return live;
  return remembered === null ? undefined : remembered === "1";
}
