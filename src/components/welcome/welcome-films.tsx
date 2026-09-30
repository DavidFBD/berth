"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { motion, useMotionValueEvent, useScroll, useSpring, useTransform } from "motion/react";
import { Play, SpeakerSimpleHigh, SpeakerSimpleSlash } from "@phosphor-icons/react";
import { useCopy } from "@/components/settings-provider";
import { EASE_LIFT } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The two launch films on the welcome page (2026-09-30). The vertical one,
 * the habit, plays inside a flat phone that is tilted back and turns to face
 * the reader as it scrolls in, with one glare sweep as it settles. The wide
 * one, Wall Street in your wallet, rises in a flat card under what Berth is.
 *
 * Both play muted and inline only while at least half in view, and pause
 * when they leave. Nothing loads before that but the poster. Reduced motion
 * gets no tilt, glare or rise and no autoplay, a play button instead.
 */

const HABIT = { webm: "/videos/habit.webm", mp4: "/videos/habit.mp4", poster: "/videos/habit.jpg" };
const WALL_STREET = { webm: "/videos/wall-street.webm", mp4: "/videos/wall-street.mp4", poster: "/videos/wall-street.jpg" };

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

/** Read on the client only, so the server's markup and the first client render agree. */
function useReducedMotionPreference() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(REDUCED_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
}

/**
 * Plays the film while at least half of it is in view and pauses it when it
 * leaves; with reduced motion it waits for a tap. Muted is set on the element
 * itself because iOS only lets a muted, inline video start on its own.
 */
function useFilm(ref: RefObject<HTMLVideoElement | null>, reduced: boolean) {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = true;
    video.defaultMuted = true;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [ref]);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio >= 0.5) {
          if (!reduced) video.play().catch(() => {});
        } else if (!video.paused) {
          video.pause();
        }
      },
      { threshold: [0, 0.5] },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [ref, reduced]);

  const toggleSound = () => {
    const video = ref.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    if (!video.muted && video.paused) video.play().catch(() => {});
  };
  const play = () => ref.current?.play().catch(() => {});
  const togglePlay = () => {
    const video = ref.current;
    if (!video) return;
    if (video.paused) play();
    else video.pause();
  };
  return { playing, muted, toggleSound, play, togglePlay };
}

