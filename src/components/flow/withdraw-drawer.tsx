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
import { useCopy, useMoney } from "@/components/settings-provider";
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
  const copy = useCopy();
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
        successTitle: copy.pouredBackTitle,
        successDescription: copy.pouredBackBody(getChainName(dstChainKey)),
        failureDescription: copy.pourBackFailedBody,
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
          label: copy.connectChainWallet(getChainName(srcChainKey)),
          disabled: !onConnectWallet,
          onClick: onConnectWallet,
        };
      case "pickDestination":
        return {
          label: copy.whereTo,
          disabled: false,
          onClick: () => setPickerOpen(true),
        };
      case "invalidRecipient":
        return { label: copy.ctaAddressLooksOff, disabled: true };
      case "connectDestination":
        return {
          label: copy.connectChainWallet(
            dstChainKey ? getChainName(dstChainKey) : "",
          ),
          disabled: !onConnectWallet,
          onClick: onConnectWallet,
        };
      case "enterAmount":
        return { label: copy.ctaPourBackHowMuch, disabled: true };
      case "insufficient":
        return { label: copy.ctaCupNotThatFull, disabled: true };
      case "wrongChain":
        return {
          label: copy.ctaSwitchNetwork,
          disabled: false,
          onClick: handleSwitchChain,
        };
      case "noRoute":
        return { label: copy.ctaNoRoute, disabled: true };
      case "belowDust":
        return { label: copy.ctaTooSmallForBtc, disabled: true };
      case "quotePending":
        return { label: copy.ctaReadingLeaves, disabled: true, busy: true };
      default:
        return {
          label: copy.pourBack,
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
              {meta ? copy.pourBackTitle(meta.teaName) : copy.pourBackTitleFallback}
            </DrawerTitle>
            <DrawerDescription>
              {vault
                ? copy.pourBackSub
                : copy.pickCupPourBack}
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
                successTitle={copy.backInTeapotTitle}
                successBody={
                  dstChainKey && outputToken
                    ? copy.backInTeapotBody(
                        outputToken.symbol,
                        getChainName(dstChainKey),
                      )
                    : copy.backInTeapotBodyFallback
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
                      className="flex w-fit items-center gap-1 text-xs text-muted-foreground tabular-nums transition-[transform,color] duration-150 ease-lift hover:text-foreground active:scale-[0.96]"
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
                        ? copy.cupHolds(
                            `≈ ${money.format(sharesWorthUsd(availableShares) ?? 0)}`,
                          )
                        : copy.cupHolds(
                            `${formatTokenAmount(availableShares, SHARE_DECIMALS)} ${vault.name}`,
                          )}
                    </span>
                    {availableShares > 0n && (
                      <Button variant="ghost" size="xs" onClick={handleMax}>
                        {copy.maxLabel}
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {copy.signOnceOn(getChainName(srcChainKey))}
                  </p>
                  {totalShares !== undefined &&
                    totalShares > availableShares && (
                      <p className="text-xs text-muted-foreground">
                        {sharePriceUsd !== undefined
                          ? copy.splitSharesNote(
                              `≈ ${money.format(sharesWorthUsd(availableShares) ?? 0)}`,
                              `≈ ${money.format(sharesWorthUsd(totalShares) ?? 0)}`,
                              getChainName(srcChainKey),
                            )
                          : copy.splitSharesNote(
                              formatTokenAmount(availableShares, SHARE_DECIMALS),
                              `${formatTokenAmount(totalShares, SHARE_DECIMALS)} shares`,
                              getChainName(srcChainKey),
                            )}
                      </p>
                    )}
                </div>

                {/* Destination chain + token */}
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-[transform,background-color] duration-150 ease-lift hover:bg-muted active:bg-muted active:scale-[0.99]"
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
                      {copy.whereShouldWePour}
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
                            {copy.pourToDifferentAddress}
                          </span>
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setCustomRecipient(null)}
                          >
                            {copy.useMyWallet}
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
                          {copy.tripleCheckAddress(
                            outputToken.symbol,
                            getChainName(dstChainKey),
                          )}
                        </p>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setCustomRecipient("")}
                        className="self-start py-1 text-xs font-bold text-muted-foreground transition-[transform,color] duration-150 ease-lift hover:text-foreground active:scale-[0.97]"
                      >
                        {copy.cashOutLink}
                      </button>
                    )}
                  </div>
                )}

                {/* Live quote */}
                {dstChainKey && outputToken && buildAmount ? (
                  <div className="flex flex-col gap-1 rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
                    {quote.noRoute ? (
                      <span className="text-destructive">
                        {copy.noRouteForPair}
                      </span>
                    ) : quote.quoted !== undefined && quote.minOut !== undefined ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            {copy.youllGetBack}
                          </span>
                          <span className="font-medium text-foreground tabular-nums">
                            {quotedWorthUsd !== undefined
                              ? `≈ ${money.format(quotedWorthUsd)}`
                              : `≈ ${formatTokenAmount(quote.quoted, outputToken.decimals)} ${outputToken.symbol}`}
                          </span>
                        </div>
                        {quotedWorthUsd !== undefined && (
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{copy.asTokenLabel}</span>
                            <span className="tabular-nums">
                              {formatTokenAmount(quote.quoted, outputToken.decimals)}{" "}
                              {outputToken.symbol} on {getChainName(dstChainKey)}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{copy.atLeastOncePoured}</span>
                          <span className="tabular-nums">
                            {minOutWorthUsd !== undefined
                              ? `≈ ${money.format(minOutWorthUsd)}`
                              : formatTokenAmount(quote.minOut, outputToken.decimals)}
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
        mode="destination"
        onSelect={(chainKey, selected) => {
          setDstChainKey(chainKey);
          setOutputToken(selected);
        }}
      />
    </>
  );
}
