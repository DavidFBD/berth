"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { motion, useReducedMotion } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { AvatarWithRank, RankGlyph } from "@/components/rank-glyph";
import { Button } from "@/components/ui/button";
import { PRIMARY } from "@/components/home-next-step";
import { useCopy } from "@/components/settings-provider";
import { useAccountHeaders } from "@/hooks/use-profile";
import { avatarSrc } from "@/lib/avatars";
import {
  celebrations,
  foldCelebrations,
  isNewLevel,
  seenLevelKey,
  stageBusy,
  TAKEOVER,
  TAKEOVER_EVENTS,
  takeoverEventAction,
  type Celebration,
} from "@/lib/level-up";
import { EASE_LIFT } from "@/lib/motion";
import type { Profile } from "@/lib/profile-types";
import { unlocksBetween } from "@/lib/unlocks";

/**
 * The level-up takeover (lib/level-up is its rulebook). A rank crossing
 * takes the centre of the screen for a moment: the person's face opens in
 * with two rings of the new rank's glyph spreading out from behind it in
 * ink, the rank's name and what the rung opened settle in, and by well
 * under two seconds it is a still card that waits for "Nice", Esc or a tap
 * outside. No confetti, no glow, no gradient, no colour but the one
 * primary action. With reduced motion asked for, the card is simply there.
 *
 * It waits while a signing window or an order drawer is open and shows
 * once that closes. Each rung shows at most once per account on this
 * device. Screen readers are told politely, then the focus rests on Nice
 * and stays inside until it closes. Over an open drawer (the account
 * drawer, where friend features are turned on) it closes alone.
 */

const memorySeen = new Map<string, string>();

function readSeen(key: string): string | null {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored !== null) return stored;
  } catch {
    // Storage blocked: the in-memory copy is all there is this session.
  }
  return memorySeen.get(key) ?? null;
}

function writeSeen(key: string, level: number) {
  memorySeen.set(key, String(level));
  try {
    window.localStorage.setItem(key, String(level));
  } catch {
    // Kept in memory for the session.
  }
}

const POLL_MS = 300;

