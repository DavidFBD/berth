"use client";

import { useMemo, useState } from "react";
import { CaretLeft, MagnifyingGlass } from "@phosphor-icons/react";
import { useXBalances } from "@sodax/dapp-kit";
import { getXChainType, useXAccount, useXService } from "@sodax/wallet-sdk-react";
import { isEvmChainKeyType, type SpokeChainKey, type XToken } from "@sodax/sdk";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  DEPOSIT_SOURCE_CHAINS,
  getChainLogo,
  getChainName,
  getDepositTokens,
  toBalanceReadToken,
} from "@/lib/chains";
import { formatTokenAmount, formatUsd } from "@/lib/format";
import {
  EMBEDDED_CHAINS,
  useEmbeddedHoldings,
} from "@/hooks/use-embedded-holdings";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";

/** Chain logo with graceful fallback to a neutral lettered circle. */
export function ChainLogo({
  chainKey,
  size = 28,
  className,
}: {
  chainKey: SpokeChainKey;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const logo = getChainLogo(chainKey);
  const name = getChainName(chainKey);

  if (!logo || failed) {
    return (
      <div
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground",
          className,
        )}
        style={{ width: size, height: size }}
      >
        {name.charAt(0)}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote chain logos, tiny and unknown domains
    <img
      src={logo}
      alt={name}
      width={size}
      height={size}
      className={cn("shrink-0 rounded-full", className)}
      onError={() => setFailed(true)}
    />
  );
}

export function TokenGlyph({ symbol }: { symbol: string }) {
  return (
    <div
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
    >
      {symbol.charAt(0)}
    </div>
  );
}

/**
 * Bottom-drawer picker with two personalities. Email mode (Privy) leads with
 * the user's actual holdings across every chain their embedded wallets sign
 * on: pick what you hold, done. The wallet-native chain grid → token list
 * flow stays behind a "browse all networks" escape hatch and remains the
 * default for external-wallet users. Calls `onSelect(chainKey, token)` and
 * closes itself.
 */
