"use client";

import { NotHereDrawer, useAvailability } from "@/components/availability/availability";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { AnimatePresence, motion } from "motion/react";
import { ArrowsDownUp, CaretDown, GasPump } from "@phosphor-icons/react";
import { ChainKeys, getChainType, isEvmChainKeyType, type SpokeChainKey, type XToken } from "@sodax/sdk";
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
import { ThinkingOrb } from "@/components/ui/thinking-orb";
import { cn } from "@/lib/utils";
import { EASE_LIFT } from "@/lib/motion";
import {
  DEPOSIT_SOURCE_CHAINS,
  getChainName,
  getDepositTokens,
  getNativeGasToken,
  toBalanceReadToken,
} from "@/lib/chains";
import { preferPayChoice, type PreferPay } from "@/lib/funding-handoff";
import { getVaultMeta } from "@/lib/vaults-meta";
import type { Listing } from "@/lib/listings";
import { formatTokenAmount, formatUsd } from "@/lib/format";
import { useCopy, useMoney } from "@/components/settings-provider";
import {
  amountText,
  belowMinimum,
  depositGate,
  depositMax,
  minPourUsd,
  pourAmounts,
  swapInputFor,
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
import { useListingPrices } from "@/hooks/use-listing-prices";
import { useLimitDraft, type LimitPrefill } from "@/hooks/use-limit-draft";
import { usePourQuote } from "@/hooks/use-pour-quote";
import { useVaultAction } from "@/hooks/use-vault-action";
import { useVaultWallet } from "@/hooks/use-vault-wallet";
import { useHubAccount } from "@/hooks/use-hub-account";
import { useAddConnectedWallet, useAddWallets } from "@/hooks/use-account-wallets";
import { useAccountWallets } from "@/hooks/use-profile";
import { payerLink } from "@/lib/payer-link";
import { addressKey } from "@/lib/add-wallet-list";
import {
  useEmbeddedHoldings,
  type EmbeddedHoldingsResult,
} from "@/hooks/use-embedded-holdings";
import { useOpenFor } from "@/hooks/use-open-for";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import {
  FIND_TIMEOUT_MS,
  PICK_WAIT_MS,
  payTokenState,
  shouldPrefillUsd,
} from "@/lib/pay-token-pick";
import { useUsdPrices } from "@/hooks/use-usd-prices";
import { useNativeGasBuffer } from "@/hooks/use-native-gas-buffer";
import { gasShortMessage, isGasToken, useGasGate, useGasPreflight } from "@/hooks/use-gas-gate";
import { useWalletOnlySession } from "@/hooks/use-account";
import { useOutcomeHold, useSponsoredChainNames } from "@/hooks/use-sponsor-refusals";
import { byGasStatus, floorWarns, gasToAdd, orderGasShort } from "@/lib/gas-need";
import {
  ActionError,
  ActionStepper,
  EarlierOrderNote,
  IntentTracking,
} from "./action-stepper";
import { TokenLogo, TokenPicker } from "./token-picker";
import { LimitPlaced, LimitPriceFields, LimitSummary } from "./limit-price";
import { useDrawerFunnel } from "@/components/analytics/use-drawer-funnel";

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
  prefill,
  preferPay,
  devHoldings,
  devLimit,
  confirmTerms,
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
  /**
   * Optional: the terms check at the moment the buy is confirmed, before
   * the wallet is asked (lib/terms-gate confirmBuy). False holds the order
   * where it is, drawer open, amount kept.
   */
  confirmTerms?: () => Promise<boolean>;
  /**
   * Optional: an amount to start from, in dollars, from a draft an
   * assistant made (lib/draft-order). Filled in once the pay token is
   * priced, so it is always read as money; never submitted.
   */
  prefill?: { usd?: number; limit?: LimitPrefill } | null;
  /**
   * Optional: the pay token to start from, once per opening, over whatever
   * the sweep would pick: money that just arrived from a card payment
   * (lib/funding-handoff), USDC on Base. The person can still change it.
   */
  preferPay?: PreferPay | null;
  /**
   * Dev galleries only: stands in for the wallet sweep, so the drawer's
   * waiting and picked states can be reviewed without a session.
   */
  devHoldings?: Pick<
    EmbeddedHoldingsResult,
    "connected" | "holdings" | "gasShortChains" | "isLoading"
  > &
    Partial<Pick<EmbeddedHoldingsResult, "nativeBalances">>;
  /** Dev galleries only: show "Set a price" as if the switch were on. */
  devLimit?: boolean;
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
  const availability = useAvailability();

  // Where a buy lands: the account. Vault deposits ignore this (see RunDepositArgs).
  const account = useHubAccount();
  const addWallet = useAddConnectedWallet();
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
  const { address, walletProvider, mode, isWrongChain, handleSwitchChain, ensureReady, asleep } =
    useVaultWallet(srcChainKey);
  // A buy paid from Solana or Bitcoin earns XP only from a wallet on the
  // account, so one not on it is added first; a network no wallet can be
  // linked in is said plainly (lib/payer-link).
  const payingNonEvm = isBuy && !isEvmChainKeyType(srcChainKey);
  const accountList = useAccountWallets(payingNonEvm);
  const addWallets = useAddWallets();
  const payer = payingNonEvm
    ? payerLink({ chainType: getChainType(srcChainKey), address, linked: accountList.data?.wallets })
    : ({ state: "evm" } as const);
  const payerRow =
    payer.state === "unlinked" && address
      ? addWallets.rows.find(
          (row) => row.network === getChainType(srcChainKey) && !!row.address && addressKey(row.network, row.address) === addressKey(row.network, address),
        )
      : undefined;

  // Balance-first: land the person on what they already hold so the drawer
  // opens showing a balance and an amount field, not a chain picker. The
  // sweep is sorted by oracle value, so the pick waits for it to settle,
  // but only for PICK_WAIT_MS once something is found: one slow chain on a
  // fresh page load used to hold the pick back so long the drawer read as
  // empty. Balances that arrive later still get picked, whenever they come,
  // and never over a token already in the slot (lib/pay-token-pick).
  // Render-time state adjustment (not an effect), per house pattern.
  const sweep = useEmbeddedHoldings();
  const {
    connected,
    holdings: sweptHoldings,
    gasShortChains,
    isLoading: holdingsLoading,
  } = devHoldings ?? sweep;
  const nativeBalances = devHoldings ? (devHoldings.nativeBalances ?? {}) : sweep.nativeBalances;
  // The first pick prefers what can pay its own fee (lib/gas-need), the
  // order the picker shows; a wallet where nothing can still lands on its
  // largest holding, and the drawer says what is missing.
  const sweepGas = useGasGate(sweptHoldings.map((holding) => holding.chainKey), open && !token);
  const holdings = byGasStatus(sweptHoldings, (holding) =>
    sweepGas.statusFor(holding.chainKey, holding.token, nativeBalances[holding.chainKey]),
  );
  const privy = usePrivyEmbeddedWallet();
  // Signed in but the embedded wallet not yet in hand: no address to sweep
  // yet, which is waiting, not having nothing.
  const sessionPending =
    !devHoldings &&
    privy.enabled &&
    (!privy.ready ||
      (privy.authenticated && !privy.embedded && !privy.walletAccountSession));
  const pickWaitOver = useOpenFor(open, PICK_WAIT_MS);
  const findTimedOut = useOpenFor(open, FIND_TIMEOUT_MS);
  // Money that just arrived goes in the slot first, once per opening.
  // Render-time state adjustment, per house pattern.
  const [preferTaken, setPreferTaken] = useState(false);
  if (!open && preferTaken) setPreferTaken(false);
  // Only while fresh, and only once the sweep shows it still held (lib/funding-handoff preferPayChoice).
  const preferChoice =
    open && preferPay && !preferTaken
      ? preferPayChoice({
          prefer: preferPay,
          loading: holdingsLoading,
          holdings: sweptHoldings.map((holding) => ({
            chainKey: holding.chainKey,
            address: holding.token.address,
            balance: holding.balance,
          })),
        })
      : "wait";
  if (open && preferPay && !preferTaken && preferChoice !== "wait") {
    setPreferTaken(true);
    const preferred =
      preferChoice === "use"
        ? getDepositTokens(preferPay.chainKey as SpokeChainKey).find(
            (candidate) => candidate.address.toLowerCase() === preferPay.address.toLowerCase(),
          )
        : undefined;
    if (preferred) {
      setSrcChainKey(preferPay.chainKey as SpokeChainKey);
      setToken(preferred);
    }
  }
  const payState = payTokenState({
    hasToken: !!token,
    connected,
    sessionPending,
    sweepLoading: holdingsLoading,
    holdingsCount: holdings.length,
    pickWaitOver,
    findTimedOut,
  });
  if (open && payState === "pick") {
    setSrcChainKey(holdings[0].chainKey);
    setToken(holdings[0].token);
  }
  const finding = open && payState === "finding";

  const prices = useUsdPrices();

  const xService = useXService({ xChainType: getXChainType(srcChainKey) });
  // The pay token and, beside it, the chain's native token, which pays the fee.
  const nativeToken = getNativeGasToken(srcChainKey);
  const payingNative = !!token && isGasToken(srcChainKey, token);
  const balancesQuery = useXBalances({
    params: {
      xService,
      xChainId: srcChainKey,
      xTokens: token
        ? payingNative || !nativeToken
          ? [toBalanceReadToken(token)]
          : [toBalanceReadToken(token), toBalanceReadToken(nativeToken)]
        : [],
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

  const nativeBalance =
    token && nativeToken && balancesQuery.data
      ? (balancesQuery.data[toBalanceReadToken(nativeToken).address] ?? 0n)
      : undefined;
  // Can this chain pay the order's fee at its own price (lib/gas-need)?
  // No approval counted here: the order machine adds one only when the
  // allowance it reads needs it. Unknown never blocks.
  const gas = useGasGate([srcChainKey], open && !!token);
  const gasNeed = gas.needFor(srcChainKey, false);
  const gasPreflight = useGasPreflight();
  // A session with no email signs every order with its own wallet and pays
  // every fee itself: said calmly near the fee line, every time.
  const walletSession = useWalletOnlySession();
  // Only where an email sign-in would in fact pay nothing (lib/gas-sponsor,
  // minus any chain Privy refused this session) is the note true.
  const emailCoversFee = useSponsoredChainNames().includes(getChainName(srcChainKey));
  // A sponsored send may still land: no second tap for a minute (lib/gas-sponsor).
  const outcomeHold = useOutcomeHold();

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
    // Privy pays the fee here for the embedded wallet: Max may spend it all.
    sponsored: gas.sponsored(srcChainKey),
  });

  // A drafted amount goes in once per opening, and only as money: until
  // the pay token has a price the field would read "50" as fifty tokens.
  // It waits as long as the pay token does, and typing in the field
  // consumes it, so it never lands over the person's own number.
  // Render-time adjustment, per house pattern.
  const [prefilled, setPrefilled] = useState(false);
  if (!open && prefilled) setPrefilled(false);
  if (
    open &&
    prefill?.usd &&
    shouldPrefillUsd({
      consumed: prefilled,
      draftUsd: prefill.usd,
      hasToken: !!token,
      priced: entryPrice !== undefined,
      amount,
    })
  ) {
    setPrefilled(true);
    setDenom("money");
    setAmount((prefill.usd * money.rate).toFixed(money.fractionDigits));
  }

  // The amount pipeline: what the text means, the amount actually swapped
  // after the fee, and the slippage floor all live in the pour-amount module.
  // The quote takes the pre-fee amount; the SDK takes the fee off itself.
  const { moneyMode, buildAmount } = pourAmounts(
    amount,
    denom,
    token?.decimals,
    entryPrice,
  );
  const worthUsd =
    token && buildAmount ? prices.usdValue(token, buildAmount) : undefined;
  // The chosen token's chain cannot pay: with no amount yet, whether any
  // order could; with one, whether this one leaves enough for the fee. The
  // need is the larger of the chain's price and what wallets attach on top
  // (lib/gas-need blockingNeed), so a wallet paying its own fee is stopped
  // here, before the flow starts, and told roughly how much to add.
  const selectedGasFacts = {
    chainKey: srcChainKey,
    isNative: payingNative,
    nativeBalance,
    amount: payingNative ? (buildAmount ?? 1n) : 0n,
    need: gasNeed,
    sponsored: gas.sponsored(srcChainKey),
  };
  const selectedGasShort = !!token && orderGasShort(selectedGasFacts);
  const selectedGasToAdd = selectedGasShort ? gasToAdd(selectedGasFacts) : undefined;
  // Clears the gate, but a wallet attaching 2 gwei would ask for more: say
  // so calmly and let the person sign (lib/gas-need warnReserve).
  const gasFloorWarn =
    !!token &&
    floorWarns({
      ...selectedGasFacts,
      amount: payingNative ? (buildAmount ?? 0n) : 0n,
      warnNeed: gas.warnNeedFor(srcChainKey, false),
    });
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
    signingChainKey: srcChainKey,
  });

  // A limit buy (lib/limit-orders): the price, not a quote, sets the
  // minimum, computed on what is actually swapped after the fee and
  // rounded up so the fill is never worse than the price named.
  const listingPrices = useListingPrices();
  const marketPrice = listing?.kind === "stock" ? listingPrices.priceOf(listing) : undefined;
  const limit = useLimitDraft({ side: "buy", open, listing, marketPrice, prefill: prefill?.limit, force: devLimit });
  const limitTokenFits = limitTokenOk(token, isEvmChainKeyType(srcChainKey));
  const swapInput = swapInputFor(buildAmount);
  const limitMin =
    limit.active && token && listing
      ? limitMinOutput({
          side: "buy",
          swapInput,
          inputDecimals: token.decimals,
          outputDecimals: listing.decimals,
          price: limit.price,
        })
      : undefined;
  const limitPriceLabel = limit.price ? formatUsd(priceNumber(limit.price)) : "";
  // The price stays in dollars; in another display currency, a quiet line gives it at the rate.
  const limitPriceAbout = limit.price ? money.aboutAtRate(priceNumber(limit.price)) : null;

  // The drawer's half of the order funnel (lib/analytics): codes and buckets only.
  useDrawerFunnel({
    side: "buy",
    open,
    listing,
    chainKey: token ? srcChainKey : null,
    usd: worthUsd,
    quoted: !limit.active && quote.quoted !== undefined,
    limitActive: limit.active,
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

  const [checkingTerms, setCheckingTerms] = useState(false);
  const handleDeposit = async () => {
    const minOut = limit.active ? limitMin : quote.minOut;
    if (
      !listing ||
      !token ||
      !buildAmount ||
      minOut === undefined ||
      !address ||
      !walletProvider ||
      (isBuy && !deliverTo) ||
      (limit.active && (limit.deadline === undefined || !limit.price || !limitTokenFits || limit.recheck() !== null))
    ) {
      limit.setReviewing(false);
      return;
    }
    if (confirmTerms) {
      // A spinner on Buy while the terms are read (at most a few seconds, lib/terms-gate).
      setCheckingTerms(true);
      const go = await confirmTerms().finally(() => setCheckingTerms(false));
      if (!go) return;
    }
    await action.runDeposit({
      vault: listing.address,
      vaultName: listing.symbol,
      deliverTo,
      srcChainKey,
      srcAddress: address,
      token,
      inputAmount: buildAmount,
      minOutputAmount: minOut,
      walletProvider,
      walletMode: mode,
      ...(limit.active &&
        limit.deadline !== undefined &&
        limit.price && {
          limit: { deadline: limit.deadline, limitPrice: limitPriceText(limit.price) },
        }),
      gasCheck: (approval) =>
        gasPreflight({ chainKey: srcChainKey, address, token, amount: buildAmount, approval }),
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
    belowMinimum: tooSmall || quote.tooSmall,
    isWrongChain,
    noRoute: quote.noRoute,
    // A limit order needs no quote to be placed: its price is the minimum.
    quoted: limit.active ? 1n : quote.quoted,
    minOut: limit.active ? 1n : quote.minOut,
    hasWalletProvider: !!walletProvider,
    walletAsleep: !!asleep,
    account: accountState,
    // An EVM payer is the session's signer; one not on the account yet is
    // added first, or the order would not count as the account's.
    payerLinked: !isBuy || (isEvmChainKeyType(srcChainKey) ? account.signerLinked : payer.state !== "unlinked"),
    gasShort: selectedGasShort,
  });
  const cta: Cta = checkingTerms ? { label: copy.buy, disabled: true, busy: true } : (() => {
    switch (gate.kind) {
      case "noAccount":
        return {
          label: copy.ctaSignInToBuy,
          disabled: !onSignIn,
          onClick: onSignIn,
        };
      case "accountPending":
        return { label: copy.ctaOpeningAccount, disabled: true, busy: true };
      case "walletNotLinked":
        if (payer.state === "unlinked") {
          // A Solana or Bitcoin payer: Sign-In With Solana or BIP-322 in its own extension.
          const busy = !!payerRow && addWallets.busyAddress === payerRow.address;
          return {
            label: copy.ctaAddWalletFirst,
            disabled: !payerRow || busy,
            busy,
            onClick: payerRow ? () => void addWallets.add(payerRow) : undefined,
          };
        }
        return {
          label: copy.ctaAddWalletFirst,
          disabled: !addWallet.canSign || addWallet.busy,
          busy: addWallet.busy,
          onClick: () => void addWallet.add(),
        };
      case "signWithOther":
        return { label: copy.ctaAddWalletFirst, disabled: true };
      case "pickToken":
        if (finding) {
          return { label: copy.findingPayWith, disabled: true, busy: true };
        }
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
      case "needsGas":
        return { label: copy.ctaNeedsGas(nativeToken?.symbol ?? token?.symbol ?? ""), disabled: true };
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
              return { label: copy.limitCtaDollarsBuy, disabled: false, onClick: () => setPickerOpen(true) };
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
              return { label: copy.limitCtaThroughBuy, disabled: true };
            default:
              return { label: copy.limitCtaEnterPrice, disabled: true };
          }
        }
        return {
          label: copy.buy,
          disabled: false,
          onClick: () => void handleDeposit(),
        };
      }
    }
  })();

  // Where Berth is not available (lib/availability) a buy is not started:
  // the drawer says so instead. Selling has its own drawer and is never
  // replaced. Dev galleries set the availability themselves.
  if (!availability.available) {
    return <NotHereDrawer availability={availability} open={open} onOpenChange={onOpenChange} />;
  }

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
                approveTwice={action.approveTwice}
                headless={mode === "email" && gas.sponsored(srcChainKey)}
              />
            </div>
          ) : listing && limit.reviewing && token && buildAmount && limitMin ? (
            <div className="flex flex-col gap-4 overflow-y-auto p-4">
              <LimitSummary
                side="buy"
                name={listing.name}
                priceLabel={limitPriceLabel}
                priceAbout={limitPriceAbout}
                putLabel={
                  worthUsd !== undefined
                    ? `${money.format(worthUsd)} (${formatTokenAmount(buildAmount, token.decimals)} ${token.symbol})`
                    : `${formatTokenAmount(buildAmount, token.decimals)} ${token.symbol}`
                }
                getLabel={`${formatTokenAmount(limitMin, listing.decimals, 6)} ${listing.name}`}
                feeLabel={
                  swapInput !== undefined
                    ? `${formatTokenAmount(buildAmount - swapInput, token.decimals, 4)} ${token.symbol}`
                    : undefined
                }
                expiryDay={limit.expiry.kind === "date" ? dayLabel(limit.expiry.day) : undefined}
                noGasChain={gas.sponsored(srcChainKey) ? getChainName(srcChainKey) : undefined}
                placeLabel={copy.limitPlace}
                onBack={() => limit.setReviewing(false)}
                onPlace={() => void handleDeposit()}
                held={outcomeHold}
              />
              {action.step === "error" && action.error && (
                <ActionError message={action.error} reportState={action.reportState} />
              )}
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
                  ) : finding ? (
                    <span className="flex flex-1 items-center gap-2 text-sm text-muted-foreground">
                      <ThinkingOrb state="searching" size={20} decorative />
                      {copy.findingPayWith}
                    </span>
                  ) : (
                    <span className="flex-1 text-sm text-muted-foreground">
                      {copy.whatPayingWith}
                    </span>
                  )}
                  <CaretDown className="size-4 text-muted-foreground" />
                </button>

                {/* Whether this buy can earn XP, said before it is made (lib/payer-link). */}
                {(payer.state === "unlinked" || payer.state === "unlinkable") && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {payer.state === "unlinked" ? copy.buyLinkForXp : copy.buyNoXpNetwork}
                  </p>
                )}

                {/* Funds without gas: the embedded wallet holds this token
                    but zero native balance on its chain, so the order would
                    die at the network fee. Say so before the quote does. */}
                {connected &&
                  token &&
                  (gasShortChains.includes(srcChainKey) || selectedGasShort) &&
                  (() => {
                    const native = getNativeGasToken(srcChainKey);
                    const symbol = native?.symbol ?? "the native token";
                    return (
                      <div className="flex gap-3 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2.5">
                        <GasPump className="mt-0.5 size-5 shrink-0 text-warn" />
                        <div className="flex flex-col gap-1.5 text-xs leading-relaxed">
                          <p className="text-foreground">
                            {/* An amount whenever one can be told, an empty wallet included. */}
                            {native && selectedGasToAdd !== undefined
                              ? gasShortMessage(copy, native, srcChainKey, selectedGasToAdd)
                              : gasShortChains.includes(srcChainKey)
                                ? copy.gasShortWarning(getChainName(srcChainKey), symbol)
                                : native
                                  ? gasShortMessage(copy, native, srcChainKey, undefined)
                                  : copy.gasNeededToPay(symbol, getChainName(srcChainKey))}
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
                      onChange={(event) => {
                        setPrefilled(true);
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

                {limit.allowed && (
                  <LimitPriceFields
                    side="buy"
                    mode={limit.mode}
                    onMode={limit.setMode}
                    priceText={limit.priceText}
                    onPriceText={limit.setPriceText}
                    marketLabel={marketPrice !== undefined ? formatUsd(marketPrice) : undefined}
                    expiry={limit.expiry}
                    onExpiry={limit.setExpiry}
                    tokenOk={!token || limitTokenFits}
                    throughHint={limit.problem === "throughMarket"}
                    noPriceHint={limit.problem === "noPrice"}
                    fillsNow={fillsNow("buy", limit.price, marketPrice)}
                  />
                )}

                {/* Live quote */}
                {token && buildAmount && !limit.active ? (
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
                {gasFloorWarn && nativeToken && (
                  <p className="text-center text-xs leading-relaxed text-muted-foreground">
                    {copy.gasFloorWarning(nativeToken.symbol)}
                  </p>
                )}
                {/* One gas message at a time: the note only while no block or warning speaks. */}
                {token && walletSession && emailCoversFee && address && !gas.sponsored(srcChainKey) && nativeToken &&
                  !selectedGasShort && !gasShortChains.includes(srcChainKey) && !gasFloorWarn && (
                  <p className="text-center text-xs leading-relaxed text-muted-foreground" data-testid="self-paid-fee">
                    {copy.selfPaidFeeNote(nativeToken.symbol, getChainName(srcChainKey))}
                  </p>
                )}
                {token && gas.sponsored(srcChainKey) && (
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
        onTopUp={onTopUp}
        devHoldings={devHoldings}
        onSelect={(chainKey, selected) => {
          setSrcChainKey(chainKey);
          setToken(selected);
          setAmount("");
        }}
      />
    </>
  );
}
