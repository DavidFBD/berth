"use client";

/**
 * A money figure whose digits roll to a new value when it changes while in
 * view. Adapted from SmoothUI's number-flow and digit-roll
 * (https://smoothui.dev, MIT, (c) 2024 Eduardo Calvo), cut down to what Berth
 * allows (CLAUDE.md, Brand, third exception): under 300 ms, an ease-out with
 * no overshoot, up when the value rises and down when it falls, ink only, no
 * colour, blur or scale, never on first paint, never idle, and an instant
 * swap under prefers-reduced-motion.
 *
 * The input is the string the caller already formats; only digit characters
 * roll, separators and symbols stay still. Slots are keyed from the right, so
 * a figure that gains a digit (999 to 1,000) keeps its units where they were.
 * Screen readers get the whole figure once as text; the columns are hidden.
 */
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/** Matches --ease-settle in globals.css. */
const SETTLE = [0.22, 1, 0.36, 1] as const;
const ROLL_SECONDS = 0.26;

/** 1 when the figure rose, -1 when it fell, 0 when its digits are the same. */
export function rollDirection(from: string, to: string): 1 | -1 | 0 {
  // Berth formats in en-US: commas group, a dot marks the fraction, and
  // compact figures end in K, M, B or T. Token amounts trim their trailing
  // zeros, so the digits alone would read 0.5 as more than 0.12.
  const scale: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
  const read = (text: string) => {
    const match = text.replace(/,/g, "").match(/(\d*\.?\d+)\s*([KMBT])?/);
    if (!match) return 0;
    const sign = /[-−]/.test(text) ? -1 : 1;
    return sign * Number(match[1]) * (match[2] ? scale[match[2]] : 1);
  };
  const [a, b] = [read(from), read(to)];
  return b > a ? 1 : b < a ? -1 : 0;
}

function Digit({ char, direction }: { char: string; direction: 1 | -1 }) {
  return (
    <span className="relative inline-block">
      <AnimatePresence initial={false} mode="popLayout" custom={direction}>
        <motion.span
          key={char}
          custom={direction}
          className="inline-block"
          variants={{
            enter: (d: number) => ({ y: `${d * 0.6}em`, opacity: 0 }),
            rest: { y: 0, opacity: 1 },
            leave: (d: number) => ({ y: `${d * -0.6}em`, opacity: 0 }),
          }}
          initial="enter"
          animate="rest"
          exit="leave"
          transition={{ duration: ROLL_SECONDS, ease: SETTLE }}
        >
          {char}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function RollingNumber({ value, className }: { value: string; className?: string }) {
  const reduced = useReducedMotion();
  // The direction of the latest change, derived while rendering (no effect, no ref).
  const [seen, setSeen] = useState<{ value: string; direction: 1 | -1 }>({ value, direction: 1 });
  if (seen.value !== value) {
    const direction = rollDirection(seen.value, value);
    setSeen({ value, direction: direction === 0 ? seen.direction : direction });
  }

  if (reduced) return <span className={className}>{value}</span>;

  const chars = Array.from(value);
  return (
    <span className={cn("inline-flex", className)}>
      <span className="sr-only">{value}</span>
      <span aria-hidden className="inline-flex">
        {chars.map((char, index) =>
          /\d/.test(char) ? (
            <Digit key={`d${chars.length - index}`} char={char} direction={seen.direction} />
          ) : (
            <span key={`s${chars.length - index}`}>{char}</span>
          ),
        )}
      </span>
    </span>
  );
}
