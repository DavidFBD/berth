"use client";

import { Desktop, Moon, Sun } from "@phosphor-icons/react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  useAppearance,
  useCopy,
  useCurrency,
} from "@/components/settings-provider";
import { APPEARANCE_IDS, type AppearanceId } from "@/lib/appearance";
import { CURRENCIES } from "@/lib/currencies";
import { cn } from "@/lib/utils";
import { useAwardTheme } from "@/hooks/use-profile";

const APPEARANCE_ICONS: Record<AppearanceId, typeof Sun> = {
  system: Desktop,
  light: Sun,
  dark: Moon,
};

/**
 * The back room: pick an appearance (system, light, or dark) and a display
 * currency. Both persist per browser. Controlled from outside; the account
 * drawer owns the way in.
 */
export function SettingsDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const copy = useCopy();
  const { appearance, setAppearance } = useAppearance();
  const { currency, setCurrency } = useCurrency();
  const awardTheme = useAwardTheme();

  const appearanceLabel: Record<AppearanceId, string> = {
    system: copy.appearanceSystem,
    light: copy.appearanceLight,
    dark: copy.appearanceDark,
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{copy.settingsTitle}</DrawerTitle>
            <DrawerDescription>{copy.settingsSub}</DrawerDescription>
          </DrawerHeader>

          <div className="flex max-h-[65svh] flex-col gap-5 overflow-y-auto p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <section className="flex flex-col gap-2">
              <h3
                id="appearance-label"
                className="text-[11.5px] font-bold tracking-(--tracking-caps) uppercase text-muted-foreground"
              >
                {copy.appearanceSectionLabel}
              </h3>
              <div
                role="radiogroup"
                aria-labelledby="appearance-label"
                className="grid grid-cols-3 gap-2"
              >
                {APPEARANCE_IDS.map((id) => {
                  const selected = id === appearance;
                  const Icon = APPEARANCE_ICONS[id];
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setAppearance(id);
                        // First taste of an appearance earns a sip of XP; the
                        // server pays each one once per account, so this can
                        // fire on every tap without being farmable.
                        if (id !== appearance) awardTheme.mutate(id);
                      }}
                      role="radio"
                      aria-checked={selected}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-xl border px-3 py-2.5 transition-[transform,background-color,border-color,box-shadow,color] duration-150 ease-lift active:scale-[0.97]",
                        selected
                          ? "border-primary ring-2 ring-primary/40"
                          : "border-border hover:border-primary/40",
                      )}
                    >
                      <Icon className="size-5 text-foreground" aria-hidden />
                      <span className="truncate text-[13px] font-bold text-foreground">
                        {appearanceLabel[id]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <h3
                id="currency-label"
                className="text-[11.5px] font-bold tracking-(--tracking-caps) uppercase text-muted-foreground"
              >
                {copy.currencySectionLabel}
              </h3>
              <div
                role="radiogroup"
                aria-labelledby="currency-label"
                className="flex flex-wrap gap-1.5"
              >
                {CURRENCIES.map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setCurrency(code)}
                    role="radio"
                    aria-checked={code === currency}
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
