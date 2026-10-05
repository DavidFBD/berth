"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { CompanyMark } from "@/components/company-marks";
import { useCopy } from "@/components/settings-provider";
import { LISTING_MARK_BY_SYMBOL } from "@/lib/listings";
import { changeDirection, formatPercentChange } from "@/lib/performance";
import type { StoryPoint } from "@/lib/portfolio-story";
import { cn } from "@/lib/utils";

/**
 * The last seven market days under the line, one tile each: the weekday,
 * the day's change over the money at work (the only toned figure), and the
 * holding that moved it most, by its own mark or its name. In a new
 * account's first seven the days still to come are empty slots, so the
 * strip fills in day by day.
 *
 * A tile shares the line's scrub: hovering or focusing it marks that day
 * on the line, tapping it keeps the day picked until it is tapped again.
 * One tab stop; the arrow keys walk the days.
 */

const TONE = { up: "text-good", down: "text-bad", flat: "text-muted-foreground" } as const;

/** "Thu", read in UTC so the day never shifts. */
export function weekday(day: string, style: "short" | "long" = "short"): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: style, timeZone: "UTC" });
}

export type StripDay = StoryPoint & {
  /** The name a person reads for the day's mover. */
  moverName: string | null;
  /** The tile's accessible name. */
  label: string;
  /** The live point: "Today" instead of its weekday. */
  today: boolean;
};

export function WeekStrip({
  days,
  slots,
  heading,
  active,
  pinned,
  onHover,
  onPin,
}: {
  days: readonly StripDay[];
  /** The market days still to come in a first week, as empty slots. */
  slots: readonly string[];
  heading: string;
  /** The day marked on the line now, from either side. */
  active: string | null;
  /** The day tapped and kept. */
  pinned: string | null;
  onHover: (day: string | null) => void;
  onPin: (day: string) => void;
}) {
  const copy = useCopy();
  const group = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const tabDay = focusDay ?? pinned ?? days.at(-1)?.day ?? null;

  const walk = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const to = event.key === "Home" ? 0 : event.key === "End" ? days.length - 1 : index + step;
    if (to === index || (step === 0 && event.key !== "Home" && event.key !== "End")) return;
    if (to < 0 || to >= days.length) return;
    event.preventDefault();
    setFocusDay(days[to].day);
    group.current?.querySelectorAll<HTMLButtonElement>("button[data-day]")[to]?.focus();
  };

  return (
    <div className="mt-4 border-t border-border pt-3">
      <p id={headingId} className="text-xs leading-5 text-muted-foreground">
        {heading}
      </p>
      <div
        ref={group}
        role="group"
        aria-labelledby={headingId}
        // Blocked, not masked: the days are the account's own changes, with its holdings' marks.
        data-ph-block
        className="mt-1 -mx-0.5 grid grid-cols-7 gap-0.5"
      >
        {days.map((day, index) => {
          const direction = changeDirection(day.changePct ?? undefined) ?? "flat";
          const mark = day.top ? LISTING_MARK_BY_SYMBOL[day.top.symbol] : undefined;
          const isActive = active === day.day;
          return (
            <button
              key={day.day}
              type="button"
              data-day={day.day}
              tabIndex={day.day === tabDay ? 0 : -1}
              aria-pressed={pinned === day.day}
              aria-label={day.label}
              onClick={() => onPin(day.day)}
              onKeyDown={(event) => walk(event, index)}
              onFocus={() => {
                setFocusDay(day.day);
                onHover(day.day);
              }}
              onBlur={() => onHover(null)}
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") onHover(day.day);
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === "mouse") onHover(null);
              }}
              className={cn(
                "flex min-w-0 flex-col items-center gap-[3px] rounded-[10px] px-0.5 pt-1.5 pb-2 outline-none transition-colors duration-150 ease-lift focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
                isActive || pinned === day.day ? "bg-muted" : "hover:bg-muted/60",
              )}
            >
              <span className={cn("text-[11px] leading-4", isActive ? "text-foreground" : "text-muted-foreground")}>
                {day.today ? copy.portfolioToday : weekday(day.day)}
              </span>
              <span
                className={cn(
                  "money text-[11.5px] leading-4 font-medium tracking-[-0.02em] tabular-nums",
                  day.changePct == null ? "text-muted-foreground" : TONE[direction],
                )}
              >
                {day.changePct == null ? "·" : formatPercentChange(day.changePct, 1)}
              </span>
              <span className="flex h-4 max-w-full items-center justify-center text-secondary-foreground">
                {mark ? (
                  <CompanyMark id={mark} className="size-3.5" />
                ) : day.moverName ? (
                  <span className="max-w-full truncate px-0.5 text-[10px] leading-4">{day.moverName}</span>
                ) : null}
              </span>
            </button>
          );
        })}
        {slots.map((slot) => (
          <div
            key={slot}
            aria-hidden="true"
            className="flex min-w-0 flex-col items-center gap-[3px] px-0.5 pt-1.5 pb-2"
          >
            <span className="text-[11px] leading-4 text-muted-foreground opacity-70">{weekday(slot)}</span>
            {/* A day still to come: a short rule where its figure will be. */}
            <span className="flex h-4 items-center">
              <span className="block h-px w-3.5 bg-faint" />
            </span>
            <span className="h-4" />
          </div>
        ))}
      </div>
    </div>
  );
}
