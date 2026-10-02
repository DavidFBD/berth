"use client";

import { useState } from "react";
import Image from "next/image";
import { toast } from "@/lib/toast";
import { Check } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";
import { useSetAvatar } from "@/hooks/use-profile";
import {
  AVATARS,
  avatarLockedSrc,
  avatarSrc,
  avatarUnlockLevel,
  type AvatarId,
  canUseAvatar,
  resolveAvatarId,
} from "@/lib/avatars";
import { RANKS, XP_ACTIONS } from "@/lib/xp";
import { cn } from "@/lib/utils";

/**
 * Choosing a face, made plain (field feedback, 2026-10-01: a new account
 * did not see that a face was something to tap). A tap selects, and the
 * selected face wears an ink ring and a check; one button saves it. The
 * first pick pays XP and the server's reward ceremony says so; a later
 * change says "Avatar saved". The button is the one accent here.
 *
 * `first`: the first screen's next step, which shows only the faces this
 * rank may use. Otherwise (changing it later) the locked faces show too,
 * dimmed, each with the rank that opens it.
 */
export function AvatarPicker({
  avatarId,
  level,
  first,
  onSaved,
  demoSave,
}: {
  avatarId: string | null;
  level: number;
  first: boolean;
  onSaved?: () => void;
  /** Dev galleries only: the save, without a session. */
  demoSave?: (avatarId: string) => void;
}) {
  const copy = useCopy();
  const words = copy.drawer;
  const setAvatar = useSetAvatar();
  const current: string | null = avatarId ? (resolveAvatarId(avatarId) ?? null) : null;
  const [picked, setPicked] = useState<string | null>(current);
  const faces = first ? AVATARS.filter((avatar) => canUseAvatar(avatar.id, level)) : AVATARS;
  const changed = picked !== null && picked !== current;

  const save = () => {
    if (!picked || !changed) return;
    if (demoSave) {
      demoSave(picked);
      onSaved?.();
      return;
    }
    setAvatar.mutate(picked as AvatarId, {
      onSuccess: (data) => {
        if (!data) {
          toast.error(words.avatarFailed);
          return;
        }
        // The first pick's reward has its own ceremony; a change has none.
        if (data.rewards.length === 0) toast.success(words.avatarSaved);
        onSaved?.();
      },
      onError: () => toast.error(words.avatarFailed),
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label={first ? words.avatarTitle : words.avatarChangeTitle} className="grid grid-cols-4 items-start gap-2.5">
        {faces.map((avatar) => {
          const locked = !canUseAvatar(avatar.id, level);
          const unlockName = RANKS[avatarUnlockLevel(avatar.id) - 1].name;
          const selected = !locked && picked === avatar.id;
          return (
            <div key={avatar.id} className="flex flex-col items-center gap-1">
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={locked ? copy.avatarLockedLabel(avatar.label, unlockName) : copy.avatarChooseLabel(avatar.label)}
                aria-disabled={locked || undefined}
                disabled={!locked && setAvatar.isPending}
                onClick={() => {
                  if (!locked) setPicked(avatar.id);
                }}
                className={cn(
                  "relative w-full rounded-full p-1 transition-[box-shadow,opacity,transform] duration-150 ease-lift outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  locked
                    ? "cursor-default"
                    : selected
                      ? "ring-2 ring-foreground"
                      : "ring-1 ring-border hover:ring-2 hover:ring-muted-foreground/40 active:scale-[0.96]",
                )}
              >
                <Image
                  src={(locked ? avatarLockedSrc(avatar.id) : avatarSrc(avatar.id)) ?? avatar.src}
                  alt=""
                  width={64}
                  height={64}
                  className={cn("block size-full rounded-full bg-avatar-disc transition-opacity duration-150", picked && !selected && !locked && "opacity-70")}
                />
                {selected && (
                  <span
                    aria-hidden
                    className="absolute -right-0.5 -bottom-0.5 flex size-6 items-center justify-center rounded-full border-2 border-popover bg-foreground text-background"
                  >
                    <Check weight="bold" className="size-3.5" />
                  </span>
                )}
              </button>
              {locked && (
                <span aria-hidden className="text-center text-[10px] leading-tight text-balance text-muted-foreground">
                  {copy.avatarUnlocksAt(unlockName)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-1.5">
        <Button className="w-full" disabled={!changed || setAvatar.isPending} onClick={save}>
          {picked === null ? words.avatarPickFirst : words.avatarSave}
        </Button>
        {first && (
          <p className="text-center text-xs text-muted-foreground">{words.avatarXp(XP_ACTIONS.avatar_set.amount)}</p>
        )}
      </div>
    </div>
  );
}
