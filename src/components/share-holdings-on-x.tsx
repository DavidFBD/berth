"use client";

import { useState } from "react";
import { CheckSquare, Square } from "@phosphor-icons/react";
import { buttonVariants, Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useCopy } from "@/components/settings-provider";
import { XMark } from "@/components/x-mark";
import { useCampaignProgress } from "@/hooks/use-profile";
import { track } from "@/lib/analytics";
import { inviteLink } from "@/lib/referral";
import { cn } from "@/lib/utils";
import { holdingsXWords, xPostIntent } from "@/lib/x-intent";

/**
 * "Share what you hold on X": a quiet link under What you own, and the
 * small sheet it opens. The person ticks which holdings to name (all of
 * them to begin with), sees the exact words, and X's own composer opens in
 * a new tab with those words and their invite link. Nothing here is
 * automatic or prompted, Berth calls no X API, and nothing is given for the
 * tap or the post (X's developer policy, and Berth's own rule). The post
 * names holdings by name only: no amount, value, price or return. The
 * names never reach analytics either; only that the sheet sent someone on.
 */
export function ShareHoldingsOnX({
  names,
  code,
  defaultOpen = false,
}: {
  /** The held listings' row names, in the list's order. */
  names: readonly string[];
  /** The person's own invite code. */
  code: string;
  /** Dev gallery only: the sheet open on arrival. */
  defaultOpen?: boolean;
}) {
  const copy = useCopy();
  const [open, setOpen] = useState(defaultOpen);
  // Each opening starts from "all ticked": the sheet is keyed on it.
  const [round, setRound] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setRound((n) => n + 1);
          setOpen(true);
        }}
        className="inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground/40"
      >
        <XMark className="size-3" />
        {copy.holdingsXShare}
      </button>
      <Drawer open={open} onOpenChange={setOpen}>
        <ShareSheet key={round} open={open} names={names} code={code} onDone={() => setOpen(false)} />
      </Drawer>
    </>
  );
}

function ShareSheet({ open, names, code, onDone }: { open: boolean; names: readonly string[]; code: string; onDone: () => void }) {
  const copy = useCopy();
  const sheet = copy.holdingsXSheet;
  // Asked only while the sheet is open; not known yet reads as live, so the disclosure stays.
  const campaign = useCampaignProgress(open);
  const live = campaign.data === undefined ? undefined : campaign.data !== null && campaign.data.open;
  const [left, setLeft] = useState<ReadonlySet<string>>(() => new Set());
  const chosen = names.filter((name) => !left.has(name));
  const words = holdingsXWords(copy, chosen, live);
  const link = inviteLink(code);
  const toggle = (name: string) =>
    setLeft((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <DrawerContent data-testid="share-holdings-sheet" data-ph-mask>
      <DrawerHeader>
        <DrawerTitle>{sheet.title}</DrawerTitle>
        <DrawerDescription>{sheet.lede}</DrawerDescription>
      </DrawerHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-[max(env(safe-area-inset-bottom),1rem)] *:shrink-0">
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-muted-foreground">{sheet.choose}</legend>
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {names.map((name) => {
              const on = !left.has(name);
              return (
                <li key={name}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(name)}
                    className="flex min-h-11 w-full items-center gap-3 px-3.5 text-left text-[15px] text-foreground"
                  >
                    {on ? (
                      <CheckSquare weight="duotone" className="size-5 shrink-0 text-foreground" aria-hidden />
                    ) : (
                      <Square weight="duotone" className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className="truncate">{name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </fieldset>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{sheet.preview}</p>
          <div className="rounded-2xl bg-muted px-3.5 py-3 text-[15px] leading-relaxed" aria-live="polite">
            {words ? (
              <>
                <p className="text-foreground">{words}</p>
                <p className="mt-1 break-all text-muted-foreground">{link}</p>
              </>
            ) : (
              <p className="text-muted-foreground">{sheet.none}</p>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2 pt-1">
          {words ? (
            <a
              href={xPostIntent(words, link)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                track("invite_link_shared", { surface: "holdings_x" });
                onDone();
              }}
              className={cn(buttonVariants({ size: "lg" }), "gap-2")}
            >
              <XMark className="size-3.5" />
              {sheet.open}
            </a>
          ) : (
            <Button size="lg" disabled>
              <XMark className="size-3.5" />
              {sheet.open}
            </Button>
          )}
          <Button size="lg" variant="ghost" className="text-muted-foreground" onClick={onDone}>
            {sheet.notNow}
          </Button>
        </div>
      </div>
    </DrawerContent>
  );
}
