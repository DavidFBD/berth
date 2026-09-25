"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import { ArrowsDownUp, CaretDown, GasPump } from "@phosphor-icons/react";
import { ChainKeys, type SpokeChainKey, type XToken } from "@sodax/sdk";
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
import { EASE_LIFT } from "@/lib/motion";
import {
  DEPOSIT_SOURCE_CHAINS,
  getChainName,
  getNativeGasToken,
  toBalanceReadToken,
} from "@/lib/chains";
import { getVaultMeta } from "@/lib/vaults-meta";
import type { Listing } from "@/lib/listings";
import { formatTokenAmount } from "@/lib/format";
import { useCopy, useMoney } from "@/components/settings-provider";
import {
  amountText,
  belowMinimum,
  depositGate,
  depositMax,
  minPourUsd,
  pourAmounts,
} from "@/lib/pour-amount";
import { usePourQuote } from "@/hooks/use-pour-quote";
import { useVaultAction } from "@/hooks/use-vault-action";
import { useVaultWallet } from "@/hooks/use-vault-wallet";
import { useHubAccount } from "@/hooks/use-hub-account";
import { useEmbeddedHoldings } from "@/hooks/use-embedded-holdings";
import { useUsdPrices } from "@/hooks/use-usd-prices";
import { useNativeGasBuffer } from "@/hooks/use-native-gas-buffer";
import { ActionError, ActionStepper, IntentTracking } from "./action-stepper";
import { TokenLogo, TokenPicker } from "./token-picker";

/**
 * Full mobile deposit flow in one bottom drawer: pick source chain + token,
 * enter an amount against a live quote, then drive the build → approve → sign
 * pipeline and track the solver fill.
 *
 * The destination is a listing (lib/listings). A vault deposit keeps its old
 * habit: delivery to the signing wallet's own hub wallet. A stock or cash
 * listing is a buy: plain name, and delivery to THE account, the
 * Base-derived hub wallet, whatever wallet pays.
 */
