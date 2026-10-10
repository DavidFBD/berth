/**
 * A row of chips that scrolls sideways inside its pill when it does not fit
 * (the account card's range toggle on a narrow phone). Pure geometry, so the
 * component only measures and applies.
 */

/** Room kept beside a chip scrolled into view, so the next one shows it is there. */
export const CHIP_SCROLL_MARGIN = 24;

/**
 * Where the row should scroll so the chip at `[left, left + width)` (in the
 * row's content coordinates) is in view: unchanged when it already is,
 * otherwise just far enough, with CHIP_SCROLL_MARGIN beside it, never past
 * either end. Only ever sideways: the page itself does not move.
 */
export function scrollToShow(
  { scrollLeft, clientWidth, scrollWidth }: { scrollLeft: number; clientWidth: number; scrollWidth: number },
  { left, width }: { left: number; width: number },
): number {
  const max = Math.max(scrollWidth - clientWidth, 0);
  let next = scrollLeft;
  if (left < scrollLeft) next = left - CHIP_SCROLL_MARGIN;
  else if (left + width > scrollLeft + clientWidth) next = left + width - clientWidth + CHIP_SCROLL_MARGIN;
  return Math.min(Math.max(next, 0), max);
}

/** Which edges have chips hidden past them: where the row fades. */
export function edgeFades({
  scrollLeft,
  clientWidth,
  scrollWidth,
}: {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}): { start: boolean; end: boolean } {
  return { start: scrollLeft > 1, end: scrollLeft + clientWidth < scrollWidth - 1 };
}
