"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
import { formatUnits } from "viem";
import { CaretRight, Hourglass } from "@phosphor-icons/react";
import type { SpokeChainKey } from "@sodax/sdk";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useCopy, useMoney } from "@/components/settings-provider";
import { HOME_CHAIN } from "@/lib/account";
import { formatTokenAmount, formatUsd } from "@/lib/format";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { cn } from "@/lib/utils";
import { waitingUsd } from "@/lib/limit-orders";
import { useListingPrices } from "@/hooks/use-listing-prices";
import {
  useAnnounceClosings,
  useCancelWaitingOrder,
  useLimitOrders,
  usePendingLimits,
  type LimitOrderView,
} from "@/hooks/use-limit-orders";
import { useVaultWallet } from "@/hooks/use-vault-wallet";
import { useSignGasCheck } from "@/hooks/use-gas-gate";

/**
 * Waiting orders (lib/limit-orders): a thin line under the account total,
 * only while the person has a limit order resting or partly filled, and
 * the list it opens, with fill progress and one-signature Cancel. Nothing
 * at all when there are none or the switch is off. The line also owns the
 * one-time announcement of an order that filled or expired while the page
 * was away (useAnnounceClosings).
 */
export function WaitingOrders() {
  const copy = useCopy();
  const limits = useLimitOrders();
  useAnnounceClosings(limits.orders);
  const unsaved = usePendingLimits(limits.orders, limits.enabled);
  const [open, setOpen] = useState(false);
  // Shown whenever an order waits, even after the switch is turned off, so none is ever stranded.
  if (!waitingOrdersShow(limits.waiting.length, unsaved.length)) return null;
  return (
    <>
      {unsaved.length > 0 && <p className="px-1 text-xs text-muted-foreground" data-testid="limit-unsaved">{copy.limitUnsaved}</p>}
      {limits.waiting.length > 0 && <WaitingStripView orders={limits.waiting} onOpen={() => setOpen(true)} />}
      <WaitingOrdersDrawer orders={limits.waiting} open={open} onOpenChange={setOpen} />
    </>
  );
}

const waitingOrdersShow = (waitingCount: number, unsavedCount: number) => waitingCount > 0 || unsavedCount > 0;

/**
 * Whether the waiting-orders strip is showing right now, without mounting
 * `useAnnounceClosings` a second time. Shared with the email nudge's
 * priority (lib/email-nudge): this strip outranks it, since it is about
 * money already in motion.
 */
export function useWaitingOrdersShowing(): boolean {
  const limits = useLimitOrders();
  const unsaved = usePendingLimits(limits.orders, limits.enabled);
  return waitingOrdersShow(limits.waiting.length, unsaved.length);
}

const nameOf = (symbol: string) => TOKEN_LISTINGS.find((listing) => listing.symbol === symbol)?.name ?? symbol;

