"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { motion } from "motion/react";
import { Play, SpeakerSimpleHigh, SpeakerSimpleSlash } from "@phosphor-icons/react";
import { useCopy } from "@/components/settings-provider";
import { EASE_LIFT } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The launch film on the welcome page: Wall Street in your wallet, in a flat
 * card near the foot of the page. The vertical habit film that once stood in
 * the hero is gone with recurring buys (2026-10-04); its files stay in
 * public/videos, unreferenced.
 *
 * It plays muted and inline once half of it is in view and pauses when it
 * leaves, loading nothing before that but its poster. Reduced motion gets no
 * rise and no autoplay, a play button instead.
 */

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
 * Plays the film while enough of it is in view (`share`, of its height) and
 * pauses it when it leaves; with reduced motion it waits for a tap. Muted is
 * set on the element itself because iOS only lets a muted, inline video
 * start on its own.
 */
function useFilm(ref: RefObject<HTMLVideoElement | null>, reduced: boolean, share = 0.5) {
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
        if (entry.isIntersecting && entry.intersectionRatio >= share) {
          if (!reduced) video.play().catch(() => {});
        } else if (!video.paused) {
          video.pause();
        }
      },
      { threshold: [0, share] },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [ref, reduced, share]);

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
  preload = "none",
  className,
}: {
  sources: typeof WALL_STREET;
  preload?: "none" | "metadata" | "auto";
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
        preload={preload}
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
 * The Wall Street film in a wide flat card with one hairline and no shadow,
 * rising into place the first time it comes into view, its line and sound
 * pill underneath it. It closes the page, just before the way in again.
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
  const className = "rounded-2xl border border-border bg-card p-1.5 lg:rounded-[18px] lg:p-2";
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
