"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { toast } from "sonner";
import { CaretDown } from "@phosphor-icons/react";
import {
  ChainKeys,
  adjustAmountByFee,
  isEvmChainKeyType,
  type LeverageYieldVault,
  type SpokeChainKey,
  type XToken,
} from "@sodax/sdk";
import { useQuote, useStatus } from "@sodax/dapp-kit";
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
import { DEFAULT_SLIPPAGE_PCT, PARTNER_FEE } from "@/lib/sodax-config";
import { getVaultMeta } from "@/lib/vaults-meta";
import { applySlippage, formatTokenAmount, parseAmount } from "@/lib/format";
import { useVaultAction } from "@/hooks/use-vault-action";
import { useVaultWallet } from "@/hooks/use-vault-wallet";
import { useErrorReporter } from "@/hooks/use-error-reporter";
import { useAwardPour } from "@/hooks/use-profile";
import { addressHint, type ErrorReportContext } from "@/lib/error-report";
import { FILL_FAILED_MESSAGE } from "@/lib/error-copy";
import { ActionError, ActionStepper, IntentTracking } from "./action-stepper";
import { TokenLogo, TokenPicker } from "./token-picker";

/** lsoda* shares are 18-decimal ERC-4626 tokens on the Sonic hub. */
const SHARE_DECIMALS = 18;
/** Bitcoin dust limit — the solver can't deliver less than this. */
const BTC_DUST_SATS = 546n;

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
  const [pickerOpen, setPickerOpen] = useState(false);
  // Optional: pour to somebody else's address (e.g. an exchange deposit
  // address — the no-bank-rails cash-out path). null = own wallet.
  const [customRecipient, setCustomRecipient] = useState<string | null>(null);

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
  // Funds are delivered to the user's wallet ON the destination chain (the
  // SDK would otherwise default to `srcAddress`, the wrong format across
  // chain families) — unless the user typed a custom cash-out address.
  const ownRecipient = useVaultWallet(dstChainKey).address;
  // A failed FILL lands after useVaultAction has handed off, so it needs its
  // own reporter — see the deposit drawer.
  const { report: reportFill, reportState: fillReportState } =
    useErrorReporter();
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

  const parsed = parseAmount(amount, SHARE_DECIMALS);
  // The partner fee is deducted from the input shares before the swap —
  // quote on the post-fee amount or minOutputAmount is unfillable.
  const quoteAmount = parsed
    ? adjustAmountByFee(parsed, PARTNER_FEE, "exact_input")
    : undefined;

  const quoteQuery = useQuote({
    params: {
      payload:
        open && vault && dstChainKey && outputToken && quoteAmount
          ? {
              token_src: vault.vault,
              token_src_blockchain_id: ChainKeys.SONIC_MAINNET,
              token_dst: outputToken.address,
              token_dst_blockchain_id: dstChainKey,
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
  // Dust floor applies to native BTC only — guard on the token, not just the
  // chain, in case Bitcoin's solver list ever gains a non-BTC (non-8dp) token.
  const belowBtcDust =
    dstChainKey === ChainKeys.BITCOIN_MAINNET &&
    outputToken?.symbol === "BTC" &&
    minReceived !== undefined &&
    minReceived < BTC_DUST_SATS;

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

  /**
   * Everything a fill-failure report needs, synced after commit so the effect
   * below can fire on terminal status alone without closing over stale values.
   */
  const fillContextRef = useRef<Partial<ErrorReportContext>>({});
  useEffect(() => {
    fillContextRef.current = {
      vaultName: vault?.name,
      srcChainKey,
      dstChainKey: dstChainKey ?? undefined,
      tokenSymbol: outputToken?.symbol,
      amount: parsed ? `${parsed} shares (18dp)` : undefined,
      addressHint: addressHint(address),
      txHashes: [
        action.response?.intentDeliveryInfo.dstTxHash,
        fillTxHash,
      ].filter((hash): hash is string => !!hash),
    };
  });

  const { mutate: awardPour } = useAwardPour();
  const toastedRef = useRef(false);
  useEffect(() => {
    if (toastedRef.current) return;
    if (statusCode === 3) {
      toastedRef.current = true;
      toast.success("Poured back.", {
        description: dstChainKey
          ? `Funds delivered on ${getChainName(dstChainKey)}.`
          : "Funds delivered.",
      });
      // Rewards ride the same context the failure report does: the first
      // hash is the intent's hub tx, the ledger's dedup handle.
      const intentTxHash = fillContextRef.current.txHashes?.[0];
      if (intentTxHash) awardPour({ direction: "out", intentTxHash });
    } else if (statusCode === 4) {
      toastedRef.current = true;
      toast.error(FILL_FAILED_MESSAGE, {
        description: "Your cup is untouched. Please try again.",
      });
      // Signed, delivered to the hub, then unfilled by the solver: a failed
      // transaction with funds already in motion. Nothing else reported it.
      reportFill({
        action: "withdraw",
        step: "filling",
        ...fillContextRef.current,
        errorCode: "SOLVER_FILL_FAILED",
        friendlyMessage: FILL_FAILED_MESSAGE,
        rawMessage: "Solver reported status 4 (failed) for the withdraw intent.",
      } as ErrorReportContext);
    }
  }, [statusCode, dstChainKey, reportFill, awardPour]);

  const finish = () => {
    action.reset();
    setAmount("");
    setCustomRecipient(null);
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
    if (availableShares <= 0n) return;
    setAmount(formatUnits(availableShares, SHARE_DECIMALS));
  };

  const handleWithdraw = async () => {
    if (
      !vault ||
      !dstChainKey ||
      !outputToken ||
      !parsed ||
      minReceived === undefined ||
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
      inputAmount: parsed,
      minOutputAmount: minReceived,
      recipient,
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
  const cta: Cta = !address
    ? {
        label: `Connect ${getChainName(srcChainKey)} wallet`,
        disabled: !onConnectWallet,
        onClick: onConnectWallet,
      }
    : !dstChainKey || !outputToken
      ? {
          label: "Where to?",
          disabled: false,
          onClick: () => setPickerOpen(true),
        }
      : !recipient
        ? usingCustom
          ? { label: "That address looks off", disabled: true }
          : {
              label: `Connect ${getChainName(dstChainKey)} wallet`,
              disabled: !onConnectWallet,
              onClick: onConnectWallet,
            }
        : !parsed
          ? { label: "Pour back how much?", disabled: true }
          : parsed > availableShares
            ? { label: "Your cup isn't quite that full", disabled: true }
            : isWrongChain
              ? {
                  label: "Switch network",
                  disabled: false,
                  onClick: handleSwitchChain,
                }
              : noRoute
                ? { label: "No blend path for this pair", disabled: true }
                : belowBtcDust
                  ? { label: "Too small a sip for Bitcoin", disabled: true }
                  : quoted === undefined ||
                      minReceived === undefined ||
                      !walletProvider
                    ? { label: "Reading the leaves…", disabled: true, busy: true }
                    : {
                        label: "Pour back",
                        disabled: false,
                        onClick: () => void handleWithdraw(),
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
              {meta ? `Pour back from ${meta.teaName}` : "Pour back"}
            </DrawerTitle>
            <DrawerDescription>
              {vault
                ? "Back to any asset, on any network. The tea keeps its warmth."
                : "Pick a cup to pour back from."}
            </DrawerDescription>
          </DrawerHeader>

          {vault && showTracking ? (
            <div className="p-4">
              <IntentTracking
                reportState={fillReportState}
                statusCode={statusCode}
                fillTxHash={fillTxHash}
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
          ) : vault && pending ? (
            <div className="p-4">
              <ActionStepper step={action.step} approveNeeded={false} />
            </div>
          ) : vault ? (
            <>
              <div className="flex flex-col gap-4 overflow-y-auto p-4">
                {/* Shares amount */}
                <div className="flex flex-col gap-1.5">
                  <input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    inputMode="decimal"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="0"
                    aria-label="Shares to withdraw"
                    className={cn(
                      "w-full bg-transparent text-4xl font-semibold text-foreground tabular-nums outline-none",
                      "placeholder:text-muted-foreground/40",
                    )}
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      Your cup holds{" "}
                      {formatTokenAmount(availableShares, SHARE_DECIMALS)}{" "}
                      {vault.name}
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
                        {formatTokenAmount(availableShares, SHARE_DECIMALS)} of
                        your {formatTokenAmount(totalShares, SHARE_DECIMALS)}{" "}
                        total shares sit under {getChainName(srcChainKey)}. The
                        rest were deposited via other chains and become
                        withdrawable in a follow-up pass.
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
                {dstChainKey && outputToken && parsed ? (
                  <div className="flex flex-col gap-1 rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
                    {noRoute ? (
                      <span className="text-destructive">
                        No route for this pair
                      </span>
                    ) : quoted !== undefined && minReceived !== undefined ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            You&apos;ll get back
                          </span>
                          <span className="font-medium text-foreground tabular-nums">
                            ≈ {formatTokenAmount(quoted, outputToken.decimals)}{" "}
                            {outputToken.symbol}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>At least, once poured</span>
                          <span className="tabular-nums">
                            {formatTokenAmount(minReceived, outputToken.decimals)}
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
