"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Menu } from "@base-ui/react/menu";
import { Wallet } from "@phosphor-icons/react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { PILL } from "@/components/ui/pill";
import { useCopy } from "@/components/settings-provider";
import type { ConnectorLike, InstalledWallet } from "@/lib/installed-wallets";
import { cn } from "@/lib/utils";

/** A wallet's own mark, or the duotone wallet glyph when it brings none. */
export function WalletMark({ icon, className }: { icon?: string; className?: string }) {
  return icon ? (
    // Wallet icons are wallet-provided URLs, often data: URIs, which
    // next/image does not take.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={icon} alt="" className={cn("size-4 shrink-0 rounded-sm", className)} />
  ) : (
    <Wallet weight="duotone" className={cn("size-4 shrink-0", className)} aria-hidden />
  );
}

/**
 * Above Tailwind's `sm`, where the way in stops being a column, the list is
 * a popover under its pill; below it, a sheet from the bottom edge, where
 * the thumb is. matchMedia because the two are different components, not
 * two styles; the list only opens on a tap, long after this has resolved.
 */
function useWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 40rem)");
    const apply = () => setWide(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return wide;
}

const ROW =
  "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left outline-none transition-colors duration-150 ease-lift";

/**
 * "More wallets (N)": the wallets the way in folds away once more than two
 * are found (lib/installed-wallets splitWalletOffer), so ten extensions
 * never crowd the welcome page. One calm list, a row per wallet with its
 * mark, its name and the families it holds; the whole row connects.
 */
export function MoreWallets<C extends ConnectorLike>({
  wallets,
  onPick,
  disabled = false,
  pendingName,
  className,
}: {
  wallets: InstalledWallet<C>[];
  onPick: (wallet: InstalledWallet<C>) => void;
  disabled?: boolean;
  /** A folded wallet being connected: the pill says so while it waits. */
  pendingName?: string | null;
  className?: string;
}) {
  const copy = useCopy();
  const wide = useWide();
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const label = pendingName ? copy.walletConnecting(pendingName) : copy.moreWallets(wallets.length);
  const families = (wallet: InstalledWallet<C>) =>
    wallet.connectors.map((c) => copy.walletFamilyNames[c.xChainType] ?? c.xChainType).join(", ");
  const pick = (wallet: InstalledWallet<C>) => {
    setOpen(false);
    onPick(wallet);
  };
  const pillClass = cn(PILL, "disabled:opacity-50 data-[popup-open]:bg-secondary", className);

  if (wide) {
    return (
      <Menu.Root open={open} onOpenChange={setOpen}>
        <Menu.Trigger disabled={disabled} className={pillClass}>
          <span className="truncate">{label}</span>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={16} className="z-50">
            <Menu.Popup className="max-h-[min(26rem,var(--available-height))] w-72 origin-[var(--transform-origin)] overflow-y-auto rounded-xl border border-border bg-popover p-1 text-sm text-popover-foreground outline-none transition-[opacity,transform] duration-150 ease-lift data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0">
              <Menu.Group>
                <Menu.GroupLabel className="px-3 pt-2 pb-1 text-[11.5px] text-muted-foreground">
                  {copy.moreWalletsTitle}
                </Menu.GroupLabel>
                {wallets.map((wallet) => (
                  <Menu.Item
                    key={wallet.name}
                    onClick={() => pick(wallet)}
                    className={cn(ROW, "data-[highlighted]:bg-secondary")}
                  >
                    <WalletRow name={wallet.name} icon={wallet.icon} families={families(wallet)} />
                  </Menu.Item>
                ))}
              </Menu.Group>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    );
  }

  // Arrow keys walk the rows, as they do in the popover; Tab still works.
  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    if (rows.length === 0) return;
    event.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (at + 1) % rows.length : (at - 1 + rows.length) % rows.length;
    rows[at === -1 ? 0 : next]?.focus();
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={pillClass}
      >
        <span className="truncate">{label}</span>
      </button>
      <Drawer open={open} onOpenChange={setOpen} swipeDirection="down" showSwipeHandle>
        <DrawerContent>
          <DrawerHeader className="pb-2">
            <DrawerTitle>{copy.moreWalletsTitle}</DrawerTitle>
          </DrawerHeader>
          <div
            ref={listRef}
            role="list"
            onKeyDown={onListKey}
            className="flex min-h-0 flex-col overflow-y-auto px-2 pb-[max(env(safe-area-inset-bottom),1rem)]"
          >
            {wallets.map((wallet) => (
              <div role="listitem" key={wallet.name}>
                <button
                  type="button"
                  onClick={() => pick(wallet)}
                  className={cn(ROW, "hover:bg-secondary focus-visible:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50")}
                >
                  <WalletRow name={wallet.name} icon={wallet.icon} families={families(wallet)} />
                </button>
              </div>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

function WalletRow({ name, icon, families }: { name: string; icon?: string; families: string }) {
  return (
    <>
      <WalletMark icon={icon} className="size-5" />
      <span className="min-w-0 flex-1 truncate text-[14.5px] text-foreground">{name}</span>
      <span className="shrink-0 text-[12.5px] text-muted-foreground">{families}</span>
    </>
  );
}
