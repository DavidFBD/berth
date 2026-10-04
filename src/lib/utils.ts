import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Scroll an element into view, instantly for a visitor who asked for
 * reduced motion, smoothly otherwise. Used after an action moves the
 * page's own point of attention (a new campaign's card, a status line)
 * somewhere the person is not currently looking.
 */
export function scrollIntoViewGently(el: Element | null, options?: ScrollIntoViewOptions) {
  if (!el) return;
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center", ...options });
}
