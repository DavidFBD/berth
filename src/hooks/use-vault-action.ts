"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import {
  useLeverageYieldDeposit,
  useLeverageYieldWithdraw,
  useSodaxContext,
  useStatus,
  useSwapApprove,
} from "@sodax/dapp-kit";
import {
  ChainKeys,
  DEFAULT_RELAY_TX_TIMEOUT,
  HUB_CHAIN_KEY,
  getChainType,
  getIntentRelayChainId,
  isBitcoinChainKeyType,
  isHubChainKeyType,
  mapRelayFailure,
  relayTxAndWaitPacket,
  submitTransaction,
  verifyFailed,
  waitUntilIntentExecuted,
  type Address,
  type CreateIntentParams,
  type CreateVaultIntentResult,
  type GetWalletProviderType,
  type LeverageYieldSwapPayload,
  type SpokeChainKey,
  type XToken,
} from "@sodax/sdk";
import {
  addressHint,
  submitErrorReport,
  type ErrorReportContext,
  type PourReportContext,
  type ReportState,
} from "@/lib/error-report";
import {
  CANCELLED_MESSAGE,
  FILL_FAILED_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  extractErrorCode,
  friendlyError,
  rawErrorMessage,
  type GasContext,
} from "@/lib/error-copy";
import { getChainName, getNativeGasToken, sdkAddress, spokeTxUrl } from "@/lib/chains";
import { COPY } from "@/lib/copy";
import {
  FILL_WATCH_MS,
  TRACKING_RELEASE_MS,
  dueOneShot,
  fillPhase,
  isPipelineStep,
  isPourLocked,
  probeApprovalTakesTwo,
  releaseTracking,
  resolveTracking,
  settledFollowUp,
  slowSource,
  solverNotNotifiedReport,
  unsettledReport,
  type FillPhase,
  type PourStep,
} from "@/lib/pour-lifecycle";
import {
  runSlowOrder,
  waitForRelay,
  type FillStatus,
  type SlowOrderEvent,
} from "@/lib/slow-order";
import {
  notifyWithin,
  notifyWithRetries,
  reachHub,
  renotifyDue,
  unlessStalled,
  type NotifyOutcome,
  type RenotifyState,
} from "@/lib/market-send";
import { subscribeSponsoredStall } from "@/lib/gas-sponsor";
import { useOutcomeHold } from "@/hooks/use-sponsor-refusals";
import { useErrorReporter } from "@/hooks/use-error-reporter";
import { LISTINGS_QUERY_KEY } from "@/hooks/use-hub-holdings";
import type { PourReadiness } from "@/hooks/use-privy-evm-wallet";
import { useAwardPour } from "@/hooks/use-profile";
import { useRecordLimitOrder } from "@/hooks/use-limit-orders";
import { addPending } from "@/lib/limit-pending";
import { chainFamily, failureReason, track, type OrderType } from "@/lib/analytics";
import type { Delivery } from "@/lib/delivery";
import { asksAgain, buyDestination, robinhoodParams } from "@/lib/delivery-client";
import { readRobinhoodBalances, robinhoodClient } from "@/lib/robinhood-chain";
import { ROBINHOOD_CHAIN_KEY, robinhoodSellDeadline, robinhoodSellPayload } from "@/lib/robinhood-sell";
import { DELIVERY_QUERY_KEY } from "@/hooks/use-delivery";

// Re-exported so existing consumers keep one import site for error copy and
// the step union.
export { CANCELLED_MESSAGE };
export type { PourStep as VaultActionStep };

/** Any connected wallet provider — the exact family is resolved at runtime. */
type AnyWalletProvider = GetWalletProviderType<SpokeChainKey>;

/**
 * What the source chain charges its fee in, so a wallet that cannot pay can
 * be told what to top up and where. Both directions pay on the source chain:
 * a withdraw signs on the chain the shares sit on, not the one the money
 * lands on.
 */
function gasContextFor(srcChainKey: SpokeChainKey): GasContext | undefined {
  const native = getNativeGasToken(srcChainKey);
  if (!native) return undefined;
  return {
    symbol: native.symbol,
    decimals: native.decimals,
    network: getChainName(srcChainKey),
  };
}

/**
 * The toast copy for the fill's terminal moment. Supplied per run because the
 * voice differs by direction (and the withdraw description names the
 * destination chain), while the one-shot firing belongs to the machine.
 */
export interface FillToastCopy {
  successTitle: string;
  successDescription: string;
  failureDescription: string;
}

/**
 * A limit order (lib/limit-orders): the same build with the intent's
 * `deadline` set to 0n (until cancelled) or the chosen day's end, and a
 * `minOutputAmount` from the price instead of a quote. The SDK's
 * leverageYield builders take `deadline` verbatim (resolveDeadline returns
 * a supplied value as is, and deposit/withdraw put it on the intent's
 * params). Once on the hub the order rests: the machine records it and
 * stops, with no fill poll and no unsettled report.
 */
export interface LimitRun {
  deadline: bigint;
  /** The price the person typed, as a decimal string, for the record. */
  limitPrice: string;
}

export interface RunDepositArgs {
  /** Vault proxy address on the Sonic hub (doubles as the lsoda* share token). */
  vault: Address;
  /** Registry name (lsoda* symbol), for error reports only. */
  vaultName?: string;
  srcChainKey: SpokeChainKey;
  /** User's EOA on `srcChainKey`. */
  srcAddress: string;
  /** Input token the user pays with (drives `inputToken` + decimals). */
  token: XToken;
  /** Amount in INPUT token decimals. */
  inputAmount: bigint;
  /** Minimum lsoda* shares out, 18 decimals, slippage already applied. */
  minOutputAmount: bigint;
  walletProvider: AnyWalletProvider;
  /** Which wallet source is signing, for error reports. */
  walletMode: "email" | "external";
  fillToasts: FillToastCopy;
  /**
   * The send precondition: a live Privy session, and the wallet on
   * `srcChainKey` (embedded wallets share one provider whose chain a
   * competing switch can steal). Awaited before every on-chain send; anything
   * but "ready" aborts the flow.
   */
  ensureReady?: () => Promise<PourReadiness>;
  /**
   * Where the output lands on the hub. The SDK's builder delivers to the hub
   * wallet derived from the SIGNING wallet, which is right for a vault
   * deposit (shares are read per source chain) and wrong for a listing:
   * every buy, from any wallet on any chain, must land on THE account
   * (lib/account). Set for listing buys, left unset for vault deposits.
   * Applied at execution, after the last
   * build: `deposit()` keeps the recipient as a plain field (`data` stays
   * "0x"), so nothing else in the payload depends on it.
   */
  deliverTo?: string;
  /**
   * Robinhood Chain delivery (plan P2b), for a market stock buy: where the
   * drawer quoted to and said it would arrive (`quoted`, from
   * hooks/use-delivery), the listing's token there, and `ask`, the route
   * asked fresh. Only when `quoted` is Robinhood Chain is the route asked
   * again, as the order starts; the buy then goes there only if the fresh
   * answer says the same (lib/delivery-client buyDestination), else it
   * stops before anything is signed. Unset, or quoted to the hub: the hub,
   * exactly as before, with no request made.
   */
  delivery?: { quoted: Delivery; rhAddress: Address | undefined; ask: () => Promise<Delivery> };
  /** Set for a limit buy; see LimitRun. */
  limit?: LimitRun;
  /**
   * The last gas check before the wallet opens (hooks/use-gas-gate
   * useGasPreflight): resolves to the message to stop with when the signing
   * chain cannot pay its fee, or null to go on. `approval` is whether an
   * approve will be sent first.
   */
  gasCheck?: (approval: boolean) => Promise<string | null>;
  /**
   * The quote check just before signing (hooks/use-pour-quote checkPrice):
   * asked after the delivery re-ask, the gas check, the approval and its
   * rebuild, so the minimum signed is still cleared by a quote seconds old,
   * not one from the tap. "moved" (the fresh minimum is below the confirmed
   * one) and "unavailable" stop the order before the wallet signs, with no
   * report: the drawer shows the new figure and the person taps again.
   * Unset for a limit order, whose minimum is its price.
   */
  priceCheck?: () => Promise<"ok" | "moved" | "unavailable">;
}

