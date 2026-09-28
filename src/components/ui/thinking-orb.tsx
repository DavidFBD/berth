"use client";

import { Component, lazy, Suspense, useSyncExternalStore, type ReactNode } from "react";
import { useCopy } from "@/components/settings-provider";
import { cn } from "@/lib/utils";

/**
 * The one way Berth shows that something is being worked on right now:
 * Jakub Antalik's thinking orbs (MIT, npm `thinking-orbs`), a dotted sphere
 * drawn on a 2D canvas. Only while work is actually happening, never as
 * idle decoration.
 *
 * Colour is Berth's, never the library's: the ink is read from the page's
 * own `--foreground` or `--muted-foreground` token for the appearance
 * next-themes has stamped on <html>, and passed as the orb's tint. The library
 * itself pauses offscreen and in a hidden tab, and draws a still frame
 * for anyone whose system asks for less motion.
 *
 * The canvas is client only and its code is loaded on demand, so the
 * server renders a box of the same size (with `fallback` in it, if given)
 * and nothing moves when the orb arrives.
 */

export type OrbState = "working" | "searching" | "solving" | "composing" | "connecting" | "breathing";

/** Loaded on the first orb that mounts, and shared after. */
const Orb = lazy(() => import("thinking-orbs").then((module) => ({ default: module.ThinkingOrb })));

/**
 * A chunk that fails to load (a tab left open across a deploy) shows the
 * still fallback instead of taking the page down with it.
 */
class OrbBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const SIZE_CLASS = { 20: "size-5", 32: "size-8", 64: "size-16" } as const;

/**
 * The ink for the appearance on <html> right now: the token's value (the hex
 * the library takes) and whether next-themes has stamped `.dark`. Read from
 * the page, and read again whenever <html>'s class or style changes, so a
 * switch of appearance repaints the orb. Null on the server.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
  return () => observer.disconnect();
}

// The library's `color` parses only #rgb, #rrggbb and rgb(); Berth's tokens
// in globals.css are hex. A token moved to oklch() or a var() would need
// converting here first, or the orb falls back to the library's grey.
function useInk(tone: "ink" | "muted"): { ink: string | null; dark: boolean } {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => {
      const root = document.documentElement;
      const value = getComputedStyle(root).getPropertyValue(tone === "ink" ? "--foreground" : "--muted-foreground").trim();
      return `${root.classList.contains("dark") ? "dark" : "light"} ${value}`;
    },
    () => null,
  );
  if (!snapshot) return { ink: null, dark: false };
  const [mode, value] = snapshot.split(" ");
  return { ink: value || null, dark: mode === "dark" };
}

export function ThinkingOrb({
  state = "working",
  size = 20,
  tone = "ink",
  paused = false,
  speed,
  dotSize,
  decorative = false,
  label,
  fallback,
  className,
}: {
  state?: OrbState;
  /** The library's tuned presets: 20 inline with text, 64 avatar scale; 32 sits between. */
  size?: 20 | 32 | 64;
  /** Berth's foreground or its muted text colour, nothing else. */
  tone?: "ink" | "muted";
  paused?: boolean;
  speed?: number;
  /** The library's dot radius multiplier, for an orb that sits in a heavy mark. */
  dotSize?: number;
  /** Beside words that already say what is happening: hidden from assistive tech. */
  decorative?: boolean;
  /** Overrides the per-state name from copy.orbLabel. */
  label?: string;
  /** Shown in the orb's box until the canvas is ready (the splash's still dot). */
  fallback?: ReactNode;
  className?: string;
}) {
  const copy = useCopy();
  const { ink, dark } = useInk(tone);
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", SIZE_CLASS[size], className)}
      aria-hidden={decorative || undefined}
      data-orb={state}
    >
      {ink ? (
        <OrbBoundary fallback={fallback}>
          <Suspense fallback={fallback}>
            <Orb
              state={state}
              size={size}
              theme={dark ? "dark" : "light"}
              color={ink}
              paused={paused}
              speed={speed}
              dotSize={dotSize}
              aria-label={decorative ? undefined : (label ?? copy.orbLabel[state])}
              aria-hidden={decorative || undefined}
              style={{ width: size, height: size, display: "block" }}
            />
          </Suspense>
        </OrbBoundary>
      ) : (
        fallback
      )}
    </span>
  );
}
