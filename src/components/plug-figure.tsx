"use client";

import { Plug } from "@lucasmarkes/hairline/react";
import { cn } from "@/lib/utils";

/**
 * A plug drawn toward its socket that stops short: Lucas Marques' hairline
 * (MIT, npm `@lucasmarkes/hairline`), the one line figure Berth carries, for
 * the not found page where it says a true thing, nothing connects here.
 * David's call 2026-10-09.
 *
 * Ink and stone only, never the accent: the library's own five tones are
 * mapped to Berth's tokens, which follow the `.dark` class the library also
 * reads. It moves only under the reader's own pointer (never on its own,
 * never a status), and for anyone whose system asks for less motion it
 * takes no pointer at all and holds still. Client only; the server renders
 * an empty box of the same shape, so the 404 page stays static and the same
 * bytes for every visitor (docs/adr/0008-staff-area.md).
 */
export function PlugFigure({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "w-44 self-center [--hairline-plate:var(--card)] [--hairline-hi:var(--foreground)] [--hairline-edge:var(--muted-foreground)] [--hairline-mid:var(--faint)] [--hairline-lo:var(--border)] motion-reduce:pointer-events-none",
        className,
      )}
    >
      <Plug intensity={0.5} />
    </div>
  );
}
