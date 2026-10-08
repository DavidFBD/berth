"use client";

import { toast } from "@/lib/toast";
import { useState } from "react";
import { formatUnits } from "viem";
import { AnimatePresence, motion } from "motion/react";
import { ArrowsDownUp, CaretDown } from "@phosphor-icons/react";
import {
  ChainKeys,
  isEvmChainKeyType,
  type SpokeChainKey,
  type XToken,
} from "@sodax/sdk";
import { useLeverageYieldPreviewRedeem, useXBalances } from "@sodax/dapp-kit";
import { getXChainType, useXService } from "@sodax/wallet-sdk-react";
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
import { getChainName, getNativeGasToken, isTypedEvmAddress, toBalanceReadToken } from "@/lib/chains";
import { floorWarns, gasToAdd, orderGasShort } from "@/lib/gas-need";
import { useGasGate, useGasPreflight } from "@/hooks/use-gas-gate";
import { gasShortMessage, shortfallProp } from "@/lib/gas-message";
import { useWalletOnlySession } from "@/hooks/use-account";
import { useOutcomeHold, useSponsoredChainNames } from "@/hooks/use-sponsor-refusals";
import { getVaultMeta } from "@/lib/vaults-meta";
import type { Listing } from "@/lib/listings";
import { formatTokenAmount, formatUsd, parseAmount, shortenAddress } from "@/lib/format";
import {
  SHARE_DECIMALS,
  amountText,
  belowBtcDust,
  belowMinimum,
  minPourUsd,
  pourAmounts,
  swapInputFor,
  withdrawGate,
} from "@/lib/pour-amount";
import {
  dayLabel,
  fillsNow,
  limitCta,
  limitMinOutput,
  limitTokenOk,
  priceNumber,
  priceText as limitPriceText,
} from "@/lib/limit-orders";
import { useLimitDraft, type LimitPrefill } from "@/hooks/use-limit-draft";
import { LimitPlaced, LimitPriceFields, LimitSummary } from "./limit-price";
import { useCopy, useMoney } from "@/components/settings-provider";
import { usePourQuote } from "@/hooks/use-pour-quote";
import { useUsdPrices } from "@/hooks/use-usd-prices";
import { useListingPrices } from "@/hooks/use-listing-prices";
import { useVaultAction } from "@/hooks/use-vault-action";
import { useVaultAddress, useVaultWallet } from "@/hooks/use-vault-wallet";
import { useAccountWallets } from "@/hooks/use-profile";
import {
  ActionError,
  ActionStepper,
  EarlierOrderNote,
  IntentTracking,
} from "./action-stepper";
import { TokenLogo, TokenPicker } from "./token-picker";
import { useDrawerFunnel } from "@/components/analytics/use-drawer-funnel";

/** One vault share (18 decimals) — reads the price-per-share via previewRedeem. */
const ONE_SHARE = 10n ** 18n;

/**
 * Mirror of the deposit flow: swap what the hub wallet derived from
 * `srcChainKey` holds of a listing back into any solver token on any chain.
 * One signature on `srcChainKey`, no approval step: the payload carries
 * `hubWalletSwap`, so the hub wallet is authorised by a `sendMessage` the
 * user signs on the spoke, never a Sonic transaction.
 *
 * A vault withdrawal keeps its old habits (shares priced by `previewRedeem`,
 * the chain it was deposited from). A stock or cash listing is a sell: plain
 * name, oracle price, and `srcChainKey` is the home chain, since every
 * listing lives on THE account (lib/account).
 */
