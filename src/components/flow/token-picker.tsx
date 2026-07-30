"use client";

import { useMemo, useState } from "react";
import { CaretLeft, MagnifyingGlass } from "@phosphor-icons/react";
import { useXBalances } from "@sodax/dapp-kit";
import { getXChainType, useXAccount, useXService } from "@sodax/wallet-sdk-react";
import type { SpokeChainKey, XToken } from "@sodax/sdk";
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
} from "@/lib/chains";
import { formatTokenAmount } from "@/lib/format";

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

function TokenGlyph({ symbol }: { symbol: string }) {
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
 * Two-step bottom-drawer picker: chain grid → token list for that chain,
 * with the connected wallet's balances surfaced and balance-holders sorted
 * first. Calls `onSelect(chainKey, token)` and closes itself.
 */
export function TokenPicker({
  open,
  onOpenChange,
  onSelect,
  mode = "source",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (chainKey: SpokeChainKey, token: XToken) => void;
  /** Direction the copy speaks to: funding a deposit vs receiving a withdrawal. */
  mode?: "source" | "destination";
}) {
  const [chainKey, setChainKey] = useState<SpokeChainKey | null>(null);
  const [search, setSearch] = useState("");

  // Reset on close so every open starts fresh at the chain grid.
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
  const balancesQuery = useXBalances({
    params: {
      xService,
      xChainId: chainKey ?? undefined,
      xTokens: tokens,
      address: chainKey ? account.address : undefined,
    },
  });
  const balances = balancesQuery.data;
  const balancesLoading =
    chainKey !== null && !!account.address && balancesQuery.isLoading;

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
        // omits zero native balances), not unknown.
        token,
        balance: balances ? (balances[token.address] ?? 0n) : undefined,
      }))
      .sort((a, b) => {
        const aHas = (a.balance ?? 0n) > 0n;
        const bHas = (b.balance ?? 0n) > 0n;
        if (aHas === bHas) return 0;
        return aHas ? -1 : 1;
      });
  }, [tokens, search, balances]);

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <div className="flex items-center gap-2">
            {chainKey && (
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
              {chainKey ? `Select token on ${getChainName(chainKey)}` : "Select chain"}
            </DrawerTitle>
          </div>
          <DrawerDescription>
            {mode === "source"
              ? chainKey
                ? "Anything in the pot can become tea."
                : "Where's your tea coming from?"
              : chainKey
                ? "Pick what it arrives as."
                : "Where should we pour it?"}
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex h-[65dvh] flex-col gap-3 p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          {chainKey === null ? (
            <div className="grid grid-cols-4 gap-2 overflow-y-auto pb-2">
              {DEPOSIT_SOURCE_CHAINS.map((key) => (
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
