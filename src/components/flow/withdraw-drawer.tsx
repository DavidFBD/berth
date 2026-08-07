"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { ArrowsDownUp, CaretDown } from "@phosphor-icons/react";
import {
  ChainKeys,
  isEvmChainKeyType,
  type LeverageYieldVault,
  type SpokeChainKey,
  type XToken,
} from "@sodax/sdk";
import { useLeverageYieldPreviewRedeem } from "@sodax/dapp-kit";
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
import { getChainName } from "@/lib/chains";
import { getVaultMeta } from "@/lib/vaults-meta";
import { formatTokenAmount } from "@/lib/format";
import {
  SHARE_DECIMALS,
  amountText,
  belowBtcDust,
  pourAmounts,
  withdrawGate,
} from "@/lib/pour-amount";
import { useMoney } from "@/components/settings-provider";
import { usePourQuote } from "@/hooks/use-pour-quote";
import { useUsdPrices } from "@/hooks/use-usd-prices";
import { useVaultAction } from "@/hooks/use-vault-action";
import { useVaultWallet } from "@/hooks/use-vault-wallet";
import { ActionError, ActionStepper, IntentTracking } from "./action-stepper";
import { TokenLogo, TokenPicker } from "./token-picker";

/** One vault share (18 decimals) — reads the price-per-share via previewRedeem. */
const ONE_SHARE = 10n ** 18n;

/**
 * Mirror of the deposit flow: swap lsoda* shares (held in the hub wallet
 * derived from `srcChainKey`) back into any solver token on any chain. One
 * signature on `srcChainKey`, no approval step.
 */
