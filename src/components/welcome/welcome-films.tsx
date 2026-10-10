"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { motion } from "motion/react";
import { Play, SpeakerSimpleHigh, SpeakerSimpleSlash } from "@phosphor-icons/react";
import { useCopy } from "@/components/settings-provider";
import { EASE_LIFT } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The two launch films on the welcome page. The vertical one, your account in motion,
 * stands in the hero (2026-09-30): a flat phone that starts tilted back and
 * turns to face the reader once the page has loaded, with one glare sweep as
 * it settles. The wide one, Wall Street in your wallet, rises in a flat card
 * near the foot of the page.
 *
 * Both play muted and inline while in view and pause when they leave. The
 * hero film counts as in view the moment any of it shows, so on a phone,
 * where only its top clears the first screen, it still plays on load; the
 * wide one waits until half of it shows, and loads nothing before that but
 * its poster. Reduced motion gets no tilt, glare or rise and no autoplay, a
 * play button instead.
 */

const HERO = { webm: "/videos/hero.webm", mp4: "/videos/hero.mp4", poster: "/videos/hero.jpg" };
const WALL_STREET = { webm: "/videos/buy-2026-10.webm", mp4: "/videos/buy-2026-10.mp4", poster: "/videos/buy-2026-10.jpg" };

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
  sources: typeof HERO;
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

/** Where the phone starts: leaning back and away, a little low. */
const TILTED = { rotateX: 22, rotateY: -16, rotateZ: 3, y: 36 };
const UPRIGHT = { rotateX: 0, rotateY: 0, rotateZ: 0, y: 0 };

/**
 * The hero film in a flat phone, for the hero: one hairline, a small
 * island, three side keys, no rendered bezel. It arrives tilted back, turns
 * upright once the page is up, and one glare band crosses the glass as it
 * settles. Its line and sound pill sit underneath.
 */
export function HeroPhone({ className }: { className?: string }) {
  const copy = useCopy().welcomePage.films;
  const reduced = useReducedMotionPreference();
  const ref = useRef<HTMLVideoElement>(null);
  const film = useFilm(ref, reduced, 0);
  const [glare, setGlare] = useState<"waiting" | "sweeping" | "done">("waiting");

  const phoneClass =
    "relative w-[248px] rounded-[42px] border border-input bg-card p-[7px] lg:w-[288px] lg:rounded-[48px] lg:p-2";
  const body = (
    <>
      {/* Side keys: action and volume on the left, power on the right. */}
      <i aria-hidden className="absolute top-[88px] -left-[3px] h-6 w-[3px] rounded-l-sm bg-input lg:top-[100px]" />
      <i aria-hidden className="absolute top-[128px] -left-[3px] h-11 w-[3px] rounded-l-sm bg-input lg:top-[144px]" />
      <i aria-hidden className="absolute top-[184px] -left-[3px] h-11 w-[3px] rounded-l-sm bg-input lg:top-[204px]" />
      <i aria-hidden className="absolute top-[148px] -right-[3px] h-16 w-[3px] rounded-r-sm bg-input lg:top-[168px]" />
      <div className="relative overflow-hidden rounded-[35px] border border-border lg:rounded-[40px]">
        <Film sources={HERO} label={copy.hero.label} reduced={reduced} videoRef={ref} playing={film.playing} onPlay={film.play} onTogglePlay={film.togglePlay} preload="metadata" className="aspect-[9/16]" />
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
    </>
  );

  return (
    // The stage clips sideways so the tilt can never widen the page.
    <div className={cn("flex flex-col items-center overflow-x-clip py-2 [perspective:1100px]", className)}>
      {reduced ? (
        <div data-film-phone className={phoneClass}>{body}</div>
      ) : (
        <motion.div
          data-film-phone
          className={phoneClass}
          style={{ transformStyle: "preserve-3d" }}
          initial={TILTED}
          animate={UPRIGHT}
          transition={{ duration: 1.5, delay: 0.35, ease: EASE_LIFT }}
          onAnimationComplete={() => setGlare((g) => (g === "waiting" ? "sweeping" : g))}
        >
          {body}
        </motion.div>
      )}
      <div className="mt-5 flex max-w-[288px] flex-col items-center gap-3 text-center">
        <SoundPill muted={film.muted} onToggle={film.toggleSound} />
        <p className="text-[13px] leading-snug text-muted-foreground">{copy.hero.line}</p>
      </div>
    </div>
  );
}

/**
 * The hero film for the How Berth works drawer: no phone, no tilt, just the
 * film in one hairline at a height that leaves the drawer room for its
 * lines. Muted, inline and looping like the welcome page's; with reduced
 * motion the poster waits behind a play button. The sound pill sits under
 * it, as on the welcome page.
 */
export function DrawerFilm({ className }: { className?: string }) {
  const copy = useCopy().welcomePage.films;
  const reduced = useReducedMotionPreference();
  const ref = useRef<HTMLVideoElement>(null);
  const film = useFilm(ref, reduced, 0);
  return (
    <div className={cn("flex shrink-0 flex-col items-center gap-3", className)}>
      <div data-drawer-film className="aspect-[9/16] h-[min(46svh,400px)] shrink-0 overflow-hidden rounded-2xl border border-border bg-card">
        <Film sources={HERO} label={copy.hero.label} reduced={reduced} videoRef={ref} playing={film.playing} onPlay={film.play} onTogglePlay={film.togglePlay} preload="metadata" className="size-full" />
      </div>
      <SoundPill muted={film.muted} onToggle={film.toggleSound} />
    </div>
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