export function WithdrawDrawer({
  listing,
  open,
  onOpenChange,
  availableShares,
  srcChainKey,
  totalShares,
  onConnectWallet,
  prefill,
  devLimit,
  sellFrom,
  sourceIsHome = true,
  signerLinked,
  onAddWallet,
}: {
  listing: Listing | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Units held via `srcChainKey`'s hub wallet (18 decimals for every listing). */
  availableShares: bigint;
  /**
   * Chain the user signs the message on: for a vault, the chain they deposited
   * FROM; for a listing sell, the home chain.
   */
  srcChainKey: SpokeChainKey;
  /**
   * The user's share total across ALL source chains (18 decimals). When it
   * exceeds `availableShares`, the drawer explains why only part of the
   * position is withdrawable in this pass.
   */
  totalShares?: bigint;
  /** Optional: lets the CTA open the app's wallet drawer when disconnected. */
  onConnectWallet?: () => void;
  /**
   * Optional: where to start, from a draft an assistant made
   * (lib/draft-order): dollars to take out, or units to sell, never more
   * than `availableShares`. Filled in once; never submitted.
   */
  prefill?: { usd?: number; quantity?: number; limit?: LimitPrefill } | null;
  /** Dev galleries only: show "Set a price" as if the switch were on. */
  devLimit?: boolean;
  /**
   * A listing sell from an account with more than one hub wallet holding it
   * (lib/account-wallets sellSources): the drawer asks which, and a hub
   * wallet only its own address can sign for says so on the button.
   * `availableShares` is then the chosen one's holding.
   */
  sellFrom?: {
    sources: { spoke: string; isHome: boolean; balance: bigint; canSign: boolean }[];
    chosen: string;
    onChoose: (spoke: string) => void;
  };
  /** False when the one hub wallet selling is not the home's: no limit sell then (v1 is home only). */
  sourceIsHome?: boolean;
  /** False when the signing wallet is connected but not on the account yet. */
  signerLinked?: boolean;
  /** Adds the connected wallet to the account (hooks/use-account-wallets). */
  onAddWallet?: () => void;
}) {
  const [dstChainKey, setDstChainKey] = useState<SpokeChainKey | null>(null);
  const [outputToken, setOutputToken] = useState<XToken | null>(null);
  const [amount, setAmount] = useState("");
  // What the typed amount means: the user's display currency (default, when
  // the share price is known) or raw shares for the exact-amount crowd.
  const [denom, setDenom] = useState<"money" | "token">("money");
  // What Max wrote, and the holding it saw when pressed: while the field
  // still shows that text, the order is exactly that many shares (lib/
  // pour-amount pourAmounts `max`). A snapshot, so a holding that grows
  // meanwhile (a buy filling in another tab) never sells more than shown.
  const [maxed, setMaxed] = useState<{ text: string; amount: bigint } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Optional: send to somebody else's address (e.g. an exchange deposit
  // address — the no-bank-rails cash-out path). null = own wallet.
  const [customRecipient, setCustomRecipient] = useState<string | null>(null);

  const isSell = !!listing && listing.kind !== "vault";
  const meta =
    listing?.kind === "vault" ? getVaultMeta(listing.vault.name) : null;
  const copy = useCopy();
  // The order machine owns everything past the first tap: pipeline, solver
  // fill, toasts, XP, failure reporting. The drawer renders its states.
  const action = useVaultAction();

  // Privy embedded wallet on EVM chains when signed in via email; external
  // wallets otherwise. Email mode switches chains silently.
  const { address, walletProvider, mode, isWrongChain, handleSwitchChain, ensureReady, asleep } =
    useVaultWallet(srcChainKey);
  // The sell is one transaction the person signs on `srcChainKey`, paid in
  // that chain's native token: without enough of it the wallet refuses
  // (lib/gas-need). Where the money lands needs nothing from them.
  const signNative = getNativeGasToken(srcChainKey);
  const signXService = useXService({ xChainType: getXChainType(srcChainKey) });
  const signNativeQuery = useXBalances({
    params: {
      xService: signXService,
      xChainId: srcChainKey,
      xTokens: signNative ? [toBalanceReadToken(signNative)] : [],
      address: open && signNative ? address : undefined,
    },
    queryOptions: { refetchInterval: 30_000, staleTime: 15_000 },
  });
  const signNativeBalance =
    signNative && signNativeQuery.data
      ? (signNativeQuery.data[toBalanceReadToken(signNative).address] ?? 0n)
      : undefined;
  // A wallet that pays its own fee is stopped here, before the flow
  // starts, below the larger of the chain's price and what wallets attach
  // on top (lib/gas-need blockingNeed); a sponsored sell is never stopped.
  const signGas = useGasGate([srcChainKey], open);
  const signGasFacts = {
    chainKey: srcChainKey,
    isNative: false,
    nativeBalance: signNativeBalance,
    amount: 0n,
    need: signGas.needFor(srcChainKey, false, "sell"),
    sponsored: signGas.sponsored(srcChainKey),
  };
  const signGasShort = orderGasShort(signGasFacts);
  const signGasToAdd = signGasShort ? gasToAdd(signGasFacts) : undefined;
  // Clears the gate, but a wallet attaching 2 gwei would ask for more: say
  // so calmly and let the person sign (lib/gas-need warnReserve).
  const signGasFloorWarn = floorWarns({ ...signGasFacts, warnNeed: signGas.warnNeedFor(srcChainKey, false, "sell") });
  const gasPreflight = useGasPreflight();
  // A session with no email signs every order with its own wallet and pays
  // every fee itself: said calmly near the fee line, every time.
  const walletSession = useWalletOnlySession();
  // Only where an email sign-in would in fact pay nothing (lib/gas-sponsor,
  // minus any chain Privy refused this session) is the note true.
  const emailCoversFee = useSponsoredChainNames().includes(getChainName(srcChainKey));
  // A sponsored send may still land: no second tap for a minute (lib/gas-sponsor).
  const outcomeHold = useOutcomeHold();
  // Funds are delivered to the user's wallet ON the destination chain (the
  // SDK would otherwise default to `srcAddress`, the wrong format across
  // chain families) — unless the user typed a custom cash-out address. The
  // address only, never the full wallet: nobody signs on the destination, and
  // building its provider would switch the embedded wallet's global chain out
  // from under the signature (issue #15).
  const ownRecipient = useVaultAddress(dstChainKey);
  const trimmedCustom = customRecipient?.trim() ?? "";
  const dstIsEvm = dstChainKey ? isEvmChainKeyType(dstChainKey) : false;
  const customLooksValid =
    trimmedCustom.length > 0 &&
    (!dstIsEvm || isTypedEvmAddress(trimmedCustom));
  const usingCustom = customRecipient !== null;
  const recipient = usingCustom
    ? customLooksValid
      ? trimmedCustom
      : undefined
    : ownRecipient;

  // A withdrawal is money, not shares: the field takes the user's display
  // currency whenever the share price is known (vault price-per-share ×
  // hub-asset oracle price × FX), with a tap-to-flip line for exact shares.
  // The ticker never leads; this crowd thinks in euros, not lsoda*.
  const money = useMoney();
  const prices = useUsdPrices();
  const listingPrices = useListingPrices();
  // Vault positions are valued through previewRedeem times the hub asset's
  // oracle price; a listing sell is priced straight by the solver oracle.
  // Query disabled for listings (undefined vault).
  const vaultListing = listing?.kind === "vault" ? listing : null;
  const { data: pricePerShare } = useLeverageYieldPreviewRedeem({
    params: { vault: vaultListing?.address, shares: ONE_SHARE },
  });
  const assetPriceUsd = vaultListing
    ? prices.priceOfHubAsset(vaultListing.vault.asset)
    : undefined;
  const sharePriceUsd = isSell
    ? listingPrices.priceOf(listing)
    : pricePerShare !== undefined && assetPriceUsd !== undefined
      ? Number(formatUnits(pricePerShare, SHARE_DECIMALS)) * assetPriceUsd
      : undefined;
  const entryPrice =
    sharePriceUsd !== undefined ? sharePriceUsd * money.rate : undefined;
  const sharesWorthUsd = (shares: bigint): number | undefined =>
    sharePriceUsd !== undefined
      ? Number(formatUnits(shares, SHARE_DECIMALS)) * sharePriceUsd
      : undefined;

  // A drafted amount goes in once per opening: units as units, dollars
  // only once the listing has a price to read them by, either capped at
  // what can be sold. Render-time adjustment, per house pattern.
  const [prefilled, setPrefilled] = useState(false);
  // Set when the draft asked for more than can be sold from here: the
  // drawer says so instead of shrinking the amount without a word.
  const [capped, setCapped] = useState(false);
  if (!open && prefilled) {
    setPrefilled(false);
    setCapped(false);
  }
  if (open && !prefilled && prefill && amount === "") {
    if (prefill.quantity) {
      const asked = parseAmount(String(prefill.quantity), SHARE_DECIMALS);
      if (asked !== undefined && availableShares > 0n) {
        setPrefilled(true);
        setCapped(asked > availableShares);
        setDenom("token");
        setAmount(formatUnits(asked > availableShares ? availableShares : asked, SHARE_DECIMALS));
      }
    } else if (prefill.usd && entryPrice !== undefined && sharePriceUsd !== undefined && availableShares > 0n) {
      // Never more dollars than the shares that can be sold are worth,
      // rounded down so the cap itself never tips over them.
      const worthUsd = Number(formatUnits(availableShares, SHARE_DECIMALS)) * sharePriceUsd;
      const step = 10 ** money.fractionDigits;
      setPrefilled(true);
      setCapped(prefill.usd > worthUsd);
      setDenom("money");
      setAmount((Math.floor(Math.min(prefill.usd, worthUsd) * money.rate * step) / step).toFixed(money.fractionDigits));
    }
  }

  // The amount pipeline: money or shares in, shares (18dp) out; the quote is
  // asked for the pre-fee amount (the SDK takes the fee off itself) and the
  // slippage floor applied, all in the pour-amount module.
  const { moneyMode, buildAmount } = pourAmounts(
    amount,
    denom,
    SHARE_DECIMALS,
    entryPrice,
    maxed ?? undefined,
  );
  // Under the floor the solver answers "no path" for a pair that routes
  // fine, so it isn't asked: the field gets the real reason instead.
  const tooSmall = belowMinimum(
    buildAmount ? sharesWorthUsd(buildAmount) : undefined,
    money.rate,
  );
  const smallestOrderLabel = money.format(minPourUsd(money.rate));
  const quote = usePourQuote({
    enabled: open && !!listing && !!dstChainKey && !!outputToken && !tooSmall,
    src: listing
      ? { address: listing.address, chainKey: ChainKeys.SONIC_MAINNET }
      : null,
    dst:
      dstChainKey && outputToken
        ? { address: outputToken.address, chainKey: dstChainKey }
        : null,
    buildAmount,
    signingChainKey: srcChainKey,
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

  // A limit sell (lib/limit-orders): the price sets the minimum payout,
  // on the shares actually swapped after the fee, rounded up.
  const limit = useLimitDraft({ side: "sell",
    open,
    listing,
    marketPrice: isSell ? sharePriceUsd : undefined,
    prefill: prefill?.limit,
    force: devLimit,
    // v1 limit sells come from the home hub wallet only: its record,
    // sweep and cancel all know that one (lib/server/limit-orders).
    unavailable:
      !sourceIsHome || (!!sellFrom && sellFrom.sources.find((source) => source.spoke === sellFrom.chosen)?.isHome !== true),
  });
  const limitTokenFits = limitTokenOk(outputToken, dstChainKey ? isEvmChainKeyType(dstChainKey) : false);
  const swapShares = swapInputFor(buildAmount);
  const limitMin =
    limit.active && outputToken
      ? limitMinOutput({
          side: "sell",
          swapInput: swapShares,
          inputDecimals: SHARE_DECIMALS,
          outputDecimals: outputToken.decimals,
          price: limit.price,
        })
      : undefined;
  const limitPriceLabel = limit.price ? formatUsd(priceNumber(limit.price)) : "";
  // The price stays in dollars; in another display currency, a quiet line gives it at the rate.
  const limitPriceAbout = limit.price ? money.aboutAtRate(priceNumber(limit.price)) : null;

  // The drawer's half of the order funnel (lib/analytics): codes and buckets only.
  useDrawerFunnel({
    side: "sell",
    open,
    listing,
    chainKey: outputToken ? dstChainKey : null,
    usd: buildAmount ? sharesWorthUsd(buildAmount) : undefined,
    quoted: !limit.active && quote.quoted !== undefined,
    limitActive: limit.active,
    gasBlocked:
      signGasShort && signNative
        ? { chainKey: srcChainKey, shortfall: shortfallProp(signGasToAdd, signNative.decimals) }
        : null,
  });

  const finish = () => {
    action.reset();
    setAmount("");
    setMaxed(null);
    setCustomRecipient(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && action.locked) return;
    onOpenChange(next);
    if (!next) finish();
  };

  const handleMax = () => {
    if (availableShares <= 0n) return;
    const text = amountText(
      availableShares,
      SHARE_DECIMALS,
      moneyMode,
      entryPrice,
      money.fractionDigits,
    );
    setAmount(text);
    setMaxed({ text, amount: availableShares });
  };

  // Flip the entry denomination, carrying the current value across so the
  // number in the field keeps meaning the same withdrawal.
  const flipDenom = () => {
    if (entryPrice === undefined) return;
    setDenom(moneyMode ? "token" : "money");
    if (buildAmount) {
      const text = amountText(
        buildAmount,
        SHARE_DECIMALS,
        !moneyMode,
        entryPrice,
        money.fractionDigits,
      );
      setAmount(text);
      // Max flipped is still Max: the same whole holding, in the other unit.
      if (maxed && amount === maxed.text) setMaxed({ text, amount: maxed.amount });
    }
  };

  const handleWithdraw = async () => {
    const minOut = limit.active ? limitMin : quote.minOut;
    if (
      (limit.active && (limit.deadline === undefined || !limit.price || !limitTokenFits || limit.recheck() !== null)) ||
      !listing ||
      !dstChainKey ||
      !outputToken ||
      !buildAmount ||
      minOut === undefined ||
      !address ||
      !recipient ||
      !walletProvider
    ) {
      return;
    }
    await action.runWithdraw({
      vault: listing.address,
      vaultName: listing.symbol,
      srcChainKey,
      srcAddress: address,
      dstChainKey,
      outputToken: outputToken.address,
      outputTokenSymbol: outputToken.symbol,
      inputAmount: buildAmount,
      minOutputAmount: minOut,
      recipient,
      ...(limit.active &&
        limit.deadline !== undefined &&
        limit.price && {
          limit: { deadline: limit.deadline, limitPrice: limitPriceText(limit.price) },
        }),
      walletProvider,
      walletMode: mode,
      gasCheck: () =>
        gasPreflight({ chainKey: srcChainKey, address, amount: 0n, approval: false, order: "sell" }),
      fillToasts: {
        successTitle: isSell ? copy.soldTitle : copy.withdrawnTitle,
        successDescription: copy.deliveredBody(getChainName(dstChainKey)),
        failureDescription: copy.sellFailedBody,
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
  const chosenSource = sellFrom?.sources.find((source) => source.spoke === sellFrom.chosen);
  // The account's email wallet signs only in an email sign in: say that,
  // not an address the person may never have seen.
  const accountWallets = useAccountWallets();
  const chosenIsEmailWallet = !!accountWallets.data?.wallets.some(
    (wallet) => wallet.embedded && wallet.address.toLowerCase() === chosenSource?.spoke.toLowerCase(),
  );
  // The gate (pour-amount module) decides why the withdrawal can't go yet;
  // this map only speaks it plainly.
  const gate = withdrawGate({
    address,
    hasDestination: !!dstChainKey && !!outputToken,
    recipient,
    usingCustomRecipient: usingCustom,
    buildAmount,
    availableShares,
    belowMinimum: tooSmall || quote.tooSmall,
    isWrongChain,
    noRoute: quote.noRoute,
    belowDust: dustBlocked,
    // A limit order needs no quote to be placed: its price is the minimum.
    quoted: limit.active ? 1n : quote.quoted,
    minOut: limit.active ? 1n : quote.minOut,
    hasWalletProvider: !!walletProvider,
    walletAsleep: !!asleep,
    signerLinked,
    canSignSource: chosenSource ? chosenSource.canSign : undefined,
    gasShort: signGasShort,
  });
  const cta: Cta = (() => {
    switch (gate.kind) {
      case "walletNotLinked":
        return { label: copy.ctaAddWalletFirst, disabled: !onAddWallet, onClick: onAddWallet };
      case "signWithOther":
        return {
          label: chosenIsEmailWallet
            ? copy.ctaSellSignInEmail
            : copy.ctaSellSwitchWallet(shortenAddress(chosenSource?.spoke ?? "", 4)),
          disabled: true,
        };
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
        return {
          label: isSell ? copy.ctaSellHowMuch : copy.ctaWithdrawHowMuch,
          disabled: true,
        };
      case "insufficient":
        return {
          label: isSell ? copy.ctaNotThatMuchHeld : copy.ctaVaultNotThatMuch,
          disabled: true,
        };
      case "needsGas":
        return { label: copy.ctaNeedsGas(signNative?.symbol ?? ""), disabled: true };
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
      case "belowDust":
        return { label: copy.ctaTooSmallForBtc, disabled: true };
      case "wakeWallet":
        // Signed in on the session alone (lib/wallet-restore): the one
        // prompt is here, when the person asked for a signature.
        return {
          label: copy.ctaWakeWallet(asleep?.name ?? null),
          disabled: false,
          onClick: () => {
            void asleep?.wake().then((woke) => {
              if (!woke) toast(copy.wakeWalletFailed(asleep?.name ?? null));
            });
          },
        };
      case "quotePending":
        return { label: copy.ctaGettingQuote, disabled: true, busy: true };
      default: {
        if (limit.active) {
          const reason = limitCta({ tokenOk: limitTokenFits, problem: limit.problem, minOut: limitMin });
          switch (reason) {
            case "review":
              return { label: copy.limitCtaReview, disabled: false, onClick: () => limit.setReviewing(true) };
            case "needsDollars":
              return { label: copy.limitCtaDollarsSell, disabled: false, onClick: () => setPickerOpen(true) };
            case "enterPrice":
              return { label: copy.limitCtaEnterPrice, disabled: true };
            case "pickDate":
              return { label: copy.limitCtaPickDate, disabled: true };
            case "pastDate":
              return { label: copy.limitCtaPastDate, disabled: true };
            case "tooFar":
              return { label: copy.limitCtaTooFar, disabled: true };
            case "noPrice":
              return { label: copy.limitCtaNoPrice, disabled: true };
            case "throughMarket":
              return { label: copy.limitCtaThroughSell, disabled: true };
            default:
              return { label: copy.limitCtaEnterPrice, disabled: true };
          }
        }
        return {
          label: isSell ? copy.sell : copy.vaultWithdraw,
          disabled: false,
          onClick: () => void handleWithdraw(),
        };
      }
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
                ? isSell
                  ? copy.sellTitle(listing.name)
                  : copy.withdrawTitle(meta?.title ?? listing.name)
                : copy.orderTitleFallback}
            </DrawerTitle>
            <DrawerDescription>
              {isSell ? copy.sellSub : copy.withdrawSub}
            </DrawerDescription>
          </DrawerHeader>

          {/* Same three-act wash as the deposit drawer. */}
          <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            data-ph-mask
            key={
              action.step === "resting"
                ? "resting"
                : action.fillPhase
                  ? "settling"
                  : action.pending
                    ? "stepper"
                    : limit.reviewing
                      ? "review"
                      : "form"
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
          {listing && action.step === "resting" ? (
            <div className="p-4">
              <LimitPlaced
                name={listing.name}
                priceLabel={limitPriceLabel}
                unsaved={action.limitUnsaved}
                onDone={() => {
                  onOpenChange(false);
                  finish();
                }}
              />
            </div>
          ) : listing && action.fillPhase ? (
            <div className="p-4">
              <IntentTracking
                reportState={action.reportState}
                phase={action.fillPhase}
                fillTxHash={action.fillTxHash}
                hubTxHash={action.hubTxHash}
                spokeTxHash={action.spokeTxHash}
                spokeTxUrl={action.spokeTxUrl}
                successTitle={copy.onItsWayTitle}
                successBody={
                  dstChainKey && outputToken
                    ? copy.onItsWayBody(
                        outputToken.symbol,
                        getChainName(dstChainKey),
                      )
                    : copy.onItsWayBodyFallback
                }
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
                approveNeeded={false}
                headless={mode === "email" && signGas.sponsored(srcChainKey)}
              />
            </div>
          ) : listing && limit.reviewing && outputToken && dstChainKey && buildAmount && limitMin ? (
            <div className="flex flex-col gap-4 overflow-y-auto p-4">
              <LimitSummary
                side="sell"
                name={listing.name}
                priceLabel={limitPriceLabel}
                priceAbout={limitPriceAbout}
                putLabel={`${formatTokenAmount(buildAmount, SHARE_DECIMALS, 6)} ${listing.name}`}
                getLabel={`${formatTokenAmount(limitMin, outputToken.decimals)} ${outputToken.symbol} on ${getChainName(dstChainKey)}`}
                feeLabel={
                  swapShares !== undefined
                    ? `${formatTokenAmount(buildAmount - swapShares, SHARE_DECIMALS, 6)} ${listing.name}`
                    : undefined
                }
                expiryDay={limit.expiry.kind === "date" ? dayLabel(limit.expiry.day) : undefined}
                noGasChain={signGas.sponsored(srcChainKey) ? getChainName(srcChainKey) : undefined}
                placeLabel={copy.limitPlace}
                onBack={() => limit.setReviewing(false)}
                onPlace={() => void handleWithdraw()}
                held={outcomeHold}
              />
              {action.step === "error" && action.error && (
                <ActionError message={action.error} reportState={action.reportState} />
              )}
            </div>
          ) : listing ? (
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
                      onChange={(event) => {
                        // Typing consumes a draft, so it never lands over the person's number.
                        setPrefilled(true);
                        setMaxed(null);
                        setAmount(event.target.value);
                      }}
                      inputMode="decimal"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="0"
                      aria-label={
                        moneyMode
                          ? copy.ariaAmountIn(money.currency)
                          : isSell
                            ? copy.ariaAmount
                            : copy.ariaSharesToWithdraw
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
                        ? `≈ ${buildAmount ? formatTokenAmount(buildAmount, SHARE_DECIMALS, 6) : "0"} ${listing.symbol}`
                        : `≈ ${money.format(sharesWorthUsd(buildAmount ?? 0n) ?? 0)}`}
                    </button>
                  )}
                  {sellFrom && sellFrom.sources.length > 1 && (
                    <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={copy.sellFromLabel}>
                      <span className="text-xs text-muted-foreground">{copy.sellFromLabel}</span>
                      <div className="flex flex-wrap gap-1.5">
                        {sellFrom.sources.map((source) => {
                          const selected = source.spoke === sellFrom.chosen;
                          return (
                            <button
                              key={source.spoke}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => {
                                sellFrom.onChoose(source.spoke);
                                setAmount("");
                                setCapped(false);
                              }}
                              className={cn(
                                "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs tabular-nums transition-[background-color,border-color] duration-150 ease-lift",
                                selected ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted",
                              )}
                            >
                              <span className="money">{shortenAddress(source.spoke, 4)}</span>
                              {source.isHome && <span className="text-[11px] text-muted-foreground">{copy.sellFromHomeTag}</span>}
                              <span>{formatTokenAmount(source.balance, SHARE_DECIMALS, 4)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      {(isSell ? copy.youHold : copy.vaultHolds)(
                        sharePriceUsd !== undefined
                          ? `≈ ${money.format(sharesWorthUsd(availableShares) ?? 0)} (${formatTokenAmount(availableShares, SHARE_DECIMALS, 6)} ${listing.symbol})`
                          : `${formatTokenAmount(availableShares, SHARE_DECIMALS, 6)} ${listing.symbol}`,
                      )}
                    </span>
                    {availableShares > 0n && (
                      <Button variant="ghost" size="xs" onClick={handleMax}>
                        {copy.maxLabel}
                      </Button>
                    )}
                  </div>
                  {capped && isSell && (
                    <p className="text-xs text-muted-foreground">
                      {copy.sellUpToFromWallet(
                        sharePriceUsd !== undefined
                          ? money.format(sharesWorthUsd(availableShares) ?? 0)
                          : `${formatTokenAmount(availableShares, SHARE_DECIMALS, 6)} ${listing.symbol}`,
                      )}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {isSell
                      ? copy.sellSignOnce(getChainName(srcChainKey))
                      : copy.vaultSignOnce(getChainName(srcChainKey))}
                  </p>
                  {signGasShort && signNative && (
                    <p className="text-xs text-warn">
                      {gasShortMessage(copy, signNative, srcChainKey, signGasToAdd)}
                    </p>
                  )}
                  {totalShares !== undefined &&
                    totalShares > availableShares && (
                      <p className="text-xs text-muted-foreground">
                        {sharePriceUsd !== undefined
                          ? copy.vaultSplitNote(
                              `≈ ${money.format(sharesWorthUsd(availableShares) ?? 0)}`,
                              `≈ ${money.format(sharesWorthUsd(totalShares) ?? 0)}`,
                              getChainName(srcChainKey),
                            )
                          : copy.vaultSplitNote(
                              formatTokenAmount(availableShares, SHARE_DECIMALS),
                              `${formatTokenAmount(totalShares, SHARE_DECIMALS)} shares`,
                              getChainName(srcChainKey),
                            )}
                      </p>
                    )}
                </div>

                {limit.allowed && (
                  <LimitPriceFields
                    side="sell"
                    mode={limit.mode}
                    onMode={limit.setMode}
                    priceText={limit.priceText}
                    onPriceText={limit.setPriceText}
                    marketLabel={sharePriceUsd !== undefined ? formatUsd(sharePriceUsd) : undefined}
                    expiry={limit.expiry}
                    onExpiry={limit.setExpiry}
                    tokenOk={!outputToken || limitTokenFits}
                    throughHint={limit.problem === "throughMarket"}
                    noPriceHint={limit.problem === "noPrice"}
                    fillsNow={fillsNow("sell", limit.price, sharePriceUsd)}
                  />
                )}

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
                      {copy.whereToDeliver}
                    </span>
                  )}
                  <CaretDown className="size-4 text-muted-foreground" />
                </button>

                {/* Cash-out path: send to a different address (e.g. an
                    exchange deposit address) instead of your own wallet. */}
                {dstChainKey && outputToken && (
                  <div data-ph-block className="flex flex-col gap-1.5">
                    {usingCustom ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-muted-foreground">
                            {copy.sendElsewhere}
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
                          aria-label={copy.withdrawCustomAddressLabel}
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
                {dstChainKey && outputToken && buildAmount && !limit.active ? (
                  <div className="flex flex-col gap-1 rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
                    {tooSmall || quote.tooSmall ? (
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
                          <span>{copy.atLeastLabel}</span>
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

                <EarlierOrderNote order={action.earlierOrder} />

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
                  disabled={cta.disabled || outcomeHold}
                  onClick={cta.onClick}
                >
                  {cta.busy && <Spinner className="size-4" />}
                  {cta.label}
                </Button>
                {signGasFloorWarn && signNative && (
                  <p className="text-center text-xs leading-relaxed text-muted-foreground">
                    {copy.gasFloorWarning(signNative.symbol)}
                  </p>
                )}
                {/* One gas message at a time: the note only while no block or warning speaks. */}
                {walletSession && emailCoversFee && address && !signGas.sponsored(srcChainKey) && signNative &&
                  !signGasShort && !signGasFloorWarn && (
                  <p className="text-center text-xs leading-relaxed text-muted-foreground" data-testid="self-paid-fee">
                    {copy.selfPaidFeeNote(signNative.symbol, getChainName(srcChainKey))}
                  </p>
                )}
                {signGas.sponsored(srcChainKey) && (
                  <p className="text-center text-xs leading-relaxed text-muted-foreground" data-testid="no-network-fee">
                    {copy.noNetworkFeeOn(getChainName(srcChainKey))}
                  </p>
                )}
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
        mode="destination"
        onSelect={(chainKey, selected) => {
          setDstChainKey(chainKey);
          setOutputToken(selected);
        }}
      />
    </>
  );
}