export interface RunWithdrawArgs {
  vault: Address;
  /** Registry name (lsoda* symbol), for error reports only. */
  vaultName?: string;
  /** Chain the user deposited FROM — shares live in that chain's hub wallet. */
  srcChainKey: SpokeChainKey;
  /** User's EOA on `srcChainKey`. */
  srcAddress: string;
  /** Chain the swapped-back funds should be delivered to. */
  dstChainKey: SpokeChainKey;
  /** Output spoke-side token address on `dstChainKey`. */
  outputToken: string;
  /** Symbol of `outputToken`, for error reports only. */
  outputTokenSymbol?: string;
  /** lsoda* shares to swap back, 18 decimals. */
  inputAmount: bigint;
  /** Minimum output in OUTPUT token decimals, slippage already applied. */
  minOutputAmount: bigint;
  /**
   * Address funds are delivered to ON `dstChainKey`. Required: the SDK
   * otherwise defaults to `srcAddress`, which is the wrong address format
   * whenever the destination is a different chain family.
   */
  recipient: string;
  walletProvider: AnyWalletProvider;
  /** Which wallet source is signing, for error reports. */
  walletMode: "email" | "external";
  fillToasts: FillToastCopy;
  /** See RunDepositArgs.ensureReady. */
  ensureReady?: () => Promise<PourReadiness>;
  /** Set for a limit sell; see LimitRun. */
  limit?: LimitRun;
  /**
   * A sell from the person's own wallet on Robinhood Chain (plan P3a,
   * lib/robinhood-sell): the listing's native token there. `srcChainKey`
   * is then Robinhood Chain and `srcAddress` the wallet that holds the
   * tokens and signs. Not a hub wallet spend: the SDK's withdraw build is
   * turned into a source chain intent (robinhoodSellPayload), the wallet
   * approves the robinhood asset manager for exactly `inputAmount` when its
   * allowance is short, then createVaultIntent without hubWalletSwap,
   * relay and notify, as a buy from Base goes. Market sells only. Unset:
   * the sell spends the hub wallet exactly as before. `owner` is the wallet
   * the sheet chose to sell from; the order stops before anything is
   * signed unless it is `srcAddress`.
   */
  robinhood?: { rhAddress: Address; owner: string };
  /**
   * The last gas check before the wallet opens (hooks/use-gas-gate
   * useGasPreflight): resolves to the message to stop with when the signing
   * chain cannot pay its fee, or null to go on. `approval` is whether an
   * approve will be sent first.
   */
  gasCheck?: (approval: boolean) => Promise<string | null>;
  /** See RunDepositArgs.priceCheck. */
  priceCheck?: () => Promise<"ok" | "moved" | "unavailable">;
}

export interface UseVaultActionResult {
  step: PourStep;
  error: string | null;
  /**
   * Whether the current error reached the issue tracker. `unsent` covers both
   * "not worth reporting" (user cancelled) and "reporting failed", because the
   * user-facing distinction is only ever "the team has this" or not. One state
   * for the whole order: a pipeline failure and a fill failure never coexist.
   */
  reportState: ReportState;
  /**
   * Whether the current deposit needed an approval tx: null until the
   * allowance check has run, then true/false. Drives the stepper so a
   * skipped approval isn't rendered as a completed one.
   */
  approveRequired: boolean | null;
  /**
   * The approval takes two wallet prompts: since @sodax/sdk 2.2 a token that
   * refuses a change between two non-zero allowances (USDT's lineage) is
   * first set to zero, then approved. Still one step; only its words change.
   */
  approveTwice: boolean;
  /** Solver fill progress for the settling screen; null before handoff. */
  fillPhase: FillPhase | null;
  /** The fill's spoke-side tx hash, once the solver reports one. */
  fillTxHash: string | undefined;
  /**
   * The intent's transaction on the Sonic hub, once the order is sent: what
   * an unsettled order points the user at.
   */
  hubTxHash: string | undefined;
  /**
   * Where the payment can be followed on its own chain while it travels to
   * Sonic: set for a Bitcoin payment (mempool.space), undefined elsewhere.
   */
  spokeTxUrl: string | undefined;
  /** The payment's transaction on its own chain, shown beside that link. */
  spokeTxHash: string | undefined;
  /**
   * An earlier order from a slow chain still on its way after its drawer
   * closed, so a reopened drawer can say so before the user pays twice.
   */
  earlierOrder: { spokeTxHash: string; spokeTxUrl?: string } | null;
  /** Set when a limit order rests on the hub but its record did not save; the page retries on its next load. */
  limitUnsaved: boolean;
  /**
   * Set while the order in hand is a buy delivered to Robinhood Chain:
   * the wallet it goes to, the token, and that token's balance there as the
   * order started (undefined until read, or when the read failed), so the
   * arrival can be seen (hooks/use-robinhood-arrival). Null for every other order.
   */
  robinhood: RobinhoodRun | null;
  /**
   * The order buttons are held for a gas-sponsored order that may still go
   * through (lib/gas-sponsor outcome hold), while this screen has no order
   * of its own in hand: the calm "may still go through" note shows. True
   * after a reload mid-send, and in a second tab.
   */
  outcomeHeld: boolean;
  /** True mid-pipeline: between first tap and signature. */
  pending: boolean;
  /** True while the drawer must refuse dismissal. */
  locked: boolean;
  runDeposit: (args: RunDepositArgs) => Promise<boolean>;
  runWithdraw: (args: RunWithdrawArgs) => Promise<boolean>;
  reset: () => void;
}

/** A buy delivered to Robinhood Chain, as the screen follows it. */
export type RobinhoodRun = { address: Address; rhAddress: Address; baseline?: bigint };

/** Everything the machine remembers about the run in flight. */
type ActivePour = {
  context: PourReportContext;
  fillToasts: FillToastCopy;
  /** The order's analytics funnel (lib/analytics): codes only, and what it has already said. */
  funnel?: Funnel;
};

type Funnel = {
  side: "buy" | "sell";
  props: { listing: string; chain_family: string; order_type: OrderType };
  said: Set<string>;
};

/** One funnel step of the order, once per run (lib/analytics: never an amount, address or hash). */
function sayFunnel(pour: ActivePour | null, stage: "sign_requested" | "signed" | "filled" | "failed", reason?: string): void {
  const funnel = pour?.funnel;
  if (!funnel || funnel.said.has(stage)) return;
  if (stage === "failed" && funnel.said.has("filled")) return;
  funnel.said.add(stage);
  if (stage === "failed") track(`${funnel.side}_failed`, { ...funnel.props, reason: reason ?? "other" });
  else track(`${funnel.side}_${stage}`, funnel.props);
}

function funnelFor(side: "buy" | "sell", listing: string | undefined, chainKey: SpokeChainKey, limit: boolean): Funnel {
  return {
    side,
    props: { listing: listing ?? "other", chain_family: chainFamily(getChainType(chainKey)), order_type: limit ? "limit" : "market" },
    said: new Set(),
  };
}

/** What the machine knows about the order once it has left the wallet. */
type SentOrder = {
  /** The source-chain transaction, or the relay's id for an unbroadcast payload. */
  spokeTxHash: string;
  spokeTxUrl?: string;
  intentId: string;
  /** The intent's transaction on the hub, once there: the status poll keys on it. */
  hubTxHash?: string;
  /** The solver's intent hash, from its answer when told about the intent. */
  intentHash?: string;
  /**
   * Sent by `sendSlow`, which owns the whole order: its status watch, toast,
   * award and reports. The screen only mirrors it.
   */
  slow?: boolean;
  /** The drawer may close at every step from here on. */
  closable?: boolean;
  /** A limit order resting on the hub: nothing to poll, nothing to announce. */
  limit?: boolean;
};

/** A slow order still travelling, and which run sent it. */
type InFlight = { run: number; spokeTxHash: string; spokeTxUrl?: string };

/** A relay or solver error as one line, for reports. */
function errorLine(error: unknown): string {
  return rawErrorMessage(error) ?? String(error);
}

/** The intent as createVaultIntent hands it back once it has been sent. */
type SentIntent = CreateVaultIntentResult<SpokeChainKey, boolean>;

/**
 * Whether the screen says an earlier order may still go through: the
 * outcome hold is on (a sponsored send is out, or its outcome is unknown,
 * here, before a reload, or in another tab) and the screen is idle. A
 * screen with an order in hand shows that order's own state instead.
 */
export function heldOrderNotice(step: PourStep, held: boolean): boolean {
  return held && step === "idle";
}

/**
 * Resolves when a sponsored send passes its deadline (lib/gas-sponsor), so
 * the approval waiting on it can let its screen go while the send carries on.
 */
function sponsoredStall(): { promise: Promise<void>; cancel: () => void } {
  let off = () => {};
  const promise = new Promise<void>((resolve) => {
    off = subscribeSponsoredStall(() => resolve());
  });
  return { promise, cancel: () => off() };
}

type Sent<V, E> = { ok: true; value: V } | { ok: false; error: E };

/**
 * Sends an order whose sponsored send may pass its deadline
 * (lib/gas-sponsor subscribeSponsoredStall). In time: its result, as
 * createVaultIntent gave it. Past the deadline: `onStalled` runs at once,
 * so the screen can say the order may still go through, and the send
 * carries on underneath; should it then go out after all, `onLate` takes
 * it from there, once. It is never sent a second time. A throw from the
 * send in time is the caller's to handle.
 */
