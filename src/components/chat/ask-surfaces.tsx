"use client";

import { useEffect, useState } from "react";
import { ArrowUp, ChatCircleText } from "@phosphor-icons/react";
import { Panel, SectionHeading } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { ThinkingOrb } from "@/components/ui/thinking-orb";
import { useCopy } from "@/components/settings-provider";
import { cn } from "@/lib/utils";
import { useLimitOrders } from "@/hooks/use-limit-orders";

/**
 * The board's two ways into Ask besides the header's button. Neither is a
 * real field: each opens the chat sheet, which holds the one composer, so
 * the conversation lives in one place and the keyboard only ever opens
 * there. Home renders them only while the chat is open to this person
 * (useAskAvailable).
 */

/** The field's look, shared by the card and the dock. */
const FIELD =
  "flex w-full items-center gap-2.5 rounded-full border border-input pr-1.5 pl-4 text-left text-[15px] text-muted-foreground outline-none transition-colors duration-150 ease-lift hover:border-foreground/30 focus-visible:ring-3 focus-visible:ring-ring/50";

/** Desktop: a card in the right column, with three things to ask. */
export function AskCard({ onOpen }: { onOpen: (prompt?: string) => void }) {
  const copy = useCopy();
  // Where limit orders are switched on, the buy suggestion waits for a price.
  const limitsOn = useLimitOrders({ poll: false }).enabled;
  const suggestions = limitsOn
    ? copy.askSuggestions.map((prompt, index) => (index === copy.askSuggestions.length - 1 ? copy.askSuggestionLimit : prompt))
    : copy.askSuggestions;
  return (
    <Panel>
      <SectionHeading title={copy.chatTitle} hint={copy.chatWhy} />
      <div className="px-[18px] pb-5 lg:px-6 lg:pb-[22px]">
        <button type="button" onClick={() => onOpen()} aria-label={copy.chatOpenLabel} className={cn(FIELD, "mt-1 h-[46px] bg-card")}>
          <ChatCircleText weight="duotone" className="size-[18px] shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{copy.askPlaceholder}</span>
          {/* The way to send, in ink: the page keeps its one accent for the next step. */}
          <span aria-hidden className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-foreground text-background">
            <ArrowUp weight="bold" className="size-4" />
          </span>
        </button>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {suggestions.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onOpen(prompt)}
              className="h-8 rounded-full border border-border bg-card px-3 text-[13px] text-secondary-foreground outline-none transition-colors duration-150 ease-lift hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {prompt}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] text-muted-foreground">{copy.askFine}</p>
      </div>
    </Panel>
  );
}

/** The card's place while it is not yet known whether Ask is open here. */
export function AskCardPlaceholder() {
  return (
    <Panel className="flex flex-col gap-3 px-[18px] lg:px-6 pt-4 pb-4" aria-hidden>
      <Skeleton className="h-4 w-12" />
      <Skeleton className="h-[46px] w-full rounded-full" />
      <div className="flex gap-1.5">
        <Skeleton className="h-8 w-32 rounded-full" />
        <Skeleton className="h-8 w-32 rounded-full" />
      </div>
      <Skeleton className="h-3 w-48" />
    </Panel>
  );
}

/**
 * Whether an on-screen keyboard has taken the bottom of the viewport. iOS
 * Safari lays a fixed element over the keyboard's top edge instead of
 * moving it, so the dock steps aside while one is up.
 */
function useKeyboardUp(): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    // A pinch zoom shrinks the visual viewport too, so it counts only at
    // scale 1 and while a field has focus, which is when a keyboard is up.
    const update = () => {
      const active = document.activeElement;
      const typing =
        active instanceof HTMLElement &&
        (active.isContentEditable || active.matches("input, textarea, select"));
      setUp(typing && Math.abs(viewport.scale - 1) < 0.01 && window.innerHeight - viewport.height > 120);
    };
    update();
    viewport.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      viewport.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);
  return up;
}

/**
 * Whether any dialog is on screen: a drawer or sheet from anywhere on the
 * page (funds breakdown, settings, the info sheet), including the ones Home
 * does not own the state of. Drawers mount into a portal on open and leave
 * on close, so watching the body's children is enough.
 */
function useDialogOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => setOpen(document.querySelector('[role="dialog"], [role="alertdialog"]') !== null);
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return open;
}

/**
 * Phone: the field docked at the foot of the screen, over the safe area.
 * Hidden from 1024px, where the card holds the same place, and whenever
 * `hidden` (a sheet or an order drawer Home owns is open), any other
 * dialog is open, or a keyboard is up. The
 * page adds the dock's height to its own bottom padding (DOCK_CLEARANCE),
 * so the last thing on it is never under the dock. `busy` while an answer
 * is streaming in the chat: only then does the dock's glyph become an orb.
 */
export function AskDock({ onOpen, hidden, busy = false }: { onOpen: () => void; hidden: boolean; busy?: boolean }) {
  const copy = useCopy();
  const keyboard = useKeyboardUp();
  const dialog = useDialogOpen();
  const gone = hidden || keyboard || dialog;
  return (
    <div
      aria-hidden={gone}
      inert={gone}
      className={cn(
        "fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background px-4 pt-2.5 pb-[max(env(safe-area-inset-bottom),0.625rem)] transition-[transform,opacity] duration-200 ease-lift lg:hidden",
        gone && "pointer-events-none translate-y-full opacity-0",
      )}
    >
      <div className="mx-auto max-w-lg">
        <button type="button" onClick={onOpen} aria-label={copy.chatOpenLabel} className={cn(FIELD, "h-[46px] bg-card")}>
          {/* The chat glyph, and an orb in its 20px place only while an answer is coming in, so the orb's code loads only then. */}
          {busy ? (
            <ThinkingOrb state="composing" size={20} decorative fallback={<ChatCircleText weight="duotone" className="size-5" />} />
          ) : (
            <ChatCircleText weight="duotone" className="size-5 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate">{copy.askPlaceholder}</span>
          <span aria-hidden className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-foreground text-background">
            <ArrowUp weight="bold" className="size-4" />
          </span>
        </button>
        <p className="mt-1.5 text-center text-[11.5px] text-muted-foreground">{copy.askFine}</p>
      </div>
    </div>
  );
}

/** Bottom padding the page keeps on a phone while the dock shows. */
export const DOCK_CLEARANCE = "max-lg:pb-[calc(7rem+env(safe-area-inset-bottom))]";
