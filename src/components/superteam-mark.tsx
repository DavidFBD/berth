import { useId, type SVGProps } from "react";

/**
 * Superteam Netherlands' mark: the "st" letterform in currentColor, so it
 * takes the ink of the link it sits in, and the small round Dutch flag at the
 * foot of the "t" in its own colours. Decorative: the link around it carries
 * the name.
 *
 * Redrawn 2026-10-05 from Superteam Netherlands' avatar (white "st" on orange
 * with a round Dutch flag), measured off the 400px source: the "s" is two
 * half discs facing apart, the "t" a square topped stem with a quarter round
 * arm and a rounded foot, the flag a disc at the lower right of the "t". The
 * flag stays in colour on David's call (2026-10-05); a ring in the page's
 * background separates it from the letterform in either theme, as the
 * orange gap does in the original. The mark belongs to Superteam; used here
 * only to point at Superteam Netherlands.
 */
const S = "M39 0H87V78H39A39 39 0 0 1 39 0ZM0 78H48A39 39 0 0 1 48 156H0Z";
const T = "M101 0H160V26H203V37A43 43 0 0 1 160 80V156H141A40 40 0 0 1 101 116Z";
const FLAG = { cx: 172, cy: 194, r: 38 };
// The flag's colours, as the Dutch government specifies them.
const RED = "#AE1C28";
const WHITE = "#FFFFFF";
const BLUE = "#21468B";

export function SuperteamMark(props: SVGProps<SVGSVGElement>) {
  const clip = useId();
  const { cx, cy, r } = FLAG;
  const top = cy - r;
  const band = (2 * r) / 3;
  return (
    <svg viewBox="0 0 210 232" fill="currentColor" aria-hidden focusable="false" {...props}>
      <path d={S} />
      <path d={T} />
      <circle cx={cx} cy={cy} r={r + 14} fill="var(--background)" />
      <clipPath id={clip}>
        <circle cx={cx} cy={cy} r={r} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect x={cx - r} y={top} width={2 * r} height={band} fill={RED} />
        <rect x={cx - r} y={top + band} width={2 * r} height={band} fill={WHITE} />
        <rect x={cx - r} y={top + 2 * band} width={2 * r} height={band} fill={BLUE} />
      </g>
    </svg>
  );
}