export function DepositDrawer({
  listing,
  open,
  onOpenChange,
  onConnectWallet,
  onSignIn,
  onTopUp,
  onPoured,
}: {
  listing: Listing | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional: lets the CTA open the app's wallet drawer when disconnected. */
  onConnectWallet?: () => void;
  /** Optional: lets a buy's CTA start the email sign-in when there is no account. */
  onSignIn?: () => void;
  /** Optional: routes an empty email-mode balance to the funding flow. */
  onTopUp?: () => void;
  /** Optional: fired once when the order fills. */
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

  const isBuy = !!listing && listing.kind !== "vault";
  const meta =
    listing?.kind === "vault" ? getVaultMeta(listing.vault.name) : null;
  const copy = useCopy();

  // Where a buy lands: the account. Vault deposits ignore this (see RunDepositArgs).
  const account = useHubAccount();
  const deliverTo = isBuy ? account.hubWallet : undefined;
  const accountState = !isBuy
    ? "ready"
    : account.hubWallet
      ? "ready"
      : account.spokeAddress
        ? "deriving"
        : "none";
  // The order machine owns everything past the first tap: pipeline, solver
  // fill, toasts, XP, failure reporting. The drawer renders its states.
  const action = useVaultAction({ onPoured });

  // Privy embedded wallet on EVM chains when signed in via email; external
  // wallets otherwise. Email mode switches chains silently.
  const { address, walletProvider, mode, isWrongChain, handleSwitchChain, ensureReady } =
    useVaultWallet(srcChainKey);

  // Email mode is balance-first: land the user on what they already hold so
  // the drawer opens showing a balance and an amount field, not a chain
  // picker. Waits for the oracle prices so "first" means largest USD value,
  // not first in chain order. Render-time state adjustment (not an effect),
  // per house pattern.
  const {
    connected,
    holdings,
    gasShortChains,
    isLoading: holdingsLoading,
  } = useEmbeddedHoldings();
  if (open && connected && !token && !holdingsLoading && holdings.length > 0) {
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

  // Money is how people think about an order, so the amount field takes the
  // user's display currency whenever the oracle prices the token, with a
  // tap-to-flip line for exact token amounts. Unpriced tokens fall back to
  // token entry. The oracle speaks USD; entry converts at the FX rate.
  const money = useMoney();
  const priceUsd = token ? prices.priceOf(token) : undefined;
  const entryPrice =
    priceUsd !== undefined ? priceUsd * money.rate : undefined;

  // What Max must hold back so the order can pay its own network fee.
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
  // Under the floor the solver answers "no path" for a pair that routes
  // fine, so it isn't asked: the field gets the real reason instead.
  const tooSmall = belowMinimum(worthUsd, money.rate);
  const smallestOrderLabel = money.format(minPourUsd(money.rate));
  const quote = usePourQuote({
    enabled: open && !!listing && !!token && !tooSmall,
    src: token ? { address: token.address, chainKey: srcChainKey } : null,
    dst: listing
      ? { address: listing.address, chainKey: ChainKeys.SONIC_MAINNET }
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
      toast.info(copy.gasCostChecking);
      return;
    }
    if (max.kind === "nothingSpendable") {
      toast.info(copy.nothingLeftForGas);
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
  // number in the field keeps meaning the same order.
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
      !listing ||
      !token ||
      !buildAmount ||
      quote.minOut === undefined ||
      !address ||
      !walletProvider ||
      (isBuy && !deliverTo)
    ) {
      return;
    }
    await action.runDeposit({
      vault: listing.address,
      vaultName: listing.symbol,
      deliverTo,
      srcChainKey,
      srcAddress: address,
      token,
      inputAmount: buildAmount,
      minOutputAmount: quote.minOut,
      walletProvider,
      walletMode: mode,
      fillToasts: {
        successTitle: copy.buyFilledTitle,
        successDescription: copy.buyFilledBody,
        failureDescription: copy.buyFailedBody,
      },
      ensureReady,
    });
  };

  type Cta = {
    label: string;
    disabled: boolean;
    busy?: boolean;
    onClick?: () => void;
  };
  // The gate (pour-amount module) decides why the order can't go yet; this
  // map only speaks it plainly.
  const gate = depositGate({
    hasToken: !!token,
    address,
    buildAmount,
    balance,
    belowMinimum: tooSmall,
    isWrongChain,
    noRoute: quote.noRoute,
    quoted: quote.quoted,
    minOut: quote.minOut,
    hasWalletProvider: !!walletProvider,
    account: accountState,
  });
  const cta: Cta = (() => {
    switch (gate.kind) {
      case "noAccount":
        return {
          label: copy.ctaSignInToBuy,
          disabled: !onSignIn,
          onClick: onSignIn,
        };
      case "accountPending":
        return { label: copy.ctaOpeningAccount, disabled: true, busy: true };
      case "pickToken":
        return {
          label: copy.whatPayingWith,
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
        return { label: copy.ctaEnterAmount, disabled: true };
      case "balanceLoading":
        return { label: copy.checkingBalance, disabled: true, busy: true };
      case "insufficient":
        return { label: copy.ctaTooMuch, disabled: true };
      case "belowMinimum":
        return {
          label: copy.ctaAtLeast(smallestOrderLabel),
          disabled: true,
        };
      case "wrongChain":
        return {
          label: copy.ctaSwitchNetwork,
          disabled: false,
          onClick: handleSwitchChain,
        };
      case "noRoute":
        return { label: copy.ctaNoRoute, disabled: true };
      case "quotePending":
        return { label: copy.ctaGettingQuote, disabled: true, busy: true };
      default:
        return {
          label: copy.buy,
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
              {listing
                ? copy.buyTitle(isBuy ? listing.name : (meta?.title ?? listing.name))
                : copy.orderTitleFallback}
            </DrawerTitle>
            <DrawerDescription>{copy.buySub}</DrawerDescription>
          </DrawerHeader>

          {/* The three acts (form → working → settling) hand off with a soft
              directional wash instead of a hard cut; the 2px blur masks the
              crossfade so two states never read double-exposed. */}
          <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={
              action.fillPhase ? "settling" : action.pending ? "stepper" : "form"
            }
            className="flex min-h-0 flex-1 flex-col"
            initial={{
              opacity: 0,
              transform: "translateY(10px)",
              filter: "blur(2px)",
            }}
            animate={{
              opacity: 1,
              transform: "translateY(0px)",
              filter: "blur(0px)",
            }}
            exit={{
              opacity: 0,
              transform: "translateY(-10px)",
              filter: "blur(2px)",
            }}
            transition={{ duration: 0.22, ease: EASE_LIFT }}
          >
          {listing && action.fillPhase ? (
            <div className="p-4">
              <IntentTracking
                reportState={action.reportState}
                phase={action.fillPhase}
                fillTxHash={action.fillTxHash}
                hubTxHash={action.hubTxHash}
                spokeTxHash={action.spokeTxHash}
                spokeTxUrl={action.spokeTxUrl}
                successTitle={copy.buyFilledTitle}
                successBody={copy.settledBody(
                  isBuy ? listing.name : (meta?.title ?? listing.name),
                )}
                onDone={() => {
                  onOpenChange(false);
                  finish();
                }}
              />
            </div>
          ) : listing && action.pending ? (
            <div className="p-4">
              <ActionStepper
                step={action.step}
                approveNeeded={action.approveRequired ?? true}
              />
            </div>
          ) : listing ? (
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
                          shouldn't be the only place that prices the account. */}
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
                      {copy.whatPayingWith}
                    </span>
                  )}
                  <CaretDown className="size-4 text-muted-foreground" />
                </button>

                {/* Funds without gas: the embedded wallet holds this token
                    but zero native balance on its chain, so the order would
                    die at the network fee. Say so before the quote does. */}
                {connected &&
                  token &&
                  gasShortChains.includes(srcChainKey) &&
                  (() => {
                    const native = getNativeGasToken(srcChainKey);
                    const symbol = native?.symbol ?? "the native token";
                    return (
                      <div className="flex gap-3 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2.5">
                        <GasPump className="mt-0.5 size-5 shrink-0 text-warn" />
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
                              className="self-start text-left font-medium text-warn underline underline-offset-2"
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
                          ? copy.ariaAmountIn(money.currency)
                          : copy.ariaAmount
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
                          ? copy.walletHolds(
                              balanceWorthUsd !== undefined
                                ? `≈ ${money.format(balanceWorthUsd)} (${formatTokenAmount(balance, token.decimals)} ${token.symbol})`
                                : `${formatTokenAmount(balance, token.decimals)} ${token.symbol}`,
                            )
                          : copy.checkingBalance
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
                    {tooSmall ? (
                      <span className="text-destructive">
                        {copy.smallestOrder(smallestOrderLabel)}
                      </span>
                    ) : quote.noRoute ? (
                      <span className="text-destructive">
                        {copy.noRouteForPair}
                      </span>
                    ) : quote.quoted !== undefined && quote.minOut !== undefined ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            {copy.youllHold}
                          </span>
                          <span className="font-medium text-foreground tabular-nums">
                            ≈ {formatTokenAmount(quote.quoted, listing.decimals, 6)} {listing.symbol}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{copy.atLeastLabel}</span>
                          <span className="tabular-nums">
                            {formatTokenAmount(quote.minOut, listing.decimals, 6)}
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
          </motion.div>
          </AnimatePresence>
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
