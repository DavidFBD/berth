"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  isUserRejectedError,
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
}

export interface RunWithdrawArgs {
  vault: Address;
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
}

export interface UseVaultActionResult {
  step: VaultActionStep;
  error: string | null;
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

function extractErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/** Map SDK error codes to human copy per the shared error-handling contract. */
/** Cancel copy is compared by identity in the drawers to style it gently. */
export const CANCELLED_MESSAGE = "No worries — the tea's still warm.";

function friendlyError(error: unknown, fallback: string): string {
  if (isUserRejectedError(error)) return CANCELLED_MESSAGE;
  switch (extractErrorCode(error)) {
    case "USER_REJECTED":
      return CANCELLED_MESSAGE;
    case "RELAY_TIMEOUT":
    case "RELAY_FAILED":
    case "TX_SUBMIT_FAILED":
    case "TX_VERIFICATION_FAILED":
      return "Your pour was sent but the tray is taking a while — funds are safe, this usually resolves itself.";
    case "EXECUTION_FAILED":
    case "EXTERNAL_API_ERROR":
      return "Your pour is on the counter but the solver hasn't confirmed — it's safe to retry.";
    default:
      return fallback;
  }
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

  const fail = useCallback((message: string) => {
    setError(message);
    setStep("error");
  }, []);

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
      setResponse(null);
      setApproveRequired(null);
      try {
        // 1. Build right before executing — the payload deadline is hub time + 5 min.
        setStep("building");
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
          );
          return false;
        }

        // 2. Allowance check (native tokens and non-EVM chains report true).
        const allowance = await sodax.swaps.isAllowanceValid<SpokeChainKey>({
          params: built.value.params,
          walletProvider: args.walletProvider,
        });
        if (!allowance.ok) {
          fail("Couldn't check the pot. Please try again.");
          return false;
        }
        setApproveRequired(!allowance.value);

        // 3. Approve if needed.
        if (!allowance.value) {
          setStep("approving");
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
            );
            return false;
          }
          const confirmed = await waitForAllowance(
            built.value.params,
            args.walletProvider,
          );
          if (!confirmed) {
            fail(
              "The pot is still warming — wait a few seconds and try again.",
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
            );
            return false;
          }
        }

        // 4. Execute: one signature on the spoke chain, then verify → relay → notify solver.
        setStep("signing");
        const swapped = await vaultSwap.mutateAsyncSafe({
          ...built.value,
          walletProvider: args.walletProvider,
        });
        if (!swapped.ok) {
          fail(
            friendlyError(swapped.error, "The kettle's acting up — try again."),
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
    [approve, buildDeposit, fail, queryClient, sodax, vaultSwap, waitForAllowance],
  );

  const runWithdraw = useCallback(
    async (args: RunWithdrawArgs): Promise<boolean> => {
      if (runningRef.current) return false;
      runningRef.current = true;
      setError(null);
      setResponse(null);
      try {
        setStep("building");
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
          );
          return false;
        }

        // No allowance/approve step: the payload carries hubWalletSwap and the
        // hub wallet is authorised via the single sendMessage signature below.
        setStep("signing");
        const swapped = await vaultSwap.mutateAsyncSafe({
          ...built.value,
          walletProvider: args.walletProvider,
        });
        if (!swapped.ok) {
          fail(
            friendlyError(
              swapped.error,
              "The kettle's acting up — try again.",
            ),
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
    [buildWithdraw, fail, queryClient, vaultSwap],
  );

  const reset = useCallback(() => {
    setStep("idle");
    setError(null);
    setResponse(null);
    setApproveRequired(null);
  }, []);

  return {
    step,
    error,
    response,
    approveRequired,
    runDeposit,
    runWithdraw,
    reset,
  };
}
