"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useCopy } from "@/components/settings-provider";
import { FEE_PCT_LABEL } from "@/lib/sodax-config";
import { toast } from "@/lib/toast";

/**
 * The terms, asked once per version (lib/terms-gate,
 * lib/server/terms-acceptance): the short version, links to both pages and
 * Accept. Before a buy, the way out is Not now, and the buy waits; before a
 * sell, the way out is to sell without accepting. It never stands between
 * a person and their money leaving.
 */
export function TermsSheet({
  open,
  purpose,
  onAccept,
  onLeave,
  pending = false,
}: {
  open: boolean;
  purpose: "buy" | "sell";
  /** The account's answer is on its way: the short version shows, quietly, and the buttons wait. */
  pending?: boolean;
  /** Records the yes; true once saved. */
  onAccept: () => Promise<boolean>;
  /** Not now (buy) or sell without accepting (sell), and any other close. */
  onLeave: () => void;
}) {
  const copy = useCopy().termsSheet;
  const [saving, setSaving] = useState(false);
  const accept = async () => {
    setSaving(true);
    const saved = await onAccept().catch(() => false);
    setSaving(false);
    if (!saved) toast.error(copy.failed);
  };
  return (
    <Drawer open={open} onOpenChange={(next) => !next && onLeave()}>
      <DrawerContent data-testid="terms-sheet">
        <DrawerHeader>
          <DrawerTitle>{copy.title}</DrawerTitle>
          <DrawerDescription>{copy.lede}</DrawerDescription>
        </DrawerHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-[max(env(safe-area-inset-bottom),1rem)] *:shrink-0">
          <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] leading-relaxed text-foreground marker:text-muted-foreground">
            {copy.summary(FEE_PCT_LABEL).map((line) => (
              <li key={line} className="pl-1">
                {line}
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            {copy.read}{" "}
            <Link href="/terms" target="_blank" className="text-foreground underline underline-offset-4">
              {copy.terms}
            </Link>
            {" · "}
            <Link href="/privacy" target="_blank" className="text-foreground underline underline-offset-4">
              {copy.privacy}
            </Link>
          </p>
          <div className="flex flex-col gap-2 pt-1">
            {pending ? (
              <div className="flex h-9 items-center justify-center text-muted-foreground" data-testid="terms-sheet-pending">
                <Spinner className="size-5" />
              </div>
            ) : (
              <Button size="lg" onClick={accept} disabled={saving}>
                {copy.accept}
              </Button>
            )}
            <Button size="lg" variant="ghost" className="text-muted-foreground" onClick={onLeave} disabled={saving}>
              {purpose === "buy" ? copy.notNow : copy.continueSell}
            </Button>
          </div>
          <p className="text-center text-xs text-muted-foreground">{purpose === "buy" ? copy.buyNote : copy.sellNote}</p>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
