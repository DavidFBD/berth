"use client";

import { useMemo, useState } from "react";
import { CaretLeft, CaretRight, MagnifyingGlass } from "@phosphor-icons/react";
import { useXBalances } from "@sodax/dapp-kit";
import { getXChainType, useXService } from "@sodax/wallet-sdk-react";
import {
  tokenLogo,
  type SpokeChainKey,
  type XToken,
} from "@sodax/sdk";
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
  getNativeGasToken,
  toBalanceReadToken,
} from "@/lib/chains";
import { formatTokenAmount } from "@/lib/format";
import { useCopy, useMoney } from "@/components/settings-provider";
import {
  EMBEDDED_CHAINS,
  useEmbeddedHoldings,
  type EmbeddedHoldingsResult,
} from "@/hooks/use-embedded-holdings";
import { useAccount } from "@/hooks/use-account";
import { useUsdPrices } from "@/hooks/use-usd-prices";
import { isGasToken, useGasGate } from "@/hooks/use-gas-gate";
import { byGasStatus, type GasStatus } from "@/lib/gas-need";
import { PayTokenRow } from "./pay-token-row";

/**
 * Lettered circle standing in for a logo that is missing or failed to load.
 * Sized in px so it lines up with the image it replaces.
 */
function LetterCircle({
  letter,
  size,
  className,
}: {
  letter: string;
  size: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.4) }}
    >
      {letter}
    </div>
  );
}

/**
 * What a holding is worth, the way the deposit drawer's pill shows it: the
 * value in the display currency on top, the amount and symbol beneath. A
 * token with no price shows its amount on top and its symbol beneath,
 * never a blank and never zero, because unknown is not nothing.
 */
function HoldingWorth({
  balance,
  token,
  usdValue,
}: {
  balance: bigint;
  token: XToken;
  usdValue: number | undefined;
}) {
  const money = useMoney();
  const amount = formatTokenAmount(balance, token.decimals);
  return (
    <div className="flex shrink-0 flex-col items-end">
      <span className="money text-sm text-foreground tabular-nums">
        {usdValue !== undefined ? money.format(usdValue) : amount}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {usdValue !== undefined ? `${amount} ${token.symbol}` : token.symbol}
      </span>
    </div>
  );
}

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
  // Track WHICH src failed, not a boolean: the same component instance gets
  // re-pointed at another chain as the drawer's selection changes, and a
  // sticky `true` would strand a working logo behind the fallback.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const logo = getChainLogo(chainKey);
  const name = getChainName(chainKey);

  if (!logo || failedSrc === logo) {
    return (
      <LetterCircle letter={name.charAt(0)} size={size} className={className} />
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
      onError={() => setFailedSrc(logo)}
    />
  );
}

/**
 * Asset logo, resolved from the token symbol against the logo set shipped in
 * `@sodax/assets` (the SDK's `tokenLogo`). Long-tail symbols have no file
 * there, so a 404 falls back to the lettered circle. Pass `chainKey` to badge
 * the network in the corner — the asset is the subject, the chain the caveat.
 */
