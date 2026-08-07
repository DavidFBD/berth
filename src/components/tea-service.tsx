"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import {
  CaretDown,
  Check,
  Coffee,
  EnvelopeSimple,
  HandHeart,
  LockSimple,
  Receipt,
  Ticket,
  UserPlus,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { AVATARS, avatarSrc, type AvatarId } from "@/lib/avatars";
import { inviteLink } from "@/lib/referral";
import {
  INVITE_UNLOCK_LEVEL,
  RANKS,
  rankForXp,
  XP_ACTIONS,
} from "@/lib/xp";
import type { ReferralPanel } from "@/lib/profile-types";
import { REWARD_REASONS } from "@/components/xp-toast";
import {
  useClaimInvite,
  useProfile,
  useReferralPanel,
  useSetAvatar,
  useXpHistory,
} from "@/hooks/use-profile";
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
  /**
   * Whether the avatar shelf is unfolded. null = no explicit choice, and the
   * default does the smart thing: open while the pick is still unmade (it
   * pays XP and deserves the space), folded away once a face is chosen.
   */
  const [shelfToggled, setShelfToggled] = useState<boolean | null>(null);

  if (!profile.data) return null;
  const { xp, avatarId, hasEmail } = profile.data;
  const rank = rankForXp(xp);
  const currentSrc = avatarSrc(avatarId);
  const shelfOpen = shelfToggled ?? avatarId == null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-3 py-3">
      {/* The rank row doubles as the shelf's handle: tap your face to
          swap it. */}
      <button
        type="button"
        aria-expanded={shelfOpen}
        aria-controls="avatar-shelf"
        onClick={() => setShelfToggled(!shelfOpen)}
        className="-m-1 flex items-center gap-3 rounded-lg p-1 text-left transition-colors hover:bg-muted/60"
      >
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
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          {avatarId == null
            ? `Pick a face · +${XP_ACTIONS.avatar_set.amount} XP`
            : "New face"}
          <CaretDown
            className={cn(
              "size-3.5 transition-transform",
              shelfOpen && "rotate-180",
            )}
          />
        </span>
      </button>

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

      <AnimatePresence initial={false}>
        {shelfOpen && (
          <motion.div
            key="shelf"
            id="avatar-shelf"
            initial={{ height: 0, opacity: 0, marginTop: -12 }}
            animate={{ height: "auto", opacity: 1, marginTop: 0 }}
            exit={{ height: 0, opacity: 0, marginTop: -12 }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-4 gap-2 p-0.5">
              {AVATARS.map((avatar) => (
                <button
                  key={avatar.id}
                  type="button"
                  aria-label={`Choose ${avatar.label}`}
                  aria-pressed={avatarId === avatar.id}
                  disabled={setAvatar.isPending}
                  onClick={() =>
                    setAvatar.mutate(avatar.id as AvatarId, {
                      // Choice made: the shelf folds itself away again.
                      // (null = the post never landed; keep it open.)
                      onSuccess: (data) => {
                        if (data) setShelfToggled(null);
                      },
                    })
                  }
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
          </motion.div>
        )}
      </AnimatePresence>

      <InviteCorner xp={xp} code={profile.data.referralCode} />

      <LedgerRow />

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
 * The referral corner, both directions of the invitation (field feedback
 * round, 2026-08-07). Inbound: who set your seat, and the hand-claim hatch
 * for codes that links lost in transit. Outbound: the invite link as a rank
 * perk — locked below INVITE_UNLOCK_LEVEL, full-size until the first friend
 * takes a seat, then shrunk to make room for the earned/steeping numbers.
 */
function InviteCorner({ xp, code }: { xp: number; code: string | null }) {
  const panel = useReferralPanel(true);
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
              Invites unlock at {unlockRank.name}
            </span>
            <span className="text-xs text-muted-foreground">
              Reach level {INVITE_UNLOCK_LEVEL} and you can set places at the
              table too.
            </span>
          </span>
        </div>
      ) : code && stats && stats.seated > 0 ? (
        <BrewingRow code={code} stats={stats} />
      ) : code ? (
        <InviteRow code={code} taps={stats?.taps ?? 0} />
      ) : null}
    </>
  );
}

/**
 * The referred side's welcome: who set the seat (avatar and rank only, no
 * names) and — crucially — when the shared reward actually lands, so a
 * fresh account knows its +250 is steeping, not missing.
 */
function ThankYouRow({
  invitedBy,
}: {
  invitedBy: NonNullable<ReferralPanel["invitedBy"]>;
}) {
  const src = avatarSrc(invitedBy.avatarId);
  const amount = XP_ACTIONS.invite_accepted.amount;
  return (
    <div className="flex min-h-12 items-center gap-3 rounded-lg bg-muted/60 px-3 py-2">
      {src ? (
        <Image
          src={src}
          alt=""
          width={36}
          height={36}
          className="size-9 shrink-0 rounded-full"
        />
      ) : (
        <HandHeart className="size-5 shrink-0 text-primary" />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium text-foreground">
          A friend saved your seat
        </span>
        <span className="text-xs text-muted-foreground">
          {invitedBy.firstPourPaid
            ? `Your first pour paid you both +${amount} XP. Lovely.`
            : `Pour your first cup and +${amount} XP lands for you both.`}
        </span>
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground">
        Level {invitedBy.level} host
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

  const submit = () => {
    setMissed(false);
    claim.mutate(value, {
      onSuccess: (data) => {
        if (data?.invitedBy) {
          toast.success("Invite claimed", {
            description: "Your first pour pays you both.",
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
        className="flex min-h-12 items-center gap-3 rounded-lg bg-muted/60 px-3 py-2 text-left transition-colors hover:bg-muted"
      >
        <Ticket className="size-5 shrink-0 text-primary" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-foreground">
            {"Arrived on a friend's invite?"}
          </span>
          <span className="text-xs text-muted-foreground">
            Enter their code and your first pour pays you both.
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/60 px-3 py-2.5">
      <span className="text-sm font-medium text-foreground">
        {"Your friend's invite code"}
      </span>
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value.toLowerCase())}
          maxLength={8}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="eight letters"
          className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 font-mono text-sm text-foreground outline-none focus:border-primary"
        />
        <button
          type="button"
          disabled={value.length !== 8 || claim.isPending}
          onClick={submit}
          className="h-10 shrink-0 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-40"
        >
          Claim
        </button>
      </div>
      {missed && (
        <span className="text-xs text-muted-foreground">
          {"That code didn't take. Check it with your friend, codes never use the letters i, l, o or the digits 0 and 1."}
        </span>
      )}
    </div>
  );
}

/**
 * The full-size invite row, shown until the first friend takes a seat. The
 * reward fires when the invited friend pours a first verified cup — not at
 * signup — so the promise line names the pour, and the payout arrives on a
 * later sync. Taps count quietly once the link starts traveling.
 */
function InviteRow({ code, taps }: { code: string; taps: number }) {
  const { copied, copy } = useCopiedFlag();

  return (
    <button
      type="button"
      onClick={() => copy(inviteLink(code))}
      className="flex min-h-12 items-center gap-3 rounded-lg bg-muted/60 px-3 py-2 text-left transition-colors hover:bg-muted"
    >
      {copied ? (
        <Check className="size-5 shrink-0 text-primary" />
      ) : (
        <UserPlus className="size-5 shrink-0 text-primary" />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium text-foreground">
          {copied ? "Link copied, off it goes" : "Set another place at the table"}
        </span>
        <span className="text-xs text-muted-foreground">
          +{XP_ACTIONS.friend_poured.amount} XP for you both when a friend
          pours their first cup.
          {taps > 0 && ` Your link's been tapped ${taps === 1 ? "once" : `${taps} times`}.`}
        </span>
      </span>
    </button>
  );
}

/**
 * Once a friend is seated the big button has done its teaching job — it
 * shrinks to a corner glyph and the space shows the brewing numbers: seats,
 * pours, banked XP, and the XP still steeping on friends yet to pour. The
 * nudge is a clipboard line, not a message we send; the referrer stays the
 * messenger.
 */
function BrewingRow({
  code,
  stats,
}: {
  code: string;
  stats: ReferralPanel["stats"];
}) {
  const { copied, copy } = useCopiedFlag();

  const nudge = () => {
    void navigator.clipboard
      .writeText(
        `A seat's still warm for you at LSTeaTime. One pour and we both earn ${XP_ACTIONS.friend_poured.amount} XP: ${inviteLink(code)}`,
      )
      .then(() =>
        toast.success("Nudge copied", {
          description: "Pass it along however you like.",
        }),
      )
      .catch(() => {});
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-muted/60 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-foreground">
            Friends at the table
          </span>
          <span className="text-xs text-muted-foreground">
            {stats.seated} seated · {stats.poured} poured
            {stats.taps > 0 && ` · ${stats.taps} link taps`}
          </span>
        </span>
        <button
          type="button"
          onClick={() => copy(inviteLink(code))}
          aria-label="Copy your invite link"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background/60 text-primary transition-colors hover:bg-background"
        >
          {copied ? <Check className="size-4.5" /> : <UserPlus className="size-4.5" />}
        </button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          <span className="money font-medium text-foreground">
            +{stats.earnedXp.toLocaleString()} XP
          </span>{" "}
          banked
          {stats.steepingXp > 0 && (
            <>
              {" · "}
              <span className="money font-medium text-primary">
                {stats.steepingXp.toLocaleString()} XP
              </span>{" "}
              steeping
            </>
          )}
        </span>
        {stats.steepingXp > 0 && (
          <button
            type="button"
            onClick={nudge}
            className="shrink-0 text-xs font-medium text-primary underline decoration-primary/40 underline-offset-2 transition-colors hover:decoration-primary"
          >
            Copy a gentle nudge
          </button>
        )}
      </div>
    </div>
  );
}

/** Two-and-a-bit seconds of "copied" before a row reads normal again. */
function useCopiedFlag() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copy = (text: string) => {
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
  return { copied, copy };
}

const LEDGER_DATE = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});

/**
 * The house ledger: every award, attributable after the fact. Folded by
 * default; the list only fetches while it's open.
 */
function LedgerRow() {
  const [open, setOpen] = useState(false);
  const history = useXpHistory(open);

  return (
    <div className="flex flex-col rounded-lg bg-muted/40">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="house-ledger"
        onClick={() => setOpen(!open)}
        className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/60"
      >
        <Receipt className="size-5 shrink-0 text-primary" />
        <span className="flex-1 text-sm font-medium text-foreground">
          House ledger
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
            id="house-ledger"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            className="overflow-hidden"
          >
            <ul className="flex flex-col gap-1 px-3 pb-2.5">
              {history.isLoading && (
                <li className="py-1 text-xs text-muted-foreground">
                  Fetching the book…
                </li>
              )}
              {history.data?.length === 0 && (
                <li className="py-1 text-xs text-muted-foreground">
                  Nothing written yet. Pour something.
                </li>
              )}
              {history.data?.map((entry, index) => (
                <li
                  key={`${entry.at}-${index}`}
                  className="flex items-baseline gap-2 py-0.5 text-xs"
                >
                  <span className="money shrink-0 font-medium text-foreground">
                    +{entry.amount}
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
