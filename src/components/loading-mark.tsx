"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Berth's mark, animated. Built from public/berth-brand/app/loading-mark.svg
 * with the file's C2PA provenance block stripped and every fill and stroke
 * switched to currentColor so it reads in either theme. This is the shape
 * the app rests on while an order is in flight: the ring breathes while
 * `done` is false and settles to a still frame once the work is finished,
 * or for anyone whose system asks for less motion.
 */
export function LoadingMark({
  className,
  done = false,
}: {
  className?: string;
  done?: boolean;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("size-16", className)}
      data-done={done || undefined}
      aria-hidden="true"
      id={`loading-mark-${id}`}
    >
      <style>{`
        #loading-mark-${id} .l {
          fill: none;
          stroke: currentColor;
          stroke-width: 6;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        #loading-mark-${id} .d {
          fill: currentColor;
          transform-origin: 32px 30px;
        }
        #loading-mark-${id}:not([data-done="true"]) .d {
          animation: loading-mark-breathe 1.6s ease-in-out infinite;
        }
        #loading-mark-${id}[data-done="true"] .d {
          transform: scale(1);
          opacity: 1;
        }
        @keyframes loading-mark-breathe {
          0%, 100% { transform: scale(0.82); opacity: 0.6; }
          50% { transform: scale(1); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          #loading-mark-${id}:not([data-done="true"]) .d {
            animation: none;
            transform: scale(1);
            opacity: 1;
          }
        }
      `}</style>
      <path className="l" d="M15 8V42a7 7 0 0 0 7 7h20a7 7 0 0 0 7-7V8" />
      <circle className="d" cx="32" cy="30" r="6" />
    </svg>
  );
}
