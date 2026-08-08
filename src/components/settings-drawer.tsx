"use client";

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
import { useAwardTheme } from "@/hooks/use-profile";

/**
 * The back room: pick a mode (the app's whole personality — skin AND voice)
 * and a display currency. Both persist per browser. Controlled from outside;
 * the pantry owns the way in.
 */
export function SettingsDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const copy = useCopy();
  const { mode, setMode } = useMode();
  const { currency, setCurrency } = useCurrency();
  const awardTheme = useAwardTheme();

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
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
              {/* Name and swatch only — no blurb. What a mode does to the
                  place is the surprise; explaining it here would spoil it. */}
              <div className="grid grid-cols-2 gap-2">
                {MODES.map((meta) => {
                  const selected = meta.id === mode;
                  return (
                    <button
                      key={meta.id}
                      type="button"
                      onClick={() => {
                        setMode(meta.id);
                        // First taste of a mode earns a sip of XP; the server
                        // pays each theme once per account, so this can fire
                        // on every tap without being farmable.
                        if (meta.id !== mode) awardTheme.mutate(meta.id);
                      }}
                      aria-pressed={selected}
                      className={cn(
                        "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-[transform,background-color,border-color,box-shadow,color] duration-150 ease-lift active:scale-[0.97]",
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
                            className="h-6 w-3"
                            style={{ background: color }}
                          />
                        ))}
                      </span>
                      <span className="min-w-0 truncate text-[13px] font-bold text-foreground">
                        {meta.label}
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
                      "money min-h-9 rounded-full border px-3.5 text-[13px] font-bold transition-[transform,background-color,border-color,color] duration-150 ease-lift active:scale-[0.96]",
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
  );
}
