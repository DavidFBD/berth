"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowsDownUp, CaretDown, Flame } from "@phosphor-icons/react";
import {
  ChainKeys,
  type LeverageYieldVault,
  type SpokeChainKey,
  type XToken,
} from "@sodax/sdk";
import { useXBalances } from "@sodax/dapp-kit";
import {
  getXChainType,
  isNativeToken,
  useXService,
} from "@sodax/wallet-sdk-react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  DEPOSIT_SOURCE_CHAINS,
  getChainName,
  getNativeGasToken,
  toBalanceReadToken,
} from "@/lib/chains";
import { getVaultMeta } from "@/lib/vaults-meta";
import { formatTokenAmount } from "@/lib/format";
import { useCopy, useMoney } from "@/components/settings-provider";
import {
  SHARE_DECIMALS,
  amountText,
  depositGate,
  depositMax,
  pourAmounts,
} from "@/lib/pour-amount";
import { usePourQuote } from "@/hooks/use-pour-quote";
import { useVaultAction } from "@/hooks/use-vault-action";
import { useVaultWallet } from "@/hooks/use-vault-wallet";
import { useEmbeddedHoldings } from "@/hooks/use-embedded-holdings";
import { useUsdPrices } from "@/hooks/use-usd-prices";
import { useNativeGasBuffer } from "@/hooks/use-native-gas-buffer";
import { ActionError, ActionStepper, IntentTracking } from "./action-stepper";
import { TokenLogo, TokenPicker } from "./token-picker";

/**
 * Full mobile deposit flow in one bottom drawer: pick source chain + token,
 * enter an amount against a live quote, then drive the build → approve → sign
 * pipeline and track the solver fill.
 */
