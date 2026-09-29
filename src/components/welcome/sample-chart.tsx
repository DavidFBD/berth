"use client";

import { useState } from "react";
import { PortfolioChart } from "@/components/board/portfolio-chart";
import type { HistoryPoint } from "@/lib/portfolio-history";

/**
 * A month of an example account beside the same dollars in a benchmark, for
 * the welcome page, drawn by the board's own chart so the preview is the
 * real component and not a picture of it. The walk is seeded, so the server
 * and the browser draw the same line and nothing shifts on hydration.
 */
function walk(seed: number, count: number, drift: number, end: number): number[] {
  let state = seed;
  const next = () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
  const values = [100];
  for (let i = 1; i < count; i++) values.push(values[i - 1] + (next() - 0.5) * 3 + drift);
  const last = values[count - 1];
  return values.map((value, i) => value + ((end - last) * i) / (count - 1));
}

function sampleDays(seed: number, benchmarkSeed: number): HistoryPoint[] {
  const you = walk(seed, 31, 0.2, 106.1);
  const benchmark = walk(benchmarkSeed, 31, 0.07, 102.4);
  const start = Date.UTC(2026, 7, 29);
  return you.map((value, i) => ({
    day: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    value: value * 12.1,
    benchmark: benchmark[i] * 12.1,
  }));
}

export function SampleChart({ seed = 3, benchmarkSeed = 9 }: { seed?: number; benchmarkSeed?: number }) {
  const [scrub, setScrub] = useState<number | null>(null);
  const [days] = useState(() => sampleDays(seed, benchmarkSeed));
  return (
    <PortfolioChart days={days} withBenchmark scrubIndex={scrub} onScrub={setScrub} drawKey={`sample-${seed}`} />
  );
}
