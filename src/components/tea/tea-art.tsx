"use client";

import { useEffect, useId, useState } from "react";
import "@/lib/silk-shader";
import { useMounted } from "@/hooks/use-mounted";

/**
 * LSTeaTime signature art. Keyframes live in globals.css.
 *
 * The porcelain rules, shared by every piece:
 * - handles are drawn BEFORE the body so their ends vanish under the wall
 *   instead of floating next to it;
 * - every vessel sits on a saucer via a small foot, nothing hovers;
 * - interiors carry a rim shadow and a floor shade so empty porcelain still
 *   has depth against the page;
 * - tea is a top-to-bottom accent-to-deep gradient with a lit surface, not
 *   a translucent sticker.
 */

/* Wavy wisp silhouettes, used as CSS masks over the steam color so the
   iridescent gradient token keeps working. Three variants so neighboring
   wisps never trace the same path. */
const WISP_PATHS = [
  "M7 42 C 2 34, 12 27, 7 19 S 3 6, 7 2",
  "M7 42 C 12 35, 2 28, 7 20 S 11 7, 6 2",
  "M7 42 C 4 36, 10 30, 6 22 S 10 8, 8 2",
];
const WISP_MASKS = WISP_PATHS.map(
  (d) =>
    `url("data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 44'><path d='${d}' fill='none' stroke='white' stroke-width='4.5' stroke-linecap='round'/></svg>`,
    )}")`,
);