export function WithdrawDrawer({
  vault,
  open,
  onOpenChange,
  availableShares,
  srcChainKey,
  totalShares,
  onConnectWallet,
}: {
  vault: LeverageYieldVault | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shares held via `srcChainKey`'s hub wallet (18 decimals). */
  availableShares: bigint;
  /** Chain the user deposited FROM — they sign the withdraw message there. */
  srcChainKey: SpokeChainKey;
  /**
   * The user's share total across ALL source chains (18 decimals). When it
   * exceeds `availableShares`, the drawer explains why only part of the
   * position is withdrawable in this pass.
   */
  totalShares?: bigint;
  /** Optional: lets the CTA open the app's wallet drawer when disconnected. */
  onConnectWallet?: () => void;
}) {
  const [dstChainKey, setDstChainKey] = useState<SpokeChainKey | null>(null);
  const [outputToken, setOutputToken] = useState<XToken | null>(null);
  const [amount, setAmount] = useState("");
  // What the typed amount means: the user's display currency (default, when
  // the share price is known) or raw shares for the exact-amount crowd.
  const [denom, setDenom] = useState<"money" | "token">("money");
  const [pickerOpen, setPickerOpen] = useState(false);
  // Optional: pour to somebody else's address (e.g. an exchange deposit
  // address — the no-bank-rails cash-out path). null = own wallet.
  const [customRecipient, setCustomRecipient] = useState<string | null>(null);

  const meta = vault ? getVaultMeta(vault.name) : null;
  // The pour machine owns everything past the first tap: pipeline, solver
  // fill, toasts, XP, failure reporting. The drawer renders its states.
  const action = useVaultAction();

  // Privy embedded wallet on EVM chains when signed in via email; external
  // wallets otherwise. Email mode switches chains silently.
  const { address, walletProvider, mode, isWrongChain, handleSwitchChain, ensureChain } =
    useVaultWallet(srcChainKey);
  // Funds are delivered to the user's wallet ON the destination chain (the
  // SDK would otherwise default to `srcAddress`, the wrong format across
  // chain families) — unless the user typed a custom cash-out address.
  const ownRecipient = useVaultWallet(dstChainKey).address;
  const trimmedCustom = customRecipient?.trim() ?? "";
  const dstIsEvm = dstChainKey ? isEvmChainKeyType(dstChainKey) : false;
  const customLooksValid =
    trimmedCustom.length > 0 &&
    (!dstIsEvm || /^0x[a-fA-F0-9]{40}$/.test(trimmedCustom));
  const usingCustom = customRecipient !== null;
  const recipient = usingCustom
    ? customLooksValid
      ? trimmedCustom
      : undefined
    : ownRecipient;

  // A pour-back is money, not shares: the field takes the user's display
  // currency whenever the share price is known (vault price-per-share ×
  // hub-asset oracle price × FX), with a tap-to-flip line for exact shares.
  // The ticker never leads; this crowd thinks in euros, not lsoda*.
  const money = useMoney();
  const prices = useUsdPrices();
  const { data: pricePerShare } = useLeverageYieldPreviewRedeem({
    params: { vault: vault?.vault, shares: ONE_SHARE },
  });
  const assetPriceUsd = vault ? prices.priceOfHubAsset(vault.asset) : undefined;
  const sharePriceUsd =
    pricePerShare !== undefined && assetPriceUsd !== undefined
      ? Number(formatUnits(pricePerShare, SHARE_DECIMALS)) * assetPriceUsd
      : undefined;
  const entryPrice =
    sharePriceUsd !== undefined ? sharePriceUsd * money.rate : undefined;
  const sharesWorthUsd = (shares: bigint): number | undefined =>
    sharePriceUsd !== undefined
      ? Number(formatUnits(shares, SHARE_DECIMALS)) * sharePriceUsd
      : undefined;

  // The amount pipeline: money or shares in, shares (18dp) out; the quote is
  // asked for the post-fee amount and the slippage floor applied — all in
  // the pour-amount module.
  const { moneyMode, buildAmount } = pourAmounts(
    amount,
    denom,
    SHARE_DECIMALS,
    entryPrice,
  );
  const quote = usePourQuote({
    enabled: open && !!vault && !!dstChainKey && !!outputToken,
    src: vault
      ? { address: vault.vault, chainKey: ChainKeys.SONIC_MAINNET }
      : null,
    dst:
      dstChainKey && outputToken
        ? { address: outputToken.address, chainKey: dstChainKey }
        : null,
    buildAmount,
  });
  const dustBlocked = belowBtcDust(dstChainKey, outputToken?.symbol, quote.minOut);
  // What the quote is worth in the user's money; undefined for unpriced
  // output tokens, which keep their token-denominated rows.
  const quotedWorthUsd =
    outputToken && quote.quoted !== undefined
      ? prices.usdValue(outputToken, quote.quoted)
      : undefined;
  const minOutWorthUsd =
    outputToken && quote.minOut !== undefined
      ? prices.usdValue(outputToken, quote.minOut)
      : undefined;

  const finish = () => {
    action.reset();
    setAmount("");
    setCustomRecipient(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && action.locked) return;
    onOpenChange(next);
    if (!next) finish();
  };

  const handleMax = () => {
    if (availableShares <= 0n) return;
    setAmount(
      amountText(
        availableShares,
        SHARE_DECIMALS,
        moneyMode,
        entryPrice,
        money.fractionDigits,
      ),
    );
  };

  // Flip the entry denomination, carrying the current value across so the
  // number in the field keeps meaning the same pour-back.
  const flipDenom = () => {
    if (entryPrice === undefined) return;
    setDenom(moneyMode ? "token" : "money");
    if (buildAmount) {
      setAmount(
        amountText(
          buildAmount,
          SHARE_DECIMALS,
          !moneyMode,
          entryPrice,
          money.fractionDigits,
        ),
      );
    }
  };

  const handleWithdraw = async () => {
    if (
      !vault ||
      !dstChainKey ||
      !outputToken ||
      !buildAmount ||
      quote.minOut === undefined ||
      !address ||
      !recipient ||
      !walletProvider
    ) {
      return;
    }
    await action.runWithdraw({
      vault: vault.vault,
      vaultName: vault.name,
      srcChainKey,
      srcAddress: address,
      dstChainKey,
      outputToken: outputToken.address,
      outputTokenSymbol: outputToken.symbol,
      inputAmount: buildAmount,
      minOutputAmount: quote.minOut,
      recipient,
      walletProvider,
      walletMode: mode,
      fillToasts: {
        successTitle: "Poured back.",
        successDescription: `Funds delivered on ${getChainName(dstChainKey)}.`,
        failureDescription: "Your cup is untouched. Please try again.",
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
  // The gate (pour-amount module) decides why the pour-back can't go yet;
  // this map only speaks it in the tea voice.
  const gate = withdrawGate({
    address,
    hasDestination: !!dstChainKey && !!outputToken,
    recipient,
    usingCustomRecipient: usingCustom,
    buildAmount,
    availableShares,
    isWrongChain,
    noRoute: quote.noRoute,
    belowDust: dustBlocked,
    quoted: quote.quoted,
    minOut: quote.minOut,
    hasWalletProvider: !!walletProvider,
  });
  const cta: Cta = (() => {
    switch (gate.kind) {
      case "connectSource":
        return {
          label: `Connect ${getChainName(srcChainKey)} wallet`,
          disabled: !onConnectWallet,
          onClick: onConnectWallet,
        };
      case "pickDestination":
        return {
          label: "Where to?",
          disabled: false,
          onClick: () => setPickerOpen(true),
        };
      case "invalidRecipient":
        return { label: "That address looks off", disabled: true };
      case "connectDestination":
        return {
          label: `Connect ${dstChainKey ? getChainName(dstChainKey) : ""} wallet`,
          disabled: !onConnectWallet,
          onClick: onConnectWallet,
        };
      case "enterAmount":
        return { label: "Pour back how much?", disabled: true };
      case "insufficient":
        return { label: "Your cup isn't quite that full", disabled: true };
      case "wrongChain":
        return {
          label: "Switch network",
          disabled: false,
          onClick: handleSwitchChain,
        };
      case "noRoute":
        return { label: "No blend path for this pair", disabled: true };
      case "belowDust":
        return { label: "Too small a sip for Bitcoin", disabled: true };
      case "quotePending":
        return { label: "Reading the leaves…", disabled: true, busy: true };
      default:
        return {
          label: "Pour back",
          disabled: false,
          onClick: () => void handleWithdraw(),
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
              {meta ? `Pour back from ${meta.teaName}` : "Pour back"}
            </DrawerTitle>
            <DrawerDescription>
              {vault
                ? "Back to any asset, on any network. The tea keeps its warmth."
                : "Pick a cup to pour back from."}
            </DrawerDescription>
          </DrawerHeader>

          {vault && action.fillPhase ? (
            <div className="p-4">
              <IntentTracking
                reportState={action.reportState}
                phase={action.fillPhase}
                fillTxHash={action.fillTxHash}
                successTitle="Back in your teapot."
                successBody={
                  dstChainKey && outputToken
                    ? `${outputToken.symbol} is on its way to you on ${getChainName(dstChainKey)}, ready when you are.`
                    : "Ready when you are."
                }
                onDone={() => {
                  onOpenChange(false);
                  finish();
                }}
              />
            </div>
          ) : vault && action.pending ? (
            <div className="p-4">
              <ActionStepper step={action.step} approveNeeded={false} />
            </div>
          ) : vault ? (
            <>
              <div className="flex flex-col gap-4 overflow-y-auto p-4">
                {/* Amount: money leads, shares live behind the flip */}
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
                          ? `Amount to pour back in ${money.currency}`
                          : "Shares to withdraw"
                      }
                      className={cn(
                        "w-full bg-transparent text-4xl font-semibold text-foreground tabular-nums outline-none",
                        "placeholder:text-muted-foreground/40",
                      )}
                    />
                  </div>
                  {entryPrice !== undefined && (
                    <button
                      type="button"
                      onClick={flipDenom}
                      className="flex w-fit items-center gap-1 text-xs text-muted-foreground tabular-nums transition-colors hover:text-foreground"
                    >
                      <ArrowsDownUp className="size-3.5" />
                      {moneyMode
                        ? `≈ ${buildAmount ? formatTokenAmount(buildAmount, SHARE_DECIMALS) : "0"} ${vault.name}`
                        : `≈ ${money.format(sharesWorthUsd(buildAmount ?? 0n) ?? 0)}`}
                    </button>
                  )}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      {sharePriceUsd !== undefined
                        ? `Your cup holds ≈ ${money.format(sharesWorthUsd(availableShares) ?? 0)}`
                        : `Your cup holds ${formatTokenAmount(availableShares, SHARE_DECIMALS)} ${vault.name}`}
                    </span>
                    {availableShares > 0n && (
                      <Button variant="ghost" size="xs" onClick={handleMax}>
                        Max
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    You&apos;ll sign once on {getChainName(srcChainKey)}, the
                    chain you deposited from.
                  </p>
                  {totalShares !== undefined &&
                    totalShares > availableShares && (
                      <p className="text-xs text-muted-foreground">
                        {sharePriceUsd !== undefined
                          ? `≈ ${money.format(sharesWorthUsd(availableShares) ?? 0)} of your ≈ ${money.format(sharesWorthUsd(totalShares) ?? 0)} total`
                          : `${formatTokenAmount(availableShares, SHARE_DECIMALS)} of your ${formatTokenAmount(totalShares, SHARE_DECIMALS)} total shares`}{" "}
                        sits under {getChainName(srcChainKey)}. The rest were
                        deposited via other chains and become withdrawable in
                        a follow-up pass.
                      </p>
                    )}
                </div>

                {/* Destination chain + token */}
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted active:bg-muted"
                >
                  {dstChainKey && outputToken ? (
                    <>
                      <TokenLogo
                        symbol={outputToken.symbol}
                        chainKey={dstChainKey}
                      />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="text-sm font-medium text-foreground">
                          {outputToken.symbol}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          to {getChainName(dstChainKey)}
                        </span>
                      </div>
                    </>
                  ) : (
                    <span className="flex-1 text-sm text-muted-foreground">
                      Where should we pour it?
                    </span>
                  )}
                  <CaretDown className="size-4 text-muted-foreground" />
                </button>

                {/* Cash-out path: pour to a different address (e.g. an
                    exchange deposit address) instead of your own wallet. */}
                {dstChainKey && outputToken && (
                  <div className="flex flex-col gap-1.5">
                    {usingCustom ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-muted-foreground">
                            Pouring to a different address
                          </span>
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setCustomRecipient(null)}
                          >
                            Use my wallet
                          </Button>
                        </div>
                        <input
                          value={customRecipient}
                          onChange={(event) =>
                            setCustomRecipient(event.target.value)
                          }
                          placeholder={`${getChainName(dstChainKey)} address`}
                          autoComplete="off"
                          autoCorrect="off"
                          spellCheck={false}
                          aria-label="Custom destination address"
                          className="money w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-ring"
                        />
                        <p className="text-[11.5px] leading-snug text-destructive">
                          Triple-check this. Tea poured to the wrong address is
                          gone for good, and the receiving side (your
                          exchange) must accept {outputToken.symbol} on{" "}
                          {getChainName(dstChainKey)}.
                        </p>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setCustomRecipient("")}
                        className="self-start py-1 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Cash out? Pour to an exchange address instead →
                      </button>
                    )}
                  </div>
                )}

                {/* Live quote */}
                {dstChainKey && outputToken && buildAmount ? (
                  <div className="flex flex-col gap-1 rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
                    {quote.noRoute ? (
                      <span className="text-destructive">
                        No route for this pair
                      </span>
                    ) : quote.quoted !== undefined && quote.minOut !== undefined ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            You&apos;ll get back
                          </span>
                          <span className="font-medium text-foreground tabular-nums">
                            {quotedWorthUsd !== undefined
                              ? `≈ ${money.format(quotedWorthUsd)}`
                              : `≈ ${formatTokenAmount(quote.quoted, outputToken.decimals)} ${outputToken.symbol}`}
                          </span>
                        </div>
                        {quotedWorthUsd !== undefined && (
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>As</span>
                            <span className="tabular-nums">
                              {formatTokenAmount(quote.quoted, outputToken.decimals)}{" "}
                              {outputToken.symbol} on {getChainName(dstChainKey)}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>At least, once poured</span>
                          <span className="tabular-nums">
                            {minOutWorthUsd !== undefined
                              ? `≈ ${money.format(minOutWorthUsd)}`
                              : formatTokenAmount(quote.minOut, outputToken.decimals)}
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
        mode="destination"
        onSelect={(chainKey, selected) => {
          setDstChainKey(chainKey);
          setOutputToken(selected);
        }}
      />
    </>
  );
}
