"use client";

import { track } from "@/lib/analytics";
import { useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "@/lib/toast";
import {
  CaretDown,
  EnvelopeSimple,
  Check,
  UserCircle,
  HandHeart,
  LockSimple,
  Receipt,
  Ticket,
  UserPlus,
} from "@phosphor-icons/react";
import { HOME_CHAIN } from "@/lib/account";
import { useAccount } from "@/hooks/use-account";
import { useLinkEmail } from "@/hooks/use-link-email";
import { MergeCardView } from "@/components/account-merge";
import { ShareInviteOnX } from "@/components/share-on-x";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SPRING_POP, SPRING_SHELF } from "@/lib/motion";
import {
  AVATARS,
  avatarLockedSrc,
  avatarSrc,
  avatarUnlockLevel,
  type AvatarId,
  canUseAvatar,
  resolveAvatarId,
} from "@/lib/avatars";
import { unlockAt } from "@/lib/unlocks";
import { AvatarWithRank, RankGlyph } from "@/components/rank-glyph";
import { CODE_LENGTH, isInviteCode } from "@/lib/invite-code";
import { inviteLink } from "@/lib/referral";
import {
  INVITE_UNLOCK_LEVEL,
  RANKS,
  rankForXp,
  REWARD_REASONS,
  XP_ACTIONS,
} from "@/lib/xp";
import type { ReferralPanel } from "@/lib/profile-types";
import {
  useClaimInvite,
  useProfile,
  useReferralPanel,
  useSetAvatar,
  useXpHistory,
  useXpHolds,
} from "@/hooks/use-profile";
import { useCopy } from "@/components/settings-provider";
import { ADD_EMAIL_ANCHOR } from "@/components/social/social-section";

/**
 * The rewards corner of an account surface: rank, progress toward the next
 * one, the avatar grid, and (for wallet-only guests) the email invitation.
 * Rendered inside both the account drawer (email users) and the external
 * account drawer. Its prose lives in lib/copy, one voice for the whole app.
 */