/** The signature steam. level 0–4 (0 = none). Iridescent only at level 4. */
export function SteamPlume({
  level = 2,
  bloom = false,
  width = 60,
  height = 54,
}: {
  level?: number;
  bloom?: boolean;
  width?: number;
  height?: number;
}) {
  if (level <= 0 && !bloom) return <div style={{ width, height }} />;
  // One more wisp than the level, so even level 1 has two staggered wisps
  // and the plume never goes fully dark mid-cycle.
  const n = Math.min(level + 1, 4);
  const duration = 4.2 - level * 0.35;
  const offsets = [0, 12, -11, 6];
  const wispH = Math.max(28, Math.min(46, height + 10));
  return (
    <div
      aria-hidden="true"
      style={{
        position: "relative",
        width,
        height,
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      {Array.from({ length: n }, (_, i) => {
        const iridescent = level >= 4 && i < 3;
        const mask = WISP_MASKS[i % WISP_MASKS.length];
        return (
          <div
            key={i}
            data-steam-wisp
            style={
              {
                position: "absolute",
                bottom: 0,
                left: "50%",
                marginLeft: offsets[i] - 7,
                width: 14,
                height: wispH,
                background: iridescent ? "var(--iridescent)" : "var(--steam)",
                maskImage: mask,
                WebkitMaskImage: mask,
                maskSize: "100% 100%",
                WebkitMaskSize: "100% 100%",
                maskRepeat: "no-repeat",
                WebkitMaskRepeat: "no-repeat",
                filter: "blur(1.2px)",
                opacity: 0,
                "--steam-opacity": String(0.22 + level * 0.11),
                animation: `steam-rise-${"abc"[i % 3]} ${duration.toFixed(2)}s linear ${((i * duration) / n).toFixed(2)}s infinite`,
              } as React.CSSProperties
            }
          />
        );
      })}
      {bloom && (
        <div
          data-steam-bloom
          style={{
            position: "absolute",
            bottom: 0,
            left: "50%",
            marginLeft: -20,
            width: 40,
            height: 40,
            borderRadius: "50%",
            filter: "blur(8px)",
            background: "var(--iridescent)",
            animation: "steam-bloom var(--duration-steep) var(--ease-settle) both",
          }}
        />
      )}
    </div>
  );
}

/**
 * Inline cup illustration, fill 0–1, tinted by accent. Sencha renders
 * handleless. When `silk` (a 4-stop palette) is set, the tea surface becomes
 * a live generative silk field — mounted client-side only, over the gradient
 * tea so SSR and no-WebGL still show tea.
 */
export function CupArt({
  accent = "var(--cup-breakfast)",
  deep = "var(--cup-breakfast-deep)",
  fill = 0.6,
  bowl = false,
  size = 72,
  silk,
}: {
  accent?: string;
  deep?: string;
  fill?: number;
  bowl?: boolean;
  size?: number;
  silk?: string;
}) {
  const mounted = useMounted();
  const f = Math.max(0, Math.min(1, fill));
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const interior = bowl
    ? "M14 26h68v8c0 15.2-14.9 27-34 27S14 49.2 14 34V26Z"
    : "M18 22h52v16c0 14-11.2 25-26 25S18 52 18 38V22Z";
  const topY = bowl ? 26 : 22;
  const botY = bowl ? 61 : 63;
  const cx = bowl ? 48 : 44;
  const teaTop = botY - f * (botY - topY - 3);
  // Room for the tea-ring stain: only when the cup is partly drunk and the
  // stain line would sit clearly above the surface yet below the rim.
  const ringY = teaTop - 4.5;
  const showRing = f > 0.08 && f < 0.78 && ringY > topY + 5;
  // The silk canvas lives OUTSIDE the svg: WebKit (all iOS browsers) neither
  // clips nor viewBox-scales foreignObject content, so an embedded canvas
  // paints as a raw unclipped rectangle. An HTML overlay clipped with CSS
  // path() renders identically everywhere. px = viewBox unit → CSS px.
  const px = (v: number) => Math.round(v * (size / 96) * 100) / 100;
  const interiorPx = bowl
    ? `M ${px(14)} ${px(26)} h ${px(68)} v ${px(8)} c 0 ${px(15.2)} ${px(-14.9)} ${px(27)} ${px(-34)} ${px(27)} S ${px(14)} ${px(49.2)} ${px(14)} ${px(34)} V ${px(26)} Z`
    : `M ${px(18)} ${px(22)} h ${px(52)} v ${px(16)} c 0 ${px(14)} ${px(-11.2)} ${px(25)} ${px(-26)} ${px(25)} S ${px(18)} ${px(52)} ${px(18)} ${px(38)} V ${px(22)} Z`;
  return (
    <div
      aria-hidden="true"
      style={{ position: "relative", width: size, height: size * 0.83 }}
    >
      <svg width={size} height={size * 0.83} viewBox="0 0 96 80" fill="none">
        <defs>
          <clipPath id={`cup${id}`}>
            <path d={interior} />
          </clipPath>
          <linearGradient
            id={`tea${id}`}
            gradientUnits="userSpaceOnUse"
            x1={cx}
            y1={teaTop}
            x2={cx}
            y2={botY + 4}
          >
            <stop offset="0" style={{ stopColor: accent }} stopOpacity="0.95" />
            <stop offset="1" style={{ stopColor: deep }} stopOpacity="0.95" />
          </linearGradient>
          <linearGradient
            id={`shade${id}`}
            gradientUnits="userSpaceOnUse"
            x1={cx}
            y1={topY}
            x2={cx}
            y2={botY + 4}
          >
            <stop offset="0.45" style={{ stopColor: deep }} stopOpacity="0" />
            <stop offset="1" style={{ stopColor: deep }} stopOpacity="0.14" />
          </linearGradient>
        </defs>

        {/* Handle first, so the body wall swallows its ends. */}
        {!bowl && (
          <path
            d="M69 26a12 12 0 0 1 0 21"
            stroke={deep}
            strokeWidth="4.5"
            strokeLinecap="round"
          />
        )}

        {/* Foot and saucer — the vessel stands on something. */}
        {bowl ? (
          <>
            <path
              d="M40 62.5c0 3.6 3.4 5.6 8 5.6s8-2 8-5.6"
              stroke={deep}
              strokeWidth="2.5"
              fill="var(--card)"
            />
            <path d="M16 70.5h64" stroke={deep} strokeWidth="3" strokeLinecap="round" />
            <path
              d="M28 75h40"
              stroke={deep}
              strokeWidth="2"
              strokeLinecap="round"
              opacity="0.45"
            />
          </>
        ) : (
          <>
            <path
              d="M36 64c0 3.6 3.4 5.6 8 5.6s8-2 8-5.6"
              stroke={deep}
              strokeWidth="2.5"
              fill="var(--card)"
            />
            <path d="M12 70.5h64" stroke={deep} strokeWidth="3" strokeLinecap="round" />
            <path
              d="M24 75h40"
              stroke={deep}
              strokeWidth="2"
              strokeLinecap="round"
              opacity="0.45"
            />
          </>
        )}

        {/* The body. */}
        {bowl ? (
          <path
            d="M12 24h72v10c0 16.6-16.1 30-36 30S12 50.6 12 34V24Z"
            fill="var(--card)"
            stroke={deep}
            strokeWidth="3"
          />
        ) : (
          <path
            d="M16 20h56v18c0 15.5-12.5 28-28 28S16 53.5 16 38V20Z"
            fill="var(--card)"
            stroke={deep}
            strokeWidth="3"
          />
        )}

        {/* Interior depth: rim shadow up top, floor shade below. */}
        <g clipPath={`url(#cup${id})`}>
          <rect x="10" y={topY} width="76" height="6" fill={deep} opacity="0.12" />
          <rect x="10" y={topY} width="76" height="50" fill={`url(#shade${id})`} />
        </g>

        {/* The tea. */}
        {f > 0 && (
          <g clipPath={`url(#cup${id})`}>
            <rect
              x="10"
              y={teaTop}
              width="76"
              height="60"
              fill={`url(#tea${id})`}
            />
            <ellipse cx={cx + 4} cy={teaTop} rx="38" ry="3.5" fill={accent} />
            <ellipse
              cx={cx + 4}
              cy={teaTop}
              rx="38"
              ry="3.5"
              fill="white"
              opacity="0.2"
            />
            <ellipse
              cx={cx - 8}
              cy={teaTop - 0.5}
              rx="11"
              ry="1.4"
              fill="white"
              opacity="0.4"
            />
          </g>
        )}

        {/* The stain of a previous high water line. */}
        {showRing && (
          <g clipPath={`url(#cup${id})`}>
            <ellipse
              cx={cx + 4}
              cy={ringY}
              rx="36"
              ry="3"
              stroke="var(--tea-ring)"
              strokeWidth="1.5"
              fill="none"
            />
          </g>
        )}
      </svg>
      {f > 0 && silk && mounted && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            clipPath: `path("${interiorPx}")`,
            pointerEvents: "none",
          }}
        >
          <silk-shader
            colors={silk}
            scale="1.7"
            speed="1.2"
            glow="0.55"
            style={{
              position: "absolute",
              left: px(10),
              top: px(teaTop),
              width: px(76),
              height: px(botY - teaTop + 6),
              opacity: 0.92,
            }}
          />
          {/* Surface highlight above the silk, as the in-svg ellipse was. */}
          <div
            style={{
              position: "absolute",
              left: px(cx + 4 - 36),
              top: px(teaTop - 3.5),
              width: px(72),
              height: px(7),
              borderRadius: "50%",
              background: accent,
              opacity: 0.9,
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The teapot — idle funds waiting to be poured. `trivet={false}` lifts it
 * off its stand (a pouring pot is held, not parked); the line fades back
 * in when it lands.
 */
export function TeapotArt({
  size = 56,
  trivet = true,
}: {
  size?: number;
  trivet?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size * 0.76}
      viewBox="0 0 110 84"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="teapotShade"
          gradientUnits="userSpaceOnUse"
          x1="55"
          y1="26"
          x2="55"
          y2="70"
        >
          <stop offset="0.5" stopColor="var(--primary)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--primary)" stopOpacity="0.12" />
        </linearGradient>
      </defs>
      {/* Handle behind the body, ends under the wall. */}
      <path
        d="M78 32a12 12 0 0 1 0 22"
        stroke="var(--primary)"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      {/* Foot and trivet. */}
      <path
        d="M47 68.5c0 3.4 3.5 5.3 8 5.3s8-1.9 8-5.3"
        stroke="var(--primary)"
        strokeWidth="2.5"
        fill="var(--card)"
      />
      <path
        d="M24 77h62"
        stroke="var(--primary)"
        strokeWidth="3.2"
        strokeLinecap="round"
        style={{
          opacity: trivet ? 1 : 0,
          transition: "opacity 0.6s var(--ease-tea)",
        }}
      />
      {/* Body, lid, spout. */}
      <path
        d="M30 26h50v18c0 14.9-11.2 26-25 26S30 58.9 30 44V26Z"
        fill="var(--card)"
        stroke="var(--primary)"
        strokeWidth="3.2"
      />
      <path
        d="M30 26h50v18c0 14.9-11.2 26-25 26S30 58.9 30 44V26Z"
        fill="url(#teapotShade)"
      />
      <path
        d="M34 26c0-6 9.4-10 21-10s21 4 21 10"
        stroke="var(--primary)"
        strokeWidth="3.2"
        fill="var(--card)"
      />
      <circle cx="55" cy="12" r="4" fill="var(--primary)" />
      <path
        d="M30 34 14 26c-3 8 2 16 12 18"
        stroke="var(--primary)"
        strokeWidth="3.2"
        fill="var(--card)"
        strokeLinejoin="round"
      />
      {/* The brew, glimpsed through the wall. */}
      <path
        d="M34 40h42v4c0 11.6-9 21-21 21s-21-9.4-21-21v-4Z"
        fill="var(--cup-breakfast)"
        opacity="0.6"
      />
    </svg>
  );
}

/**
 * The pour — teapot tipped over a slowly filling cup. The app's central
 * verb, finally on screen. `done` rights the pot, tops the cup and lets the
 * bloom fire; while pouring, the fill creeps toward 0.88 and never quite
 * arrives, which is honest for a wait of unknown length.
 */
export function PourScene({
  accent = "var(--cup-breakfast)",
  deep = "var(--cup-breakfast-deep)",
  done = false,
  width = 190,
}: {
  accent?: string;
  deep?: string;
  done?: boolean;
  width?: number;
}) {
  const [creep, setCreep] = useState(0.15);
  useEffect(() => {
    if (done) return;
    const timer = setInterval(
      () => setCreep((f) => f + (0.88 - f) * 0.05),
      400,
    );
    return () => clearInterval(timer);
  }, [done]);
  const fill = done ? 1 : creep;
  const height = width * 0.72;
  const s = width / 190;
  return (
    <div
      aria-hidden="true"
      style={{ position: "relative", width, height, pointerEvents: "none" }}
    >
      {/* The teapot, held tipped toward its spout (spout points left);
          its trivet only returns once the pot is set down. */}
      <div
        data-pour-rock={done ? undefined : ""}
        style={{
          position: "absolute",
          right: 0,
          top: 4 * s,
          transform: done ? "rotate(0deg)" : "rotate(-16deg)",
          transformOrigin: "30% 70%",
          transition: "transform 0.9s var(--ease-settle)",
        }}
      >
        <TeapotArt size={96 * s} trivet={done} />
      </div>

      {/* The stream: leaves the spout with a little sideways life in it,
          then falls near vertical into the cup. Anchors tuned to the
          spout tip at rotate(-16deg) and the cup centered at x 50. */}
      <svg
        width={width}
        height={height}
        viewBox="0 0 190 137"
        fill="none"
        style={{
          position: "absolute",
          inset: 0,
          opacity: done ? 0 : 1,
          transition: "opacity 0.45s var(--ease-tea)",
        }}
      >
        <path
          d="M99 40 C 82 45, 65 65, 48 100"
          stroke={accent}
          strokeWidth="6"
          strokeLinecap="round"
          opacity="0.25"
        />
        <path
          data-pour-stream
          d="M99 40 C 82 45, 65 65, 48 100"
          stroke={accent}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray="9 8"
          style={{ animation: "pour-flow 0.55s linear infinite" }}
        />
      </svg>

      {/* The cup receiving it, steam rising as it warms. */}
      <div
        style={{
          position: "absolute",
          left: 16 * s,
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <SteamPlume
          level={done ? 4 : fill > 0.55 ? 2 : 1}
          bloom={done}
          width={56 * s}
          height={26 * s}
        />
        <CupArt accent={accent} deep={deep} fill={fill} size={68 * s} />
      </div>
    </div>
  );
}
