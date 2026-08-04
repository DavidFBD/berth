"use client";

import { useState } from "react";
import { CaretRight, Flame } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { SteamPlume, TeapotArt } from "@/components/tea/tea-art";
import { ChainLogo, TokenGlyph } from "@/components/flow/token-picker";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import {
  useEmbeddedHoldings,
  type EmbeddedHoldingsResult,
} from "@/hooks/use-embedded-holdings";
import { getChainName, getNativeGasToken } from "@/lib/chains";
import { formatTokenAmount, formatUsd } from "@/lib/format";

/**
 * The teapot header module — idle funds waiting to be poured. Email users
 * see what the pot is worth (embedded-wallet holdings valued by the money
 * market oracle) and can lift the lid: a breakdown drawer showing each asset,
 * the shelf (chain) it sits on, and whether that shelf has a flame (native
 * gas) to actually pour with. Everyone else gets the account-state copy.
 */
export function TeapotModule({ onTopUp }: { onTopUp: () => void }) {
  const privy = usePrivyEmbeddedWallet();
  const signedIn = privy.enabled && privy.authenticated;
  const embedded = useEmbeddedHoldings();
  const { emailMode, isLoading, holdings, erroredChains, gasShortChains, totalUsd } =
    embedded;
  const [lidOpen, setLidOpen] = useState(false);

  const worth = emailMode && !isLoading && totalUsd !== undefined;
  // Anything to investigate? Holdings, or shelves we couldn't read.
  const canPeek =
    emailMode && !isLoading && (holdings.length > 0 || erroredChains.length > 0);

  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
      <div className="flex shrink-0 flex-col items-center">
        <SteamPlume level={signedIn ? 1 : 0} width={54} height={26} />
        <TeapotArt size={56} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] font-bold tracking-(--tracking-caps) uppercase text-muted-foreground">
          Your teapot
        </div>
        {emailMode && isLoading ? (
          <Skeleton className="mt-1 h-4 w-36" />
        ) : worth ? (
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">
              ≈ {formatUsd(totalUsd)}
            </span>{" "}
            in the pot, ready to pour
            {holdings.length > 1 ? ` (${holdings.length} assets)` : ""}.
          </div>
        ) : (
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            {signedIn
              ? emailMode && holdings.length === 0
                ? "The pot is empty. Top it up and the tea can flow."
                : "Send anything from ~200 assets across 20 networks. It waits here."
              : "Sign in and the pot warms itself. Email is all it takes."}
          </div>
        )}
        {canPeek && (
          <button
            type="button"
            onClick={() => setLidOpen(true)}
            className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="underline underline-offset-2">
              What&apos;s in the pot?
            </span>
            {gasShortChains.length > 0 ? (
              <span className="flex items-center gap-0.5 font-medium text-amber-700">
                <Flame className="size-3.5" /> a shelf needs a flame
              </span>
            ) : (
              <CaretRight className="size-3" />
            )}
          </button>
        )}
      </div>
      <Button
        variant="secondary"
        className="h-11 shrink-0 rounded-full px-4 text-[13.5px] font-bold"
        onClick={signedIn ? onTopUp : privy.login}
      >
        {signedIn ? "Top up" : "Sign in"}
      </Button>

      <TeapotLidDrawer
        open={lidOpen}
        onOpenChange={setLidOpen}
        embedded={embedded}
        onTopUp={() => {
          setLidOpen(false);
          onTopUp();
        }}
      />
    </div>
  );
}

/**
 * Under the lid: every leaf in the pot with the shelf (chain) it sits on,
 * exact amount plus oracle USD value, a flame warning for chains where the
 * tea can't move because the native gas balance is zero, and a note for
 * shelves whose RPC won't answer.
 */
function TeapotLidDrawer({
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

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Inside the pot</DrawerTitle>
          <DrawerDescription>
            What you hold, and which shelf it sits on.
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex max-h-[65cqh] flex-col gap-3 overflow-y-auto p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          {holdings.length > 0 && (
            <div className="flex flex-col gap-1">
              {holdings.map(({ chainKey, token, balance, usdValue }) => (
                <div
                  key={`${chainKey}:${token.address}`}
                  className="flex min-h-14 items-center gap-3 rounded-xl px-2 py-2"
                >
                  <TokenGlyph symbol={token.symbol} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">
                      {token.symbol}
                    </span>
                    <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <ChainLogo chainKey={chainKey} size={12} />
                      on {getChainName(chainKey)}
                    </span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-sm text-foreground tabular-nums">
                      {formatTokenAmount(balance, token.decimals)}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {usdValue !== undefined ? formatUsd(usdValue) : "unpriced"}
                    </span>
                  </div>
                </div>
              ))}
              {totalUsd !== undefined && holdings.length > 1 && (
                <div className="flex items-center justify-between border-t border-border/60 px-2 pt-2.5 text-sm">
                  <span className="text-muted-foreground">In the pot</span>
                  <span className="font-semibold text-foreground tabular-nums">
                    ≈ {formatUsd(totalUsd)}
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
                className="flex gap-3 rounded-xl border border-amber-600/30 bg-amber-500/10 px-3 py-2.5"
              >
                <Flame className="mt-0.5 size-5 shrink-0 text-amber-700" />
                <div className="flex flex-col gap-1.5 text-xs leading-relaxed">
                  <p className="text-foreground">
                    Tea on the {chainName} shelf, but no {symbol} to light the
                    burner. Every pour from {chainName} pays its network fee in{" "}
                    {symbol}, so this tea can&apos;t move yet.
                  </p>
                  <button
                    type="button"
                    onClick={onTopUp}
                    className="self-start text-left font-medium text-amber-800 underline underline-offset-2"
                  >
                    Send a splash of {symbol} to your teapot address
                  </button>
                </div>
              </div>
            );
          })}

          {erroredChains.length > 0 && (
            <p className="px-2 text-xs text-muted-foreground">
              The {erroredChains.map(getChainName).join(", ")}{" "}
              {erroredChains.length === 1 ? "shelf" : "shelves"} won&apos;t open
              just now, so anything there is missing from this list. Still
              trying.
            </p>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
