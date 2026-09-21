"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useLeverageYieldDeposit,
  useLeverageYieldVaultSwap,
  useLeverageYieldWithdraw,
  useSodaxContext,
  useStatus,
  useSwapApprove,
} from "@sodax/dapp-kit";
import type {
  Address,
  CreateIntentParams,
  GetWalletProviderType,
  SpokeChainKey,
  VaultSwapResponse,
  XToken,
} from "@sodax/sdk";
import {
  addressHint,
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
import { getChainName, getNativeGasToken } from "@/lib/chains";
import { COPY } from "@/lib/copy";
import {
  TRACKING_RELEASE_MS,
  fillPhase,
  isPipelineStep,
  isPourLocked,
  resolveTracking,
  type FillPhase,
  type PourStep,
} from "@/lib/pour-lifecycle";
import { useErrorReporter } from "@/hooks/use-error-reporter";
import { LISTINGS_QUERY_KEY } from "@/hooks/use-hub-holdings";
import type { PourReadiness } from "@/hooks/use-privy-evm-wallet";
import { useAwardPour } from "@/hooks/use-profile";

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

  const [step, setStep] = useState<PourStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<VaultSwapResponse | null>(null);
  const [approveRequired, setApproveRequired] = useState<boolean | null>(null);
  const [trackingTimedOut, setTrackingTimedOut] = useState(false);
  const runningRef = useRef(false);
  const { reportState, report, resetReport } = useErrorReporter();
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

  /** Advance the pipeline, keeping the report's "failed at" in step. */
  const advance = useCallback((next: PourStep) => {
    if (pourRef.current) pourRef.current.context.step = next;
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
  const statusQuery = useStatus({
    params: {
      intentTxHash: response
        ? (response.intentDeliveryInfo.dstTxHash as `0x${string}`)
        : undefined,
    },
  });
  const statusCode = statusQuery.data?.ok
    ? statusQuery.data.value.status
    : undefined;
  const fillTxHash = statusQuery.data?.ok
    ? statusQuery.data.value.fill_tx_hash
    : undefined;

  // Terminal resolution, applied during render (house pattern: render-time
  // state adjustment, not an effect). Only the "tracking" step resolves, and
  // resolving leaves it, so continued polling can't re-resolve.
  const resolution = resolveTracking(step, statusCode);
  if (resolution) setStep(resolution);

  // The terminal one-shots: toast, XP award, solver-fill failure report.
  // The step transition is the trigger; the ref guards against dependency
  // identity changes re-running the effect after it has fired.
  const terminalFiredRef = useRef(false);
  useEffect(() => {
    if (step !== "filled" && step !== "fillFailed") return;
    if (terminalFiredRef.current) return;
    terminalFiredRef.current = true;
    const pour = pourRef.current;
    const intentTxHash = response?.intentDeliveryInfo.dstTxHash;

    if (step === "filled") {
      if (pour?.context.action === "deposit") onPouredRef.current?.();
      if (pour) {
        toast.success(pour.fillToasts.successTitle, {
          description: pour.fillToasts.successDescription,
        });
      }
      // Rewards ride the same handle the failure report does: the intent's
      // hub tx hash is the ledger's dedup key.
      if (intentTxHash) {
        awardPour({
          direction: pour?.context.action === "withdraw" ? "out" : "in",
          intentTxHash,
        });
      }
    } else if (pour) {
      toast.error(FILL_FAILED_MESSAGE, {
        description: pour.fillToasts.failureDescription,
      });
      // The signature went through and the intent reached the hub, then the
      // solver failed to fill it. A failed transaction with the user's funds
      // already in motion, so it matters more than a build-time error, not
      // less — and nothing else in this flow reports it.
      report({
        ...pour.context,
        step: "filling",
        txHashes: [intentTxHash, fillTxHash].filter(
          (hash): hash is string => !!hash,
        ),
        errorCode: "SOLVER_FILL_FAILED",
        friendlyMessage: FILL_FAILED_MESSAGE,
        rawMessage: `Solver reported status 4 (failed) for the ${pour.context.action} intent.`,
      });
    }
  }, [step, response, fillTxHash, awardPour, report]);

  // The status poll can legitimately never turn terminal (NOT_FOUND / a
  // failing endpoint) — release the dismissal lock after a bounded wait
  // rather than trapping the user forever.
  useEffect(() => {
    if (step !== "tracking") return;
    const timer = setTimeout(
      () => setTrackingTimedOut(true),
      TRACKING_RELEASE_MS,
    );
    return () => clearTimeout(timer);
  }, [step]);

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

  const runDeposit = useCallback(
    async (args: RunDepositArgs): Promise<boolean> => {
      if (runningRef.current) return false;
      runningRef.current = true;
      setError(null);
      resetReport();
      setResponse(null);
      setApproveRequired(null);
      setTrackingTimedOut(false);
      terminalFiredRef.current = false;
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
      try {
        // 1. Build right before executing — the payload deadline is hub time + 5 min.
        advance("building");
        const buildArgs = {
          vault: args.vault,
          srcChainKey: args.srcChainKey,
          srcAddress: args.srcAddress,
          inputToken: args.token.address,
          inputAmount: args.inputAmount,
          minOutputAmount: args.minOutputAmount,
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

        setResponse(swapped.value);
        advance("tracking");
        void queryClient.invalidateQueries({ queryKey: ["leverageYield"] });
        void queryClient.invalidateQueries({ queryKey: LISTINGS_QUERY_KEY });
        return true;
      } finally {
        runningRef.current = false;
      }
    },
    [advance, approve, buildDeposit, fail, queryClient, resetReport, sodax, vaultSwap, waitForAllowance],
  );

  const runWithdraw = useCallback(
    async (args: RunWithdrawArgs): Promise<boolean> => {
      if (runningRef.current) return false;
      runningRef.current = true;
      setError(null);
      resetReport();
      setResponse(null);
      setTrackingTimedOut(false);
      terminalFiredRef.current = false;
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

        setResponse(swapped.value);
        advance("tracking");
        void queryClient.invalidateQueries({ queryKey: ["leverageYield"] });
        void queryClient.invalidateQueries({ queryKey: LISTINGS_QUERY_KEY });
        return true;
      } finally {
        runningRef.current = false;
      }
    },
    [advance, buildWithdraw, fail, queryClient, resetReport, vaultSwap],
  );

  const reset = useCallback(() => {
    setStep("idle");
    setError(null);
    resetReport();
    setResponse(null);
    setApproveRequired(null);
    setTrackingTimedOut(false);
    terminalFiredRef.current = false;
    pourRef.current = null;
  }, [resetReport]);

  return {
    step,
    error,
    reportState,
    approveRequired,
    fillPhase: fillPhase(step, statusCode),
    fillTxHash,
    pending: isPipelineStep(step),
    locked: isPourLocked(step, trackingTimedOut),
    runDeposit,
    runWithdraw,
    reset,
  };
}