function Film({
  sources,
  label,
  reduced,
  videoRef,
  playing,
  onPlay,
  onTogglePlay,
  className,
}: {
  sources: typeof HABIT;
  label: string;
  reduced: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  playing: boolean;
  onPlay: () => void;
  onTogglePlay: () => void;
  className?: string;
}) {
  const copy = useCopy().welcomePage.films;
  return (
    <div className={cn("relative", className)}>
      <video
        ref={videoRef}
        aria-label={label}
        poster={sources.poster}
        preload="none"
        muted
        playsInline
        loop
        disablePictureInPicture
        onClick={reduced ? onTogglePlay : undefined}
        className="block size-full object-cover"
      >
        <source src={sources.webm} type={`video/webm; codecs="vp9, opus"`} />
        <source src={sources.mp4} type="video/mp4" />
      </video>
      {reduced && !playing && (
        <button
          type="button"
          onClick={onPlay}
          aria-label={copy.play}
          className="absolute top-1/2 left-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-border bg-card text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Play weight="duotone" className="size-6" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** The ghost pill that turns the sound on and off; its words say what a tap will do. */
function SoundPill({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  const copy = useCopy().welcomePage.films;
  const Glyph = muted ? SpeakerSimpleSlash : SpeakerSimpleHigh;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={!muted}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-input bg-card px-3 text-[13px] text-foreground outline-none transition-colors duration-150 ease-lift hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Glyph weight="duotone" className="size-4" aria-hidden />
      {muted ? copy.soundOn : copy.soundOff}
    </button>
  );
}

/**
 * The habit film in a flat phone: one hairline, a small island, three side
 * keys, no rendered bezel. Tilted back while it approaches, upright once its
 * middle meets the middle of the screen, and one glare band crosses the
 * glass as it settles, once per visit.
 */
export function HabitFilm() {
  const copy = useCopy().welcomePage.films;
  const reduced = useReducedMotionPreference();
  const ref = useRef<HTMLVideoElement>(null);
  const film = useFilm(ref, reduced);
  const stage = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: stage, offset: ["start end", "center center"] });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 26, mass: 0.6 });
  const rotateX = useTransform(progress, [0, 1], [22, 0]);
  const rotateY = useTransform(progress, [0, 1], [-16, 0]);
  const rotateZ = useTransform(progress, [0, 1], [3, 0]);
  const y = useTransform(progress, [0, 1], [36, 0]);
  const [glare, setGlare] = useState<"waiting" | "sweeping" | "done">("waiting");
  useMotionValueEvent(progress, "change", (value) => {
    if (glare === "waiting" && value > 0.94) setGlare("sweeping");
  });

  return (
    <section className="grid items-center gap-9 border-t border-border py-11 lg:grid-cols-2 lg:gap-16 lg:py-16">
      <h2 className="max-w-[26rem] font-display text-[28px] leading-[1.15] tracking-[-0.025em] text-foreground lg:text-[36px]">
        {copy.habit.line}
      </h2>
      {/* The stage clips sideways so the tilt can never widen the page. */}
      <div ref={stage} className="flex flex-col items-center overflow-x-clip py-2 [perspective:1100px]">
        <motion.div
          data-film-phone
          style={reduced ? undefined : { rotateX, rotateY, rotateZ, y, transformStyle: "preserve-3d" }}
          className="relative w-[248px] rounded-[42px] border border-input bg-card p-[7px] lg:w-[288px] lg:rounded-[48px] lg:p-2"
        >
          {/* Side keys: action and volume on the left, power on the right. */}
          <i aria-hidden className="absolute top-[88px] -left-[3px] h-6 w-[3px] rounded-l-sm bg-input lg:top-[100px]" />
          <i aria-hidden className="absolute top-[128px] -left-[3px] h-11 w-[3px] rounded-l-sm bg-input lg:top-[144px]" />
          <i aria-hidden className="absolute top-[184px] -left-[3px] h-11 w-[3px] rounded-l-sm bg-input lg:top-[204px]" />
          <i aria-hidden className="absolute top-[148px] -right-[3px] h-16 w-[3px] rounded-r-sm bg-input lg:top-[168px]" />
          <div className="relative overflow-hidden rounded-[35px] border border-border lg:rounded-[40px]">
            <Film sources={HABIT} label={copy.habit.label} reduced={reduced} videoRef={ref} playing={film.playing} onPlay={film.play} onTogglePlay={film.togglePlay} className="aspect-[9/16]" />
            <i aria-hidden className="pointer-events-none absolute top-2 left-1/2 h-[22px] w-[76px] -translate-x-1/2 rounded-full bg-[#1C1917] lg:h-6 lg:w-[86px]" />
            {!reduced && glare === "sweeping" && (
              <motion.i
                aria-hidden
                data-film-glare
                className="pointer-events-none absolute -inset-y-1/4 left-0 w-1/2 bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.55)_45%,rgb(255_255_255/0.55)_55%,transparent)]"
                style={{ skewX: -18 }}
                initial={{ x: "-130%" }}
                animate={{ x: "260%" }}
                transition={{ duration: 1.25, ease: [0.45, 0, 0.25, 1] }}
                onAnimationComplete={() => setGlare("done")}
              />
            )}
          </div>
        </motion.div>
        <div className="mt-5">
          <SoundPill muted={film.muted} onToggle={film.toggleSound} />
        </div>
      </div>
    </section>
  );
}

/**
 * The Wall Street film in a wide flat card with one hairline and no shadow,
 * rising into place the first time it comes into view, its line and sound
 * pill underneath it.
 */
export function WallStreetFilm() {
  const copy = useCopy().welcomePage.films;
  const reduced = useReducedMotionPreference();
  const ref = useRef<HTMLVideoElement>(null);
  const film = useFilm(ref, reduced);
  const card = (
    <>
      <div className="overflow-hidden rounded-xl border border-border lg:rounded-[14px]">
        <Film sources={WALL_STREET} label={copy.wallStreet.label} reduced={reduced} videoRef={ref} playing={film.playing} onPlay={film.play} onTogglePlay={film.togglePlay} className="aspect-video" />
      </div>
      <div className="flex items-center justify-between gap-4 px-2.5 pt-3 pb-1.5 lg:px-3 lg:pt-3.5 lg:pb-2">
        <p className="text-[13.5px] leading-snug text-muted-foreground">{copy.wallStreet.line}</p>
        <SoundPill muted={film.muted} onToggle={film.toggleSound} />
      </div>
    </>
  );
  const className = "mt-8 rounded-2xl border border-border bg-card p-1.5 lg:mt-12 lg:rounded-[18px] lg:p-2";
  if (reduced) return <div className={className}>{card}</div>;
  return (
    <motion.div
      data-film-card
      className={className}
      initial={{ opacity: 0, y: 48 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.9, ease: EASE_LIFT }}
    >
      {card}
    </motion.div>
  );
}
