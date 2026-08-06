"use client";

import { useState } from "react";
import { GearSix } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  useCopy,
  useCurrency,
  useMode,
} from "@/components/settings-provider";
import { MODES } from "@/lib/copy";
import { CURRENCIES } from "@/lib/currencies";
import { cn } from "@/lib/utils";

/**
 * Header gear + the back room: pick a mode (the app's whole personality —
 * skin AND voice) and a display currency. Both persist per browser.
 */
export function SettingsDrawer() {
  const [open, setOpen] = useState(false);
  const copy = useCopy();
  const { mode, setMode } = useMode();
  const { currency, setCurrency } = useCurrency();

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Settings"
        className="shrink-0"
        onClick={() => setOpen(true)}
      >
        <GearSix className="size-5" />
      </Button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{copy.settingsTitle}</DrawerTitle>
            <DrawerDescription>{copy.settingsSub}</DrawerDescription>
          </DrawerHeader>

          <div className="flex max-h-[65cqh] flex-col gap-5 overflow-y-auto p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <section className="flex flex-col gap-2">
              <h3 className="text-[11.5px] font-bold tracking-(--tracking-caps) uppercase text-muted-foreground">
                {copy.modeSectionLabel}
              </h3>
              <div className="grid grid-cols-1 gap-2">
                {MODES.map((meta) => {
                  const selected = meta.id === mode;
                  return (
                    <button
                      key={meta.id}
                      type="button"
                      onClick={() => setMode(meta.id)}
                      aria-pressed={selected}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                        selected
                          ? "border-primary ring-2 ring-primary/40"
                          : "border-border hover:border-primary/40",
                      )}
                    >
                      {/* Swatches are literals from the registry: a card must
                          preview a mode that is not active, so the live CSS
                          variables are exactly the wrong source. */}
                      <span
                        className="flex shrink-0 overflow-hidden rounded-md border border-border/60"
                        aria-hidden
                      >
                        {meta.swatch.map((color, index) => (
                          <span
                            key={index}
                            className="h-7 w-3.5"
                            style={{ background: color }}
                          />
                        ))}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="text-sm font-bold text-foreground">
                          {meta.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {meta.blurb}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-[11.5px] font-bold tracking-(--tracking-caps) uppercase text-muted-foreground">
                {copy.currencySectionLabel}
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {CURRENCIES.map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setCurrency(code)}
                    aria-pressed={code === currency}
                    className={cn(
                      "money min-h-9 rounded-full border px-3.5 text-[13px] font-bold transition-colors",
                      code === currency
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                    )}
                  >
                    {code}
                  </button>
                ))}
              </div>
            </section>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
