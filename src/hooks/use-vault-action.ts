"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import {
  useLeverageYieldDeposit,
  useLeverageYieldVaultSwap,
  useLeverageYieldWithdraw,
  useSodaxContext,
  useStatus,
  useSwapApprove,
} from "@sodax/dapp-kit";
import {
  DEFAULT_RELAY_TX_TIMEOUT,
  getIntentRelayChainId,
  isBitcoinChainKeyType,
  isHubChainKeyType,
  relayTxAndWaitPacket,
  submitTransaction,
  waitUntilIntentExecuted,
  type Address,
  type CreateIntentParams,
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
import { getChainName, getNativeGasToken, spokeTxUrl } from "@/lib/chains";
import { COPY } from "@/lib/copy";
import {
  FILL_WATCH_MS,
  TRACKING_RELEASE_MS,
  dueOneShot,
  fillPhase,
  isPipelineStep,
  isPourLocked,
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
import { useErrorReporter } from "@/hooks/use-error-reporter";
import { LISTINGS_QUERY_KEY } from "@/hooks/use-hub-holdings";
import type { PourReadiness } from "@/hooks/use-privy-evm-wallet";
import { useAwardPour } from "@/hooks/use-profile";
import { useRecordLimitOrder } from "@/hooks/use-limit-orders";
import { addPending } from "@/lib/limit-pending";

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
  /** Set for a limit buy; see LimitRun. */
  limit?: LimitRun;
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
  /** True mid-pipeline: between first tap and signature. */
  pending: boolean;
  /** True while the drawer must refuse dismissal. */
  locked: boolean;
  runDeposit: (args: RunDepositArgs) => Promise<boolean>;
  runWithdraw: (args: RunWithdrawArgs) => Promise<boolean>;
  reset: () => void;
}

/** Everything the machine remembers about the run in flight. */
type ActivePour = {
  context: PourReportContext;
  fillToasts: FillToastCopy;
};

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
  const vaultSwap = useLeverageYieldVaultSwap();
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
  const runningRef = useRef(false);
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
    if (next === "tracking" || next === "confirming") {
      trackingStartedRef.current = Date.now();
    }
    setStep(next);
  }, []);

  const fail = useCallback(
    (message: string, raw?: unknown) => {
      // The friendly copy hides the SDK error entirely — keep the raw object
      // on the console so field failures are diagnosable. This console line is
      // also what the log buffer captures into the issue.
      if (raw !== undefined) console.error("[vault-action]", raw);
      setError(message);
      setStep("error");

      // A cancelled order isn't a bug; everything else goes to the team so
      // the user never has to describe what happened. `fail` is only
      // reachable inside a run, after pourRef is set — a missing context
      // would be a reporting bug, not an order, so don't guess an attribution.
      const pour = pourRef.current;
      if (!pour) return;
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
    }): Promise<boolean> => {
      const { payload, walletProvider, srcChainKey } = input;
      const { params } = payload;
      const run = runRef.current;
      const current = () => runRef.current === run;
      const pour = pourRef.current;
      if (!pour) return false;
      /** File with the screen's reporter while it shows this order, else directly. */
      const file = (context: ErrorReportContext) => {
        if (current()) reportRef.current(context);
        else void submitErrorReport(context);
      };
      const analytics = sodax.config.analytics;
      analytics.emit("leverageYield", "vaultSwap", "start", () => ({
        srcChainKey,
        dstChainKey: params.dstChainKey,
        srcAddress: params.srcAddress,
        dstAddress: params.dstAddress,
        inputToken: params.inputToken,
        outputToken: params.outputToken,
        inputAmount: params.inputAmount,
      }));

      // Signs, and for a deposit broadcasts. Nothing has left the wallet if
      // this fails, so it stays an ordinary, retryable failure.
      const created = await sodax.leverageYield.createVaultIntent({
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
          notify: async (hubTxHash) => {
            const notified = await sodax.leverageYield.notifySolver({
              intent_tx_hash: hubTxHash as `0x${string}`,
            });
            return notified.ok
              ? { ok: true, intentHash: notified.value.intent_hash }
              : { ok: false, error: errorLine(notified.error) };
          },
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
   * The balance that paid, and a sell's holding, moved now.
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
    ) => {
      const hubTxHash = swapped.intentDeliveryInfo.dstTxHash;
      setSent({
        spokeTxHash: swapped.intentDeliveryInfo.srcTxHash,
        intentId: swapped.intent.intentId.toString(),
        hubTxHash,
        intentHash: swapped.solverExecutionResponse.intent_hash,
        limit: true,
        closable: true,
      });
      advance("resting");
      void queryClient.invalidateQueries({ queryKey: LISTINGS_QUERY_KEY });
      const run = runRef.current;
      setLimitUnsaved(false);
      void recordLimitOrder({
        intentTxHash: hubTxHash,
        spokeTxHash: swapped.intentDeliveryInfo.srcTxHash,
        direction,
        limitPrice: limit.limitPrice,
        intentHash: swapped.solverExecutionResponse.intent_hash,
        srcChain: srcChainKey,
      }).then((saved) => {
        // Said plainly on the placed screen rather than promising the list.
        if (!saved && runRef.current === run) setLimitUnsaved(true);
      });
    },
    [advance, queryClient, recordLimitOrder],
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
   * sent and not arrived, with its hash, reported, and never retried.
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
      const created = await sodax.leverageYield.createVaultIntent({ ...payload, walletProvider, raw: false });
      if (!created.ok) {
        fail(friendlyError(created.error, COPY.errOrderFailed, gasContextFor(srcChainKey)), created.error);
        return false;
      }
      const tx = String(created.value.tx);
      const intentId = created.value.intent.intentId.toString();
      void queryClient.invalidateQueries({ queryKey: ["shared", "xBalances", srcChainKey] });
      const notArrived = (why: unknown) => {
        console.error("[vault-action] limit order not on the hub", why);
        // It may still arrive and rest: kept in this browser until the
        // sweep (lib/server/limit-orders sweepMissing) records it.
        addPending({ spokeTxHash: tx, direction: input.direction, limitPrice: input.limit.limitPrice, srcChain: srcChainKey, at: Date.now() });
        setSent({ spokeTxHash: tx, spokeTxUrl: spokeTxUrl(srcChainKey, tx), intentId, limit: true, closable: true });
        advance("unsettled");
        return true;
      };
      const verified = await sodax.spoke.verifyTxHash({ txHash: tx, chainKey: srcChainKey });
      if (!verified.ok) return notArrived(verified.error);
      let hubTxHash = tx;
      if (!isHubChainKeyType(srcChainKey)) {
        const packet = await relayTxAndWaitPacket({
          srcTxHash: tx,
          data: created.value.relayData,
          chainKey: srcChainKey,
          relayerApiEndpoint: sodax.swaps.relayerApiEndpoint,
          timeout: undefined,
        });
        if (!packet.ok) return notArrived(packet.error);
        hubTxHash = packet.value.dst_tx_hash;
      }
      const notified = await sodax.leverageYield.notifySolver({ intent_tx_hash: hubTxHash as `0x${string}` });
      if (!notified.ok && pourRef.current) {
        report(
          solverNotNotifiedReport(pourRef.current.context, {
            intentId,
            spokeTxHash: tx,
            hubTxHash,
            notifyError: errorLine(notified.error),
          }),
        );
      }
      restLimit(input.direction, srcChainKey, input.limit, {
        intent: { intentId: created.value.intent.intentId },
        intentDeliveryInfo: { srcTxHash: tx, dstTxHash: hubTxHash },
        solverExecutionResponse: { intent_hash: notified.ok ? notified.value.intent_hash : undefined },
      });
      return true;
    },
    [advance, fail, queryClient, report, restLimit, sodax],
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
          srcAddress: args.srcAddress,
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

        // 3. Approve if needed (an on-chain tx on the spoke: assert chain).
        if (!allowance.value) {
          advance("approving");
          if (!(await onRightChain())) return false;
          const approved = await approve.mutateAsyncSafe({
            params: built.value.params,
            walletProvider: args.walletProvider,
          });
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
        const payload = args.deliverTo
          ? {
              ...built.value,
              params: { ...built.value.params, dstAddress: args.deliverTo },
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
        const swapped = await vaultSwap.mutateAsyncSafe({
          ...payload,
          walletProvider: args.walletProvider,
        });
        if (!swapped.ok) {
          fail(
            friendlyError(swapped.error, COPY.errOrderFailed, gasContextFor(args.srcChainKey)),
            swapped.error,
          );
          return false;
        }

        setSent({
          spokeTxHash: swapped.value.intentDeliveryInfo.srcTxHash,
          intentId: swapped.value.intent.intentId.toString(),
          hubTxHash: swapped.value.intentDeliveryInfo.dstTxHash,
          intentHash: swapped.value.solverExecutionResponse.intent_hash,
        });
        advance("tracking");
        void queryClient.invalidateQueries({ queryKey: ["leverageYield"] });
        void queryClient.invalidateQueries({ queryKey: LISTINGS_QUERY_KEY });
        return true;
      } finally {
        runningRef.current = false;
      }
    },
    [advance, approve, buildDeposit, fail, queryClient, resetReport, sendLimit, sendSlow, sodax, vaultSwap, waitForAllowance],
  );

  const runWithdraw = useCallback(
    async (args: RunWithdrawArgs): Promise<boolean> => {
      if (runningRef.current) return false;
      runningRef.current = true;
      runRef.current += 1;
      setError(null);
      resetReport();
      setSent(null);
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
        const built = await buildWithdraw.mutateAsyncSafe({
          vault: args.vault,
          srcChainKey: args.srcChainKey,
          srcAddress: args.srcAddress,
          dstChainKey: args.dstChainKey,
          outputToken: args.outputToken,
          inputAmount: args.inputAmount,
          minOutputAmount: args.minOutputAmount,
          recipient: args.recipient,
          ...(args.limit && { deadline: args.limit.deadline }),
        });
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

        // No allowance/approve step: the payload carries hubWalletSwap and the
        // hub wallet is authorised via the single sendMessage signature below.
        advance("signing");
        if (!(await onRightChain())) return false;
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
        const swapped = await vaultSwap.mutateAsyncSafe({
          ...built.value,
          walletProvider: args.walletProvider,
        });
        if (!swapped.ok) {
          fail(
            friendlyError(
              swapped.error,
              COPY.errOrderFailed,
              gasContextFor(args.srcChainKey),
            ),
            swapped.error,
          );
          return false;
        }

        setSent({
          spokeTxHash: swapped.value.intentDeliveryInfo.srcTxHash,
          intentId: swapped.value.intent.intentId.toString(),
          hubTxHash: swapped.value.intentDeliveryInfo.dstTxHash,
          intentHash: swapped.value.solverExecutionResponse.intent_hash,
        });
        advance("tracking");
        void queryClient.invalidateQueries({ queryKey: ["leverageYield"] });
        void queryClient.invalidateQueries({ queryKey: LISTINGS_QUERY_KEY });
        return true;
      } finally {
        runningRef.current = false;
      }
    },
    [advance, buildWithdraw, fail, queryClient, resetReport, sendLimit, sendSlow, vaultSwap],
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
    fillPhase: fillPhase(step, statusCode, sent?.hubTxHash !== undefined),
    fillTxHash,
    hubTxHash: sent?.hubTxHash,
    spokeTxUrl: sent?.spokeTxUrl,
    spokeTxHash: sent?.spokeTxUrl ? sent.spokeTxHash : undefined,
    limitUnsaved,
    earlierOrder: earlierOrder
      ? { spokeTxHash: earlierOrder.spokeTxHash, spokeTxUrl: earlierOrder.spokeTxUrl }
      : null,
    pending: isPipelineStep(step),
    locked: isPourLocked(step, sent?.closable === true),
    runDeposit,
    runWithdraw,
    reset,
  };
}
