/**
 * TypeSafe's mark for Jev, drawn in the current text colour.
 *
 * The file is a black mark on transparency, which would vanish on the dark
 * theme as an <img>. As a mask over `currentColor` it takes whatever tone its
 * surroundings set, so it sits in the muted grey beside a chip and needs no
 * second asset for dark mode. Decorative: the words beside it say "Jev".
 */
export function JevMark({
  className = "size-3.5",
  live = false,
}: {
  className?: string;
  /** A slow ring pulses out from the mark (globals.css `jev-ping`). */
  live?: boolean;
}) {
  const mark = (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{
        maskImage: "url(/jev/typesafe-mark.png)",
        WebkitMaskImage: "url(/jev/typesafe-mark.png)",
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  );
  if (!live) return mark;
  return (
    <span className="relative inline-flex shrink-0">
      <span
        data-jev-ping
        aria-hidden="true"
        className="absolute inset-0 rounded-full border border-current opacity-0 [animation:jev-ping_2.8s_cubic-bezier(0,0,0.2,1)_infinite]"
      />
      {mark}
    </span>
  );
}