export function TokenLogo({
  symbol,
  size = 32,
  chainKey,
  className,
}: {
  symbol: string;
  size?: number;
  chainKey?: SpokeChainKey;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = tokenLogo(symbol);
  const badgeSize = Math.round(size * 0.42);

  const art =
    failedSrc === src ? (
      <LetterCircle letter={symbol.charAt(0)} size={size} />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element -- remote token logos, tiny and unknown domains
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full"
        onError={() => setFailedSrc(src)}
      />
    );

  if (!chainKey) {
    return <div className={cn("shrink-0", className)}>{art}</div>;
  }

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
    >
      {art}
      <ChainLogo
        chainKey={chainKey}
        size={badgeSize}
        className="absolute -right-0.5 -bottom-0.5 ring-2 ring-card"
      />
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
  devHoldings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (chainKey: SpokeChainKey, token: XToken) => void;
  /** Direction the copy speaks to: funding a deposit vs receiving a withdrawal. */
  mode?: "source" | "destination";
  /** Lets the email-mode empty state route to the funding flow. */
  onTopUp?: () => void;
  /** Dev galleries only: stands in for the wallet sweep (see DepositDrawer). */
  devHoldings?: Pick<EmbeddedHoldingsResult, "connected" | "holdings" | "isLoading"> &
    Partial<Pick<EmbeddedHoldingsResult, "nativeBalances">>;
}) {
  const [chainKey, setChainKey] = useState<SpokeChainKey | null>(null);
  const [search, setSearch] = useState("");
  // Wallet users can step past their swept holdings to a network the sweep
  // does not cover (Bitcoin, Stellar, Sui). Email accounts have nothing
  // there to reach, so they never see the door.
  const [browseAll, setBrowseAll] = useState(false);

  const copy = useCopy();
  const prices = useUsdPrices();
  const sweep = useEmbeddedHoldings();
  const {
    emailMode,
    erroredChains,
  } = sweep;
  const {
    connected,
    isLoading: holdingsLoading,
    holdings: sweptHoldings,
  } = devHoldings ?? sweep;
  const nativeBalances = devHoldings ? (devHoldings.nativeBalances ?? {}) : sweep.nativeBalances;

  // Reset on close so every open starts fresh at the first screen.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setChainKey(null);
      setSearch("");
      setBrowseAll(false);
    }
    onOpenChange(next);
  };

  const tokens = useMemo(
    () => (chainKey ? getDepositTokens(chainKey) : []),
    [chainKey],
  );

  const xService = useXService({
    xChainType: getXChainType(chainKey ?? undefined),
  });
  // One rule for whose balances decorate the list — see lib/account.
  const { address } = useAccount(chainKey ?? DEPOSIT_SOURCE_CHAINS[0]);
  const balancesQuery = useXBalances({
    params: {
      xService,
      xChainId: chainKey ?? undefined,
      xTokens: tokens.map(toBalanceReadToken),
      address: chainKey ? address : undefined,
    },
    // Browsing a chain reads its WHOLE token list, which the SDK fans out to
    // one RPC call per token on Solana. dapp-kit's default 5s refetch turns
    // that into a rate-limit storm; these numbers only decorate a list the
    // user is scrolling, so a slower cadence costs nothing.
    queryOptions: { refetchInterval: 30_000, staleTime: 30_000 },
  });
  const balances = balancesQuery.data;
  const balancesLoading =
    chainKey !== null && !!address && balancesQuery.isLoading;

  // Paying in, a token whose chain cannot pay its own fee is shown last and
  // greyed (lib/gas-need): the order would only die in the wallet. Where
  // the money lands needs no fee from the person, so destinations never grey.
  const gasGate = useGasGate(
    chainKey ? [chainKey] : sweptHoldings.map((holding) => holding.chainKey),
    open && mode === "source",
  );
  const gasOf = (key: SpokeChainKey, token: XToken, nativeBalance: bigint | undefined): GasStatus =>
    mode === "source" ? gasGate.statusFor(key, token, nativeBalance) : "ok";
  const gasTipFor = (key: SpokeChainKey, token: XToken): string => {
    const native = getNativeGasToken(key);
    const symbol = native?.symbol ?? token.symbol;
    return isGasToken(key, token)
      ? copy.gasNeededNative(symbol, getChainName(key))
      : copy.gasNeededToPay(symbol, getChainName(key));
  };
  const holdings = byGasStatus(
    sweptHoldings.map((holding) => ({
      ...holding,
      gas: gasOf(holding.chainKey, holding.token, nativeBalances[holding.chainKey]),
    })),
    (row) => row.gas,
  );
  const browseNative = chainKey ? getNativeGasToken(chainKey) : undefined;
  const browseNativeBalance =
    balances && browseNative
      ? (balances[toBalanceReadToken(browseNative).address] ?? 0n)
      : undefined;

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
  const browseRows = chainKey
    ? byGasStatus(
        rows.map((row) => ({ ...row, gas: gasOf(chainKey, row.token, browseNativeBalance) })),
        (row) => row.gas,
      )
    : [];

  // First screen when paying in: what the swept wallets hold, for email
  // accounts and connected wallets alike, so nobody picks a network before
  // an asset. Withdrawing out, email accounts get the trimmed grid of chains
  // the embedded wallets can receive on. Email mode has no browse-all door
  // in either direction; wallet users get one under the holdings.
  const showHoldings =
    connected && !browseAll && mode === "source" && chainKey === null;
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
            {(showBack || browseAll) && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={copy.backToNetworks}
                onClick={() => {
                  if (chainKey === null) setBrowseAll(false);
                  setChainKey(null);
                  setSearch("");
                }}
              >
                <CaretLeft className="size-4" />
              </Button>
            )}
            <DrawerTitle className="flex-1">
              {chainKey
                ? copy.pickerSelectTokenOn(getChainName(chainKey))
                : showHoldings
                  ? copy.pickerHoldingsTitle
                  : copy.pickerSelectChain}
            </DrawerTitle>
          </div>
          <DrawerDescription>
            {mode === "source"
              ? chainKey
                ? copy.pickerSourceChainSub
                : showHoldings
                  ? copy.pickerSourceHoldingsSub
                  : copy.pickerSourceGridSub
              : chainKey
                ? copy.pickerDestTokenSub
                : copy.whereToDeliver}
          </DrawerDescription>
        </DrawerHeader>

        <div data-ph-mask className="flex flex-col gap-3 p-4 pb-[max(env(safe-area-inset-bottom),1rem)] group-data-[swipe-axis=y]/drawer-popup:h-[65svh] group-data-[swipe-axis=x]/drawer-popup:min-h-0 group-data-[swipe-axis=x]/drawer-popup:flex-1">
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
                        ? copy.pickerNothingReachable(
                            erroredChains.map(getChainName).join(", "),
                          )
                        : copy.pickerHoldingsEmpty}
                    </p>
                    {onTopUp && (
                      <Button
                        onClick={() => {
                          handleOpenChange(false);
                          onTopUp();
                        }}
                      >
                        {copy.addFunds}
                      </Button>
                    )}
                  </div>
                ) : (
                  holdings.map(({ chainKey: key, token, balance, usdValue, gas }) => (
                    <PayTokenRow
                      key={`${key}:${token.address}`}
                      logo={<TokenLogo symbol={token.symbol} chainKey={key} />}
                      title={token.symbol}
                      subtitle={`on ${getChainName(key)}`}
                      gasTip={gas === "short" ? gasTipFor(key, token) : undefined}
                      gasHelpLabel={copy.gasHelpLabel}
                      onSelect={() => {
                        onSelect(key, token);
                        handleOpenChange(false);
                      }}
                      trailing={
                        <HoldingWorth
                          balance={balance}
                          token={token}
                          usdValue={usdValue}
                        />
                      }
                    />
                  ))
                )}
                {holdings.length > 0 && erroredChains.length > 0 && (
                  <p className="px-2 py-2 text-xs text-muted-foreground">
                    {copy.pickerUnreachableNote(
                      erroredChains.map(getChainName).join(", "),
                      erroredChains.length > 1,
                    )}
                  </p>
                )}
              </div>
              {!emailMode && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-center text-muted-foreground"
                  onClick={() => setBrowseAll(true)}
                >
                  {copy.pickerBrowseAll}
                  <CaretRight className="size-3.5" />
                </Button>
              )}
            </>
          ) : chainKey === null ? (
            <div className="grid grid-cols-4 gap-2 overflow-y-auto pb-2">
              {gridChains.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setChainKey(key)}
                  className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card p-2 transition-[transform,background-color] duration-150 ease-lift hover:bg-muted active:bg-muted active:scale-[0.96]"
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
                  placeholder={copy.pickerSearchPlaceholder}
                  className="h-11 pl-9"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
                {rows.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {copy.pickerNoMatches(search)}
                  </p>
                )}
                {browseRows.map(({ token, balance, gas }) => (
                  <PayTokenRow
                    key={token.address}
                    logo={<TokenLogo symbol={token.symbol} />}
                    title={token.symbol}
                    subtitle={token.name}
                    gasTip={gas === "short" ? gasTipFor(chainKey, token) : undefined}
                    gasHelpLabel={copy.gasHelpLabel}
                    onSelect={() => {
                      onSelect(chainKey, token);
                      handleOpenChange(false);
                    }}
                    trailing={
                      <div className="text-right">
                        {balancesLoading ? (
                          <Skeleton className="h-4 w-14" />
                        ) : balance !== undefined && balance > 0n ? (
                          <HoldingWorth
                            balance={balance}
                            token={token}
                            usdValue={prices.usdValue(token, balance)}
                          />
                        ) : balance !== undefined ? (
                          <span className="text-sm text-muted-foreground tabular-nums">
                            {formatTokenAmount(balance, token.decimals)}
                          </span>
                        ) : null}
                      </div>
                    }
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
