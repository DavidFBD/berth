"use client";

import { useState, type CSSProperties, type ReactNode } from "react";

import { SilkBackdrop } from "@/components/tea/silk";

/**
 * Desktop presentation layer: below `lg` the app renders as-is (true mobile
 * experience); on `lg+` the same single mount becomes the screen of a phone
 * held up by a photographed hand, over a blurred looping ambient video. One
 * mount only — duplicating children would double every query and
 * wallet-modal instance.
 *
 * Assets (public/stage/):
 * - tea-loop.mp4        — blurred, muted, seamlessly looping background video
 * - tea-loop-poster.jpg — its first frame, shown while the video loads
 * - tea-hand.png        — hand holding the phone; the screen area is punched
 *                         transparent so the app shows through and the thumb
 *                         overlaps the screen edge naturally
 *
 * Geometry: in the 1749x1312 hand PNG the screen rect is x 704-1107,
 * y 199-1080 (404x882, corner radius 44px ≈ 5% of screen height). The
 * percentages on the overlay place the PNG around the app screen so the two
 * stay aligned at any --phone-h.
 */
export function DesktopStage({ children }: { children: ReactNode }) {
  const [videoFailed, setVideoFailed] = useState(false);
  const [handFailed, setHandFailed] = useState(false);

  return (
    <div className="min-h-dvh lg:fixed lg:inset-0 lg:grid lg:place-items-center lg:overflow-hidden">
      {/* Ambient backdrop — desktop only */}
      <div className="hidden lg:block" aria-hidden>
        {!videoFailed && (
          <video
            className="absolute inset-0 h-full w-full object-cover"
            src="/stage/tea-loop.mp4"
            poster="/stage/tea-loop-poster.jpg"
            autoPlay
            muted
            loop
            playsInline
            onError={() => setVideoFailed(true)}
          />
        )}
        {/* Gradient stand-in + grading overlay (keeps the phone the focal point) */}
        <div
          className={
            videoFailed
              ? "absolute inset-0 bg-gradient-to-br from-stone-200 via-amber-100/60 to-emerald-100/50 dark:from-stone-900 dark:via-stone-800 dark:to-emerald-950"
              : "absolute inset-0 bg-black/25"
          }
        />
      </div>

      {/* The phone. On mobile these classes are inert and the app fills the viewport. */}
      <div
        className="relative lg:h-[var(--phone-h)] lg:aspect-[404/882] lg:shrink-0"
        style={{ "--phone-h": "min(92vh, 900px)" } as CSSProperties}
      >
        {/* CSS bezel fallback, only if the hand PNG can't load */}
        {handFailed && (
          <>
            <div className="hidden lg:block absolute -inset-[10px] rounded-[3.4rem] bg-neutral-900 shadow-[0_25px_80px_-20px_rgba(0,0,0,0.6)] ring-1 ring-white/10" />
            <div className="hidden lg:block absolute top-2.5 left-1/2 z-20 h-[22px] w-[90px] -translate-x-1/2 rounded-full bg-neutral-900" />
          </>
        )}
        {/* Screen: silk field pinned behind, app scrolling above. Radius sits
            just inside the PNG cutout's 5%-of-height corners so no video
            peeks through. */}
        <div className="relative h-full lg:overflow-hidden lg:rounded-[calc(var(--phone-h)*0.046)] lg:bg-background">
          <SilkBackdrop />
          <div className="builders-strength relative z-10 h-full lg:overflow-y-auto lg:overscroll-contain [scrollbar-width:none] lg:[&::-webkit-scrollbar]:hidden">
            {children}
          </div>
        </div>
        {/* Hand + phone overlay, above the screen so the thumb reads in front */}
        {!handFailed && (
          <img
            src="/stage/tea-hand.png"
            alt=""
            aria-hidden
            onError={() => setHandFailed(true)}
            className="hidden lg:block absolute z-20 max-w-none pointer-events-none select-none [filter:drop-shadow(0_30px_45px_rgba(0,0,0,0.35))]"
            style={{ width: "432.9208%", left: "-174.2574%", top: "-22.5624%" }}
          />
        )}
      </div>
    </div>
  );
}
