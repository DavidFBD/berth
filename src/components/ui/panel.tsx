import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A surface that holds a section of the page.
 *
 * Until this landed, every section on Home was the same bordered box with
 * the same shadow, seven of them stacked, and a page whose every part has
 * the same weight has no first read: the eye is given nowhere to land. So
 * there are two surfaces and they mean different things. A `sheet` holds a
 * list of discrete objects a person acts on, the board and the news, and
 * carries the raised shadow. A `panel` groups things that belong to the
 * account and sits quieter, one step back from the sheets.
 *
 * `flush` drops the surface entirely, for a block that is already inside
 * one; that is how the account rail became a single object with ruled
 * sections instead of four boxes floating apart.
 */
export function Panel({
  as: Tag = "section",
  surface = "panel",
  className,
  children,
}: {
  as?: "section" | "div" | "aside";
  surface?: "sheet" | "panel" | "flush";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      className={cn(
        surface === "sheet" &&
          "rounded-2xl border border-border bg-card shadow-raised",
        surface === "panel" &&
          "rounded-2xl border border-border bg-card shadow-sheet",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/**
 * The name of a section, and what it is for.
 *
 * Set in the display face at a readable size, in sentence case. What stood
 * here before was an eleven and a half pixel letter-spaced capital label,
 * repeated identically above every section, which is the house style of a
 * template rather than of a brand: it opts out of Archivo entirely, the one
 * typographic move the brand sheet actually specifies, and it makes every
 * section shout its own name at the same pitch. A heading carries its own
 * weight at a size a person can read.
 */
export function SectionHeading({
  title,
  hint,
  note,
  action,
  className,
}: {
  title: string;
  /** One line under the title saying what the section is for. */
  hint?: string;
  /** A second, quieter line: a measurement note or a caveat. */
  note?: string;
  /** A control that belongs to the section as a whole. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 px-4 pt-3.5 pb-2.5",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="font-display text-[15px] leading-tight font-semibold tracking-[-0.012em] text-foreground">
          {title}
        </h2>
        {hint && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {hint}
          </p>
        )}
        {note && (
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
            {note}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