export function RewardsPanel({
  initialGridOpen,
  initialLedgerOpen = false,
}: {
  /** Dev gallery only: start with the avatar grid unfolded (or folded). */
  initialGridOpen?: boolean;
  /** Dev gallery only: start with the ledger unfolded. */
  initialLedgerOpen?: boolean;
} = {}) {
  const profile = useProfile();
  const setAvatar = useSetAvatar();
  const copy = useCopy();
  /**
   * Whether the avatar grid is unfolded. null = no explicit choice, and the
   * default does the smart thing: open while the pick is still unmade (it
   * pays XP and deserves the space), folded away once a face is chosen.
   */
  const [gridToggled, setGridToggled] = useState<boolean | null>(
    initialGridOpen ?? null,
  );

  if (!profile.data) return null;
  const { xp, avatarId, hasEmail } = profile.data;
  const rank = rankForXp(xp);
  const gridOpen = gridToggled ?? avatarId == null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-3 py-3">
      {/* The rank row doubles as the grid's handle: tap your face to
          swap it. */}
      <button
        type="button"
        aria-expanded={gridOpen}
        aria-controls="avatar-grid"
        onClick={() => setGridToggled(!gridOpen)}
        className="-m-1 flex items-center gap-3 rounded-lg p-1 text-left transition-[transform,background-color] duration-150 ease-lift hover:bg-muted/60 active:bg-muted/60 active:scale-[0.99]"
      >
        <AvatarWithRank avatarId={avatarId} level={rank.level} size={44} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-foreground">
            {rank.name}
          </span>
          <span className="text-xs text-muted-foreground">
            {copy.rankLine(rank.level, xp.toLocaleString())}
          </span>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          {avatarId == null
            ? copy.pickFace(XP_ACTIONS.avatar_set.amount)
            : copy.newFace}
          <CaretDown
            className={cn(
              "size-3.5 transition-transform",
              gridOpen && "rotate-180",
            )}
          />
        </span>
      </button>

      <div className="flex flex-col gap-1">
        {rank.nextName && (
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            {/* Full-width bar slid left by the missing fraction: transform,
                not width, so the fill glides off the layout thread. */}
            <div
              className="h-full w-full rounded-full bg-primary transition-transform duration-300 ease-lift"
              style={{
                transform: `translateX(-${100 - Math.round(rank.progress * 100)}%)`,
              }}
            />
          </div>
        )}
        <Ladder xp={xp} />
      </div>

      <AnimatePresence initial={false}>
        {gridOpen && (
          <motion.div
            key="avatar-grid"
            id="avatar-grid"
            initial={{ height: 0, opacity: 0, marginTop: -12 }}
            animate={{ height: "auto", opacity: 1, marginTop: 0 }}
            exit={{ height: 0, opacity: 0, marginTop: -12 }}
            transition={SPRING_SHELF}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-4 items-start gap-2 p-0.5">
              {AVATARS.map((avatar) => {
                // Rank-gated faces show from the first rung, dimmed and
                // locked, so the ladder has something to look forward to.
                // The server checks the rung too; this only says it.
                const locked = !canUseAvatar(avatar.id, rank.level);
                const unlockName = RANKS[avatarUnlockLevel(avatar.id) - 1].name;
                const chosen = !locked && resolveAvatarId(avatarId) === avatar.id;
                return (
                  <div key={avatar.id} className="flex flex-col items-center gap-1">
                    <button
                      type="button"
                      aria-label={
                        locked
                          ? copy.avatarLockedLabel(avatar.label, unlockName)
                          : copy.avatarChooseLabel(avatar.label)
                      }
                      aria-pressed={locked ? undefined : chosen}
                      // aria-disabled, not disabled: a locked face stays
                      // focusable so its unlock line can be heard.
                      aria-disabled={locked || undefined}
                      disabled={!locked && setAvatar.isPending}
                      onClick={() => {
                        if (locked) return;
                        setAvatar.mutate(avatar.id as AvatarId, {
                          // Choice made: the grid folds itself away again.
                          // (null = the post never landed; keep it open.)
                          onSuccess: (data) => {
                            if (data) setGridToggled(null);
                          },
                        });
                      }}
                      className={cn(
                        "relative w-full rounded-full p-0.5 transition-[box-shadow,opacity,transform] duration-150 ease-lift",
                        locked
                          ? "cursor-default"
                          : chosen
                            ? "ring-2 ring-primary"
                            : "hover:ring-2 hover:ring-border",
                      )}
                    >
                      {/* A locked face is its own flat silhouette on the
                          plain disc (public/avatars/locked), no padlock:
                          the shape says what is coming, the line under it
                          says when. */}
                      <Image
                        src={(locked ? avatarLockedSrc(avatar.id) : avatarSrc(avatar.id)) ?? avatar.src}
                        alt=""
                        width={56}
                        height={56}
                        className="block size-full rounded-full bg-avatar-disc"
                      />
                    </button>
                    {locked && (
                      // aria-hidden: the button's label already says it.
                      <span
                        aria-hidden
                        className="text-center text-[10px] leading-tight text-balance text-muted-foreground"
                      >
                        {copy.avatarUnlocksAt(unlockName)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <InviteCorner xp={xp} code={profile.data.referralCode} />

      <LedgerRow initialOpen={initialLedgerOpen} />

      <AddEmailBlock hasEmail={hasEmail} />
    </div>
  );
}

/**
 * A wallet account's way to add an email: asked for before the signature,
 * then the code, then (when the email already has its own account) the
 * merge. Renders nothing for an account that has an email or no wallet to
 * sign with. Lives in the rewards panel and, on its own, on the first
 * screen of a wallet account's drawer.
 */
export function AddEmailBlock({ hasEmail }: { hasEmail: boolean }) {
  const privy = usePrivyEmbeddedWallet();
  const account = useAccount(HOME_CHAIN);
  const link = useLinkEmail(account.address);
  const copy = useCopy();
  return (
    <>
      {/* The email is asked for BEFORE the signature, because being asked
          to sign for something you have not been told about yet is how the
          second attempt at this felt. The gate deliberately does NOT read
          `privy.authenticated`: signing in is step two of this very flow, so
          a gate that read it would unmount the form mid-flow, which is
          exactly what happened on 2026-09-21. `mode === "external"` already
          means there is no email session here. See hooks/use-link-email. */}
      {(!hasEmail || link.state === "done" || link.state === "mergeDone") &&
        privy.enabled &&
        account.mode === "external" &&
        account.address && (
        <div id={ADD_EMAIL_ANCHOR} className="scroll-mt-4 rounded-lg bg-muted/60 p-3">
          {link.state === "idle" ? (
            <button
              type="button"
              onClick={link.open}
              className="flex min-h-9 w-full items-center gap-3 text-left"
            >
              <EnvelopeSimple className="size-5 shrink-0 text-primary" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-foreground">
                  {copy.addEmailTitle}
                </span>
                <span className="text-xs text-muted-foreground">
                  {copy.addEmailSub(XP_ACTIONS.email_linked.amount)}
                </span>
              </span>
            </button>
          ) : (link.state === "mergeConfirm" || link.state === "mergeDone") && link.merge ? (
            // Both sides proved: the email's own account was opened with its
            // code, and this browser holds the wallet's session.
            <MergeCardView
              plain
              kind="email"
              survivor={link.merge.survivor}
              together={link.merge.together}
              usernameComes={link.merge.usernameComes}
              step={link.mergeStep}
              xp={link.mergeXp}
              onConfirm={() => void link.confirmMerge()}
              onKeep={
                link.state === "mergeDone"
                  ? link.cancel
                  : () => {
                      toast(copy.mergeKeptSeparate);
                      link.cancel();
                    }
              }
              onRestart={() => void link.restartMerge()}
            />
          ) : link.state === "mergeAsk" || link.state === "mergeSending" || link.state === "mergeSigning" ? (
            <div className="flex flex-col gap-2">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <EnvelopeSimple className="size-5 shrink-0 text-primary" />
                {copy.mergeEmailTitle}
              </p>
              <p className="text-sm text-foreground">{copy.mergeEmailAsk}</p>
              <p className="text-xs text-muted-foreground">{copy.mergeOneMoreCode}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={link.state !== "mergeAsk"} onClick={() => void link.startMerge()}>
                  {copy.mergeContinue}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    toast(copy.mergeKeptSeparate);
                    link.cancel();
                  }}
                >
                  {copy.mergeKeepSeparate}
                </Button>
              </div>
              {link.state === "mergeSending" || link.state === "mergeSigning" ? (
                <p role="status" className="text-xs text-muted-foreground">
                  {link.state === "mergeSigning" ? copy.mergeSigning : copy.addEmailSending}
                </p>
              ) : link.mergeStep === "expired" ? (
                <p role="alert" className="text-xs text-bad">
                  {copy.mergeExpired}
                </p>
              ) : link.error === "failed" ? (
                <p role="alert" className="text-xs text-bad">
                  {copy.addEmailFailed}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <EnvelopeSimple className="size-5 shrink-0 text-primary" />
                {copy.addEmailTitle}
              </p>

              {link.state === "done" || link.state === "saving" ? null : link.state === "saveFailed" ? (
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={() => void link.retrySave()}>
                    {copy.addEmailRetrySave}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={link.cancel}>
                    {copy.addEmailCancel}
                  </Button>
                </div>
              ) : link.state === "code" || link.state === "verifying" ? (
                <form
                  key="code"
                  className="flex flex-col gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const code = new FormData(event.currentTarget).get("code");
                    if (typeof code === "string" && code.trim()) {
                      void link.submitCode(code.trim());
                    }
                  }}
                >
                  <p data-ph-mask className="text-xs text-muted-foreground">
                    {link.secondCode ? copy.mergeCodeSent(link.pendingEmail) : copy.addEmailCodeSent(link.pendingEmail)}
                  </p>
                  <Input
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder={copy.addEmailCodePlaceholder}
                    aria-label={copy.addEmailCodePlaceholder}
                    aria-invalid={link.error === "codeWrong" || undefined}
                    disabled={link.state === "verifying"}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" size="sm" disabled={link.state === "verifying"}>
                      {copy.addEmailVerify}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={link.state === "verifying"}
                      onClick={() => void link.resend()}
                    >
                      {copy.addEmailResend}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={link.cancel}>
                      {copy.addEmailCancel}
                    </Button>
                  </div>
                </form>
              ) : (
                <form
                  key="email"
                  className="flex flex-col gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const email = new FormData(event.currentTarget).get("email");
                    if (typeof email === "string" && email.trim()) {
                      void link.submitEmail(email.trim(), account.address!);
                    }
                  }}
                >
                  <Input
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    defaultValue={link.pendingEmail}
                    placeholder={copy.addEmailPlaceholder}
                    aria-label={copy.addEmailTitle}
                    disabled={link.state !== "email"}
                  />
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      size="sm"
                      disabled={link.state !== "email"}
                    >
                      {copy.addEmailContinue}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={link.cancel}>
                      {copy.addEmailCancel}
                    </Button>
                  </div>
                </form>
              )}

              {/* One line that says where the flow is, or what went wrong.
                  Every failure lands here: a silent return to the same form
                  looked like a button that did nothing. */}
              {(() => {
                const line =
                  link.state === "signing"
                    ? copy.addEmailSigning
                    : link.state === "sending"
                      ? copy.addEmailSending
                      : link.state === "verifying"
                        ? copy.addEmailVerifying
                        : link.state === "saving"
                          ? copy.addEmailSaving
                          : link.state === "done"
                              ? copy.addEmailDone
                              : link.state === "saveFailed"
                                ? copy.addEmailSaveFailed
                              : link.error === "codeWrong"
                                ? copy.addEmailCodeWrong
                                : link.error === "failed"
                                  ? copy.addEmailFailed
                                  : link.resent && link.state === "code"
                                    ? copy.addEmailResent
                                    : null;
                if (!line) return null;
                const bad = link.error !== null;
                return (
                  <p
                    role={bad ? "alert" : "status"}
                    className={`text-xs ${bad ? "text-bad" : "text-muted-foreground"}`}
                  >
                    {line}
                  </p>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/**
 * The ladder, whole: all ten rungs in one row under the rank, reached ones
 * in ink, the rest muted, the current one marked by a dot beneath it, and
 * one caption line. Left alone the caption names the next rung, how far it
 * is and what it opens; a tapped rung takes the caption over until it is
 * tapped again. No accent here on purpose: the drawer's progress bar (and
 * the chosen face's ring) already spend it, and the brand allows one.
 */
export function Ladder({ xp }: { xp: number }) {
  const copy = useCopy();
  const rank = rankForXp(xp);
  const [picked, setPicked] = useState<number | null>(null);

  const stateOf = (level: number) =>
    level < rank.level ? "reached" : level === rank.level ? "current" : "ahead";

  const caption = (() => {
    if (picked !== null) {
      const rung = RANKS[picked - 1];
      const state = stateOf(picked);
      const unlock = unlockAt(picked);
      return [
        copy.ladderRung(rung.name, rung.xp.toLocaleString()),
        state === "current" ? copy.ladderHere : null,
        unlock
          ? state === "ahead"
            ? copy.unlockNext(unlock)
            : copy.unlockDone(unlock)
          : null,
      ]
        .filter(Boolean)
        .join(" ");
    }
    if (!rank.nextName) return copy.ladderTop;
    const unlock = unlockAt(rank.level + 1);
    return [
      copy.ladderNext((rank.span - rank.into).toLocaleString(), rank.nextName),
      unlock ? copy.unlockNext(unlock) : null,
    ]
      .filter(Boolean)
      .join(" ");
  })();

  return (
    <div className="flex flex-col gap-1">
      <ol aria-label={copy.ladderLabel} className="grid grid-cols-10">
        {RANKS.map((rung) => {
          const state = stateOf(rung.level);
          const selected = picked === rung.level;
          return (
            <li key={rung.level} className="flex">
              <button
                type="button"
                aria-label={copy.ladderRungAria(rung.name, rung.level, state)}
                aria-pressed={selected}
                aria-current={state === "current" ? "step" : undefined}
                onClick={() => setPicked(selected ? null : rung.level)}
                className={cn(
                  "flex h-11 w-full flex-col items-center justify-center gap-1 rounded-md transition-[transform,background-color] duration-150 ease-lift active:scale-[0.94]",
                  selected ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <RankGlyph
                  level={rung.level}
                  className={cn(
                    "size-[18px]",
                    state === "ahead" ? "text-muted-foreground" : "text-foreground",
                  )}
                />
                <span
                  aria-hidden
                  className={cn(
                    "size-1 rounded-full",
                    state === "current" ? "bg-foreground" : "bg-transparent",
                  )}
                />
              </button>
            </li>
          );
        })}
      </ol>
      <p aria-live="polite" className="text-[11px] text-muted-foreground">
        {caption}
      </p>
    </div>
  );
}

/**
 * The referral corner, both directions of the invitation (field feedback
 * round, 2026-08-07). Inbound: who invited you, and the hand-claim hatch
 * for codes that got lost in transit. Outbound: the invite link as a rank
 * perk, locked below INVITE_UNLOCK_LEVEL, full-size until the first friend
 * joins, then shrunk to make room for the earned/pending numbers.
 */
export function InviteCorner({ xp, code }: { xp: number; code: string | null }) {
  const panel = useReferralPanel(true);
  const copy = useCopy();
  const level = rankForXp(xp).level;
  const unlockRank = RANKS[INVITE_UNLOCK_LEVEL - 1];

  const invitedBy = panel.data?.invitedBy ?? null;
  const stats = panel.data?.stats;

  return (
    <>
      {invitedBy && <ThankYouRow invitedBy={invitedBy} />}
      {panel.data && !invitedBy && panel.data.canClaim && <ClaimRow />}

      {level < INVITE_UNLOCK_LEVEL ? (
        <div className="flex min-h-12 items-center gap-3 rounded-lg bg-muted/40 px-3 py-2">
          <LockSimple className="size-5 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-medium text-muted-foreground">
              {copy.inviteLockedTitle(unlockRank.name)}
            </span>
            <span className="text-xs text-muted-foreground">
              {copy.inviteLockedSub(INVITE_UNLOCK_LEVEL)}
            </span>
          </span>
        </div>
      ) : code && stats && stats.seated > 0 ? (
        <ProgressRow code={code} stats={stats} />
      ) : code ? (
        <InviteRow code={code} taps={stats?.taps ?? 0} />
      ) : null}
    </>
  );
}

/**
 * The referred side's welcome: who invited you (avatar and rank only, no
 * names) and, crucially, when their own first trade XP (invite_accepted)
 * lands, so a fresh account knows its +250 is pending, not missing. The
 * inviter's XP is theirs, for a stay, and is not promised here.
 */
function ThankYouRow({
  invitedBy,
}: {
  invitedBy: NonNullable<ReferralPanel["invitedBy"]>;
}) {
  const src = avatarSrc(invitedBy.avatarId);
  const amount = XP_ACTIONS.invite_accepted.amount;
  const copy = useCopy();
  return (
    <div data-ph-mask className="flex min-h-12 items-center gap-3 rounded-lg bg-muted/60 px-3 py-2">
      {src ? (
        <Image
          src={src}
          alt=""
          width={36}
          height={36}
          className="size-9 shrink-0 rounded-full bg-avatar-disc"
        />
      ) : (
        <HandHeart className="size-5 shrink-0 text-primary" />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium text-foreground">
          {copy.friendInvitedYou}
        </span>
        <span className="text-xs text-muted-foreground">
          {invitedBy.firstPourPaid
            ? copy.inviteFirstTradePaid(amount)
            : copy.inviteFirstTradePending(amount)}
        </span>
        {invitedBy.friends && (
          <span className="text-xs text-muted-foreground">
            {copy.invitedFriendsWith(invitedBy.name)}
          </span>
        )}
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {copy.inviterLevel(invitedBy.level)}
      </span>
    </div>
  );
}

/**
 * The stripped-link recovery hatch: links shared through chat apps sometimes
 * arrive without their code, so a young account can still type it in. The
 * server enforces every guard; a miss just reads as "didn't take".
 */
function ClaimRow() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [missed, setMissed] = useState(false);
  const claim = useClaimInvite();
  const copy = useCopy();

  const submit = () => {
    setMissed(false);
    claim.mutate(value, {
      onSuccess: (data) => {
        if (data?.invitedBy) {
          toast.success(copy.claimSuccessTitle, {
            description: copy.claimSuccessSub,
          });
        } else {
          setMissed(true);
        }
      },
      onError: () => setMissed(true),
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-12 items-center gap-3 rounded-lg bg-muted/60 px-3 py-2 text-left transition-[transform,background-color] duration-150 ease-lift hover:bg-muted active:bg-muted active:scale-[0.99]"
      >
        <Ticket className="size-5 shrink-0 text-primary" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-foreground">
            {copy.claimAskTitle}
          </span>
          <span className="text-xs text-muted-foreground">
            {copy.claimAskSub}
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/60 px-3 py-2.5">
      <span className="text-sm font-medium text-foreground">
        {copy.claimInputLabel}
      </span>
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value.toLowerCase())}
          maxLength={CODE_LENGTH}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={copy.claimPlaceholder}
          className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 font-mono text-sm text-foreground outline-none focus:border-primary"
        />
        <button
          type="button"
          disabled={!isInviteCode(value) || claim.isPending}
          onClick={submit}
          className="h-10 shrink-0 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-[transform,opacity] duration-150 ease-lift active:translate-y-px active:scale-[0.985] disabled:opacity-40"
        >
          {copy.claimCta}
        </button>
      </div>
      {missed && (
        <span className="text-xs text-muted-foreground">{copy.claimMissed}</span>
      )}
    </div>
  );
}

/**
 * The full-size invite row, shown until the first friend joins. The reward
 * fires when the invited friend has set up and still uses Berth a week
 * later (lib/server/invite-xp), never for a buy, so the promise line names
 * the stay, and the payout arrives on a later sync. Taps count quietly once
 * the link starts traveling. Share on X beneath it earns nothing.
 */
function InviteRow({ code, taps }: { code: string; taps: number }) {
  const { copied, copyText } = useCopiedFlag();
  const copy = useCopy();

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        data-ph-mask
        onClick={() => {
          copyText(inviteLink(code));
          track("invite_link_copied", { surface: "invite_row" });
        }}
        className="flex min-h-12 items-center gap-3 rounded-lg bg-muted/60 px-3 py-2 text-left transition-[transform,background-color] duration-150 ease-lift hover:bg-muted active:bg-muted active:scale-[0.99]"
      >
        {copied ? (
          <Check className="size-5 shrink-0 text-primary" />
        ) : (
          <UserPlus className="size-5 shrink-0 text-primary" />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-foreground">
            {copied ? copy.inviteRowCopied : copy.inviteRowTitle}
          </span>
          <span className="text-xs text-muted-foreground">
            {copy.inviteRowSub(XP_ACTIONS.friend_stayed.amount)}
            {taps > 0 && ` ${copy.inviteTaps(taps)}`}
          </span>
        </span>
      </button>
      <ShareInviteOnX code={code} surface="invite_row_x" className="self-end px-1" />
    </div>
  );
}

/**
 * Once a friend has joined the big button has done its teaching job, it
 * shrinks to a corner glyph and the space shows the running numbers: joined,
 * stayed, banked XP, and the XP still pending on friends yet to set up and
 * stay. The
 * nudge is a clipboard line, not a message sent on the user's behalf; the
 * referrer stays the messenger.
 */
function ProgressRow({
  code,
  stats,
}: {
  code: string;
  stats: ReferralPanel["stats"];
}) {
  const { copied, copyText } = useCopiedFlag();
  const copy = useCopy();

  const nudge = () => {
    track("invite_link_copied", { surface: "invite_nudge" });
    void navigator.clipboard
      .writeText(
        copy.nudgeMessage(inviteLink(code)),
      )
      .then(() =>
        toast.success(copy.nudgeCopiedTitle, {
          description: copy.nudgeCopiedSub,
        }),
      )
      .catch(() => {});
  };

  return (
    <div data-ph-mask className="flex flex-col gap-1.5 rounded-lg bg-muted/60 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-foreground">
            {copy.friendsTitle}
          </span>
          <span className="text-xs text-muted-foreground">
            {copy.friendsTally(stats.seated, stats.settled, stats.taps)}
          </span>
        </span>
        <button
          type="button"
          onClick={() => {
        copyText(inviteLink(code));
        track("invite_link_copied", { surface: "invite_row" });
      }}
          aria-label={copy.inviteCopyLabel}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background/60 text-primary transition-[transform,background-color] duration-150 ease-lift hover:bg-background active:scale-[0.94]"
        >
          {copied ? <Check className="size-4.5" /> : <UserPlus className="size-4.5" />}
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-xs text-muted-foreground">
          <span className="money font-medium text-foreground">
            +{stats.earnedXp.toLocaleString()} XP
          </span>{" "}
          {copy.xpBankedWord}
          {stats.steepingXp > 0 && (
            <>
              {" · "}
              <span className="money font-medium text-primary">
                {stats.steepingXp.toLocaleString()} XP
              </span>{" "}
              {copy.xpPendingWord}
            </>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <ShareInviteOnX code={code} surface="invite_progress_x" />
          {stats.steepingXp > 0 && (
            <button
              type="button"
              onClick={nudge}
              className="shrink-0 text-xs font-medium text-primary underline decoration-primary/40 underline-offset-2 transition-colors hover:decoration-primary"
            >
              {copy.copyNudge}
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

/** Two-and-a-bit seconds of "copied" before a row reads normal again. */
function useCopiedFlag() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyText = (text: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 2400);
      })
      .catch(() => {
        // Clipboard denied: leave the row unchanged rather than lie.
      });
  };
  return { copied, copyText };
}

const LEDGER_DATE = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});

/**
 * The full ledger: every award, attributable after the fact. Folded by
 * default; the list only fetches while it's open.
 */
export function LedgerRow({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const history = useXpHistory(open);
  const holds = useXpHolds(open);
  const copy = useCopy();

  return (
    <div className="flex flex-col rounded-lg bg-muted/40">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="rewards-ledger"
        onClick={() => setOpen(!open)}
        className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-left transition-[transform,background-color] duration-150 ease-lift hover:bg-muted/60 active:bg-muted/60 active:scale-[0.99]"
      >
        <Receipt className="size-5 shrink-0 text-primary" />
        <span className="flex-1 text-sm font-medium text-foreground">
          {copy.ledgerTitle}
        </span>
        <CaretDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="ledger"
            id="rewards-ledger"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING_SHELF}
            className="overflow-hidden"
          >
            {/* Coming ashore: buys that will pay for being held once their
                thirty days are up, soonest first. Nothing pending, nothing
                shown. */}
            {holds.data && holds.data.length > 0 && (
              <div className="flex flex-col gap-1 px-3 pb-2">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {copy.ledgerHoldsTitle}
                </span>
                <ul className="flex flex-col gap-1">
                  {holds.data.map((hold) => (
                    <li key={hold.ref} className="flex items-baseline gap-2 py-0.5 text-xs">
                      <span className="money shrink-0 font-medium text-muted-foreground">
                        {copy.xpPlus(hold.amount)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {copy.ledgerHoldReason(hold.name)}
                      </span>
                      <span className="shrink-0 text-muted-foreground/70">
                        {copy.ledgerHoldDue(LEDGER_DATE.format(new Date(hold.dueAt)))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ul className="flex flex-col gap-1 px-3 pb-2.5">
              {history.isLoading && (
                <li className="py-1 text-xs text-muted-foreground">
                  {copy.ledgerLoading}
                </li>
              )}
              {history.data?.length === 0 && (
                <li className="py-1 text-xs text-muted-foreground">
                  {copy.ledgerEmpty}
                </li>
              )}
              {history.data?.map((entry, index) => (
                <li
                  key={`${entry.at}-${index}`}
                  className="flex items-baseline gap-2 py-0.5 text-xs"
                >
                  <span className="money shrink-0 font-medium text-foreground">
                    {copy.xpPlus(entry.amount)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {REWARD_REASONS[entry.kind]}
                  </span>
                  <span className="shrink-0 text-muted-foreground/70">
                    {LEDGER_DATE.format(new Date(entry.at))}
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The one header rank chip, worn by both kinds of account: the chosen face
 * plus the level, keyed on the XP total so every fresh award remounts the
 * inner span and replays the settle-in pop, the chip "receives" the reward.
 * One module on purpose: the pop IS the reward-receipt animation and must
 * feel identical wherever it appears (it used to exist twice, in here and in
 * account-button, and drifting apart was only a matter of time).
 *
 * `presence` adds the signed-in dot; `placeholder` keeps the chip rendered
 * before the profile lands (the account button must exist to be tapped),
 * without it, no profile means no rewards chrome at all.
 */
export function RankChip({
  onClick,
  presence = false,
  placeholder,
  ariaPrefix,
  ariaSuffix,
  waiting = 0,
}: {
  onClick?: () => void;
  presence?: boolean;
  placeholder?: string;
  ariaPrefix?: string;
  ariaSuffix?: string;
  /** Friend requests waiting in the drawer: a dot, never a number (lib/drawer-return waitingInDrawer). */
  waiting?: number;
}) {
  const copy = useCopy();
  const profile = useProfile();
  if (!profile.data && placeholder === undefined) return null;
  const rank = profile.data ? rankForXp(profile.data.xp) : null;
  const avatarId = profile.data?.avatarId ?? null;
  const hasFace = avatarSrc(avatarId) !== undefined;

  const inner = (
    // Keyed on the LEVEL, not raw XP: the header chip pops when the rank
    // actually changes, and sits still while ordinary XP trickles in. The
    // celebration belongs to the level-up card; chrome stays quieter than
    // the ceremony it echoes.
    <motion.span
      key={rank?.level ?? -1}
      initial={{ scale: 1.12 }}
      animate={{ scale: 1 }}
      transition={SPRING_POP}
      className="flex items-center gap-1.5"
    >
      {/* At 20px a rank mark on the face would be a smudge, so the face
          goes bare and the rank glyph stands beside it, before the level.
          No face yet: the glyph leads alone. No profile yet: the plain
          placeholder, since there is no rank to draw. */}
      <span className="relative flex size-5 shrink-0 items-center justify-center">
        {rank && hasFace ? (
          <AvatarWithRank avatarId={avatarId} level={rank.level} size={20} />
        ) : rank ? (
          <RankGlyph level={rank.level} className="size-4 text-foreground" />
        ) : (
          <UserCircle aria-hidden className="size-5 text-muted-foreground" />
        )}
        {/* The signed-in dot lives on the avatar, presence-badge style. */}
        {waiting > 0 && (
          // Ink with the card's ring, as the Friends row's badge is ink: top right, the signed-in dot being bottom right.
          <span
            aria-hidden
            data-waiting-dot
            className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-foreground ring-2 ring-card"
          />
        )}
        {presence && (
          <span
            aria-hidden
            className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-good ring-2 ring-card"
          />
        )}
      </span>
      {rank && hasFace && (
        <RankGlyph level={rank.level} className="-mr-0.5 size-3.5 text-foreground" />
      )}
      {rank ? (
        <span className="text-xs font-medium text-foreground">
          <span className="lg:hidden">{copy.rankLevelShort(rank.level)}</span>
          {/* A desktop bar has the room to say the rank in words. */}
          <span className="hidden lg:inline">
            {copy.rankLevelLong(rank.level)}
            <span className="ml-1.5 font-normal text-muted-foreground">{rank.name}</span>
          </span>
        </span>
      ) : (
        <span className="text-xs font-medium text-foreground">{placeholder}</span>
      )}
    </motion.span>
  );

  // shrink-0 + nowrap: a squeezed header must truncate its neighbours, not
  // fold "Lv 2" onto two lines.
  const shell =
    "flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-2.5";
  if (!onClick) return <span className={shell}>{inner}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={[
        ariaPrefix ?? copy.rewardsChipLabel,
        rank ? copy.rankAriaLabel(rank.name, rank.level) : null,
        ariaSuffix,
        waiting > 0 ? copy.accountWaitingAria(waiting) : null,
      ]
        .filter(Boolean)
        .join(", ")}
      className={cn(shell, "transition-[transform,background-color] duration-150 ease-lift hover:bg-muted active:scale-[0.97]")}
    >
      {inner}
    </button>
  );
}