/** The line: "Waiting orders · NVIDIA at $200.00 · Tesla at $340.00 · 1 partly filled". */
export function WaitingStripView({ orders, onOpen }: { orders: readonly LimitOrderView[]; onOpen: () => void }) {
  const copy = useCopy();
  const money = useMoney();
  const prices = useListingPrices();
  const waiting = waitingUsd(orders, (symbol) => {
    const listing = TOKEN_LISTINGS.find((entry) => entry.symbol === symbol);
    return listing ? prices.priceOf(listing) : undefined;
  });
  const partial = orders.filter((order) => order.status === "partial").length;
  const items = orders.map((order) => copy.limitStripItem(nameOf(order.symbol), formatUsd(order.limitPrice)));
  if (partial > 0) items.push(copy.limitStripPartial(partial));
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="waiting-strip"
      data-ph-mask
      className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-border bg-card py-2.5 pr-4 pl-[18px] text-left lg:pl-5 outline-none transition-[transform,background-color] duration-150 ease-lift hover:bg-muted active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Hourglass weight="duotone" className="size-[17px] shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-[13.5px] text-secondary-foreground">
        <span className="money font-medium text-foreground tabular-nums">
          {waiting.usd > 0 ? copy.limitStripLead(money.format(waiting.usd)) : copy.limitWaitingTitle}
        </span>
        {items.map((item) => (
          <span key={item}>
            <span aria-hidden className="px-1.5 text-muted-foreground">·</span>
            <span className="money tabular-nums">{item}</span>
          </span>
        ))}
      </span>
      <CaretRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

function setAsideLabel(order: LimitOrderView, format: (usd: number) => string): string {
  const raw = BigInt(order.inputRaw);
  if (order.direction === "buy") {
    // v1 buys are paid in dollar coins (lib/limit-orders limitTokenOk),
    // so the coins' amount is their worth in dollars.
    return format(Number(formatUnits(raw, order.inputDecimals)));
  }
  return `${formatTokenAmount(raw, order.inputDecimals, 6)} ${nameOf(order.symbol)}`;
}

function untilLabel(order: LimitOrderView, copy: ReturnType<typeof useCopy>): string {
  if (!order.expiresAt) return copy.limitRowUntilCancelled;
  const day = new Date(order.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return copy.limitRowUntil(day);
}

/** One waiting order: what, at what price, how much set aside, how far filled, and Cancel. */
function WaitingRow({ order, onCancel }: { order: LimitOrderView; onCancel: () => void }) {
  const copy = useCopy();
  const money = useMoney();
  const name = nameOf(order.symbol);
  // The limit price stays in dollars, the currency the order fires on;
  // a quiet line beneath gives it in the display currency.
  const price = formatUsd(order.limitPrice);
  const priceAbout = money.aboutAtRate(order.limitPrice);
  const percent = Math.round(order.progress * 100);
  return (
    <li className="flex flex-col gap-2 px-[18px] lg:px-6 py-3" data-testid="waiting-row">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-medium text-foreground">
          {order.direction === "buy" ? copy.limitRowBuy(name) : copy.limitRowSell(name)}
        </span>
        <span className="money shrink-0 text-sm text-foreground tabular-nums">
          {order.direction === "buy" ? copy.limitRowAtBuy(price) : copy.limitRowAtSell(price)}
        </span>
      </div>
      {priceAbout && (
        <p className="-mt-1.5 self-end text-xs text-muted-foreground tabular-nums">{priceAbout}</p>
      )}
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="money tabular-nums">{copy.limitRowSetAside(setAsideLabel(order, money.format))}</span>
        <span>{untilLabel(order, copy)}</span>
      </div>
      <div className="flex items-center gap-2.5">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-foreground/60" style={{ width: `${percent}%` }} />
        </div>
        <span className="money shrink-0 text-xs text-muted-foreground tabular-nums">
          {percent > 0 ? copy.limitRowFilled(`${percent}%`) : copy.limitRowNotFilled}
        </span>
      </div>
      {order.cancelAsked ? (
        <p className="text-xs text-muted-foreground">{copy.limitRowCancelAsked}</p>
      ) : (
        <Button variant="outline" size="sm" className="self-start" onClick={onCancel}>
          {copy.limitCancel}
        </Button>
      )}
    </li>
  );
}

/** The list as drawn, for Home's drawer and the dev gallery. */
export function WaitingListView({ orders, onCancel }: { orders: readonly LimitOrderView[]; onCancel: (order: LimitOrderView) => void }) {
  return (
    <ul className="divide-y divide-border" data-testid="waiting-list" data-ph-mask>
      {orders.map((order) => (
        <WaitingRow key={order.intentTx} order={order} onCancel={() => onCancel(order)} />
      ))}
    </ul>
  );
}

export function WaitingOrdersDrawer({
  orders,
  open,
  onOpenChange,
  devCancel,
}: {
  orders: readonly LimitOrderView[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dev galleries only: open on the cancel check for this order, and never sign. */
  devCancel?: LimitOrderView;
}) {
  const copy = useCopy();
  const [cancelling, setCancelling] = useState<LimitOrderView | null>(devCancel ?? null);
  const prices = useListingPrices();
  const unpriced = !waitingUsd(orders, (symbol) => {
    const listing = TOKEN_LISTINGS.find((entry) => entry.symbol === symbol);
    return listing ? prices.priceOf(listing) : undefined;
  }).priced;
  const [busy, setBusy] = useState(false);
  const change = (next: boolean) => {
    if (busy) return;
    onOpenChange(next);
    if (!next) setCancelling(null);
  };
  return (
    <Drawer open={open} onOpenChange={change} disablePointerDismissal={busy}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{copy.limitWaitingTitle}</DrawerTitle>
          <DrawerDescription>{copy.limitListSub}</DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto pb-4">
          {cancelling ? (
            devCancel ? (
              <CancelCheckView order={cancelling} busy={false} onKeep={() => setCancelling(null)} onConfirm={() => {}} />
            ) : (
              <CancelCheck
                order={cancelling}
                onBusy={setBusy}
                onDone={() => setCancelling(null)}
              />
            )
          ) : (
            <>
              <WaitingListView orders={orders} onCancel={setCancelling} />
              {!unpriced ? null : <p className="px-[18px] lg:px-6 pt-2 text-xs text-muted-foreground">{copy.limitUnpricedNote}</p>}
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * The cancel check, and the one signature. Mounted only for the order
 * being cancelled, so the wallet hook asks for the one chain that signs:
 * the paying chain for a buy, the home chain for a sell from the account.
 */
function CancelCheck({ order, onBusy, onDone }: { order: LimitOrderView; onBusy: (busy: boolean) => void; onDone: () => void }) {
  const copy = useCopy();
  const chainKey = (order.direction === "sell" ? HOME_CHAIN : (order.srcChain ?? HOME_CHAIN)) as SpokeChainKey;
  const wallet = useVaultWallet(chainKey);
  const cancel = useCancelWaitingOrder();
  // Said before the tap: a wallet that cannot pay the cancel's fee is told
  // how much to add and the button waits (hooks/use-gas-gate).
  const gasNote = useSignGasCheck({ chainKey, address: wallet.address, enabled: true, order: "sell", purpose: "cancel" });
  const confirm = async () => {
    if (!wallet.walletProvider || !wallet.address) return;
    onBusy(true);
    try {
      if (wallet.ensureReady && (await wallet.ensureReady()) !== "ready") {
        toast.error(copy.limitCancelFailed);
        return;
      }
      const outcome = await cancel.mutateAsync({ order, walletProvider: wallet.walletProvider, address: wallet.address });
      if (outcome.ok) {
        toast.success(copy.limitCancelledToast, { description: order.direction === "buy" ? copy.limitRefundBuy : copy.limitRefundSell });
        onDone();
      } else if (outcome.rejected || outcome.calm) {
        toast(outcome.message);
      } else {
        toast.error(outcome.message);
      }
    } catch {
      toast.error(copy.limitCancelFailed);
    } finally {
      onBusy(false);
    }
  };
  return (
    <CancelCheckView
      order={order}
      busy={cancel.isPending}
      ready={!!wallet.walletProvider && !!wallet.address}
      gasNote={gasNote}
      onKeep={onDone}
      onConfirm={() => void confirm()}
    />
  );
}

export function CancelCheckView({
  order,
  busy,
  ready = true,
  gasNote = null,
  onKeep,
  onConfirm,
}: {
  order: LimitOrderView;
  busy: boolean;
  ready?: boolean;
  /** The wallet cannot pay the cancel's fee: this guidance shows and the button waits. */
  gasNote?: string | null;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  const copy = useCopy();
  return (
    <div className="flex flex-col gap-4 px-4" data-testid="cancel-check" data-ph-mask>
      <div className="flex flex-col gap-1">
        <p className="font-display text-lg text-foreground">{copy.limitCancelConfirm(nameOf(order.symbol))}</p>
        <p className="text-sm text-muted-foreground">
          {order.direction === "buy" ? copy.limitCancelBodyBuy : copy.limitCancelBodySell}
        </p>
      </div>
      {gasNote && (
        <p className="text-sm text-muted-foreground" data-testid="cancel-gas-note">
          {gasNote}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <Button className={cn("h-12 w-full text-base")} disabled={busy || !ready || !!gasNote} onClick={onConfirm}>
          {busy && <Spinner className="size-4" />}
          {busy ? copy.limitCancelling : copy.limitCancel}
        </Button>
        <Button variant="ghost" className="h-10 w-full" disabled={busy} onClick={onKeep}>
          {copy.limitCancelKeep}
        </Button>
      </div>
    </div>
  );
}
