"use client";

import { useEffect, useState } from "react";
import { SEEN_THRESHOLD, countsAsInView, isNew, loadSeen, markSeen } from "@/lib/seen-posts";

/** How long a card must be on screen, in a visible tab, to count as seen. */
const SEEN_AFTER_MS = 2_000;

/**
 * The "new to you" mark for the posts column (rules in lib/seen-posts).
 *
 * The baseline is read from storage once, when the column first has posts,
 * and stays fixed for as long as the column is mounted. So the marks stay
 * while you look, and a post that arrives with a later hourly refresh and is
 * not in the baseline is marked as it comes: exactly the new arrivals. The
 * marks go on the next visit. A first visit has no baseline, marks nothing
 * for the whole visit, and seeds the record with the cards on screen once the
 * Posts tab is showing.
 *
 * A card counts as seen once at least 60% of it (lib/seen-posts
 * `countsAsInView`) has been in the viewport for two seconds while the tab is visible: the timer stops when it scrolls
 * away, when the column clips it or when the tab is hidden, and starts over
 * on return. Cards rotated in later are judged against the same baseline, so
 * a kept post the reader has never met arrives with its mark.
 *
 * `response` is every post in this refresh (visible and reserve), `visible`
 * what the rotation shows now, `node` the list; each card carries
 * `data-post-id`.
 */
export function useSeenPosts(
  response: readonly { id: string }[],
  visible: readonly { id: string }[],
  enabled: boolean,
  /** The list element, from the rotation (hooks/use-rotating-feed). */
  node: HTMLElement | null,
) {
  const hasPosts = response.length > 0;
  // Read once, the first render that has posts, then fixed. Derived during
  // render rather than in an effect so the first cards arrive already marked;
  // the posts only ever arrive on the client, so the server never renders one.
  const [state, setState] = useState<{ ready: boolean; baseline: Set<string> | null }>(() => ({
    ready: hasPosts,
    baseline: hasPosts ? loadSeen() : null,
  }));
  let baseline = state.baseline;
  if (!state.ready && hasPosts) {
    baseline = loadSeen();
    setState({ ready: true, baseline });
  }

  const shown = visible.map((post) => post.id).join(",");
  const firstVisit = (state.ready || hasPosts) && baseline === null;
  useEffect(() => {
    // No baseline yet: what is on screen, once the Posts tab shows, becomes it.
    if (firstVisit && enabled && shown) markSeen(shown.split(","));
    // Not on every turn: later cards are recorded by the timer below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstVisit, enabled]);

  useEffect(() => {
    if (!node || !enabled || typeof IntersectionObserver === "undefined") return;
    const timers = new Map<string, number>();
    const onScreen = new Set<string>();
    const start = (id: string) => {
      if (timers.has(id) || document.visibilityState !== "visible") return;
      timers.set(
        id,
        window.setTimeout(() => {
          timers.delete(id);
          markSeen([id]);
        }, SEEN_AFTER_MS),
      );
    };
    const stop = (id: string) => {
      const timer = timers.get(id);
      if (timer !== undefined) window.clearTimeout(timer);
      timers.delete(id);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.postId;
          if (!id) continue;
          const inView = countsAsInView(entry.isIntersecting, entry.intersectionRatio);
          if (inView) {
            onScreen.add(id);
            start(id);
          } else {
            onScreen.delete(id);
            stop(id);
          }
        }
      },
      // Both crossings fire: into view past the threshold, and out again.
      { threshold: [0, SEEN_THRESHOLD, 1] },
    );
    node.querySelectorAll<HTMLElement>("[data-post-id]").forEach((card) => observer.observe(card));
    const onVisibility = () => {
      if (document.visibilityState === "visible") onScreen.forEach(start);
      else [...timers.keys()].forEach(stop);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [node, enabled, shown]);

  return { isNew: (id: string) => isNew(id, baseline) };
}
