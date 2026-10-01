import Link from "next/link";
import { StaffShell } from "@/components/staff/shell";
import { PageTitle, StaffSection, Table } from "@/components/staff/ui";
import { buttonVariants } from "@/components/ui/button";
import { COPY } from "@/lib/copy";
import { staffGate } from "@/lib/server/staff-gate";
import { listAudit } from "@/lib/server/staff/audit-log";
import { clampInt } from "@/lib/server/staff/users";
import { shortId, when } from "@/lib/staff/format";
import { cn } from "@/lib/utils";

type Params = Record<string, string | string[] | undefined>;
const one = (params: Params, key: string) => (typeof params[key] === "string" ? (params[key] as string) : null);

/** The staff Audit page: staff_audit, filterable by action, staff member and target. */
export default async function StaffAuditPage({ searchParams }: { searchParams: Promise<Params> }) {
  const staff = await staffGate("page");
  const words = COPY.staff;
  const a = words.audit;
  const params = await searchParams;
  const filters = { action: one(params, "action"), staffId: one(params, "staff"), target: one(params, "target"), page: clampInt(one(params, "page"), 1, 1, 10_000) };
  const log = await listAudit(filters);
  const link = (page: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (typeof value === "string" && key !== "page") next.set(key, value);
    next.set("page", String(page));
    return `/staff/audit?${next.toString()}`;
  };
  const field = "h-8 rounded-lg border border-input bg-card px-2.5 text-[13.5px] text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
  const targetLink = (target: string | null) => {
    if (!target) return null;
    const match = target.match(/^user:([0-9a-f-]{36})$/);
    return match ? (
      <Link href={`/staff/users/${match[1]}`} className="font-money underline-offset-4 hover:underline">
        user:{shortId(match[1])}
      </Link>
    ) : (
      <span className="font-money">{target.length > 24 ? `${target.slice(0, 22)}…` : target}</span>
    );
  };

  return (
    <StaffShell staff={staff} active="audit">
      <PageTitle title={a.title} sub={a.note} />
      <form method="get" action="/staff/audit" className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4 text-[13px] text-secondary-foreground">
        <label className="flex items-center gap-2">
          {a.action}
          <select name="action" defaultValue={filters.action ?? ""} className={field}>
            <option value="">{a.anyAction}</option>
            {log.actions.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          {a.staff}
          <input name="staff" defaultValue={filters.staffId ?? ""} placeholder={a.staffPlaceholder} className={cn(field, "w-72 font-money")} />
        </label>
        <label className="flex items-center gap-2">
          {a.target}
          <input name="target" defaultValue={filters.target ?? ""} placeholder={a.targetPlaceholder} className={cn(field, "w-72 font-money")} />
        </label>
        <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          {a.filter}
        </button>
      </form>
      <StaffSection title={a.page(log.page, log.pages)}>
        <Table
          rows={log.rows}
          rowKey={(row) => String(row.id)}
          empty={a.empty}
          columns={[
            { key: "at", label: a.at, render: (row) => when(row.at) },
            {
              key: "staff",
              label: a.staff,
              render: (row) =>
                row.staffId ? (
                  <Link href={`/staff/audit?staff=${row.staffId}`} className="underline-offset-4 hover:underline">
                    {row.staffHandle ?? shortId(row.staffId)}
                  </Link>
                ) : (
                  "…"
                ),
            },
            { key: "action", label: a.action, mono: true, render: (row) => row.action },
            { key: "target", label: a.target, render: (row) => targetLink(row.target) },
            {
              key: "detail",
              label: a.detail,
              className: "whitespace-normal max-w-[420px]",
              render: (row) => <span className="font-money text-[12px] break-words text-muted-foreground">{JSON.stringify(row.detail)}</span>,
            },
          ]}
        />
        {log.pages > 1 && (
          <div className="mt-4 flex gap-2">
            {log.page > 1 && (
              <Link href={link(log.page - 1)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                {words.users.previous}
              </Link>
            )}
            {log.page < log.pages && (
              <Link href={link(log.page + 1)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                {words.users.next}
              </Link>
            )}
          </div>
        )}
      </StaffSection>
    </StaffShell>
  );
}