export function TokenPicker({
  open,
  onOpenChange,
  onSelect,
  mode = "source",
  onTopUp,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (chainKey: SpokeChainKey, token: XToken) => void;
  /** Direction the copy speaks to: funding a deposit vs receiving a withdrawal. */
  mode?: "source" | "destination";
  /** Lets the email-mode empty state route to the funding flow. */
  onTopUp?: () => void;
}) {
  const [chainKey, setChainKey] = useState<SpokeChainKey | null>(null);
  const [search, setSearch] = useState("");

  const privy = usePrivyEmbeddedWallet();
  const {
    emailMode,
    isLoading: holdingsLoading,
    holdings,
    erroredChains,
  } = useEmbeddedHoldings();

  // Reset on close so every open starts fresh at the first screen.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setChainKey(null);
      setSearch("");
    }
    onOpenChange(next);
  };

  const tokens = useMemo(
    () => (chainKey ? getDepositTokens(chainKey) : []),
    [chainKey],
  );

  const account = useXAccount({
    xChainId: chainKey ?? DEPOSIT_SOURCE_CHAINS[0],
  });
  const xService = useXService({
    xChainType: getXChainType(chainKey ?? undefined),
  });
  // Email mode holds EVM funds at the embedded address, which never enters
  // the external wallet store; Solana is bridged into the store, so the
  // external account resolves there.
  const address =
    emailMode && chainKey && isEvmChainKeyType(chainKey)
      ? privy.embedded?.address
      : account.address;
  const balancesQuery = useXBalances({
    params: {
      xService,
      xChainId: chainKey ?? undefined,
      xTokens: tokens.map(toBalanceReadToken),
      address: chainKey ? address : undefined,
    },
  });
  const balances = balancesQuery.data;
  const balancesLoading =
    chainKey !== null && !!address && balancesQuery.isLoading;

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = tokens.filter(
      (token) =>
        !query ||
        token.symbol.toLowerCase().includes(query) ||
        token.name.toLowerCase().includes(query),
    );
    return filtered
      .map((token) => ({
        // Settled record with a missing key = zero balance (the EVM adapter
        // omits zero native balances), not unknown. Keyed by the read
        // token's re-checksummed address.
        token,
        balance: balances
          ? (balances[toBalanceReadToken(token).address] ?? 0n)
          : undefined,
      }))
      .sort((a, b) => {
        const aHas = (a.balance ?? 0n) > 0n;
        const bHas = (b.balance ?? 0n) > 0n;
        if (aHas === bHas) return 0;
        return aHas ? -1 : 1;
      });
  }, [tokens, search, balances]);

  // Email-mode first screens: holdings when pouring in, a trimmed grid of
  // chains the embedded wallets can receive on when pouring out. External
  // wallets are the expert path (welcome screen, non-Privy users), so email
  // mode gets no browse-all escape hatch in either direction.
  const showHoldings = emailMode && mode === "source" && chainKey === null;
  const gridChains =
    emailMode && mode === "destination"
      ? EMBEDDED_CHAINS
      : DEPOSIT_SOURCE_CHAINS;
  const showBack = chainKey !== null;

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <div className="flex items-center gap-2">
            {showBack && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Back to chains"
                onClick={() => {
                  setChainKey(null);
                  setSearch("");
                }}
              >
                <CaretLeft className="size-4" />
              </Button>
            )}
            <DrawerTitle className="flex-1">
              {chainKey
                ? `Select token on ${getChainName(chainKey)}`
                : showHoldings
                  ? "Your teapot"
                  : "Select chain"}
            </DrawerTitle>
          </div>
          <DrawerDescription>
            {mode === "source"
              ? chainKey
                ? "Anything in the pot can become tea."
                : showHoldings
                  ? "Pour straight from what you hold."
                  : "Where's your tea coming from?"
              : chainKey
                ? "Pick what it arrives as."
                : "Where should we pour it?"}
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex h-[65cqh] flex-col gap-3 p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          {showHoldings ? (
            <>
              <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
                {holdingsLoading && holdings.length === 0 ? (
                  Array.from({ length: 3 }, (_, index) => (
                    <div
                      key={index}
                      className="flex min-h-14 items-center gap-3 px-2 py-2"
                    >
                      <Skeleton className="size-8 rounded-full" />
                      <div className="flex flex-1 flex-col gap-1.5">
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                      <Skeleton className="h-4 w-14" />
                    </div>
                  ))
                ) : holdings.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
                    <p className="text-sm text-muted-foreground">
                      {erroredChains.length > 0
                        ? `Nothing on the shelves we could reach, but ${erroredChains
                            .map(getChainName)
                            .join(", ")} won't open just now. Still trying.`
                        : "Your teapot is empty. Top it up and the tea can flow."}
                    </p>
                    {onTopUp && (
                      <Button
                        onClick={() => {
                          handleOpenChange(false);
                          onTopUp();
                        }}
                      >
                        Fill the teapot
                      </Button>
                    )}
                  </div>
                ) : (
                  holdings.map(({ chainKey: key, token, balance, usdValue }) => (
                    <button
                      key={`${key}:${token.address}`}
                      type="button"
                      onClick={() => {
                        onSelect(key, token);
                        handleOpenChange(false);
                      }}
                      className="flex min-h-14 items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-muted active:bg-muted"
                    >
                      <TokenGlyph symbol={token.symbol} />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium text-foreground">
                          {token.symbol}
                        </span>
                        <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                          <ChainLogo chainKey={key} size={12} />
                          on {getChainName(key)}
                        </span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-sm text-foreground tabular-nums">
                          {formatTokenAmount(balance, token.decimals)}
                        </span>
                        {usdValue !== undefined && (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {formatUsd(usdValue)}
                          </span>
                        )}
                      </div>
                    </button>
                  ))
                )}
                {holdings.length > 0 && erroredChains.length > 0 && (
                  <p className="px-2 py-2 text-xs text-muted-foreground">
                    The {erroredChains.map(getChainName).join(", ")}{" "}
                    {erroredChains.length === 1 ? "shelf" : "shelves"} won&apos;t
                    open just now, so anything there is missing from this list.
                    Still trying.
                  </p>
                )}
              </div>
            </>
          ) : chainKey === null ? (
            <div className="grid grid-cols-4 gap-2 overflow-y-auto pb-2">
              {gridChains.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setChainKey(key)}
                  className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card p-2 transition-colors hover:bg-muted active:bg-muted"
                >
                  <ChainLogo chainKey={key} />
                  <span className="w-full truncate text-center text-[10px] leading-tight text-muted-foreground">
                    {getChainName(key)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="relative shrink-0">
                <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name or symbol"
                  className="h-11 pl-9"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
                {rows.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No tokens match &ldquo;{search}&rdquo;
                  </p>
                )}
                {rows.map(({ token, balance }) => (
                  <button
                    key={token.address}
                    type="button"
                    onClick={() => {
                      onSelect(chainKey, token);
                      handleOpenChange(false);
                    }}
                    className="flex min-h-14 items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-muted active:bg-muted"
                  >
                    <TokenGlyph symbol={token.symbol} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium text-foreground">
                        {token.symbol}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {token.name}
                      </span>
                    </div>
                    <div className="text-right">
                      {balancesLoading ? (
                        <Skeleton className="h-4 w-14" />
                      ) : balance !== undefined ? (
                        <span className="text-sm text-muted-foreground tabular-nums">
                          {formatTokenAmount(balance, token.decimals)}
                        </span>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
