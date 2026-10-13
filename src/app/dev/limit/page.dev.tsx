"use client";

import { Suspense, useState } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { WaitingOrdersDrawer, WaitingStripView } from "@/components/board";
import { DepositDrawer, WithdrawDrawer } from "@/components/flow";
import { LimitPlaced, LimitPriceFields, LimitSummary, type OrderMode } from "@/components/flow/limit-price";
import { useMounted } from "@/hooks/use-mounted";
import { useMoney } from "@/components/settings-provider";
import { HOME_CHAIN } from "@/lib/account";
import { TOKEN_LISTINGS } from "@/lib/listings";
import type { LimitExpiry } from "@/lib/limit-orders";
import type { LimitOrderView } from "@/hooks/use-limit-orders";

/**
 * Dev-only limit order gallery (lib/limit-orders): every face of a limit
 * order from fixtures, without a session or a switch. Nothing here can
 * sign: the drawers have no wallet, and the cancel check's button does
 * nothing. Not linked anywhere; 404 in prod.
 *
 *   /dev/limit                       the price fields, the summary, the
 *                                    placed line and the waiting strip
 *   /dev/limit?drawer=buy            the real buy drawer on NVIDIA with
 *                                    Set a price on and $200 filled in
 *   /dev/limit?drawer=sell           the real sell drawer, Sell at $250
 *   /dev/limit?drawer=list           the waiting orders list
 *   /dev/limit?drawer=cancel         the cancel check for the first order
 */
export default function LimitGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full" />}>
      <Gallery />
    </Suspense>
  );
}

const NVDA = TOKEN_LISTINGS.find((listing) => listing.symbol === "NVDA")!;

const WAITING_FIXTURES: LimitOrderView[] = [
  {
    intentTx: "0x01",
    direction: "buy",
    symbol: "NVDA",
    limitPrice: 200,
    expiresAt: null,
    status: "resting",
    inputRaw: "49800000",
    inputDecimals: 6,
    minOutputRaw: "249000000000000000",
    outputDecimals: 18,
    receivedRaw: "0",
    progress: 0,
    paySymbol: "USDC",
    srcChain: HOME_CHAIN,
    placedAt: "2026-09-28T10:00:00.000Z",
    cancelAsked: false,
    fillTx: null,
  },
  {
    intentTx: "0x02",
    direction: "buy",
    symbol: "TSLA",
    limitPrice: 340,
    expiresAt: "2026-10-03T21:59:59.000Z",
    status: "partial",
    inputRaw: "99600000",
    inputDecimals: 6,
    minOutputRaw: "292941176470588236",
    outputDecimals: 18,
    receivedRaw: "117000000000000000",
    progress: 0.4,
    paySymbol: "USDC",
    srcChain: HOME_CHAIN,
    placedAt: "2026-09-27T10:00:00.000Z",
    cancelAsked: false,
    fillTx: "0xf",
  },
  {
    intentTx: "0x03",
    direction: "sell",
    symbol: "AAPL",
    limitPrice: 360,
    expiresAt: null,
    status: "resting",
    inputRaw: "148500000000000000",
    inputDecimals: 18,
    minOutputRaw: "53460000",
    outputDecimals: 6,
    receivedRaw: "0",
    progress: 0,
    paySymbol: "USDC",
    srcChain: HOME_CHAIN,
    placedAt: "2026-09-26T10:00:00.000Z",
    cancelAsked: true,
    fillTx: null,
  },
];

function Gallery() {
  const params = useSearchParams();
  const drawer = params.get("drawer");
  const mounted = useMounted();
  const money = useMoney();
  const [mode, setMode] = useState<OrderMode>("price");
  const [priceText, setPriceText] = useState("200");
  const [expiry, setExpiry] = useState<LimitExpiry>({ kind: "never" });
  const [open, setOpen] = useState(true);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-6">
      <h1 className="font-display text-xl text-foreground">Limit orders</h1>

      <Panel className="flex flex-col gap-3 p-4">
        <LimitPriceFields
          side="buy"
          mode={mode}
          onMode={setMode}
          priceText={priceText}
          onPriceText={setPriceText}
          marketLabel="$215.30"
          expiry={expiry}
          onExpiry={setExpiry}
          tokenOk
          fillsNow={Number(priceText) >= 215.3}
        />
      </Panel>

      <Panel className="p-4">
        <LimitSummary
          side="buy"
          name="NVIDIA"
          priceLabel="$200.00"
          priceAbout={money.aboutAtRate(200)}
          putLabel="$50.00 (50 USDC)"
          getLabel="0.249 NVIDIA"
          feeLabel="0.2 USDC"
          placeLabel="Place order"
          onBack={() => {}}
          onPlace={() => {}}
        />
      </Panel>

      <Panel className="p-4">
        <LimitPlaced name="NVIDIA" priceLabel="$200.00" onDone={() => {}} />
      </Panel>

      <WaitingStripView orders={WAITING_FIXTURES} onOpen={() => setOpen(true)} />

      {mounted && drawer === "buy" && (
        <DepositDrawer listing={NVDA} open={open} onOpenChange={setOpen} prefill={{ usd: 50, limit: { price: 200 } }} devLimit />
      )}
      {mounted && drawer === "sell" && (
        <WithdrawDrawer
          listing={NVDA}
          open={open}
          onOpenChange={setOpen}
          availableShares={250_000_000_000_000_000n}
          srcChainKey={HOME_CHAIN}
          prefill={{ quantity: 0.25, limit: { price: 250 } }}
          devLimit
        />
      )}
      {mounted && (drawer === "list" || drawer === "cancel") && (
        <WaitingOrdersDrawer
          orders={WAITING_FIXTURES}
          open={open}
          onOpenChange={setOpen}
          devCancel={drawer === "cancel" ? WAITING_FIXTURES[0] : undefined}
        />
      )}
    </div>
  );
}
