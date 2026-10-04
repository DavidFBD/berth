"use client";

import { useState } from "react";
import { Coins, GasPump } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { MoneyName } from "@/components/board/money-name";
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
 * Funds, as one row of the board's money card: idle money in the user's own
 * wallets, waiting to be spent. Email users see what it is worth
 * (embedded-wallet holdings valued by the money market oracle) and can open
 * the breakdown drawer, showing each asset, the network it sits on, and
 * whether that network has enough native gas to actually move it. Everyone
 * else gets the account-state copy.
 *
 * `demo` stands in for the wallet sweep and the session, for the dev gallery.
 */
export function FundsModule({
  onTopUp,
  demo,
  quietWhenEmpty = false,
}: {
  onTopUp: () => void;
  demo?: { embedded: EmbeddedHoldingsResult; signedIn: boolean };
  /**
   * Draw nothing when every network was read and nothing is there: the
   * home's Add money step already says so. Anything it has to say (an
   * asset, a network it could not read, a gas shortfall, a sweep still
   * loading) still shows.
   */
  quietWhenEmpty?: boolean;
}) {
  const privy = usePrivyEmbeddedWallet();
  const signedIn = demo ? demo.signedIn : privy.enabled && privy.authenticated;
  const swept = useEmbeddedHoldings();
  const embedded = demo?.embedded ?? swept;
  const { connected, isLoading, holdings, erroredChains, gasShortChains, totalUsd } =
    embedded;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const copy = useCopy();
  const money = useMoney();

  const worth = connected && !isLoading && totalUsd !== undefined;
  const nothingToSay = connected && !isLoading && holdings.length === 0 && erroredChains.length === 0;
  // Anything to investigate? Holdings, or networks we couldn't read.
  const canPeek =
    connected && !isLoading && (holdings.length > 0 || erroredChains.length > 0);

  if (quietWhenEmpty && nothingToSay) return null;

  return (
    // On a phone the actions drop under the words, in line with them.
    <div data-ph-mask className="flex flex-wrap items-center gap-x-3 gap-y-3 px-[18px] py-4 lg:px-6 lg:py-5">
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-secondary-foreground">
        <Coins weight="duotone" className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-3rem)]">
        <h2 className="font-display text-base leading-tight text-foreground">
          {worth ? (
            <MoneyName name={copy.fundsTitle} amount={money.format(totalUsd)} />
          ) : (
            copy.fundsTitle
          )}
        </h2>
        {connected && isLoading ? (
          <Skeleton className="mt-1 h-3.5 w-36" />
        ) : (
          <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
            {worth
              ? holdings.length > 0
                ? copy.fundsReadyLine(holdings.length)
                : copy.fundsEmpty
              : connected
                ? holdings.length === 0
                  ? copy.fundsEmpty
                  : copy.fundsSendAnything
                : copy.fundsSignIn}
            {canPeek && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  className="whitespace-nowrap text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
                >
                  {copy.fundsWhatsInside}
                </button>
                {gasShortChains.length > 0 && (
                  <span className="ml-1.5 whitespace-nowrap font-medium text-warn">
                    <GasPump weight="duotone" className="inline size-3.5 align-[-0.2em]" /> {copy.fundsNeedsGas}
                  </span>
                )}
              </>
            )}
          </p>
        )}
      </div>
      {/* Email accounts top up through Privy's funding flow; a connected
          wallet holds its own funds and needs no button; a browser with
          neither is offered the sign in. */}
      {signedIn ? (
        <Button variant="outline" size="sm" className="shrink-0 max-sm:ml-12" onClick={onTopUp}>
          {copy.topUp}
        </Button>
      ) : !connected ? (
        <Button variant="outline" size="sm" className="shrink-0 max-sm:ml-12" onClick={privy.login}>
          {copy.signIn}
        </Button>
      ) : null}

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

        <div data-ph-mask className="flex max-h-[65svh] flex-col gap-3 overflow-y-auto p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
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
