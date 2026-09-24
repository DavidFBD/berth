"use client";

import type { CSSProperties } from "react";
import Image from "next/image";
import { avatarSrc } from "@/lib/avatars";
import { rankGlyphSrc } from "@/lib/xp";
import { cn } from "@/lib/utils";

/**
 * A rank's glyph from the brand kit, in the colour of the text around it.
 *
 * The kit draws the ten glyphs as strokes in `currentColor`, which an <img>
 * cannot inherit (it would paint them black in dark mode), so the file is
 * used as a mask over a block filled with `currentColor`: the glyph takes
 * ink, muted or anything else from its className, in both appearances.
 * Size comes from the className too (`size-4`). Decorative by default,
 * since a rank name always sits beside it; pass `label` where it stands
 * alone.
 */
export function RankGlyph({
  level,
  className,
  label,
}: {
  level: number;
  className?: string;
  label?: string;
}) {
  const mask = `url(${rankGlyphSrc(level)})`;
  const style: CSSProperties = {
    maskImage: mask,
    WebkitMaskImage: mask,
    maskSize: "contain",
    WebkitMaskSize: "contain",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskPosition: "center",
  };
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("inline-block size-4 shrink-0 bg-current", className)}
      style={style}
    />
  );
}

/** Below this the rank mark would be a smudge, so the face goes bare. */
const RANK_MARK_MIN = 36;

/**
 * The account's face wearing its rank: the chosen avatar with the current
 * rank glyph as a small mark at its lower right. At 36px and above the mark
 * shows; smaller than that only the face stays legible, so only the face
 * is drawn (the header chip sets the glyph beside it instead). With no face
 * chosen yet, the rank glyph itself is the face, on a muted disc that
 * follows the appearance (the glyph is currentColor, so it reads either
 * way). A chosen face sits on `bg-avatar-disc`, light in both appearances,
 * because the face SVGs are fixed dark ink with no ground of their own.
 */
export function AvatarWithRank({
  avatarId,
  level,
  size,
  className,
}: {
  avatarId: string | null | undefined;
  level: number;
  /** Diameter in px. */
  size: number;
  className?: string;
}) {
  const src = avatarSrc(avatarId);
  const box = { width: size, height: size };

  if (!src) {
    return (
      <span
        aria-hidden
        style={box}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-muted text-foreground",
          className,
        )}
      >
        {/* A little over half the disc, whatever the disc. */}
        <RankGlyph level={level} className="size-[56%]" />
      </span>
    );
  }

  const mark = size >= RANK_MARK_MIN;
  const badge = Math.round(size * 0.42);
  return (
    <span aria-hidden style={box} className={cn("relative block shrink-0", className)}>
      <Image
        src={src}
        alt=""
        width={size}
        height={size}
        className="size-full rounded-full bg-avatar-disc"
      />
      {mark && (
        <span
          style={{ width: badge, height: badge }}
          className="absolute -right-0.5 -bottom-0.5 flex items-center justify-center rounded-full border border-border bg-card text-foreground"
        >
          <RankGlyph level={level} className="size-[72%]" />
        </span>
      )}
    </span>
  );
}
