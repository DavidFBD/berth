"use client";

import { useState, type ReactNode } from "react";

/**
 * Desktop presentation layer: below `lg` the app renders as-is (true mobile
 * experience); on `lg+` the same single mount is framed inside a CSS iPhone
 * over a looping ambient video. One mount only — duplicating children would
 * double every query and wallet-modal instance.
 *
 * Assets (optional, graceful fallback to a gradient until provided):
 * - /public/stage/tea-loop.mp4   — calm looping background video
 * - /public/stage/tea-poster.jpg — poster frame shown while video loads
 */
export function DesktopStage({ children }: { children: ReactNode }) {
  const [videoFailed, setVideoFailed] = useState(false);

  return (
    <div className="min-h-dvh lg:fixed lg:inset-0 lg:grid lg:place-items-center lg:overflow-hidden">
      {/* Ambient backdrop — desktop only */}
      <div className="hidden lg:block" aria-hidden>
        {!videoFailed && (
          <video
            className="absolute inset-0 h-full w-full object-cover"
            src="/stage/tea-loop.mp4"
            poster="/stage/tea-poster.jpg"
            autoPlay
            muted
            loop
            playsInline
            onError={() => setVideoFailed(true)}
          />
        )}
        {/* Gradient stand-in + grading overlay (keeps the phone legible) */}
        <div
          className={
            videoFailed
              ? "absolute inset-0 bg-gradient-to-br from-stone-200 via-amber-100/60 to-emerald-100/50 dark:from-stone-900 dark:via-stone-800 dark:to-emerald-950"
              : "absolute inset-0 bg-black/30 backdrop-blur-[2px]"
          }
        />
      </div>

      {/* The phone. On mobile these classes are inert and the app fills the viewport. */}
      <div className="relative lg:h-[min(92vh,900px)] lg:aspect-[390/844] lg:shrink-0">
        {/* Bezel */}
        <div className="hidden lg:block absolute -inset-[10px] rounded-[3.4rem] bg-neutral-900 shadow-[0_25px_80px_-20px_rgba(0,0,0,0.6)] ring-1 ring-white/10" />
        {/* Dynamic island */}
        <div className="hidden lg:block absolute top-2.5 left-1/2 z-20 h-[22px] w-[90px] -translate-x-1/2 rounded-full bg-neutral-900" />
        {/* Screen: the app's own scroll container on desktop */}
        <div className="relative h-full lg:overflow-y-auto lg:overscroll-contain lg:rounded-[2.8rem] lg:bg-background [scrollbar-width:none] lg:[&::-webkit-scrollbar]:hidden">
          {children}
        </div>
      </div>
    </div>
  );
}
