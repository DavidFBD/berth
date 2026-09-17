"use client";

import { useState } from "react";
import { CaretRight, GasPump, Wallet } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { TokenLogo } from "@/components/flow/token-picker";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import {
  useEmbeddedHoldings,
  type EmbeddedHoldingsResult,
} from "@/hooks/use-embedded-holdings";
import { getChainName, getNativeGasToken } from "@/lib/chains";
import { formatTokenAmount } from "@/lib/format";
import { useCopy, useMoney } from "@/components/settings-provider";

/**
 * The funds header module: idle money waiting to be spent. Email users see
 * what it is worth (embedded-wallet holdings valued by the money market
 * oracle) and can open the breakdown drawer, showing each asset, the network
 * it sits on, and whether that network has enough native gas to actually
 * move it. Everyone else gets the account-state copy.
 */
export function FundsModule({ onTopUp }: { onTopUp: () => void }) {
  const privy = usePrivyEmbeddedWallet();
  const signedIn = privy.enabled && privy.authenticated;
  const embedded = useEmbeddedHoldings();
  const { emailMode, isLoading, holdings, erroredChains, gasShortChains, totalUsd } =
    embedded;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const copy = useCopy();
  const money = useMoney();

  const worth = emailMode && !isLoading && totalUsd !== undefined;
  // Anything to investigate? Holdings, or networks we couldn't read.
  const canPeek =
    emailMode && !isLoading && (holdings.length > 0 || erroredChains.length > 0);

  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
      <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-muted">
        <Wallet className="size-7 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] font-bold tracking-(--tracking-caps) uppercase text-muted-foreground">
          {copy.fundsTitle}
        </div>
        {emailMode && isLoading ? (
          // Mirrors the loaded shape: worth sentence + peek hint, so the
          // module doesn't grow when the sweep lands.
          <div className="mt-1 flex flex-col gap-1.5">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3.5 w-24" />
          </div>
        ) : worth ? (
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">
              ≈ {money.format(totalUsd)}
            </span>{" "}
            {copy.fundsReadyTail(holdings.length)}
          </div>
        ) : (
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            {signedIn
              ? emailMode && holdings.length === 0
                ? copy.fundsEmpty
                : copy.fundsSendAnything
              : copy.fundsSignIn}
          </div>
        )}
        {canPeek && (
          // Inline flow, not flex: each span stays whole (nowrap) and drops
          // to its own full line when the column gets narrow, instead of
          // the two labels wrapping side-by-side into skinny columns.
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="mt-1 block text-left text-xs leading-5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="whitespace-nowrap underline underline-offset-2">
              {copy.fundsWhatsInside}
            </span>{" "}
            {gasShortChains.length > 0 ? (
              <span className="whitespace-nowrap font-medium text-warn">
                <GasPump className="inline size-3.5 align-[-0.2em]" />{" "}
                {copy.fundsNeedsGas}
              </span>
            ) : (
              <CaretRight className="inline size-3" />
            )}
          </button>
        )}
      </div>
      <Button
        variant="secondary"
        className="h-11 shrink-0 rounded-full px-4 text-[13.5px] font-bold"
        onClick={signedIn ? onTopUp : privy.login}
      >
        {signedIn ? copy.topUp : copy.signIn}
      </Button>

      <FundsBreakdownDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        embedded={embedded}
        onTopUp={() => {
          setDrawerOpen(false);
          onTopUp();
        }}
      />
    </div>
  );
}

/**
 * The breakdown drawer: every asset with the network it sits on, exact
 * amount plus oracle USD value, a warning for networks where funds can't
 * move because the native gas balance is zero, and a note for networks
 * whose RPC won't answer.
 */
function FundsBreakdownDrawer({
  open,
  onOpenChange,
  embedded,
  onTopUp,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  embedded: EmbeddedHoldingsResult;
  onTopUp: () => void;
}) {
  const { holdings, erroredChains, gasShortChains, totalUsd } = embedded;
  const copy = useCopy();
  const money = useMoney();

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{copy.fundsInsideTitle}</DrawerTitle>
          <DrawerDescription>{copy.fundsInsideSub}</DrawerDescription>
        </DrawerHeader>

        <div className="flex max-h-[65cqh] flex-col gap-3 overflow-y-auto p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          {holdings.length > 0 && (
            <div className="flex flex-col gap-1">
              {holdings.map(({ chainKey, token, balance, usdValue }) => (
                <div
                  key={`${chainKey}:${token.address}`}
                  className="flex min-h-14 items-center gap-3 rounded-xl px-2 py-2"
                >
                  <TokenLogo symbol={token.symbol} chainKey={chainKey} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">
                      {token.symbol}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      on {getChainName(chainKey)}
                    </span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-sm text-foreground tabular-nums">
                      {formatTokenAmount(balance, token.decimals)}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {usdValue !== undefined
                        ? money.format(usdValue)
                        : "unpriced"}
                    </span>
                  </div>
                </div>
              ))}
              {totalUsd !== undefined && holdings.length > 1 && (
                <div className="flex items-center justify-between border-t border-border/60 px-2 pt-2.5 text-sm">
                  <span className="text-muted-foreground">
                    {copy.fundsTotalLabel}
                  </span>
                  <span className="font-semibold text-foreground tabular-nums">
                    ≈ {money.format(totalUsd)}
                  </span>
                </div>
              )}
            </div>
          )}

          {gasShortChains.map((chainKey) => {
            const native = getNativeGasToken(chainKey);
            const chainName = getChainName(chainKey);
            const symbol = native?.symbol ?? "the native token";
            return (
              <div
                key={chainKey}
                className="flex gap-3 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2.5"
              >
                <GasPump className="mt-0.5 size-5 shrink-0 text-warn" />
                <div className="flex flex-col gap-1.5 text-xs leading-relaxed">
                  <p className="text-foreground">
                    {copy.gasShortWarning(chainName, symbol)}
                  </p>
                  <button
                    type="button"
                    onClick={onTopUp}
                    className="self-start text-left font-medium text-warn underline underline-offset-2"
                  >
                    {copy.gasShortCta(symbol)}
                  </button>
                </div>
              </div>
            );
          })}

          {erroredChains.length > 0 && (
            <p className="px-2 text-xs text-muted-foreground">
              {copy.pickerUnreachableNote(
                erroredChains.map(getChainName).join(", "),
                erroredChains.length > 1,
              )}
            </p>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
