import { StaffShell } from "@/components/staff/shell";
import { PageTitle, StaffSection, Table, Tag } from "@/components/staff/ui";
import { BudgetForm } from "@/components/staff/actions";
import { COPY } from "@/lib/copy";
import { staffGate } from "@/lib/server/staff-gate";
import { readBudgets, readProviderChecks, type MeterRow } from "@/lib/server/staff/budgets";
import { count, usd, when } from "@/lib/staff/format";

function amount(meter: MeterRow, value: number | null): string {
  if (value === null) return "…";
  return meter.unit === "usd" ? usd(value) : count(value);
}

/** The staff Budgets page: each paid service's spend and what is left (lib/server/staff/budgets). */
export default async function StaffBudgetsPage() {
  const staff = await staffGate("page");
  const words = COPY.staff;
  const b = words.budgets;
  const [budgets, checks] = await Promise.all([readBudgets(), readProviderChecks()]);

  return (
    <StaffShell staff={staff} active="budgets">
      <PageTitle title={b.title} sub={`${b.note} ${b.alerts}`} />
      <div className="grid gap-5">
        {budgets
          .filter((service) => service.tracked)
          .map((service) => (
            <StaffSection
              key={service.id}
              title={b.service[service.id]}
              hint={b.source[service.id]}
              action={service.low ? <Tag tone="low">{b.lowThreshold}</Tag> : <Tag tone="good">{b.fine}</Tag>}
            >
              <div className="flex flex-col gap-4">
                <Table
                  rows={service.meters}
                  rowKey={(row) => row.id}
                  columns={[
                    {
                      key: "meter",
                      label: "",
                      render: (row) => (
                        <span className="flex items-center gap-2">
                          {b.meter[row.id]}
                          {row.estimate && row.remaining !== null && <Tag>{b.estimate}</Tag>}
                        </span>
                      ),
                    },
                    { key: "today", label: b.today, align: "right", mono: true, render: (row) => amount(row, row.today) },
                    { key: "month", label: b.month, align: "right", mono: true, render: (row) => amount(row, row.month) },
                    {
                      key: "left",
                      label: b.left,
                      align: "right",
                      mono: true,
                      render: (row) => (row.remaining === null ? <span className="text-muted-foreground">{b.unknown}</span> : amount(row, Math.max(0, row.remaining))),
                    },
                    {
                      key: "runway",
                      label: b.runway,
                      align: "right",
                      render: (row) =>
                        row.kind === "daily"
                          ? row.resetsInDays === null
                            ? ""
                            : b.resets(row.resetsInDays)
                          : row.daysLeft === null
                            ? "…"
                            : words.units.days(Math.floor(row.daysLeft)),
                    },
                    { key: "threshold", label: b.threshold, align: "right", mono: true, render: (row) => (row.kind === "daily" ? "" : amount(row, row.threshold)) },
                    {
                      key: "state",
                      label: "",
                      render: (row) => (row.low ? <Tag tone="low">{row.why === "runway" ? b.lowRunway : b.lowThreshold}</Tag> : null),
                    },
                  ]}
                />
                {service.id === "openai" && (
                  <p className="text-[12.5px] text-muted-foreground">
                    {checks.openaiConfigured ? (checks.openaiMonthUsd === null ? b.providerUnread : b.providerOpenai(usd(checks.openaiMonthUsd))) : b.providerOpenaiOff}
                  </p>
                )}
                {service.id === "x" && checks.xConfigured && (
                  <p className="text-[12.5px] text-muted-foreground">{checks.xUsage ? b.providerX(checks.xUsage.used, checks.xUsage.cap) : b.providerUnread}</p>
                )}
                {service.settings.balanceAt && <p className="text-[12.5px] text-muted-foreground">{b.balanceAt(when(service.settings.balanceAt))}</p>}
                {staff.role === "admin" && (
                  <BudgetForm service={service.id} balance={service.settings.balanceUsd} threshold={service.settings.threshold} withBalance={service.id !== "resend"} thresholdUnit={service.id === "resend" ? "emails" : "USD"} />
                )}
              </div>
            </StaffSection>
          ))}
      </div>
      <StaffSection title={words.notTracked}>
        <Table
          rows={budgets.filter((service) => !service.tracked)}
          rowKey={(row) => row.id}
          columns={[
            { key: "name", label: "", render: (row) => b.service[row.id] },
            { key: "why", label: "", className: "whitespace-normal", render: (row) => <span className="text-muted-foreground">{b.source[row.id]}</span> },
          ]}
        />
      </StaffSection>
    </StaffShell>
  );
}