export async function sendUnlessStalled<V, E>(
  send: () => Promise<Sent<V, E>>,
  {
    label,
    onStalled,
    onLate,
    subscribe = subscribeSponsoredStall,
  }: {
    /** "order" or "limit order", for the console. */
    label: string;
    onStalled: () => void;
    onLate: (value: V) => Promise<unknown> | void;
    subscribe?: (listener: () => void) => () => void;
  },
): Promise<{ stalled: false; value: Sent<V, E> } | { stalled: true }> {
  let off = () => {};
  const stalled = new Promise<void>((resolve) => {
    off = subscribe(() => resolve());
  });
  let raced;
  try {
    raced = await unlessStalled(send(), stalled);
  } finally {
    off();
  }
  if (!raced.stalled) return raced;
  // The screen first, then the late answer: a late hash that is already
  // in hand must not have its screen overwritten by the stall.
  onStalled();
  void raced.later
    .then(async (created): Promise<void> => {
      if (!created.ok) return console.warn(`[vault-action] late ${label} did not go out`, created.error);
      await onLate(created.value);
    })
    .catch((e: unknown) => console.error(`[vault-action] late ${label}`, e));
  return { stalled: true };
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The whole order, one machine: build → allowance → approve → sign, then the
 * solver fill (tracking → filled | fillFailed). All mutations go through
 * `mutateAsyncSafe`, so nothing here ever throws — failures land in `error`
 * with friendly copy and the run methods resolve `false`. Post-signature, the
 * hook owns the status poll and the terminal one-shots: success toast, XP
 * award, and the solver-fill failure report all fire exactly once, from here.
 * Callers never see the raw response or the solver's status codes.
 */
export function useVaultAction(options?: {
  /** Fired once when a deposit fills. */
  onPoured?: () => void;
}): UseVaultActionResult {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  const buildDeposit = useLeverageYieldDeposit();
  const buildWithdraw = useLeverageYieldWithdraw();
  const approve = useSwapApprove();
  const { mutate: awardPour } = useAwardPour();
  const recordLimitOrder = useRecordLimitOrder();

  const [step, setStep] = useState<PourStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<SentOrder | null>(null);
  /** The solver's latest answer for a slow order, as its own watch saw it. */
  const [slowStatus, setSlowStatus] = useState<FillStatus>({});
  const [earlierOrder, setEarlierOrder] = useState<InFlight | null>(null);
  /** A limit order that rests on the hub but that Berth could not save yet. */
  const [limitUnsaved, setLimitUnsaved] = useState(false);
  /** The slow order still travelling, if any, whatever the screen shows. */
  const inFlightRef = useRef<InFlight | null>(null);
  const [approveRequired, setApproveRequired] = useState<boolean | null>(null);
  const [approveTwice, setApproveTwice] = useState(false);
  const [robinhood, setRobinhood] = useState<RobinhoodRun | null>(null);
  const runningRef = useRef(false);
  const held = useOutcomeHold();
  const { reportState, report, resetReport } = useErrorReporter();
  /** Read by slow orders, which outlive the render that started them. */
  const reportRef = useRef(report);
  const awardRef = useRef(awardPour);
  useEffect(() => {
    reportRef.current = report;
    awardRef.current = awardPour;
  });
  /**
   * The order being run, so a failure anywhere — pipeline or solver fill —
   * can be reported with the order that caused it. A ref because `fail` is
   * called from deep in the pipeline and must see the latest value without
   * re-creating every callback. Set at run start with every field the report
   * needs, so no failure path assembles context of its own.
   */
  const pourRef = useRef<ActivePour | null>(null);
  /** Kept fresh without retriggering the terminal-resolution effect. */
  const onPouredRef = useRef(options?.onPoured);
  useEffect(() => {
    onPouredRef.current = options?.onPoured;
  });

  /** When tracking began, for the unsettled report's "tracked for". */
  const trackingStartedRef = useRef(0);
  /**
   * The last status the solver answered with. A ref because an erroring
   * poll replaces the answer with an error, and the report wants the last
   * thing the solver actually said.
   */
  const lastStatusRef = useRef<number | undefined>(undefined);

  /**
   * Which run the screen belongs to. Bumped by every run and by reset, so a
   * relay wait that outlives its drawer (a Bitcoin payment can take an hour)
   * still finishes its work, telling the solver and the team, without
   * writing into a screen that has moved on.
   */
  const runRef = useRef(0);

  /** Advance the pipeline, keeping the report's "failed at" in step. */
  const advance = useCallback((next: PourStep) => {
    if (pourRef.current) pourRef.current.context.step = next;
    if (next === "signing") sayFunnel(pourRef.current, "sign_requested");
    if (next === "confirming" || next === "tracking" || next === "resting") sayFunnel(pourRef.current, "signed");
    if (next === "resting" && pourRef.current?.funnel) track("limit_saved", { side: pourRef.current.funnel.side });
    if (next === "tracking" || next === "confirming") {
      trackingStartedRef.current = Date.now();
    }
    setStep(next);
  }, []);

  const fail = useCallback(
    (message: string, raw?: unknown, options?: { report?: boolean }) => {
      // The friendly copy hides the SDK error entirely — keep the raw object
      // on the console so field failures are diagnosable. This console line is
      // also what the log buffer captures into the issue.
      if (raw !== undefined) console.error("[vault-action]", raw);
      setError(message);
      setStep("error");
      sayFunnel(pourRef.current, "failed", failureReason({ cancelled: message === CANCELLED_MESSAGE, errorCode: extractErrorCode(raw) }));

      // A cancelled order isn't a bug; everything else goes to the team so
      // the user never has to describe what happened. `fail` is only
      // reachable inside a run, after pourRef is set — a missing context
      // would be a reporting bug, not an order, so don't guess an attribution.
      const pour = pourRef.current;
      if (!pour || options?.report === false) return;
      // A sponsored send that may still land is not a failure to file: if
      // it filled, pnpm orders:recover brings it into the ledger.
      if (message === COPY.errOutcomeUnknown) return;
      report({
        ...pour.context,
        friendlyMessage: message,
        errorCode: extractErrorCode(raw),
        rawMessage: rawErrorMessage(raw),
      });
    },
    [report],
  );

  // Fill tracking after the intent lands on the hub. The cast is the one
  // place the raw response shape is reached into, and it stays inside the
  // machine.
  // A slow order watches the solver itself, from its own closure, so its
  // bookkeeping survives the drawer; this poll is for every other order.
  const slow = sent?.slow === true;
  const statusQuery = useStatus({
    params: {
      intentTxHash:
        slow || sent?.limit
          ? undefined
          : (sent?.hubTxHash as `0x${string}` | undefined),
    },
  });
  const statusCode = slow
    ? slowStatus.code
    : statusQuery.data?.ok
      ? statusQuery.data.value.status
      : undefined;
  const fillTxHash = slow
    ? slowStatus.fillTxHash
    : statusQuery.data?.ok
      ? statusQuery.data.value.fill_tx_hash
      : undefined;
  // What the status endpoint said when it could not answer: an error result
  // from the solver, or the request itself failing.
  const statusError =
    statusQuery.data && !statusQuery.data.ok
      ? (rawErrorMessage(statusQuery.data.error) ?? "error result")
      : statusQuery.isError
        ? rawErrorMessage(statusQuery.error)
        : undefined;
  useEffect(() => {
    if (statusCode !== undefined) lastStatusRef.current = statusCode;
  }, [statusCode]);

  // Terminal resolution, applied during render (house pattern: render-time
  // state adjustment, not an effect). Only the "tracking" step resolves, and
  // resolving leaves it, so continued polling can't re-resolve.
  const resolution = slow ? null : resolveTracking(step, statusCode);
  if (resolution) setStep(resolution);

  /** A filled order's one-shots: the deposit callback, the toast, the award. */
  const settleFilled = useCallback(
    (pour: ActivePour | null, intentTxHash?: string, fillTx?: string) => {
      if (pour?.context.action === "deposit") onPouredRef.current?.();
      sayFunnel(pour, "filled");
      if (pour) {
        toast.success(pour.fillToasts.successTitle, {
          description: pour.fillToasts.successDescription,
        });
      }
      // Rewards ride the same handle the failure report does: the intent's
      // hub tx hash is the ledger's dedup key.
      if (intentTxHash) {
        awardRef.current({
          direction: pour?.context.action === "withdraw" ? "out" : "in",
          intentTxHash,
          // Helps the order record tell two quick fills of one listing apart.
          fillTxHash: fillTx,
        });
      }
    },
    [],
  );

  /** A failed fill's one-shots: the toast and the report. */
  const settleFailed = useCallback(
    (
      pour: ActivePour | null,
      intentTxHash: string | undefined,
      fillTx: string | undefined,
      file: (context: ErrorReportContext) => void,
    ) => {
      if (!pour) return;
      sayFunnel(pour, "failed", "fill_failed");
      toast.error(FILL_FAILED_MESSAGE, {
        description: pour.fillToasts.failureDescription,
      });
      // The signature went through and the intent reached the hub, then the
      // solver failed to fill it. A failed transaction with the user's funds
      // already in motion, so it matters more than a build-time error, not
      // less — and nothing else in this flow reports it.
      file({
        ...pour.context,
        step: "filling",
        txHashes: [intentTxHash, fillTx].filter(
          (hash): hash is string => !!hash,
        ),
        errorCode: "SOLVER_FILL_FAILED",
        friendlyMessage: FILL_FAILED_MESSAGE,
        rawMessage: `Solver reported status 4 (failed) for the ${pour.context.action} intent.`,
      });
    },
    [],
  );

  // The one-shots: the unsettled report, then (possibly later) the terminal
  // toast, XP award, or solver-fill failure report. The step transition is
  // the trigger; the ref records which step already fired, so dependency
  // identity changes cannot re-run a one-shot, while a late fill after an
  // unsettled report still gets its own.
  const firedRef = useRef<PourStep | null>(null);
  /** The unsettled report as sent, so a late ending can follow it up. */
  const unsettledSentRef = useRef<ErrorReportContext | null>(null);
  useEffect(() => {
    const due = dueOneShot(step, firedRef.current);
    if (!due) return;
    firedRef.current = due;
    // A slow order fires its own one-shots, once, drawer or no drawer.
    if (sent?.slow) return;

    // A late ending of an order already reported as unsettled: say how it
    // ended on that same issue, so triage does not chase an order that
    // settled after all. Sent past the reporter so the settling screen's
    // report note is not disturbed.
    if (due !== "unsettled" && unsettledSentRef.current) {
      void submitErrorReport(
        settledFollowUp(
          unsettledSentRef.current,
          due,
          Date.now() - trackingStartedRef.current,
        ),
      );
      unsettledSentRef.current = null;
    }
    const pour = pourRef.current;
    const intentTxHash = sent?.hubTxHash;

    if (due === "unsettled") {
      // Signed and sent, and the solver never said filled or failed inside
      // the wait. Funds may still arrive, so this is not a failure to the
      // user, but it is a stalled order to the team, and until now nothing
      // told anyone.
      if (pour && sent) {
        const filed = unsettledReport(pour.context, {
          intentHash: sent.intentHash,
          intentId: sent.intentId,
          spokeTxHash: sent.spokeTxHash,
          hubTxHash: intentTxHash,
          fillTxHash,
          lastStatusCode: lastStatusRef.current,
          trackedMs: Date.now() - trackingStartedRef.current,
          statusError,
        });
        unsettledSentRef.current = filed;
        report(filed);
      }
      return;
    }

    if (due === "filled") {
      settleFilled(pour, intentTxHash, fillTxHash);
    } else {
      settleFailed(pour, intentTxHash, fillTxHash, report);
    }
  }, [step, sent, fillTxHash, statusError, report, settleFailed, settleFilled]);

  // The status poll can legitimately never turn terminal (NOT_FOUND / a
  // failing endpoint), so after a bounded wait the pour becomes unsettled:
  // the drawer lets go, the user is told the order is still out, and the
  // team is told. The poll keeps running while the drawer is open.
  useEffect(() => {
    // A slow order's own watch releases it, on its own clock.
    if (step !== "tracking" || slow) return;
    const timer = setTimeout(
      () => setStep(releaseTracking),
      TRACKING_RELEASE_MS,
    );
    return () => clearTimeout(timer);
  }, [step, slow]);

  /** Tells the solver about an intent on the hub, once, as one line on failure. */
  const tellSolver = useCallback(
    async (hubTxHash: string): Promise<NotifyOutcome> => {
      const told = await sodax.leverageYield.notifySolver({ intent_tx_hash: hubTxHash as `0x${string}` });
      return told.ok ? { ok: true, intentHash: told.value.intent_hash } : { ok: false, error: errorLine(told.error) };
    },
    [sodax],
  );

  /**
   * The market order whose solver notify is being kept up (sendMarket):
   * while its fill watch still reads NOT_FOUND, the solver is told again,
   * a few times at most and never two at once (lib/market-send renotifyDue).
   * Telling the solver posts the hub hash; it never sends the order again.
   */
  const renotifyRef = useRef<RenotifyState | null>(null);
  useEffect(() => {
    const state = renotifyRef.current;
    if (!state || slow || sent?.limit || sent?.hubTxHash !== state.hubTxHash) return;
    if (step !== "tracking" && step !== "unsettled") return;
    if (!renotifyDue(statusCode, state, Date.now())) return;
    state.busy = true;
    state.renotifies += 1;
    const hubTxHash = state.hubTxHash;
    void notifyWithin(() => tellSolver(hubTxHash)).then((told) => {
      state.busy = false;
      state.lastAt = Date.now();
      if (!told.ok) return console.warn("[vault-action] notify solver again", told.error);
      setSent((prev) => (prev?.hubTxHash === hubTxHash && !prev.intentHash ? { ...prev, intentHash: told.intentHash } : prev));
    });
  }, [step, slow, sent, statusCode, statusQuery.dataUpdatedAt, tellSolver]);

  /**
   * Approvals return once the tx is submitted; poll the allowance until the
   * chain reflects it (native tokens / non-EVM report valid immediately).
   */
  const waitForAllowance = useCallback(
    async (
      params: CreateIntentParams,
      walletProvider: AnyWalletProvider,
    ): Promise<boolean> => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const check = await sodax.swaps.isAllowanceValid<SpokeChainKey>({
          params,
          walletProvider,
        });
        if (check.ok && check.value) return true;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      return false;
    },
    [sodax],
  );

  /**
   * Send an order from a slow source chain (Bitcoin): the SDK's `vaultSwap`
   * split open, so the machine learns the payment's hash the moment it is
   * broadcast instead of after the relay. `vaultSwap` waits 120s for the
   * relay and then reports RELAY_TIMEOUT without the hash, so a Bitcoin
   * payment already on its way surfaced as a signing failure.
   *
   * Here a broadcast payment moves to "confirming" (the drawer may close),
   * the relay gets a Bitcoin sized wait that rides out relayer errors, the
   * solver is told once the intent is on the hub, and the fill is watched
   * to its end. The whole order lives in this closure, not in the screen:
   * the toast, the award and every report fire from here exactly once,
   * whether or not the drawer is still open, and an open drawer only
   * mirrors it. A wait that runs out is an unsettled order, reported with
   * the payment's hash, never a failure.
   *
   * Resolves once the payment has left the wallet (for a Bitcoin withdraw,
   * once the relay has it). The rest carries on while the page is open;
   * closing the tab ends it, though the relayer already holds the payment.
   */
  const sendSlow = useCallback(
    async (input: {
      payload: LeverageYieldSwapPayload;
      walletProvider: AnyWalletProvider;
      srcChainKey: SpokeChainKey;
      relayWaitMs: number;
      /**
       * A market or limit-free order whose sponsored send answered after its
       * deadline (sendMarket): already sent, so it is never created again;
       * it carries on from here for the run and the order it belongs to.
       */
      late?: { created: SentIntent; run: number; pour: ActivePour };
    }): Promise<boolean> => {
      const { payload, walletProvider, srcChainKey, late } = input;
      const { params } = payload;
      const run = late?.run ?? runRef.current;
      const current = () => runRef.current === run;
      const pour = late?.pour ?? pourRef.current;
      if (!pour) return false;
      /** File with the screen's reporter while it shows this order, else directly. */
      const file = (context: ErrorReportContext) => {
        if (current()) reportRef.current(context);
        else void submitErrorReport(context);
      };
      const analytics = sodax.config.analytics;
      if (!late) {
        analytics.emit("leverageYield", "vaultSwap", "start", () => ({
          srcChainKey,
          dstChainKey: params.dstChainKey,
          srcAddress: params.srcAddress,
          dstAddress: params.dstAddress,
          inputToken: params.inputToken,
          outputToken: params.outputToken,
          inputAmount: params.inputAmount,
        }));
      }

      // Signs, and for a deposit broadcasts. Nothing has left the wallet if
      // this fails, so it stays an ordinary, retryable failure. A late
      // order was sent already and is never created a second time.
      const created = late
        ? { ok: true as const, value: late.created }
        : await sodax.leverageYield.createVaultIntent({
            ...payload,
            walletProvider,
            raw: false,
          });
      if (!created.ok) {
        analytics.emit("leverageYield", "vaultSwap", "failure", () => ({
          code: created.error.code,
        }));
        fail(
          friendlyError(created.error, COPY.errOrderFailed, gasContextFor(srcChainKey)),
          created.error,
        );
        return false;
      }
      const { intent, relayData } = created.value;
      const tx = String(created.value.tx);
      // What dapp-kit's vaultSwap hook refreshes: the balance that just paid.
      void queryClient.invalidateQueries({
        queryKey: ["shared", "xBalances", srcChainKey],
      });

      // A withdraw from Bitcoin broadcasts nothing: the signed payload goes
      // to the relay, which tracks it under a derived id. `vaultSwap` relays
      // it under the payload itself, so it could never be found.
      const onDemand =
        payload.hubWalletSwap === true && isBitcoinChainKeyType(srcChainKey);
      const identity = onDemand
        ? sodax.spoke.bitcoin.getOnDemandRelayIdentity(tx)
        : { srcTxHash: tx, data: relayData, pollTxHash: undefined };
      const order: SentOrder = {
        spokeTxHash: identity.pollTxHash ?? tx,
        spokeTxUrl: onDemand ? undefined : spokeTxUrl(srcChainKey, tx),
        intentId: intent.intentId.toString(),
        slow: true,
        // A broadcast payment may take an hour: the drawer is free to close
        // from here to the end. The on-demand payload relays in seconds and
        // keeps the signing screen for that wait, as every other chain does.
        closable: !onDemand,
      };
      if (current()) {
        // A late order's screen said it may still go through; now it is.
        if (late) setError(null);
        setSent(order);
        setSlowStatus({});
        if (!onDemand) advance("confirming");
      }
      inFlightRef.current = {
        run,
        spokeTxHash: order.spokeTxHash,
        spokeTxUrl: order.spokeTxUrl,
      };
      const settle = () => {
        if (inFlightRef.current?.run === run) inFlightRef.current = null;
        setEarlierOrder((earlier) => (earlier?.run === run ? null : earlier));
      };

      const relayerApiEndpoint = sodax.swaps.relayerApiEndpoint;
      const intentRelayChainId = getIntentRelayChainId(srcChainKey).toString();
      const relay = () =>
        waitForRelay(
          {
            submit: () =>
              submitTransaction(
                {
                  action: "submit",
                  params: {
                    chain_id: intentRelayChainId,
                    tx_hash: identity.srcTxHash,
                    data: identity.data,
                  },
                },
                relayerApiEndpoint,
              ),
            poll: (windowMs) =>
              waitUntilIntentExecuted({
                intentRelayChainId,
                srcTxHash: identity.pollTxHash ?? identity.srcTxHash,
                timeout: windowMs,
                apiUrl: relayerApiEndpoint,
              }),
            sleep,
            now: Date.now,
          },
          {
            budgetMs: onDemand ? DEFAULT_RELAY_TX_TIMEOUT : input.relayWaitMs,
            broadcast: !onDemand,
          },
        );

      // For a Bitcoin withdraw the run resolves once the relay has answered,
      // so a payload the relayer never took returns false like any failure.
      let relayAnswered!: (accepted: boolean) => void;
      const answered = new Promise<boolean>((resolve) => {
        relayAnswered = resolve;
      });

      let onHub: SentOrder = order;
      let notifyError: string | undefined;
      let unsettledFiled: ErrorReportContext | null = null;
      // Every event lands here. Reports, toasts and the award happen
      // whatever the screen shows; the screen follows only while it shows
      // this order.
      const on = (event: SlowOrderEvent) => {
        switch (event.type) {
          case "notAccepted":
            relayAnswered(false);
            console.error("[vault-action] relay", event.relayError);
            analytics.emit("leverageYield", "vaultSwap", "failure", () => ({
              code: event.relayError,
            }));
            // Nothing moved, and trying again is the right answer. The
            // signing screen still holds this order: its drawer is locked.
            if (current()) fail(COPY.errOrderFailed, new Error(event.relayError));
            return;
          case "stalled":
            relayAnswered(true);
            console.error("[vault-action] relay", event.relayError);
            analytics.emit("leverageYield", "vaultSwap", "failure", () => ({
              code: event.relayError,
            }));
            file(
              unsettledReport(pour.context, {
                ...order,
                trackedMs: event.trackedMs,
                relayError: event.relayError,
              }),
            );
            if (current()) advance("unsettled");
            return;
          case "onHub": {
            relayAnswered(true);
            analytics.emit("leverageYield", "vaultSwap", "success", () => ({
              intentId: intent.intentId,
              srcTxHash: tx,
              dstTxHash: event.hubTxHash,
            }));
            void queryClient.invalidateQueries({ queryKey: ["leverageYield"] });
            void queryClient.invalidateQueries({ queryKey: LISTINGS_QUERY_KEY });
            // The other half of what dapp-kit's vaultSwap hook refreshes.
            void queryClient.invalidateQueries({
              queryKey: ["shared", "xBalances", params.dstChainKey],
            });
            onHub = { ...order, hubTxHash: event.hubTxHash, intentHash: event.intentHash };
            notifyError = event.notifyError;
            if (notifyError) {
              console.error("[vault-action] notify solver", notifyError);
              // The solver may still find the intent; the watch decides,
              // and the team knows now rather than never.
              file(
                solverNotNotifiedReport(pour.context, {
                  ...order,
                  hubTxHash: event.hubTxHash,
                  notifyError,
                }),
              );
            }
            if (current()) {
              setSent(onHub);
              advance("tracking");
            }
            return;
          }
          case "status":
            if (current()) setSlowStatus(event.status);
            return;
          case "released":
            unsettledFiled = unsettledReport(pour.context, {
              ...onHub,
              hubTxHash: onHub.hubTxHash,
              fillTxHash: event.last.fillTxHash,
              lastStatusCode: event.last.code,
              trackedMs: event.trackedMs,
              statusError: event.last.error,
              notifyError,
            });
            file(unsettledFiled);
            if (current()) advance("unsettled");
            return;
          case "filled":
          case "fillFailed":
            if (event.released && unsettledFiled) {
              void submitErrorReport(
                settledFollowUp(unsettledFiled, event.type, event.trackedMs),
              );
            }
            void queryClient.invalidateQueries({ queryKey: LISTINGS_QUERY_KEY });
            if (event.type === "filled") {
              settleFilled(pour, onHub.hubTxHash, event.fillTxHash);
            } else {
              settleFailed(pour, onHub.hubTxHash, event.fillTxHash, file);
            }
            if (current()) advance(event.type);
            return;
          case "gaveUp":
            return;
        }
      };

      const done = runSlowOrder(
        {
          relay,
          notify: (hubTxHash) =>
            notifyWithin(async () => {
              const notified = await sodax.leverageYield.notifySolver({
                intent_tx_hash: hubTxHash as `0x${string}`,
              });
              return notified.ok
                ? { ok: true, intentHash: notified.value.intent_hash }
                : { ok: false, error: errorLine(notified.error) };
            }),
          status: async (hubTxHash) => {
            try {
              const answer = await sodax.swaps.getStatus({
                intent_tx_hash: hubTxHash as `0x${string}`,
              });
              return answer.ok
                ? { code: answer.value.status, fillTxHash: answer.value.fill_tx_hash }
                : { error: errorLine(answer.error) };
            } catch (e) {
              return { error: errorLine(e) };
            }
          },
          sleep,
          now: Date.now,
          emit: on,
        },
        {
          releaseMs: TRACKING_RELEASE_MS,
          budgetMs: FILL_WATCH_MS,
          intervalMs: 3_000,
          lateIntervalMs: 10_000,
        },
      )
        .catch((e) => console.error("[vault-action] slow order", e))
        .finally(() => {
          relayAnswered(true);
          settle();
        });

      if (onDemand) return answered;
      void done;
      return true;
    },
    [advance, fail, queryClient, settleFailed, settleFilled, sodax],
  );

  /**
   * A limit order reached the hub: it rests there until its price, so the
   * machine records it (hooks/use-limit-orders) and stops at "resting".
   * The balance that paid, and a sell's holding, moved now. `onScreen`
   * false: a late order whose screen has moved on is recorded all the
   * same, and the screen is left alone.
   */
  const restLimit = useCallback(
    (
      direction: "buy" | "sell",
      srcChainKey: SpokeChainKey,
      limit: LimitRun,
      swapped: {
        intent: { intentId: bigint };
        intentDeliveryInfo: { srcTxHash: string; dstTxHash: string };
        solverExecutionResponse: { intent_hash?: string };
      },
      run: number,
    ) => {
      const onScreen = () => runRef.current === run;
      const hubTxHash = swapped.intentDeliveryInfo.dstTxHash;
      if (onScreen()) {
        setError(null);
        setSent({
          spokeTxHash: swapped.intentDeliveryInfo.srcTxHash,
          intentId: swapped.intent.intentId.toString(),
          hubTxHash,
          intentHash: swapped.solverExecutionResponse.intent_hash,
          limit: true,
          closable: true,
        });
        advance("resting");
        setLimitUnsaved(false);
      }
      void queryClient.invalidateQueries({ queryKey: LISTINGS_QUERY_KEY });
      void recordLimitOrder({
        intentTxHash: hubTxHash,
        spokeTxHash: swapped.intentDeliveryInfo.srcTxHash,
        direction,
        limitPrice: limit.limitPrice,
        intentHash: swapped.solverExecutionResponse.intent_hash,
        srcChain: srcChainKey,
      }).then((saved) => {
        // Said plainly on the placed screen rather than promising the list.
        if (!saved && onScreen()) setLimitUnsaved(true);
      });
    },
    [advance, queryClient, recordLimitOrder],
  );

  /**
   * The order screen when a sponsored send passed its deadline: it may
   * still go through, the buttons are held (lib/gas-sponsor), and the drawer
   * is free. Not reported: `fail` files nothing for this message.
   */
  const failStalled = useCallback(() => {
    fail(COPY.errOutcomeUnknown, new Error("The sponsored send passed its deadline; waiting for Privy in the background."));
  }, [fail]);

  /**
   * What a limit order does once its intent is sent: verify, relay, tell
   * the solver, rest. Screen writes only while `run` still owns the screen;
   * the record and the reports happen either way.
   */
  const finishLimit = useCallback(
    async (input: {
      created: SentIntent;
      srcChainKey: SpokeChainKey;
      direction: "buy" | "sell";
      limit: LimitRun;
      run: number;
      pour: ActivePour | null;
    }): Promise<boolean> => {
      const { created, srcChainKey, run, pour } = input;
      const onScreen = () => runRef.current === run;
      const file = (context: ErrorReportContext) => {
        if (onScreen()) reportRef.current(context);
        else void submitErrorReport(context);
      };
      const tx = String(created.tx);
      const intentId = created.intent.intentId.toString();
      void queryClient.invalidateQueries({ queryKey: ["shared", "xBalances", srcChainKey] });
      const notArrived = (why: unknown) => {
        console.error("[vault-action] limit order not on the hub", why);
        // It may still arrive and rest: kept in this browser until the
        // sweep (lib/server/limit-orders sweepMissing) records it.
        addPending({ spokeTxHash: tx, direction: input.direction, limitPrice: input.limit.limitPrice, srcChain: srcChainKey, at: Date.now() });
        if (onScreen()) {
          setError(null);
          setSent({ spokeTxHash: tx, spokeTxUrl: spokeTxUrl(srcChainKey, tx), intentId, limit: true, closable: true });
          advance("unsettled");
        }
        return true;
      };
      const verified = await sodax.spoke.verifyTxHash({ txHash: tx, chainKey: srcChainKey });
      if (!verified.ok) return notArrived(verified.error);
      let hubTxHash = tx;
      if (!isHubChainKeyType(srcChainKey)) {
        const packet = await relayTxAndWaitPacket({
          srcTxHash: tx,
          data: created.relayData,
          chainKey: srcChainKey,
          relayerApiEndpoint: sodax.swaps.relayerApiEndpoint,
          timeout: undefined,
        });
        if (!packet.ok) return notArrived(packet.error);
        hubTxHash = packet.value.dst_tx_hash;
      }
      // Bounded: the order rests whatever the solver says, or does not say;
      // the solver reads the orderbook too.
      const notified = await notifyWithRetries(() => tellSolver(hubTxHash));
      if (!notified.ok && pour) {
        file(
          solverNotNotifiedReport(pour.context, {
            intentId,
            spokeTxHash: tx,
            hubTxHash,
            notifyError: notified.error,
          }),
        );
      }
      restLimit(
        input.direction,
        srcChainKey,
        input.limit,
        {
          intent: { intentId: created.intent.intentId },
          intentDeliveryInfo: { srcTxHash: tx, dstTxHash: hubTxHash },
          solverExecutionResponse: { intent_hash: notified.ok ? notified.intentHash : undefined },
        },
        run,
      );
      return true;
    },
    [advance, queryClient, restLimit, sodax, tellSolver],
  );

  /**
   * Send a limit order: the SDK's vaultSwap split open, as sendSlow does,
   * because a limit intent must never be lost between the signature and
   * its record. vaultSwap reports a relay timeout or a failed solver
   * notify as a plain failure, after the intent may already be on its way;
   * a market order in that spot expires in five minutes and is refunded,
   * a limit order would rest unseen. So: once the hub transaction is known
   * the order is recorded and rests, whatever the solver notify says (a
   * failed notify is reported, and the solver still reads the orderbook);
   * a payment that left the wallet but never reached the hub is shown as
   * sent and not arrived, with its hash, reported, and never retried. A
   * sponsored send past its deadline lets the screen go and, should Privy
   * answer late with a hash, finishes the order in the background.
   */
  const sendLimit = useCallback(
    async (input: {
      payload: LeverageYieldSwapPayload;
      walletProvider: AnyWalletProvider;
      srcChainKey: SpokeChainKey;
      direction: "buy" | "sell";
      limit: LimitRun;
    }): Promise<boolean> => {
      const { payload, walletProvider, srcChainKey } = input;
      const run = runRef.current;
      const pour = pourRef.current;
      const finish = (created: SentIntent) =>
        finishLimit({ created, srcChainKey, direction: input.direction, limit: input.limit, run, pour });
      const raced = await sendUnlessStalled(
        () => sodax.leverageYield.createVaultIntent({ ...payload, walletProvider, raw: false }),
        {
          label: "limit order",
          onStalled: failStalled,
          onLate: async (created) => {
            console.warn("[vault-action] late limit order went out", String(created.tx));
            await finish(created);
          },
        },
      );
      if (raced.stalled) return false;
      const created = raced.value;
      if (!created.ok) {
        fail(friendlyError(created.error, COPY.errOrderFailed, gasContextFor(srcChainKey)), created.error);
        return false;
      }
      return finish(created.value);
    },
    [fail, failStalled, finishLimit, sodax],
  );

  /**
   * Send a market order (lib/market-send): vaultSwap's own steps, each run
   * once. The moment the hub transaction is known the order moves to its
   * fill watch, so a refresh from there keeps what a refresh keeps for any
   * tracked order; the solver is told in the background (three bounded
   * tries, then again from the fill watch while it reads NOT_FOUND, see
   * the renotify effect). A sponsored send past its deadline lets the
   * screen go; a late hash then carries on as a sent order (sendSlow's
   * relay, fill watch and record), never sent a second time.
   */
  const sendMarket = useCallback(
    async (input: {
      payload: LeverageYieldSwapPayload;
      walletProvider: AnyWalletProvider;
      srcChainKey: SpokeChainKey;
    }): Promise<boolean> => {
      const { payload, walletProvider, srcChainKey } = input;
      const { params } = payload;
      const run = runRef.current;
      const pour = pourRef.current;
      const analytics = sodax.config.analytics;
      const ctx = { srcChainKey, dstChainKey: params.dstChainKey, action: "vaultSwap" };
      analytics.emit("leverageYield", "vaultSwap", "start", () => ({
        srcChainKey,
        dstChainKey: params.dstChainKey,
        srcAddress: params.srcAddress,
        dstAddress: params.dstAddress,
        inputToken: params.inputToken,
        outputToken: params.outputToken,
        inputAmount: params.inputAmount,
      }));
      const failed = (error: unknown) => {
        const code = (error as { code?: unknown } | null)?.code;
        analytics.emit("leverageYield", "vaultSwap", "failure", () => ({ code: typeof code === "string" ? code : "UNKNOWN" }));
        fail(friendlyError(error, COPY.errOrderFailed, gasContextFor(srcChainKey)), error);
        return false;
      };

      let raced;
      try {
        raced = await sendUnlessStalled(
          () => sodax.leverageYield.createVaultIntent({ ...payload, walletProvider, raw: false }),
          {
            label: "order",
            onStalled: failStalled,
            onLate: async (created) => {
              console.warn("[vault-action] late order went out", String(created.tx));
              if (!pour) return;
              await sendSlow({
                payload,
                walletProvider,
                srcChainKey,
                relayWaitMs: DEFAULT_RELAY_TX_TIMEOUT,
                late: { created, run, pour },
              });
            },
          },
        );
      } catch (error) {
        return failed(error);
      }
      if (raced.stalled) return false;

      let onHub;
      try {
        const created = raced.value;
        onHub = await reachHub<SentIntent["intent"]>({
          created: created.ok
            ? { ok: true, value: { tx: String(created.value.tx), intent: created.value.intent, relayData: created.value.relayData } }
            : created,
          verify: (tx) => sodax.spoke.verifyTxHash({ txHash: tx, chainKey: srcChainKey }),
          relay: isHubChainKeyType(srcChainKey)
            ? undefined
            : (tx, relayData) =>
                relayTxAndWaitPacket({
                  srcTxHash: tx,
                  data: relayData as SentIntent["relayData"],
                  chainKey: srcChainKey,
                  relayerApiEndpoint: sodax.swaps.relayerApiEndpoint,
                  timeout: undefined,
                }),
          mapVerifyError: (error) => verifyFailed("leverageYield", error, ctx),
          mapRelayError: (error) => mapRelayFailure(error, { feature: "leverageYield", ...ctx }),
        });
      } catch (error) {
        return failed(error);
      }
      if (!onHub.ok) return failed(onHub.error);

      const { spokeTxHash, hubTxHash } = onHub;
      const intentId = onHub.intent.intentId.toString();
      analytics.emit("leverageYield", "vaultSwap", "success", () => ({
        intentId: onHub.intent.intentId,
        srcTxHash: spokeTxHash,
        dstTxHash: hubTxHash,
      }));
      // What dapp-kit's vaultSwap hook refreshes.
      void queryClient.invalidateQueries({ queryKey: ["shared", "xBalances", srcChainKey] });
      void queryClient.invalidateQueries({ queryKey: ["shared", "xBalances", params.dstChainKey] });
      // On the hub: the fill watch starts now, before the solver is told.
      const notifying: RenotifyState = { hubTxHash, busy: true, renotifies: 0, lastAt: 0 };
      renotifyRef.current = notifying;
      setSent({ spokeTxHash, intentId, hubTxHash });
      advance("tracking");
      void queryClient.invalidateQueries({ queryKey: ["leverageYield"] });
      void queryClient.invalidateQueries({ queryKey: LISTINGS_QUERY_KEY });

      void notifyWithRetries(() => tellSolver(hubTxHash)).then((told) => {
        notifying.busy = false;
        notifying.lastAt = Date.now();
        if (told.ok) {
          if (runRef.current === run) {
            setSent((prev) => (prev?.hubTxHash === hubTxHash ? { ...prev, intentHash: told.intentHash } : prev));
          }
          return;
        }
        console.error("[vault-action] notify solver", told.error);
        if (!pour) return;
        // The fill watch tells the solver again while it reads NOT_FOUND;
        // the team knows now rather than never.
        const context = solverNotNotifiedReport(pour.context, { intentId, spokeTxHash, hubTxHash, notifyError: told.error });
        if (runRef.current === run) reportRef.current(context);
        else void submitErrorReport(context);
      });
      return true;
    },
    [advance, fail, failStalled, queryClient, sendSlow, sodax, tellSolver],
  );

  /**
   * The last quote check before the wallet signs (RunDepositArgs.priceCheck).
   * True to go on; false when it stopped the order (and said why) or a newer
   * run owns the screen.
   */
  const priceHolds = useCallback(
    async (check: (() => Promise<"ok" | "moved" | "unavailable">) | undefined): Promise<boolean> => {
      if (!check) return true;
      const run = runRef.current;
      const verdict = await check().catch(() => "unavailable" as const);
      if (runRef.current !== run) return false;
      if (verdict === "ok") return true;
      // Not a bug and nothing sent: the drawer shows the new figure.
      fail(verdict === "moved" ? COPY.priceMoved : COPY.quoteRefreshFailed, undefined, { report: false });
      return false;
    },
    [fail],
  );

  const runDeposit = useCallback(
    async (args: RunDepositArgs): Promise<boolean> => {
      if (runningRef.current) return false;
      runningRef.current = true;
      runRef.current += 1;
      setError(null);
      resetReport();
      setSent(null);
      setApproveRequired(null);
      setApproveTwice(false);
      setRobinhood(null);
      firedRef.current = null;
      unsettledSentRef.current = null;
      lastStatusRef.current = undefined;
      setSlowStatus({});
      pourRef.current = {
        context: {
          action: "deposit",
          step: "building",
          vaultName: args.vaultName,
          srcChainKey: args.srcChainKey,
          tokenSymbol: args.token.symbol,
          amount: `${args.inputAmount} (raw, ${args.token.decimals}dp)`,
          addressHint: addressHint(args.srcAddress),
          walletMode: args.walletMode,
        },
        fillToasts: args.fillToasts,
        funnel: funnelFor("buy", args.vaultName, args.srcChainKey, !!args.limit),
      };
      // Every on-chain send is preceded by a chain re-assertion: embedded
      // wallets share one provider whose chain any competing switch can
      // steal between build and send.
      const onRightChain = async (): Promise<boolean> => {
        if (!args.ensureReady) return true;
        const readiness = await args.ensureReady();
        if (readiness === "ready") return true;
        // Two aborts, two different instructions. Retrying a stolen chain
        // works; retrying a lapsed session just fails again the same way.
        fail(
          readiness === "session-expired"
            ? SESSION_EXPIRED_MESSAGE
            : COPY.errWalletDrifted,
        );
        return false;
      };
      const slow = slowSource(args.srcChainKey);
      try {
        // 1. Build right before executing — the payload deadline is hub time + 5 min.
        advance("building");
        // A slow source chain's payment can take an hour to reach Sonic, far
        // past the SDK's five minute default, and an intent that arrives
        // expired cannot be filled. Its window is set from hub time here.
        let deadline: bigint | undefined = args.limit?.deadline;
        if (args.limit && slow) {
          // A limit order is priced in dollars on an EVM network only
          // (lib/limit-orders limitTokenOk); the drawer never offers it here.
          fail(COPY.errCouldNotPrepare);
          return false;
        }
        // Where the buy is delivered (plan P2b). Asked again only when the
        // drawer quoted and showed Robinhood Chain; a buy quoted to the hub
        // goes to the hub with no request, as every buy did before.
        let toRobinhood: { address: Address; rhAddress: Address } | null = null;
        if (args.delivery && asksAgain(args.delivery.quoted, !!args.limit)) {
          const run = runRef.current;
          const destination = buyDestination({
            quoted: args.delivery.quoted,
            fresh: await args.delivery.ask(),
            rhAddress: args.delivery.rhAddress,
          });
          if (runRef.current !== run) return false;
          if (destination.kind === "changed") {
            // Not a bug and nothing sent: the drawer reads the answer again and requotes.
            void queryClient.invalidateQueries({ queryKey: DELIVERY_QUERY_KEY });
            fail(COPY.rhChain.destinationChanged, undefined, { report: false });
            return false;
          }
          if (destination.kind === "robinhood") {
            toRobinhood = { address: destination.address, rhAddress: destination.rhAddress };
            // Auto-filed issues show the delivery chain (lib/server/issue-body).
            if (pourRef.current) pourRef.current.context.dstChainKey = ChainKeys.ROBINHOOD_MAINNET;
            const delivered = toRobinhood;
            setRobinhood(delivered);
            // The token's balance there before the order, so its arrival
            // can be seen by balance when the relay's own record is slow.
            // A read, never awaited, never in the order's way.
            void readRobinhoodBalances(robinhoodClient(), [{ rhAddress: delivered.rhAddress }], [delivered.address])
              .then(([baseline]) => {
                if (runRef.current !== run || baseline === undefined) return;
                setRobinhood((current) => (current && current.address === delivered.address && current.rhAddress === delivered.rhAddress ? { ...current, baseline } : current));
              })
              .catch((e: unknown) => console.warn("[vault-action] Robinhood Chain balance before the buy", e));
          }
        }
        if (slow) {
          try {
            const block = await sodax.hubProvider.publicClient.getBlock({
              blockTag: "latest",
            });
            deadline = block.timestamp + BigInt(slow.intentDeadlineSeconds);
          } catch (e) {
            fail(COPY.errCouldNotPrepare, e);
            return false;
          }
        }
        const buildArgs = {
          vault: args.vault,
          srcChainKey: args.srcChainKey,
          srcAddress: sdkAddress(args.srcChainKey, args.srcAddress),
          inputToken: args.token.address,
          inputAmount: args.inputAmount,
          minOutputAmount: args.minOutputAmount,
          ...(deadline !== undefined && { deadline }),
        };
        let built = await buildDeposit.mutateAsyncSafe(buildArgs);
        if (!built.ok) {
          fail(
            friendlyError(
              built.error,
              COPY.errCouldNotPrepare,
              gasContextFor(args.srcChainKey),
            ),
            built.error,
          );
          return false;
        }

        // 2. Allowance check (native tokens and non-EVM chains report true).
        // A read-only call against a public RPC, so a transient endpoint
        // failure (mobile networks, shared-IP rate limits) shouldn't kill the
        // order — back off and retry before giving up.
        let allowance = await sodax.swaps.isAllowanceValid<SpokeChainKey>({
          params: built.value.params,
          walletProvider: args.walletProvider,
        });
        for (let attempt = 1; !allowance.ok && attempt <= 2; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 1_500 * attempt));
          allowance = await sodax.swaps.isAllowanceValid<SpokeChainKey>({
            params: built.value.params,
            walletProvider: args.walletProvider,
          });
        }
        if (!allowance.ok) {
          fail(COPY.errCouldNotCheckAllowance, allowance.error);
          return false;
        }
        setApproveRequired(!allowance.value);

        // Before any wallet opens: can the chain pay for what follows? The
        // picker greys a token that cannot, but a balance can be spent or a
        // fee rise between the pick and here.
        if (args.gasCheck) {
          const run = runRef.current;
          const stop = await args.gasCheck(!allowance.value);
          // A newer run owns the screen now; this one says nothing.
          if (runRef.current !== run) return false;
          if (stop) {
            // Not a bug and nothing to report: the person is told what to
            // add, before any wallet opens.
            fail(stop, undefined, { report: false });
            return false;
          }
        }

        // 3. Approve if needed (an on-chain tx on the spoke: assert chain).
        if (!allowance.value) {
          // A read, no prompt: does this approval clear an old allowance
          // first? If the plan cannot be read, or the RPC it reads from is
          // slow, the words stay the usual ones and this never holds up the
          // approve; the SDK makes its own plan when it approves.
          const approveParams = built.value.params;
          setApproveTwice(
            await probeApprovalTakesTwo(() =>
              sodax.swaps.buildApproveTxs<SpokeChainKey>({ params: approveParams, raw: true }),
            ),
          );
          advance("approving");
          if (!(await onRightChain())) return false;
          // A sponsored approval past its deadline lets the screen go; the
          // approval landing later spends nothing by itself.
          const stall = sponsoredStall();
          let approving;
          try {
            approving = await unlessStalled(
              approve.mutateAsyncSafe({
                params: built.value.params,
                walletProvider: args.walletProvider,
              }),
              stall.promise,
            );
          } finally {
            stall.cancel();
          }
          if (approving.stalled) {
            failStalled();
            return false;
          }
          const approved = approving.value;
          if (!approved.ok) {
            fail(
              friendlyError(
                approved.error,
                COPY.errApprovalFailed,
                gasContextFor(args.srcChainKey),
              ),
              approved.error,
            );
            return false;
          }
          const confirmed = await waitForAllowance(
            built.value.params,
            args.walletProvider,
          );
          if (!confirmed) {
            fail(
              COPY.errAllowanceStillPending,
            );
            return false;
          }

          // The approval wait (wallet prompt + confirmation poll) can consume
          // most of the payload's 5-minute hub deadline — rebuild so the
          // intent goes out with a fresh window instead of landing unfillable.
          built = await buildDeposit.mutateAsyncSafe(buildArgs);
          if (!built.ok) {
            fail(
              friendlyError(
                built.error,
                COPY.errCouldNotPrepare,
                gasContextFor(args.srcChainKey),
              ),
              built.error,
            );
            return false;
          }
        }

        // 4. Execute: one signature on the spoke chain, then verify → relay → notify solver.
        advance("signing");
        if (!(await onRightChain())) return false;
        // The last step before the signature: the minimum is still cleared by a quote seconds old.
        if (!(await priceHolds(args.priceCheck))) return false;
        // Robinhood Chain: three params replaced, after the last build, as
        // the hub's `deliverTo` is (lib/delivery-client robinhoodParams).
        const payload = toRobinhood
          ? { ...built.value, params: robinhoodParams(built.value.params, toRobinhood) }
          : args.deliverTo
            ? {
                ...built.value,
                params: { ...built.value.params, dstAddress: sdkAddress(HUB_CHAIN_KEY, args.deliverTo) },
              }
            : built.value;
        if (slow) {
          return await sendSlow({
            payload,
            walletProvider: args.walletProvider,
            srcChainKey: args.srcChainKey,
            relayWaitMs: slow.relayWaitMs,
          });
        }
        if (args.limit) {
          return await sendLimit({
            payload,
            walletProvider: args.walletProvider,
            srcChainKey: args.srcChainKey,
            direction: "buy",
            limit: args.limit,
          });
        }
        return await sendMarket({
          payload,
          walletProvider: args.walletProvider,
          srcChainKey: args.srcChainKey,
        });
      } finally {
        runningRef.current = false;
      }
    },
    [advance, approve, buildDeposit, fail, failStalled, priceHolds, queryClient, resetReport, sendLimit, sendMarket, sendSlow, sodax, waitForAllowance],
  );

  const runWithdraw = useCallback(
    async (args: RunWithdrawArgs): Promise<boolean> => {
      if (runningRef.current) return false;
      runningRef.current = true;
      runRef.current += 1;
      setError(null);
      resetReport();
      setSent(null);
      setApproveRequired(null);
      setApproveTwice(false);
      setRobinhood(null);
      firedRef.current = null;
      unsettledSentRef.current = null;
      lastStatusRef.current = undefined;
      setSlowStatus({});
      pourRef.current = {
        context: {
          action: "withdraw",
          step: "building",
          vaultName: args.vaultName,
          srcChainKey: args.srcChainKey,
          dstChainKey: args.dstChainKey,
          tokenSymbol: args.outputTokenSymbol,
          amount: `${args.inputAmount} shares (18dp)`,
          addressHint: addressHint(args.srcAddress),
          walletMode: args.walletMode,
        },
        fillToasts: args.fillToasts,
        funnel: funnelFor("sell", args.vaultName, args.dstChainKey, !!args.limit),
      };
      const onRightChain = async (): Promise<boolean> => {
        if (!args.ensureReady) return true;
        const readiness = await args.ensureReady();
        if (readiness === "ready") return true;
        // Two aborts, two different instructions. Retrying a stolen chain
        // works; retrying a lapsed session just fails again the same way.
        fail(
          readiness === "session-expired"
            ? SESSION_EXPIRED_MESSAGE
            : COPY.errWalletDrifted,
        );
        return false;
      };
      try {
        advance("building");
        // A sell from Robinhood Chain carries its own deadline (review B1):
        // the relay from there can outlast the SDK's five minute default,
        // and an intent that arrives expired strands the tokens in the hub
        // wallet derived for (robinhood, the wallet). Read from hub time.
        const robinhoodDeadline = async (): Promise<bigint | null> => {
          try {
            const block = await sodax.hubProvider.publicClient.getBlock({ blockTag: "latest" });
            return robinhoodSellDeadline(block.timestamp);
          } catch (e) {
            fail(COPY.errCouldNotPrepare, e);
            return null;
          }
        };
        let sellDeadline: bigint | undefined = args.limit?.deadline;
        if (args.robinhood && !args.limit) {
          const fresh = await robinhoodDeadline();
          if (fresh === null) return false;
          sellDeadline = fresh;
        }
        const withdrawArgsFor = (deadline: bigint | undefined) => ({
          vault: args.vault,
          srcChainKey: args.srcChainKey,
          srcAddress: sdkAddress(args.srcChainKey, args.srcAddress),
          dstChainKey: args.dstChainKey,
          outputToken: args.outputToken,
          inputAmount: args.inputAmount,
          minOutputAmount: args.minOutputAmount,
          recipient: sdkAddress(args.dstChainKey, args.recipient),
          ...(deadline !== undefined && { deadline }),
        });
        const built = await buildWithdraw.mutateAsyncSafe(withdrawArgsFor(sellDeadline));
        if (!built.ok) {
          fail(
            friendlyError(
              built.error,
              COPY.errCouldNotPrepare,
              gasContextFor(args.srcChainKey),
            ),
            built.error,
          );
          return false;
        }

        if (args.robinhood) {
          // A sell from the wallet on Robinhood Chain (lib/robinhood-sell):
          // market only, signed on Robinhood Chain by the wallet holding it.
          if (args.limit || args.srcChainKey !== ROBINHOOD_CHAIN_KEY) {
            fail(COPY.errCouldNotPrepare);
            return false;
          }
          const sell = {
            vault: args.vault,
            rhAddress: args.robinhood.rhAddress,
            srcAddress: args.srcAddress,
            owner: args.robinhood.owner,
          };
          const toPayload = (value: LeverageYieldSwapPayload, deadline: bigint | undefined): LeverageYieldSwapPayload | null => {
            if (deadline === undefined) {
              fail(COPY.errCouldNotPrepare);
              return null;
            }
            try {
              return robinhoodSellPayload(value, { ...sell, deadline });
            } catch (e) {
              fail(COPY.errCouldNotPrepare, e);
              return null;
            }
          };
          let payload = toPayload(built.value, sellDeadline);
          if (!payload) return false;

          // The allowance the robinhood asset manager holds for the token,
          // read against the same params the approve and the deposit use.
          // Retried as the buy's is: a public RPC blinks.
          let allowance = await sodax.swaps.isAllowanceValid<SpokeChainKey>({
            params: payload.params,
            walletProvider: args.walletProvider,
          });
          for (let attempt = 1; !allowance.ok && attempt <= 2; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 1_500 * attempt));
            allowance = await sodax.swaps.isAllowanceValid<SpokeChainKey>({
              params: payload.params,
              walletProvider: args.walletProvider,
            });
          }
          if (!allowance.ok) {
            fail(COPY.errCouldNotCheckAllowance, allowance.error);
            return false;
          }
          setApproveRequired(!allowance.value);

          if (args.gasCheck) {
            const run = runRef.current;
            const stop = await args.gasCheck(!allowance.value);
            if (runRef.current !== run) return false;
            if (stop) {
              fail(stop, undefined, { report: false });
              return false;
            }
          }

          if (!allowance.value) {
            // The SDK approves the asset manager for exactly params.inputAmount.
            const approveParams = payload.params;
            setApproveTwice(
              await probeApprovalTakesTwo(() =>
                sodax.swaps.buildApproveTxs<SpokeChainKey>({ params: approveParams, raw: true }),
              ),
            );
            advance("approving");
            if (!(await onRightChain())) return false;
            const stall = sponsoredStall();
            let approving;
            try {
              approving = await unlessStalled(
                approve.mutateAsyncSafe({ params: approveParams, walletProvider: args.walletProvider }),
                stall.promise,
              );
            } finally {
              stall.cancel();
            }
            if (approving.stalled) {
              failStalled();
              return false;
            }
            if (!approving.value.ok) {
              fail(
                friendlyError(approving.value.error, COPY.errApprovalFailed, gasContextFor(args.srcChainKey)),
                approving.value.error,
              );
              return false;
            }
            if (!(await waitForAllowance(approveParams, args.walletProvider))) {
              fail(COPY.errAllowanceStillPending);
              return false;
            }
            // A fresh hub deadline after the approval's wait, as a buy rebuilds.
            const freshDeadline = await robinhoodDeadline();
            if (freshDeadline === null) return false;
            const rebuilt = await buildWithdraw.mutateAsyncSafe(withdrawArgsFor(freshDeadline));
            if (!rebuilt.ok) {
              fail(friendlyError(rebuilt.error, COPY.errCouldNotPrepare, gasContextFor(args.srcChainKey)), rebuilt.error);
              return false;
            }
            payload = toPayload(rebuilt.value, freshDeadline);
            if (!payload) return false;
          }

          advance("signing");
          if (!(await onRightChain())) return false;
          // The last step before the signature: the minimum is still cleared by a quote seconds old.
          if (!(await priceHolds(args.priceCheck))) return false;
          return await sendMarket({
            payload,
            walletProvider: args.walletProvider,
            srcChainKey: args.srcChainKey,
          });
        }

        // No allowance/approve step: the payload carries hubWalletSwap and the
        // hub wallet is authorised via the single sendMessage signature below.
        // Before it opens: can the signing chain pay the fee (see runDeposit)?
        if (args.gasCheck) {
          const run = runRef.current;
          const stop = await args.gasCheck(false);
          if (runRef.current !== run) return false;
          if (stop) {
            fail(stop, undefined, { report: false });
            return false;
          }
        }
        advance("signing");
        if (!(await onRightChain())) return false;
        // The last step before the signature: the minimum is still cleared by a quote seconds old.
        if (!(await priceHolds(args.priceCheck))) return false;
        const slow = slowSource(args.srcChainKey);
        if (slow && args.limit) {
          fail(COPY.errCouldNotPrepare);
          return false;
        }
        if (slow) {
          return await sendSlow({
            payload: built.value,
            walletProvider: args.walletProvider,
            srcChainKey: args.srcChainKey,
            relayWaitMs: slow.relayWaitMs,
          });
        }
        if (args.limit) {
          return await sendLimit({
            payload: built.value,
            walletProvider: args.walletProvider,
            srcChainKey: args.srcChainKey,
            direction: "sell",
            limit: args.limit,
          });
        }
        return await sendMarket({
          payload: built.value,
          walletProvider: args.walletProvider,
          srcChainKey: args.srcChainKey,
        });
      } finally {
        runningRef.current = false;
      }
    },
    [advance, approve, buildWithdraw, fail, failStalled, priceHolds, resetReport, sendLimit, sendMarket, sendSlow, sodax, waitForAllowance],
  );

  const reset = useCallback(() => {
    // A slow order still running belongs to the run being left: it finishes
    // its work, award and reports included, but no longer writes here. A
    // reopened drawer says it is still on its way.
    const travelling = inFlightRef.current;
    if (travelling && travelling.run === runRef.current) {
      setEarlierOrder(travelling);
    }
    runRef.current += 1;
    setLimitUnsaved(false);
    setStep("idle");
    setError(null);
    resetReport();
    setSent(null);
    setApproveRequired(null);
    setApproveTwice(false);
    setRobinhood(null);
    firedRef.current = null;
    unsettledSentRef.current = null;
    lastStatusRef.current = undefined;
    setSlowStatus({});
    pourRef.current = null;
  }, [resetReport]);

  return {
    step,
    error,
    reportState,
    approveRequired,
    approveTwice,
    fillPhase: fillPhase(step, statusCode, sent?.hubTxHash !== undefined),
    fillTxHash,
    hubTxHash: sent?.hubTxHash,
    spokeTxUrl: sent?.spokeTxUrl,
    spokeTxHash: sent?.spokeTxUrl ? sent.spokeTxHash : undefined,
    limitUnsaved,
    robinhood,
    earlierOrder: earlierOrder
      ? { spokeTxHash: earlierOrder.spokeTxHash, spokeTxUrl: earlierOrder.spokeTxUrl }
      : null,
    outcomeHeld: heldOrderNotice(step, held),
    pending: isPipelineStep(step),
    locked: isPourLocked(step, sent?.closable === true),
    runDeposit,
    runWithdraw,
    reset,
  };
}
