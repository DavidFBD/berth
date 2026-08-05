"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useLeverageYieldDeposit,
  useLeverageYieldVaultSwap,
  useLeverageYieldWithdraw,
  useSodaxContext,
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
  type ErrorReportContext,
  type ReportState,
} from "@/lib/error-report";
import {
  CANCELLED_MESSAGE,
  extractErrorCode,
  friendlyError,
  rawErrorMessage,
} from "@/lib/error-copy";
import { useErrorReporter } from "@/hooks/use-error-reporter";

// Re-exported so existing consumers keep one import site for error copy.
export { CANCELLED_MESSAGE };

/** Where the orchestrated deposit/withdraw currently is. */
export type VaultActionStep =
  | "idle"
  | "building"
  | "approving"
  | "signing"
  | "done"
  | "error";

/** Any connected wallet provider — the exact family is resolved at runtime. */
type AnyWalletProvider = GetWalletProviderType<SpokeChainKey>;

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
  /**
   * Re-assert the wallet is on `srcChainKey` (embedded wallets: chain state
   * is global and can be stolen by a competing switch). Awaited before every
   * on-chain send; false aborts the flow.
   */
  ensureReady?: () => Promise<boolean>;
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
  /** See RunDepositArgs.ensureReady. */
  ensureReady?: () => Promise<boolean>;
}

export interface UseVaultActionResult {
  step: VaultActionStep;
  error: string | null;
  /**
   * Whether the current error reached the issue tracker. `unsent` covers both
   * "not worth reporting" (user cancelled) and "reporting failed", because the
   * user-facing distinction is only ever "the team has this" or not.
   */
  reportState: ReportState;
  response: VaultSwapResponse | null;
  /**
   * Whether the current deposit needed an approval tx: null until the
   * allowance check has run, then true/false. Drives the stepper so a
   * skipped approval isn't rendered as a completed one.
   */
  approveRequired: boolean | null;
  runDeposit: (args: RunDepositArgs) => Promise<boolean>;
  runWithdraw: (args: RunWithdrawArgs) => Promise<boolean>;
  reset: () => void;
}

/**
 * Orchestrates the full deposit (build → allowance → approve → sign) and
 * withdraw (build → sign) flows for a leverage-yield vault. All mutations go
 * through `mutateAsyncSafe`, so nothing here ever throws — failures land in
 * `error` with friendly copy and the method resolves `false`.
 */
export function useVaultAction(): UseVaultActionResult {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  const buildDeposit = useLeverageYieldDeposit();
  const buildWithdraw = useLeverageYieldWithdraw();
  const vaultSwap = useLeverageYieldVaultSwap();
  const approve = useSwapApprove();

  const [step, setStep] = useState<VaultActionStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<VaultSwapResponse | null>(null);
  const [approveRequired, setApproveRequired] = useState<boolean | null>(null);
  const runningRef = useRef(false);
  const { reportState, report, resetReport } = useErrorReporter();
  /**
   * Context for the current run, so a failure can be reported with the pour
   * that caused it. A ref because `fail` is called from deep in the pipeline
   * and must see the latest value without re-creating every callback.
   */
  const reportContextRef = useRef<Partial<ErrorReportContext>>({});

  /** Advance the pipeline, keeping the report's "failed at" in step. */
  const advance = useCallback((next: VaultActionStep) => {
    reportContextRef.current.step = next;
    setStep(next);
  }, []);

  const fail = useCallback((message: string, raw?: unknown) => {
    // The friendly copy hides the SDK error entirely — keep the raw object
    // on the console so field failures are diagnosable. This console line is
    // also what the log buffer captures into the issue.
    if (raw !== undefined) console.error("[vault-action]", raw);
    setError(message);
    setStep("error");

    // A cancelled pour isn't a bug; everything else goes to the team so the
    // user never has to describe what happened.
    report({
      action: "deposit",
      step: "unknown",
      ...reportContextRef.current,
      friendlyMessage: message,
      errorCode: extractErrorCode(raw),
      rawMessage: rawErrorMessage(raw),
    } as ErrorReportContext);
  }, [report]);

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
      reportContextRef.current = {
        action: "deposit",
        step: "building",
        vaultName: args.vaultName,
        srcChainKey: args.srcChainKey,
        tokenSymbol: args.token.symbol,
        amount: `${args.inputAmount} (raw, ${args.token.decimals}dp)`,
        addressHint: addressHint(args.srcAddress),
        walletMode: args.ensureReady ? "email" : "external",
      };
      // Every on-chain send is preceded by a chain re-assertion: embedded
      // wallets share one provider whose chain any competing switch can
      // steal between build and send.
      const onRightChain = async (): Promise<boolean> => {
        if (!args.ensureReady) return true;
        if (await args.ensureReady()) return true;
        fail("The kettle drifted off its burner. Please pour again.");
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
              "Couldn't ready the pour. Please try again.",
            ),
            built.error,
          );
          return false;
        }

        // 2. Allowance check (native tokens and non-EVM chains report true).
        const allowance = await sodax.swaps.isAllowanceValid<SpokeChainKey>({
          params: built.value.params,
          walletProvider: args.walletProvider,
        });
        if (!allowance.ok) {
          fail("Couldn't check the pot. Please try again.", allowance.error);
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
                "Token approval failed. Please try again.",
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
              "The pot is still warming. Wait a few seconds and try again.",
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
                "Couldn't ready the pour. Please try again.",
              ),
              built.error,
            );
            return false;
          }
        }

        // 4. Execute: one signature on the spoke chain, then verify → relay → notify solver.
        advance("signing");
        if (!(await onRightChain())) return false;
        const swapped = await vaultSwap.mutateAsyncSafe({
          ...built.value,
          walletProvider: args.walletProvider,
        });
        if (!swapped.ok) {
          fail(
            friendlyError(swapped.error, "The kettle's acting up. Try again."),
            swapped.error,
          );
          return false;
        }

        setResponse(swapped.value);
        setStep("done");
        void queryClient.invalidateQueries({ queryKey: ["leverageYield"] });
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
      reportContextRef.current = {
        action: "withdraw",
        step: "building",
        vaultName: args.vaultName,
        srcChainKey: args.srcChainKey,
        dstChainKey: args.dstChainKey,
        amount: `${args.inputAmount} shares (18dp)`,
        addressHint: addressHint(args.srcAddress),
        walletMode: args.ensureReady ? "email" : "external",
      };
      const onRightChain = async (): Promise<boolean> => {
        if (!args.ensureReady) return true;
        if (await args.ensureReady()) return true;
        fail("The kettle drifted off its burner. Please pour again.");
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
              "Couldn't ready the pour-back. Please try again.",
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
              "The kettle's acting up. Try again.",
            ),
            swapped.error,
          );
          return false;
        }

        setResponse(swapped.value);
        setStep("done");
        void queryClient.invalidateQueries({ queryKey: ["leverageYield"] });
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
  }, [resetReport]);

  return {
    step,
    error,
    reportState,
    response,
    approveRequired,
    runDeposit,
    runWithdraw,
    reset,
  };
}
