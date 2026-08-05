"use client";

import { useId } from "react";
import "@/lib/silk-shader";
import { useMounted } from "@/hooks/use-mounted";

/**
 * LSTeaTime signature art, ported from the design system
 * (components/tea/SteamPlume.jsx, CupCard.jsx CupArt, TeapotModule.jsx
 * TeapotArt). Keyframes live in globals.css.
 */

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
  const n = Math.min(level, 4);
  const offsets = [0, 14, -12, 7];
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
        return (
          <div
            key={i}
            style={
              {
                position: "absolute",
                bottom: 0,
                left: "50%",
                marginLeft: offsets[i] - 5,
                width: level >= 4 ? 13 : 10,
                height: level >= 4 ? 32 : 24,
                borderRadius: "50%",
                filter: "blur(4px)",
                background: iridescent ? "var(--iridescent)" : "var(--steam)",
                opacity: 0,
                "--steam-opacity": String(0.2 + level * 0.1),
                animation: `steam-rise ${3.6 - level * 0.35}s var(--ease-tea) ${i * 0.9}s infinite`,
              } as React.CSSProperties
            }
          />
        );
      })}
      {bloom && (
        <div
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
 * a live generative silk field — mounted client-side only, over the flat
 * accent so SSR and no-WebGL still show tea.
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
  const teaTop = botY - f * (botY - topY - 3);
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
        </defs>
        {bowl ? (
          <path
            d="M12 24h72v10c0 16.6-16.1 30-36 30S12 50.6 12 34V24Z"
            fill="var(--card)"
            stroke={deep}
            strokeWidth="3"
          />
        ) : (
          <>
            <path
              d="M16 20h56v18c0 15.5-12.5 28-28 28S16 53.5 16 38V20Z"
              fill="var(--card)"
              stroke={deep}
              strokeWidth="3"
            />
            <path d="M72 25h6a10 10 0 0 1 0 20h-7" stroke={deep} strokeWidth="3" />
          </>
        )}
        {f > 0 && (
          <g clipPath={`url(#cup${id})`}>
            <rect x="10" y={teaTop} width="76" height="60" fill={accent} opacity="0.55" />
            <ellipse cx="48" cy={teaTop} rx="36" ry="3.5" fill={accent} opacity="0.9" />
          </g>
        )}
        {bowl ? (
          <path d="M28 72h40" stroke={deep} strokeWidth="3" strokeLinecap="round" />
        ) : (
          <>
            <path
              d="M16 24h56M16 27h56"
              stroke={accent}
              strokeWidth="1.5"
              opacity="0.45"
            />
            <path d="M10 72h68" stroke={deep} strokeWidth="3" strokeLinecap="round" />
          </>
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
              left: px(12),
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

/** The teapot — idle funds waiting to be poured. */
export function TeapotArt({ size = 56 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size * 0.76}
      viewBox="0 0 110 84"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M30 26h50v18c0 14.9-11.2 26-25 26S30 58.9 30 44V26Z"
        fill="var(--card)"
        stroke="var(--primary)"
        strokeWidth="3.2"
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
      <path d="M80 32h8a11 11 0 0 1 0 22h-9" stroke="var(--primary)" strokeWidth="3.2" />
      <path
        d="M34 40h42v4c0 11.6-9 21-21 21s-21-9.4-21-21v-4Z"
        fill="var(--cup-breakfast)"
        opacity="0.6"
      />
      <path d="M24 78h62" stroke="var(--primary)" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}
