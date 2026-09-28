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
}: {
  className?: string;
}) {
  return (
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
}
