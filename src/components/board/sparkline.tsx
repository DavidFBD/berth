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
