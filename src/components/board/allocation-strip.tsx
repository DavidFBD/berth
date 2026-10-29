import { OTHER_TONE, type AllocationSegment } from "@/lib/allocation";
import { cn } from "@/lib/utils";

/** Ink steps for tones 0..4; the Other tone is the stone border token. */
const INK_OPACITY = [1, 0.72, 0.52, 0.36, 0.24];

/** The colour of a segment and of its row's dot, so the two always match. */
function toneStyle(tone: number): { className: string; style?: { opacity: number } } {
  return tone === OTHER_TONE
    ? { className: "bg-border" }
    : { className: "bg-foreground", style: { opacity: INK_OPACITY[tone] ?? INK_OPACITY[INK_OPACITY.length - 1] } };
}

/** The 6px dot beside a holding's name, in its segment's tone. */
export function AllocationSwatch({ tone }: { tone: number }) {
  const { className, style } = toneStyle(tone);
  return <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", className)} style={style} />;
}

/**
 * One thin bar split by each holding's share of the holdings' value, with a
 * quiet caption. Static: no motion, no accent, ink only.
 */
export function AllocationStrip({
  segments,
  caption,
  label,
}: {
  segments: readonly AllocationSegment[];
  caption: string;
  /** The spoken form: caption, then names and whole percents. */
  label: string;
}) {
  return (
    <div className="border-t border-border px-[18px] pt-3 pb-3.5 lg:px-6">
      <p className="mb-2 text-[11px] text-muted-foreground">{caption}</p>
      <div role="img" aria-label={label} className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full">
        {segments.map((segment) => {
          const { className, style } = toneStyle(segment.tone);
          return (
            <div
              key={segment.keys.join("|")}
              className={cn("h-full min-w-0", className)}
              style={{ flexGrow: segment.share, flexBasis: 0, ...style }}
            />
          );
        })}
      </div>
    </div>
  );
}
