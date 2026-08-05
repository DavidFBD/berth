"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { toast } from "sonner";
import { ArrowsDownUp, CaretDown, Flame } from "@phosphor-icons/react";
import {
  ChainKeys,
  adjustAmountByFee,
  type LeverageYieldVault,
  type SpokeChainKey,
  type XToken,
} from "@sodax/sdk";
import { useQuote, useStatus, useXBalances } from "@sodax/dapp-kit";
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
import { DEFAULT_SLIPPAGE_PCT, PARTNER_FEE } from "@/lib/sodax-config";
import { getVaultMeta } from "@/lib/vaults-meta";
import {
  applySlippage,
  formatTokenAmount,
  formatUsd,
  parseAmount,
  usdToTokenAmount,
} from "@/lib/format";
import { CANCELLED_MESSAGE, useVaultAction } from "@/hooks/use-vault-action";
import { useVaultWallet } from "@/hooks/use-vault-wallet";
import { useEmbeddedHoldings } from "@/hooks/use-embedded-holdings";
import { useUsdPrices } from "@/hooks/use-usd-prices";
import { useNativeGasBuffer } from "@/hooks/use-native-gas-buffer";
import { ActionStepper, IntentTracking } from "./action-stepper";
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
  // What the typed amount means: dollars (default, when priced) or tokens.
  const [denom, setDenom] = useState<"usd" | "token">("usd");
  const [pickerOpen, setPickerOpen] = useState(false);

  const meta = vault ? getVaultMeta(vault.name) : null;
  const action = useVaultAction();
  const pending =
    action.step === "building" ||
    action.step === "approving" ||
    action.step === "signing";

  // Privy embedded wallet on EVM chains when signed in via email; external
  // wallets otherwise. Email mode switches chains silently.
  const { address, walletProvider, isWrongChain, handleSwitchChain, ensureChain } =
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

  // Dollars are how people think about a pour, so the amount field takes
  // USD whenever the oracle prices the token, with a tap-to-flip line for
  // exact token amounts. Unpriced tokens fall back to token entry.
  const price = token ? prices.priceOf(token) : undefined;
  const usdMode = denom === "usd" && price !== undefined;

  // What Max must hold back so the pour can pay its own network fee.
  const { buffer: gasBuffer } = useNativeGasBuffer({
    chainKey: srcChainKey,
    token,
    isNative: !!token && isNativeToken(token),
    priceUsd: price,
    balance,
  });
  const parsed = token
    ? usdMode
      ? usdToTokenAmount(amount, price, token.decimals)
      : parseAmount(amount, token.decimals)
    : undefined;
  const parsedUsd =
    token && parsed ? prices.usdValue(token, parsed) : undefined;
  // The partner fee is deducted from the input before the swap — quote on the
  // post-fee amount or minOutputAmount is unfillable.
  const quoteAmount = parsed
    ? adjustAmountByFee(parsed, PARTNER_FEE, "exact_input")
    : undefined;

  const quoteQuery = useQuote({
    params: {
      payload:
        open && vault && token && quoteAmount
          ? {
              token_src: token.address,
              token_src_blockchain_id: srcChainKey,
              token_dst: vault.vault,
              token_dst_blockchain_id: ChainKeys.SONIC_MAINNET,
              amount: quoteAmount,
              quote_type: "exact_input",
            }
          : undefined,
    },
    queryOptions: { retry: false },
  });
  const quoted = quoteQuery.data?.ok
    ? quoteQuery.data.value.quoted_amount
    : undefined;
  const noRoute = quoteQuery.data ? !quoteQuery.data.ok : false;
  const minReceived =
    quoted !== undefined
      ? applySlippage(quoted, DEFAULT_SLIPPAGE_PCT)
      : undefined;

  // Fill tracking after the intent lands on the hub.
  const statusQuery = useStatus({
    params: {
      intentTxHash: action.response
        ? (action.response.intentDeliveryInfo.dstTxHash as `0x${string}`)
        : undefined,
    },
  });
  const statusCode = statusQuery.data?.ok
    ? statusQuery.data.value.status
    : undefined;
  const fillTxHash = statusQuery.data?.ok
    ? statusQuery.data.value.fill_tx_hash
    : undefined;

  const toastedRef = useRef(false);
  useEffect(() => {
    if (toastedRef.current) return;
    if (statusCode === 3) {
      toastedRef.current = true;
      onPoured?.();
      toast.success("Your cup is poured.", {
        description: "The steam does the rest.",
      });
    } else if (statusCode === 4) {
      toastedRef.current = true;
      toast.error("The kettle's acting up.", {
        description: "The pour couldn't be filled. Nothing was lost, try again.",
      });
    }
  }, [statusCode, onPoured]);

  const finish = () => {
    action.reset();
    setAmount("");
    toastedRef.current = false;
    setTrackingTimedOut(false);
  };

  // Dismissing mid-tracking would drop the intent hash and the only progress
  // view — fills take under a minute, so keep the drawer up until terminal.
  // But the status poll can legitimately never turn terminal (NOT_FOUND / a
  // failing endpoint), so release the lock after a bounded wait rather than
  // trapping the user forever.
  const [trackingTimedOut, setTrackingTimedOut] = useState(false);
  useEffect(() => {
    if (action.step !== "done") return;
    const timer = setTimeout(() => setTrackingTimedOut(true), 90_000);
    return () => clearTimeout(timer);
  }, [action.step]);
  const trackingActive =
    action.step === "done" &&
    statusCode !== 3 &&
    statusCode !== 4 &&
    !trackingTimedOut;

  const handleOpenChange = (next: boolean) => {
    if (!next && (pending || trackingActive)) return;
    onOpenChange(next);
    if (!next) finish();
  };

  const handleMax = () => {
    if (!token || balance === undefined) return;
    if (gasBuffer === undefined) {
      toast.info("Checking what the burner costs. One moment.");
      return;
    }
    // Withhold only what the network actually charges (see useNativeGasBuffer);
    // non-native pours pay their fee from the native balance, so buffer is 0.
    const max = balance > gasBuffer ? balance - gasBuffer : 0n;
    if (max <= 0n) {
      toast.info("Not enough left over for the kettle (network fees)");
      return;
    }
    // Match the active denomination; in USD mode round DOWN so the
    // converted token amount never exceeds the spendable balance.
    if (usdMode) {
      const usd = Number(formatUnits(max, token.decimals)) * price;
      setAmount((Math.floor(usd * 100) / 100).toFixed(2));
    } else {
      setAmount(formatUnits(max, token.decimals));
    }
  };

  // Flip the entry denomination, carrying the current value across so the
  // number in the field keeps meaning the same pour.
  const flipDenom = () => {
    if (!token || price === undefined) return;
    if (usdMode) {
      setDenom("token");
      if (parsed) setAmount(formatUnits(parsed, token.decimals));
    } else {
      setDenom("usd");
      if (parsedUsd !== undefined) {
        setAmount((Math.floor(parsedUsd * 100) / 100).toFixed(2));
      }
    }
  };

  const handleDeposit = async () => {
    if (
      !vault ||
      !token ||
      !parsed ||
      minReceived === undefined ||
      !address ||
      !walletProvider
    ) {
      return;
    }
    await action.runDeposit({
      vault: vault.vault,
      srcChainKey,
      srcAddress: address,
      token,
      inputAmount: parsed,
      minOutputAmount: minReceived,
      walletProvider,
      ensureReady: ensureChain,
    });
  };

  type Cta = {
    label: string;
    disabled: boolean;
    busy?: boolean;
    onClick?: () => void;
  };
  // Token-first: a user whose only wallet is on another family (e.g. Phantom)
  // must be routed to the picker, not told to "connect" while already
  // connected — the source chain defaults to Ethereum until they pick.
  const cta: Cta = !token
    ? {
        label: "What are you pouring?",
        disabled: false,
        onClick: () => setPickerOpen(true),
      }
    : !address
      ? {
          label: `Connect a ${getChainName(srcChainKey)} wallet`,
          disabled: !onConnectWallet,
          onClick: onConnectWallet,
        }
      : !parsed
        ? { label: "Pour how much?", disabled: true }
        : balance === undefined
          ? { label: "Peeking in the teapot…", disabled: true, busy: true }
          : parsed > balance
            ? { label: "A touch more than your teapot holds", disabled: true }
            : isWrongChain
              ? {
                  label: "Switch network",
                  disabled: false,
                  onClick: handleSwitchChain,
                }
              : noRoute
                ? { label: "No blend path for this pair", disabled: true }
                : quoted === undefined ||
                    minReceived === undefined ||
                    !walletProvider
                  ? { label: "Reading the leaves…", disabled: true, busy: true }
                  : {
                      label: "Pour",
                      disabled: false,
                      onClick: () => void handleDeposit(),
                    };

  const showTracking = action.step === "done" && action.response !== null;

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={handleOpenChange}
        disablePointerDismissal={pending || trackingActive}
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>
              {meta ? `Pour into ${meta.teaName}` : "Pour a cup"}
            </DrawerTitle>
            <DrawerDescription>
              {vault
                ? "Any asset, any network. It all becomes tea."
                : "Pick a cup to pour into."}
            </DrawerDescription>
          </DrawerHeader>

          {vault && showTracking ? (
            <div className="p-4">
              <IntentTracking
                statusCode={statusCode}
                fillTxHash={fillTxHash}
                successTitle="Your cup is poured."
                successBody={meta ? `${meta.teaName} is steeping. The steam does the rest.` : "Your tea is steeping."}
                onDone={() => {
                  onOpenChange(false);
                  finish();
                }}
              />
            </div>
          ) : vault && pending ? (
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
                  className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted active:bg-muted"
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
                    </>
                  ) : (
                    <span className="flex-1 text-sm text-muted-foreground">
                      What are you pouring?
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
                            The {getChainName(srcChainKey)} shelf has no{" "}
                            {symbol} to light the burner. This pour pays its
                            network fee in {symbol}, so it can&apos;t start
                            until a splash arrives.
                          </p>
                          {onTopUp && (
                            <button
                              type="button"
                              onClick={onTopUp}
                              className="self-start text-left font-medium text-amber-800 underline underline-offset-2"
                            >
                              Send a splash of {symbol} to your teapot address
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                {/* Amount */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-baseline gap-0.5">
                    {usdMode && (
                      <span
                        aria-hidden
                        className={cn(
                          "text-4xl font-semibold tabular-nums",
                          amount
                            ? "text-foreground"
                            : "text-muted-foreground/40",
                        )}
                      >
                        $
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
                        usdMode
                          ? "Deposit amount in dollars"
                          : "Deposit amount"
                      }
                      disabled={!token}
                      className={cn(
                        "w-full bg-transparent text-4xl font-semibold text-foreground tabular-nums outline-none",
                        "placeholder:text-muted-foreground/40 disabled:opacity-50",
                      )}
                    />
                  </div>
                  {token && price !== undefined && (
                    <button
                      type="button"
                      onClick={flipDenom}
                      className="flex w-fit items-center gap-1 text-xs text-muted-foreground tabular-nums transition-colors hover:text-foreground"
                    >
                      <ArrowsDownUp className="size-3.5" />
                      {usdMode
                        ? `≈ ${parsed ? formatTokenAmount(parsed, token.decimals) : "0"} ${token.symbol}`
                        : `≈ ${parsedUsd !== undefined ? formatUsd(parsedUsd) : "$0"}`}
                    </button>
                  )}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      {token && address
                        ? balance !== undefined
                          ? `Teapot holds ${formatTokenAmount(balance, token.decimals)} ${token.symbol}`
                          : "Peeking in the teapot…"
                        : " "}
                    </span>
                    {token && balance !== undefined && balance > 0n && (
                      <Button variant="ghost" size="xs" onClick={handleMax}>
                        Max
                      </Button>
                    )}
                  </div>
                </div>

                {/* Live quote */}
                {token && parsed ? (
                  <div className="flex flex-col gap-1 rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
                    {noRoute ? (
                      <span className="text-destructive">
                        No route for this pair
                      </span>
                    ) : quoted !== undefined && minReceived !== undefined ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            You&apos;ll steep
                          </span>
                          <span className="font-medium text-foreground tabular-nums">
                            ≈ {formatTokenAmount(quoted, 18)} {vault.name}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>At least, once poured</span>
                          <span className="tabular-nums">
                            {formatTokenAmount(minReceived, 18)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Spinner className="size-3.5" /> Fetching quote…
                      </div>
                    )}
                  </div>
                ) : null}

                {action.step === "error" && action.error && (
                  <p
                    role="alert"
                    className={cn(
                      "rounded-xl px-3 py-2.5 text-sm",
                      action.error === CANCELLED_MESSAGE
                        ? "bg-muted/50 text-muted-foreground"
                        : "bg-destructive/10 text-destructive",
                    )}
                  >
                    {action.error}
                  </p>
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
