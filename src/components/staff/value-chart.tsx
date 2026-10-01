"use client";

import { useState } from "react";
import { PortfolioChart } from "@/components/board/portfolio-chart";
import { usd, day } from "@/lib/staff/format";

/** An account's stored closes, drawn with the app's own chart (no benchmark line here). */
export function ValueChart({ days }: { days: { day: string; value: number }[] }) {
  const [scrub, setScrub] = useState<number | null>(null);
  const points = days.map((row) => ({ day: row.day as never, value: row.value, benchmark: null }));
  const shown = scrub !== null ? days[scrub] : days[days.length - 1];
  return (
    <div className="flex flex-col gap-2">
      {shown && (
        <p className="font-money text-[13px] text-foreground tabular-nums">
          {usd(shown.value)} <span className="text-muted-foreground">{day(shown.day)}</span>
        </p>
      )}
      <PortfolioChart days={points} withBenchmark={false} scrubIndex={scrub} onScrub={setScrub} drawKey="staff" />
    </div>
  );
}