/** Mounted once beside the toast stack (app/layout). */
export function LevelUpTakeover() {
  const copy = useCopy();
  const { key } = useAccountHeaders({ prompt: false });
  const queryClient = useQueryClient();
  const [shown, setShown] = useState<Celebration | null>(null);
  const [tick, setTick] = useState(0);

  // A crossing that arrives while one is on screen joins it there, in place,
  // so two level-ups never play one after the other (lib/level-up
  // foldCelebrations); otherwise it waits its turn below.
  const shownRef = useRef<Celebration | null>(null);
  const keyRef = useRef(key);
  useEffect(() => {
    shownRef.current = shown;
    keyRef.current = key;
  });
  useEffect(
    () =>
      celebrations.subscribe(() => {
        const current = shownRef.current;
        if (!current) {
          setTick((n) => n + 1);
          return;
        }
        const next = celebrations.take();
        if (!next) return;
        const joined = foldCelebrations(current, next);
        shownRef.current = joined;
        writeSeen(seenLevelKey(keyRef.current) ?? "berth.level-celebrated.anonymous", joined.level);
        setShown(joined);
      }),
    [],
  );

  // Something waits and nothing shows: wait for the stage, then take it.
  useEffect(() => {
    if (shown || !celebrations.peek()) return;
    const attempt = (): boolean => {
      if (stageBusy(document)) return false;
      const next = celebrations.take();
      if (!next) return true;
      const seenKey = seenLevelKey(key) ?? "berth.level-celebrated.anonymous";
      if (!isNewLevel(readSeen(seenKey), next.level)) return true;
      writeSeen(seenKey, next.level);
      setShown(next);
      return true;
    };
    if (attempt()) return;
    const timer = window.setInterval(() => {
      if (attempt()) window.clearInterval(timer);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [tick, shown, key]);

  const avatarId = queryClient.getQueryData<Profile>(["profile", key])?.avatarId ?? null;

  return (
    <>
      {/* Polite: said once as it opens, never over what is being read. */}
      <div aria-live="polite" className="sr-only">
        {shown ? copy.levelUpAnnounce(shown.rankName, shown.level) : ""}
      </div>
      {shown &&
        createPortal(<LevelUpTakeoverView celebration={shown} avatarId={avatarId} onClose={() => setShown(null)} />, document.body)}
    </>
  );
}

/**
 * The takeover itself, from a celebration. Exported for the dev gallery
 * (/dev/levelup), which replays it on a fixture.
 */
export function LevelUpTakeoverView({
  celebration,
  avatarId,
  onClose,
}: {
  celebration: Celebration;
  avatarId: string | null;
  onClose: () => void;
}) {
  const copy = useCopy();
  const still = useReducedMotion() === true;
  const titleId = useId();
  const nice = useRef<HTMLButtonElement>(null);
  const unlocks = unlocksBetween(celebration.fromLevel, celebration.level);
  const level = celebration.level;

  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  // Its own focus trap and its own dismissal, held on window in the capture
  // phase (lib/level-up takeoverEventAction): Esc, the scrim and Nice close
  // only the takeover, never the drawer it may sit over, and that drawer's
  // focus trap never pulls the focus back. The focus rests on Nice, and goes
  // back where it was after.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    nice.current?.focus({ preventScroll: true });
    const within = (node: EventTarget | null) => node instanceof Node && root.current !== null && root.current.contains(node);
    const hold = (event: Event) => {
      const target = event.type === "focusout" ? (event as FocusEvent).relatedTarget : event.target;
      const action = takeoverEventAction({
        type: event.type,
        key: event instanceof KeyboardEvent ? event.key : undefined,
        inside: within(target),
        onClose: event.target instanceof Element && event.target.closest("[data-level-up-close]") !== null,
      });
      if (action === "pass") return;
      event.stopPropagation();
      if (action === "close") {
        event.preventDefault();
        if (event.type === "keydown" || event.type === "click") close.current();
      } else if (action === "trap") {
        event.preventDefault();
        nice.current?.focus({ preventScroll: true });
      }
    };
    for (const type of TAKEOVER_EVENTS) window.addEventListener(type, hold, true);
    return () => {
      for (const type of TAKEOVER_EVENTS) window.removeEventListener(type, hold, true);
      // Back where it was; if that control is gone (the step it was on just
      // finished), into the drawer still open under it, never lost on the page.
      const drawer = document.querySelector<HTMLElement>('[data-slot="drawer-popup"]');
      (before?.isConnected ? before : drawer)?.focus({ preventScroll: true });
    };
  }, []);

  const ease = EASE_LIFT as unknown as [number, number, number, number];
  /** A tween that is no tween under reduced motion. */
  const at = (delay: number, duration: number) => (still ? { duration: 0 } : { delay, duration, ease });
  const enter = <T extends object>(from: T) => (still ? false : from);

  return (
    <div ref={root} data-level-up className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <motion.button
        type="button"
        tabIndex={-1}
        aria-label={copy.levelUpDismiss}
        data-level-up-close=""
        initial={enter({ opacity: 0 })}
        animate={{ opacity: 1 }}
        transition={at(0, TAKEOVER.scrim.duration)}
        className="absolute inset-0 cursor-default bg-black/20 dark:bg-black/50"
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={enter({ opacity: 0, scale: 0.94, y: 8 })}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={at(0, TAKEOVER.card.duration)}
        className="relative flex w-full max-w-[22rem] flex-col items-center rounded-xl border border-border bg-card px-6 pt-9 pb-6 text-center"
      >
        <div className="relative grid size-24 place-items-center">
          {!still &&
            TAKEOVER.burst.map((ring, index) => (
              <motion.span
                key={index}
                aria-hidden
                className="absolute inset-0 grid place-items-center text-foreground"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: [0, index === 0 ? 0.28 : 0.16, 0], scale: [0.7, 1.5, 2.3] }}
                transition={{ delay: ring.delay, duration: ring.duration, ease, times: [0, 0.25, 1] }}
              >
                <RankGlyph level={level} className="size-24" />
              </motion.span>
            ))}
          <motion.div
            initial={enter({ opacity: 0, scale: 0.6 })}
            animate={{ opacity: 1, scale: 1 }}
            transition={at(TAKEOVER.face.delay, TAKEOVER.face.duration)}
            className="relative"
          >
            <AvatarWithRank avatarId={avatarId} level={level} size={88} />
          </motion.div>
        </div>

        <motion.div
          initial={enter({ opacity: 0, y: 6 })}
          animate={{ opacity: 1, y: 0 }}
          transition={at(TAKEOVER.words.delay, TAKEOVER.words.duration)}
          className="mt-6 flex flex-col items-center gap-1.5"
        >
          <h2 id={titleId} className="font-display text-[26px] leading-[1.15] tracking-[-0.022em] text-foreground">
            {copy.levelUpTitle(celebration.rankName)}
          </h2>
          <p className="text-sm text-muted-foreground">{copy.levelUpLine(celebration.level, celebration.total, celebration.reason)}</p>
        </motion.div>

        {unlocks.length > 0 && (
          <ul className="mt-4 flex w-full flex-col gap-2 border-t border-border pt-4">
            {unlocks.map((unlock, index) => {
              const face = unlock.kind === "avatar" ? avatarSrc(unlock.avatarId) : undefined;
              return (
                <motion.li
                  key={unlock.kind === "avatar" ? unlock.avatarId : unlock.kind}
                  initial={enter({ opacity: 0, y: 4 })}
                  animate={{ opacity: 1, y: 0 }}
                  transition={at(TAKEOVER.unlocks.delay + index * TAKEOVER.unlocks.step, TAKEOVER.unlocks.duration)}
                  className="flex items-center gap-3 text-left text-sm text-foreground"
                >
                  {face ? (
                    <Image src={face} alt="" width={36} height={36} className="size-9 shrink-0 rounded-full bg-avatar-disc" />
                  ) : (
                    <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-foreground">
                      <RankGlyph level={celebration.level} className="size-5" />
                    </span>
                  )}
                  <span>{copy.levelUpUnlock(unlock)}</span>
                </motion.li>
              );
            })}
          </ul>
        )}

        <motion.div
          initial={enter({ opacity: 0 })}
          animate={{ opacity: 1 }}
          transition={at(TAKEOVER.action.delay, TAKEOVER.action.duration)}
          className="mt-6 w-full"
        >
          <Button ref={nice} className={PRIMARY} data-level-up-close="">
            {copy.levelUpNice}
          </Button>
        </motion.div>
      </motion.div>
    </div>
  );
}
