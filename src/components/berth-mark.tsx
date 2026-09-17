import { cn } from "@/lib/utils";

/**
 * The mark, inline. An `<img src="/berth-mark.svg">` is its own document,
 * so `currentColor` there never sees the page's foreground and the mark
 * rendered black on the dark appearance. Inline, it takes the text colour of
 * wherever it sits. Same single path as public/berth-mark.svg; keep the two
 * in step if the mark ever changes.
 */
export function BerthMark({
  className,
  title,
}: {
  className?: string;
  /** Accessible name; omit for a decorative mark beside the wordmark. */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={cn("size-8 shrink-0 text-foreground", className)}
    >
      <path
        fill="currentColor"
        d="M10 8H20V40C20 42.21 21.79 44 24 44H40C42.21 44 44 42.21 44 40V8H54V44C54 49.52 49.52 54 44 54H20C14.48 54 10 49.52 10 44Z M32 24A6 6 0 1 1 32 36A6 6 0 1 1 32 24Z"
      />
    </svg>
  );
}
