"use client";

import { useEffect, useRef, useState } from "react";
import { nextDelayMs, startRotation, turn, type Rotation } from "@/lib/rotation";

/**
 * Rotates `reserve` through `items` on a slow, jittered clock (lib/rotation),
 * and holds still whenever moving would get in a reader's way: while the
 * pointer or focus is inside the list, while the list's top edge is off
 * screen (a card arriving above the one being read would push it away), and
 * while the tab is hidden. New data from the server restarts the turn.
 *
 * Attach `ref` to the list and spread `handlers` on it.
 */
export function useRotatingFeed<T extends { id: string }>(
  items: readonly T[],
  reserve: readonly T[],
  enabled: boolean,
) {
  const signature = [...items, ...reserve].map((item) => item.id).join(",");
  const [state, setState] = useState<{ signature: string; rotation: Rotation<T> }>(() => ({
    signature,
    rotation: startRotation(items, reserve),
  }));
  // A fresh response replaces the rotation outright, during render, which is
  // React's own pattern for state derived from props.
  let rotation = state.rotation;
  if (state.signature !== signature) {
    rotation = startRotation(items, reserve);
    setState({ signature, rotation });
  }

  const ref = useRef<HTMLUListElement | null>(null);
  const [held, setHeld] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  const [visibleTab, setVisibleTab] = useState(true);
  const turns = useRef(0);

  const mounted = rotation.visible.length > 0;
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    // Only the top strip matters: that is where the next card lands.
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(entry.isIntersecting),
      { rootMargin: "0px 0px -85% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
    // The list mounts after its data does, so re-attach when it appears.
  }, [mounted]);

  useEffect(() => {
    const update = () => setVisibleTab(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const moving = enabled && !held && onScreen && visibleTab && rotation.queue.length > 0;

  useEffect(() => {
    if (!moving) return;
    const timer = window.setTimeout(() => {
      turns.current += 1;
      setState((current) => ({ ...current, rotation: turn(current.rotation) }));
    }, nextDelayMs(turns.current));
    return () => window.clearTimeout(timer);
  }, [moving, rotation]);

  const handlers = {
    onPointerEnter: () => setHeld(true),
    onPointerLeave: () => setHeld(false),
    onFocus: () => setHeld(true),
    onBlur: () => setHeld(false),
  };

  return { visible: rotation.visible, ref, handlers, moving };
}
