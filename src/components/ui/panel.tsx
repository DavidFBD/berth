import type { ReactNode } from "react";
import { InfoTip } from "@/components/ui/info-tip";
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
        // Flat since 2026-09-29: both are a white card on the stone canvas
        // with one hairline and no shadow. The two names stay so a section
        // can still say which it is.
        (surface === "sheet" || surface === "panel") &&
          "rounded-lg border border-border bg-card",
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
 *
 * What the section is for, and any measurement note, sit behind an (i) beside
 * the title rather than as paragraphs under it (David, 2026-09-22: the
 * headings read as verbose). A person who already knows what the board is
 * should not read it again on every visit; one who does not is one tap away.
 */
export function SectionHeading({
  title,
  hint,
  note,
  more,
  action,
  className,
}: {
  title: string;
  /** What the section is for; behind the (i). */
  hint?: string;
  /** A measurement note or a caveat; behind the same (i), after the hint. */
  note?: string;
  /** Anything else the (i) should hold, after the hint and note. */
  more?: ReactNode;
  /** A control that belongs to the section as a whole. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-[18px] pt-[18px] pb-3 lg:px-6 lg:pt-[22px]",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-1">
        <h2 className="font-display text-lg leading-tight tracking-[-0.02em] text-foreground">
          {title}
        </h2>
        {(hint || note || more) && (
          <InfoTip label={title}>
            {hint && <p>{hint}</p>}
            {note && <p className={hint ? "mt-1.5 text-muted-foreground" : ""}>{note}</p>}
            {more}
          </InfoTip>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
