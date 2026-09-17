import { sparklinePath, type ChangeDirection } from "@/lib/performance";

/** Stroke colour per direction. Flat borrows the muted text colour. */
const STROKE: Record<ChangeDirection, string> = {
  up: "var(--good)",
  down: "var(--bad)",
  flat: "var(--muted-foreground)",
};

/**
 * The shape of a listing's last months, drawn small beside its price.
 *
 * Decorative by design: the change figure next to it already states the move
 * in words and digits, so this is hidden from assistive technology rather
 * than narrated as a meaningless list of numbers. Plain stroke, no fill and
 * no gradient, per the brand sheet.
 *
 * `width` and `height` set the coordinate space, not the drawn size: a
 * class on the element overrides both, and the viewBox stretches to fill it
 * because `preserveAspectRatio` is off. That is what lets one line be 48px
 * on a phone and 112px on a desktop board without re-deriving the path, and
 * the stroke stays 1.25px at either size because it does not scale.
 */
export function Sparkline({
  values,
  direction,
  width = 48,
  height = 18,
  strokeWidth = 1.25,
  className,
}: {
  values: readonly number[];
  direction: ChangeDirection;
  width?: number;
  height?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const path = sparklinePath(values, width, height, strokeWidth);
  if (!path) return null;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      fill="none"
      className={className}
    >
      <path
        d={path}
        stroke={STROKE[direction]}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
