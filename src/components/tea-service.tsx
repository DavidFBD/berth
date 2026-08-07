"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { Coffee, EnvelopeSimple } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { AVATARS, avatarSrc, type AvatarId } from "@/lib/avatars";
import { rankForXp, XP_ACTIONS } from "@/lib/xp";
import { useProfile, useSetAvatar } from "@/hooks/use-profile";
import { usePrivyEmbeddedWallet } from "@/hooks/use-privy-evm-wallet";

/**
 * The rewards corner of an account surface: rank, progress toward the next
 * one, the avatar shelf, and (for wallet-only guests) the email invitation.
 * Rendered inside both the pantry drawer (email users) and the external
 * account drawer, so ranks read the same in every theme by design — the
 * ladder lives in xp.ts, not in personality copy.
 */
export function TeaService() {
  const profile = useProfile();
  const setAvatar = useSetAvatar();
  const privy = usePrivyEmbeddedWallet();

  if (!profile.data) return null;
  const { xp, avatarId, hasEmail } = profile.data;
  const rank = rankForXp(xp);
  const currentSrc = avatarSrc(avatarId);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-3 py-3">
      <div className="flex items-center gap-3">
        {currentSrc ? (
          <Image
            src={currentSrc}
            alt=""
            width={44}
            height={44}
            className="size-11 shrink-0 rounded-full"
          />
        ) : (
          <div
            aria-hidden
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted"
          >
            <Coffee className="size-6 text-primary" />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-foreground">
            {rank.name}
          </span>
          <span className="text-xs text-muted-foreground">
            Level {rank.level} · {xp.toLocaleString()} XP
          </span>
        </div>
      </div>

      {rank.nextName && (
        <div className="flex flex-col gap-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${Math.round(rank.progress * 100)}%` }}
            />
          </div>
          <span className="text-[11px] text-muted-foreground">
            {rank.span - rank.into} XP to {rank.nextName}
          </span>
        </div>
      )}

      <div className="grid grid-cols-4 gap-2">
        {AVATARS.map((avatar) => (
          <button
            key={avatar.id}
            type="button"
            aria-label={`Choose ${avatar.label}`}
            aria-pressed={avatarId === avatar.id}
            disabled={setAvatar.isPending}
            onClick={() => setAvatar.mutate(avatar.id as AvatarId)}
            className={cn(
              "rounded-full p-0.5 transition-all",
              avatarId === avatar.id
                ? "ring-2 ring-primary"
                : "opacity-80 hover:opacity-100",
            )}
          >
            <Image
              src={avatar.src}
              alt={avatar.label}
              width={56}
              height={56}
              className="size-full rounded-full"
            />
          </button>
        ))}
      </div>

      {/* The invitation: wallet guests can put a name to the account. The
          server pays the reward once the Privy session and the wallet meet
          on one row, so this button only has to open the door. */}
      {!hasEmail && privy.enabled && !privy.authenticated && (
        <button
          type="button"
          onClick={privy.login}
          className="flex min-h-12 items-center gap-3 rounded-lg bg-muted/60 px-3 py-2 text-left transition-colors hover:bg-muted"
        >
          <EnvelopeSimple className="size-5 shrink-0 text-primary" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-medium text-foreground">
              Add an email to your table
            </span>
            <span className="text-xs text-muted-foreground">
              Keeps your seat saved. +{XP_ACTIONS.email_linked.amount} XP
            </span>
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * Compact header chip: the chosen face and the level. Renders nothing until
 * a profile exists, so signed-out visitors see no rewards chrome at all.
 */
export function XpChip({ onClick }: { onClick?: () => void }) {
  const profile = useProfile();
  if (!profile.data) return null;
  const rank = rankForXp(profile.data.xp);
  const src = avatarSrc(profile.data.avatarId);

  // Keyed on the XP total: every fresh award remounts the inner span, which
  // replays the little settle-in pop — the chip "receives" the reward.
  const inner = (
    <motion.span
      key={profile.data.xp}
      initial={{ scale: 1.25 }}
      animate={{ scale: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 15 }}
      className="flex items-center gap-1.5"
    >
      {src ? (
        <Image src={src} alt="" width={20} height={20} className="size-5 rounded-full" />
      ) : (
        <Coffee aria-hidden className="size-5 text-primary" />
      )}
      <span className="text-xs font-medium">Lv {rank.level}</span>
    </motion.span>
  );

  // shrink-0 + nowrap: a squeezed header must truncate its neighbours, not
  // fold "Lv 2" onto two lines.
  if (!onClick) {
    return (
      <span className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-2.5">
        {inner}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Your rewards: ${rank.name}, level ${rank.level}`}
      className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-2.5 transition-colors hover:bg-muted"
    >
      {inner}
    </button>
  );
}