export function DepositDrawer({
  vault,
  open,
  onOpenChange,
  onConnectWallet,
  onTopUp,
  onPoured,
}: {
  vault: LeverageYieldVault | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional: lets the CTA open the app's wallet drawer when disconnected. */
  onConnectWallet?: () => void;
  /** Optional: routes an empty email-mode teapot to the funding flow. */
  onTopUp?: () => void;
  /** Optional: fired once when the pour fills — the cup's bloom moment. */
  onPoured?: () => void;
}) {
  const [srcChainKey, setSrcChainKey] = useState<SpokeChainKey>(
    DEPOSIT_SOURCE_CHAINS[0],
  );
  const [token, setToken] = useState<XToken | null>(null);
  const [amount, setAmount] = useState("");
  // What the typed amount means: the user's display currency (default, when
  // priced) or tokens.
  const [denom, setDenom] = useState<"money" | "token">("money");
  const [pickerOpen, setPickerOpen] = useState(false);

  const meta = vault ? getVaultMeta(vault.name) : null;
  const copy = useCopy();
  // The pour machine owns everything past the first tap: pipeline, solver
  // fill, toasts, XP, failure reporting. The drawer renders its states.
  const action = useVaultAction({ onPoured });

  // Privy embedded wallet on EVM chains when signed in via email; external
  // wallets otherwise. Email mode switches chains silently.
  const { address, walletProvider, mode, isWrongChain, handleSwitchChain, ensureChain } =
    useVaultWallet(srcChainKey);

  // Email mode is balance-first: land the user on what they already hold so
  // the drawer opens showing a balance and an amount field, not a chain
  // picker. Waits for the oracle prices so "first" means largest USD value,
  // not first in chain order. Render-time state adjustment (not an effect),
  // per house pattern.
  const {
    emailMode,
    holdings,
    gasShortChains,
    isLoading: holdingsLoading,
  } = useEmbeddedHoldings();
  if (open && emailMode && !token && !holdingsLoading && holdings.length > 0) {
    setSrcChainKey(holdings[0].chainKey);
    setToken(holdings[0].token);
  }

  const prices = useUsdPrices();

  const xService = useXService({ xChainType: getXChainType(srcChainKey) });
  const balancesQuery = useXBalances({
    params: {
      xService,
      xChainId: srcChainKey,
      xTokens: token ? [toBalanceReadToken(token)] : [],
      address: token ? address : undefined,
    },
  });
  // A settled balances record can omit the key entirely: the EVM adapter
  // drops ZERO native balances (`if (balance) map[address] = balance`), so a
  // missing key on settled data means 0n, not "still loading".
  const balance = token
    ? balancesQuery.data
      ? (balancesQuery.data[toBalanceReadToken(token).address] ?? 0n)
      : undefined
    : undefined;

  // Money is how people think about a pour, so the amount field takes the
  // user's display currency whenever the oracle prices the token, with a
  // tap-to-flip line for exact token amounts. Unpriced tokens fall back to
  // token entry. The oracle speaks USD; entry converts at the FX rate.
  const money = useMoney();
  const priceUsd = token ? prices.priceOf(token) : undefined;
  const entryPrice =
    priceUsd !== undefined ? priceUsd * money.rate : undefined;

  // What Max must hold back so the pour can pay its own network fee.
  const { buffer: gasBuffer } = useNativeGasBuffer({
    chainKey: srcChainKey,
    token,
    isNative: !!token && isNativeToken(token),
    priceUsd,
    balance,
  });

  // The amount pipeline: what the text means, what the quote is asked for
  // (post-fee), and the slippage floor all live in the pour-amount module.
  const { moneyMode, buildAmount } = pourAmounts(
    amount,
    denom,
    token?.decimals,
    entryPrice,
  );
  const worthUsd =
    token && buildAmount ? prices.usdValue(token, buildAmount) : undefined;
  const balanceWorthUsd =
    token && balance !== undefined && balance > 0n
      ? prices.usdValue(token, balance)
      : undefined;
  const quote = usePourQuote({
    enabled: open && !!vault && !!token,
    src: token ? { address: token.address, chainKey: srcChainKey } : null,
    dst: vault
      ? { address: vault.vault, chainKey: ChainKeys.SONIC_MAINNET }
      : null,
    buildAmount,
  });

  const finish = () => {
    action.reset();
    setAmount("");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && action.locked) return;
    onOpenChange(next);
    if (!next) finish();
  };

  const handleMax = () => {
    if (!token || balance === undefined) return;
    const max = depositMax(balance, gasBuffer);
    if (max.kind === "bufferLoading") {
      toast.info(copy.burnerCostChecking);
      return;
    }
    if (max.kind === "nothingSpendable") {
      toast.info(copy.nothingForKettle);
      return;
    }
    setAmount(
      amountText(
        max.amount,
        token.decimals,
        moneyMode,
        entryPrice,
        money.fractionDigits,
      ),
    );
  };

  // Flip the entry denomination, carrying the current value across so the
  // number in the field keeps meaning the same pour.
  const flipDenom = () => {
    if (!token || entryPrice === undefined) return;
    setDenom(moneyMode ? "token" : "money");
    if (buildAmount) {
      setAmount(
        amountText(
          buildAmount,
          token.decimals,
          !moneyMode,
          entryPrice,
          money.fractionDigits,
        ),
      );
    }
  };

  const handleDeposit = async () => {
    if (
      !vault ||
      !token ||
      !buildAmount ||
      quote.minOut === undefined ||
      !address ||
      !walletProvider
    ) {
      return;
    }
    await action.runDeposit({
      vault: vault.vault,
      vaultName: vault.name,
      srcChainKey,
      srcAddress: address,
      token,
      inputAmount: buildAmount,
      minOutputAmount: quote.minOut,
      walletProvider,
      walletMode: mode,
      fillToasts: {
        successTitle: copy.pourFilledTitle,
        successDescription: copy.pourFilledBody,
        failureDescription: copy.pourFillFailedBody,
      },
      ensureReady: ensureChain,
    });
  };

  type Cta = {
    label: string;
    disabled: boolean;
    busy?: boolean;
    onClick?: () => void;
  };
  // The gate (pour-amount module) decides why the pour can't go yet; this
  // map only speaks it in the tea voice.
  const gate = depositGate({
    hasToken: !!token,
    address,
    buildAmount,
    balance,
    isWrongChain,
    noRoute: quote.noRoute,
    quoted: quote.quoted,
    minOut: quote.minOut,
    hasWalletProvider: !!walletProvider,
  });
  const cta: Cta = (() => {
    switch (gate.kind) {
      case "pickToken":
        return {
          label: copy.whatPouring,
          disabled: false,
          onClick: () => setPickerOpen(true),
        };
      case "connectSource":
        return {
          label: copy.connectChainWallet(getChainName(srcChainKey)),
          disabled: !onConnectWallet,
          onClick: onConnectWallet,
        };
      case "enterAmount":
        return { label: copy.ctaPourHowMuch, disabled: true };
      case "balanceLoading":
        return { label: copy.peekingTeapot, disabled: true, busy: true };
      case "insufficient":
        return { label: copy.ctaTooMuch, disabled: true };
      case "wrongChain":
        return {
          label: copy.ctaSwitchNetwork,
          disabled: false,
          onClick: handleSwitchChain,
        };
      case "noRoute":
        return { label: copy.ctaNoRoute, disabled: true };
      case "quotePending":
        return { label: copy.ctaReadingLeaves, disabled: true, busy: true };
      default:
        return {
          label: copy.pour,
          disabled: false,
          onClick: () => void handleDeposit(),
        };
    }
  })();

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={handleOpenChange}
        disablePointerDismissal={action.locked}
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>
              {meta ? copy.pourIntoTitle(meta.teaName) : copy.pourTitleFallback}
            </DrawerTitle>
            <DrawerDescription>
              {vault ? copy.pourSub : copy.pickCupToPour}
            </DrawerDescription>
          </DrawerHeader>

          {vault && action.fillPhase ? (
            <div className="p-4">
              <IntentTracking
                reportState={action.reportState}
                phase={action.fillPhase}
                fillTxHash={action.fillTxHash}
                accent={meta ? `var(--cup-${meta.cupKey})` : undefined}
                deep={meta ? `var(--cup-${meta.cupKey}-deep)` : undefined}
                successTitle={copy.pourFilledTitle}
                successBody={copy.steepingBody(meta?.teaName ?? null)}
                onDone={() => {
                  onOpenChange(false);
                  finish();
                }}
              />
            </div>
          ) : vault && action.pending ? (
            <div className="p-4">
              <ActionStepper
                step={action.step}
                approveNeeded={action.approveRequired ?? true}
              />
            </div>
          ) : vault ? (
            <>
              <div className="flex flex-col gap-4 overflow-y-auto p-4">
                {/* Source chain + token */}
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-[transform,background-color] duration-150 ease-lift hover:bg-muted active:bg-muted active:scale-[0.99]"
                >
                  {token ? (
                    <>
                      <TokenLogo symbol={token.symbol} chainKey={srcChainKey} />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="text-sm font-medium text-foreground">
                          {token.symbol}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          on {getChainName(srcChainKey)}
                        </span>
                      </div>
                      {/* What you hold of it, right on the pill — the picker
                          shouldn't be the only place that prices the shelf. */}
                      {address && balance !== undefined && balance > 0n && (
                        <div className="flex shrink-0 flex-col items-end">
                          <span className="money text-sm text-foreground">
                            {balanceWorthUsd !== undefined
                              ? `≈ ${money.format(balanceWorthUsd)}`
                              : formatTokenAmount(balance, token.decimals)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {balanceWorthUsd !== undefined
                              ? `${formatTokenAmount(balance, token.decimals)} ${token.symbol}`
                              : token.symbol}
                          </span>
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="flex-1 text-sm text-muted-foreground">
                      {copy.whatPouring}
                    </span>
                  )}
                  <CaretDown className="size-4 text-muted-foreground" />
                </button>

                {/* Tea without a flame: the embedded wallet holds this token
                    but zero native balance on its chain, so the pour would
                    die at the network fee. Say so before the quote does. */}
                {emailMode &&
                  token &&
                  gasShortChains.includes(srcChainKey) &&
                  (() => {
                    const native = getNativeGasToken(srcChainKey);
                    const symbol = native?.symbol ?? "the native token";
                    return (
                      <div className="flex gap-3 rounded-xl border border-amber-600/30 bg-amber-500/10 px-3 py-2.5">
                        <Flame className="mt-0.5 size-5 shrink-0 text-amber-700" />
                        <div className="flex flex-col gap-1.5 text-xs leading-relaxed">
                          <p className="text-foreground">
                            {copy.gasShortWarning(
                              getChainName(srcChainKey),
                              symbol,
                            )}
                          </p>
                          {onTopUp && (
                            <button
                              type="button"
                              onClick={onTopUp}
                              className="self-start text-left font-medium text-amber-800 underline underline-offset-2"
                            >
                              {copy.gasShortCta(symbol)}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                {/* Amount */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-baseline gap-0.5">
                    {moneyMode && (
                      <span
                        aria-hidden
                        className={cn(
                          "text-4xl font-semibold tabular-nums",
                          amount
                            ? "text-foreground"
                            : "text-muted-foreground/40",
                        )}
                      >
                        {money.symbol}
                      </span>
                    )}
                    <input
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      inputMode="decimal"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="0"
                      aria-label={
                        moneyMode
                          ? `Deposit amount in ${money.currency}`
                          : "Deposit amount"
                      }
                      disabled={!token}
                      className={cn(
                        "w-full bg-transparent text-4xl font-semibold text-foreground tabular-nums outline-none",
                        "placeholder:text-muted-foreground/40 disabled:opacity-50",
                      )}
                    />
                  </div>
                  {token && entryPrice !== undefined && (
                    <button
                      type="button"
                      onClick={flipDenom}
                      className="flex w-fit items-center gap-1 text-xs text-muted-foreground tabular-nums transition-[transform,color] duration-150 ease-lift hover:text-foreground active:scale-[0.96]"
                    >
                      <ArrowsDownUp className="size-3.5" />
                      {moneyMode
                        ? `≈ ${buildAmount ? formatTokenAmount(buildAmount, token.decimals) : "0"} ${token.symbol}`
                        : `≈ ${money.format(worthUsd ?? 0)}`}
                    </button>
                  )}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      {token && address
                        ? balance !== undefined
                          ? copy.teapotHolds(
                              balanceWorthUsd !== undefined
                                ? `≈ ${money.format(balanceWorthUsd)} (${formatTokenAmount(balance, token.decimals)} ${token.symbol})`
                                : `${formatTokenAmount(balance, token.decimals)} ${token.symbol}`,
                            )
                          : copy.peekingTeapot
                        : " "}
                    </span>
                    {token && balance !== undefined && balance > 0n && (
                      <Button variant="ghost" size="xs" onClick={handleMax}>
                        {copy.maxLabel}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Live quote */}
                {token && buildAmount ? (
                  <div className="flex flex-col gap-1 rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
                    {quote.noRoute ? (
                      <span className="text-destructive">
                        {copy.noRouteForPair}
                      </span>
                    ) : quote.quoted !== undefined && quote.minOut !== undefined ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            {copy.youllSteep}
                          </span>
                          <span className="font-medium text-foreground tabular-nums">
                            ≈ {formatTokenAmount(quote.quoted, SHARE_DECIMALS)} {vault.name}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{copy.atLeastOncePoured}</span>
                          <span className="tabular-nums">
                            {formatTokenAmount(quote.minOut, SHARE_DECIMALS)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Spinner className="size-3.5" /> {copy.fetchingQuote}
                      </div>
                    )}
                  </div>
                ) : null}

                {action.step === "error" && action.error && (
                  <ActionError
                    message={action.error}
                    reportState={action.reportState}
                  />
                )}
              </div>

              <DrawerFooter>
                <Button
                  className="h-12 w-full text-base"
                  disabled={cta.disabled}
                  onClick={cta.onClick}
                >
                  {cta.busy && <Spinner className="size-4" />}
                  {cta.label}
                </Button>
              </DrawerFooter>
            </>
          ) : null}
        </DrawerContent>
      </Drawer>

      <TokenPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onTopUp={onTopUp}
        onSelect={(chainKey, selected) => {
          setSrcChainKey(chainKey);
          setToken(selected);
          setAmount("");
        }}
      />
    </>
  );
}
