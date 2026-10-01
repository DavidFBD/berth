import type { ReactNode } from "react";
import { Panel, SectionHeading } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

/**
 * The staff area's building blocks: Berth's flat white card on the stone
 * canvas, one hairline, numbers in Plex Mono. Dense on purpose: these are
 * tables for one operator, not a page for a customer.
 */

export function StaffSection({
  title,
  hint,
  action,
  children,
  className,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Panel className={cn("min-w-0", className)}>
      <SectionHeading title={title} hint={hint} action={action} />
      <div className="px-[18px] pb-[18px] lg:px-6 lg:pb-5">{children}</div>
    </Panel>
  );
}

export function PageTitle({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="font-display text-[26px] leading-tight tracking-[-0.022em] text-foreground lg:text-[30px]">{title}</h1>
      {sub && <div className="text-[13.5px] leading-relaxed text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3">
      <span className="truncate text-[12.5px] text-muted-foreground">{label}</span>
      <span className="font-money text-[20px] leading-tight text-foreground tabular-nums">{value}</span>
      {sub && <span className="text-[12px] leading-snug text-muted-foreground">{sub}</span>}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{children}</div>;
}

export function Facts({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-[13.5px]">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="text-right font-money tabular-nums text-foreground">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export type Column<T> = { key: string; label: string; align?: "left" | "right"; mono?: boolean; render: (row: T) => ReactNode; className?: string };

export function Table<T>({ columns, rows, rowKey, empty }: { columns: Column<T>[]; rows: readonly T[]; rowKey: (row: T) => string; empty?: string }) {
  if (rows.length === 0 && empty) return <p className="py-2 text-[13.5px] text-muted-foreground">{empty}</p>;
  return (
    <div className="-mx-[18px] overflow-x-auto lg:-mx-6">
      <table className="w-full min-w-max border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "px-3 py-2 font-normal whitespace-nowrap text-muted-foreground first:pl-[18px] last:pr-[18px] lg:first:pl-6 lg:last:pr-6",
                  column.align === "right" ? "text-right" : "text-left",
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-border/60 last:border-0">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "px-3 py-2 whitespace-nowrap text-foreground first:pl-[18px] last:pr-[18px] lg:first:pl-6 lg:last:pr-6",
                    column.align === "right" ? "text-right" : "text-left",
                    column.mono && "font-money tabular-nums",
                    column.className,
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A quiet tag: a flag on a row, a state beside a name. `low` is the calm "Running low", never red. */
export function Tag({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "low" | "good" }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-2 text-[11.5px] whitespace-nowrap",
        tone === "plain" && "border-border text-secondary-foreground",
        tone === "low" && "border-warn/40 bg-warn-soft text-foreground",
        tone === "good" && "border-good/30 bg-good-soft text-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** Daily or weekly counts as bars: no axis, the figures sit in the table or the headline beside it. */
export function Bars({
  values,
  labels,
  accent = false,
  height = 96,
}: {
  values: readonly number[];
  labels?: readonly [string, string];
  accent?: boolean;
  height?: number;
}) {
  const max = Math.max(1, ...values);
  const width = 100;
  const gap = values.length > 40 ? 0.4 : 1;
  const bar = (width - gap * (values.length - 1)) / Math.max(values.length, 1);
  return (
    <div className="flex flex-col gap-1.5">
      <svg aria-hidden="true" focusable="false" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-24 w-full">
        {values.map((value, index) => {
          const h = value <= 0 ? 0.75 : Math.max(2, (value / max) * (height - 2));
          return (
            <rect
              key={index}
              x={index * (bar + gap)}
              y={height - h}
              width={bar}
              height={h}
              rx={0.6}
              fill={value <= 0 ? "var(--border)" : accent ? "var(--primary)" : "var(--foreground)"}
              opacity={value <= 0 ? 1 : accent ? 1 : 0.82}
            />
          );
        })}
      </svg>
      {labels && (
        <div className="flex justify-between font-money text-[11px] text-muted-foreground">
          <span>{labels[0]}</span>
          <span>{labels[1]}</span>
        </div>
      )}
    </div>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}
