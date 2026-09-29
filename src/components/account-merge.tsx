"use client";

import { UsersThree } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";
import { useWalletMerge, type MergeStep, type MergeTotals } from "@/hooks/use-account-merge";

/**
 * The merge's confirm and done steps (docs/plans/account-linking.md,
 * phase 3). Shown only after both accounts were proved: who stays, in plain
 * words, the totals once joined, and that nothing moves on chain. Nothing
 * happens until "Bring it in". This draws; the email flow
 * (components/rewards-panel) and the wallet flow (MergeCard below) wire it.
 */
export function MergeCardView({
  kind,
  survivor,
  together,
  usernameComes,
  step,
  xp,
  onConfirm,
  onKeep,
  onRestart,
  plain = false,
  signedOut = false,
}: {
  kind: "email" | "wallet";
  survivor: "this" | "other";
  together: MergeTotals;
  /** The joining account's username comes along (the staying one has none). */
  usernameComes?: boolean;
  step: MergeStep;
  /** The joined account's XP, once done. */
  xp?: number;
  onConfirm?: () => void;
  onKeep?: () => void;
  /** Expired or changed: back to the step that proves both sides again. */
  onRestart?: () => void;
  /** Inside a box of its own already (the rewards panel): no second background. */
  plain?: boolean;
  /** Done, and this browser was signed out (this account joined the other). */
  signedOut?: boolean;
}) {
  const copy = useCopy();
  const box = plain ? "flex flex-col gap-2" : "flex flex-col gap-2 rounded-lg bg-muted/60 p-3";
  if (step === "done") {
    return (
      <div className={box}>
        <p role="status" className="flex items-center gap-2 text-sm font-medium text-foreground">
          <UsersThree weight="duotone" className="size-5 shrink-0 text-primary" />
          {copy.mergeDone((xp ?? together.xp).toLocaleString())}
        </p>
        <p className="text-xs text-muted-foreground">{signedOut ? copy.mergeDoneSignedOut : copy.mergeDoneHow}</p>
        {kind === "email" && !signedOut ? <p className="text-xs text-muted-foreground">{copy.mergeDoneEmailWallet}</p> : null}
        {onKeep ? (
          <div>
            <Button type="button" size="sm" variant="ghost" onClick={onKeep}>
              {copy.mergeClose}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }
  const working = step === "working";
  // Too late (a code or the offer past its ten minutes) or changed since:
  // "Bring it in" cannot work again, so the way on is to start again.
  const stale = step === "expired" || step === "changed";
  const problem =
    step === "failed" ? copy.mergeFailed : step === "changed" ? copy.mergeChanged : step === "expired" ? copy.mergeExpired : null;
  return (
    <div className={box}>
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <UsersThree weight="duotone" className="size-5 shrink-0 text-primary" />
        {kind === "email" ? copy.mergeEmailTitle : copy.mergeWalletTitle}
      </p>
      <p className="text-sm text-foreground">{kind === "email" ? copy.mergeEmailAsk : copy.mergeWalletAsk}</p>
      <p className="text-xs text-muted-foreground">{copy.mergeStays(survivor, kind)}</p>
      <p className="text-xs text-muted-foreground">
        {copy.mergeWhatMoves} {copy.mergeChart}
      </p>
      <p className="text-xs text-muted-foreground">{copy.mergeLeftBehind(!!usernameComes)}</p>
      <p className="text-xs text-foreground tabular-nums">{copy.mergeTogether(together.xp.toLocaleString(), together.orders)}</p>
      <div className="flex flex-wrap gap-2">
        {stale && onRestart ? (
          <Button type="button" size="sm" onClick={onRestart}>
            {copy.mergeStartAgain}
          </Button>
        ) : (
          <Button type="button" size="sm" disabled={working || stale} onClick={onConfirm}>
            {copy.mergeConfirm}
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" disabled={working} onClick={onKeep}>
          {copy.mergeKeepSeparate}
        </Button>
      </div>
      {working ? (
        <p role="status" className="text-xs text-muted-foreground">
          {copy.mergeWorking}
        </p>
      ) : problem ? (
        <p role="alert" className="text-xs text-bad">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** The wallet merge, wired: nothing until a proved link found the wallet on another account. */
export function MergeCard() {
  const merge = useWalletMerge();
  if (merge.step === "idle" || !merge.offer) return null;
  return (
    <MergeCardView
      kind="wallet"
      survivor={merge.offer.survivor}
      together={merge.offer.together}
      usernameComes={merge.offer.usernameComes}
      step={merge.step}
      xp={merge.xp}
      signedOut={merge.signedOut}
      onConfirm={() => void merge.confirm()}
      onKeep={merge.close}
      onRestart={() => void merge.restart()}
    />
  );
}
