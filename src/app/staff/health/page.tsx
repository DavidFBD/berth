import { StaffShell } from "@/components/staff/shell";
import { Facts, PageTitle, StaffSection, Table, Tag } from "@/components/staff/ui";
import { StaffAction } from "@/components/staff/actions";
import { COPY } from "@/lib/copy";
import { staffGate } from "@/lib/server/staff-gate";
import { readHealth } from "@/lib/server/staff/health";
import { stageOutcomes, type CronRun } from "@/lib/server/cron-runs";
import { count, when } from "@/lib/staff/format";

function CronCard({ title, runs }: { title: string; runs: CronRun[] }) {
  const words = COPY.staff.health;
  const last = runs[0];
  return (
    <StaffSection title={title}>
      {!last ? (
        <p className="text-[13.5px] text-muted-foreground">{words.neverRan}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="flex flex-wrap items-center gap-2 text-[13.5px] text-foreground">
            {words.lastRun} {when(last.startedAt)} {last.ok ? <Tag tone="good">{words.ok}</Tag> : <Tag tone="low">{words.failedRun}</Tag>}
          </p>
          <Table
            rows={stageOutcomes(last.summary)}
            rowKey={(row) => row.stage}
            columns={[
              { key: "stage", label: "", render: (row) => words.stage[row.stage] ?? row.stage },
              { key: "ok", label: "", render: (row) => (row.ok ? words.ok : <Tag tone="low">{words.stageFailed}</Tag>) },
              {
                key: "detail",
                label: "",
                render: (row) => (
                  <span className="inline-block max-w-[280px] truncate align-bottom font-money text-[12px] text-muted-foreground">
                    {row.error ?? (row.result ? JSON.stringify(row.result).slice(0, 90) : "")}
                  </span>
                ),
              },
            ]}
          />
          {runs.length > 1 && (
            <p className="text-[12.5px] text-muted-foreground">
              {words.recent}: {runs.slice(1).map((run) => words.runLine(when(run.startedAt), run.ok)).join("; ")}
            </p>
          )}
        </div>
      )}
    </StaffSection>
  );
}

/** The staff Health page: is the machinery running (lib/server/staff/health). */
export default async function StaffHealthPage() {
  const staff = await staffGate("page");
  const words = COPY.staff;
  const h = words.health;
  const health = await readHealth();
  const capFor = (type: string) => (type === "weekly" ? health.email.caps.weekly : null);

  return (
    <StaffShell staff={staff} active="health">
      <PageTitle title={h.title} sub={h.cronNote} />
      <div className="grid gap-5 lg:grid-cols-2">
        <CronCard title={h.job.morning} runs={health.morning} />
        <CronCard title={h.job.evening} runs={health.evening} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <StaffSection title={h.email} hint={h.emailNote}>
          <div className="flex flex-col gap-4">
            <Table
              rows={[...health.email.byType, { type: "__all", going: health.email.total, failed: health.email.byType.reduce((sum, row) => sum + row.failed, 0) }]}
              rowKey={(row) => row.type}
              columns={[
                { key: "type", label: h.type, mono: true, render: (row) => (row.type === "__all" ? h.total : row.type) },
                { key: "going", label: h.sentToday, align: "right", mono: true, render: (row) => count(row.going) },
                { key: "cap", label: h.cap, align: "right", mono: true, render: (row) => (row.type === "__all" ? count(health.email.caps.all) : capFor(row.type) === null ? "" : count(capFor(row.type))) },
                { key: "failed", label: h.failedToday, align: "right", mono: true, render: (row) => count(row.failed) },
              ]}
            />
            <Facts
              rows={
                health.email.suppressions.length
                  ? health.email.suppressions.map((row) => ({ label: `${h.suppressions}, ${h.suppressionReason[row.reason] ?? row.reason}`, value: h.suppressionCount(count(row.n), count(row.last30)) }))
                  : [{ label: h.suppressions, value: count(0) }]
              }
            />
          </div>
        </StaffSection>

        <StaffSection title={h.stuckSends} hint={h.stuckNote}>
          <Table
            rows={health.email.stuck}
            rowKey={(row) => row.id}
            empty={h.noStuck}
            columns={[
              { key: "type", label: h.type, mono: true, render: (row) => row.type },
              { key: "at", label: words.audit.at, render: (row) => when(row.at).replace(/^(\d+ \w+) \d{4},/, "$1,") },
              { key: "tries", label: "", render: (row) => words.user.attempts(row.attempts) },
              { key: "error", label: "", mono: true, render: (row) => <span title={row.error ?? undefined} className="inline-block max-w-[120px] truncate align-bottom text-muted-foreground">{row.error ?? ""}</span> },
              { key: "retry", label: "", render: (row) => (staff.role === "admin" ? <StaffAction action="retry" payload={{ sendId: row.id }} /> : null) },
            ]}
          />
        </StaffSection>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <StaffSection title={h.x}>
          <Facts
            rows={[
              { label: h.xUsed, value: h.ofCap(count(health.x.used), count(health.x.cap)) },
              { label: h.xReserved, value: count(health.x.reserved) },
              { label: h.xStored, value: count(health.x.stored) },
              { label: h.xLastFetch, value: health.x.lastFetch ? when(health.x.lastFetch.at) : words.none },
              { label: h.xFailing, value: count(health.x.failing) },
            ]}
          />
        </StaffSection>
        <StaffSection title={h.claims} hint={h.claimsNote}>
          <div className="flex flex-col gap-3">
            <Facts
              rows={[
                { label: h.claims, value: count(health.waiting.claimsOpen) },
                { label: h.stuckClaims, value: count(health.waiting.claimsStuck.length) },
              ]}
            />
            {health.waiting.claimsStuck.length > 0 && (
              <Table
                rows={health.waiting.claimsStuck}
                rowKey={(row) => row.tx}
                columns={[
                  { key: "tx", label: "", mono: true, render: (row) => row.tx },
                  { key: "dir", label: "", render: (row) => words.user.side[row.direction as "buy" | "sell"] ?? row.direction },
                  { key: "at", label: words.audit.at, render: (row) => when(row.at) },
                ]}
              />
            )}
          </div>
        </StaffSection>
        <StaffSection title={h.limits}>
          <Facts
            rows={[
              { label: h.resting, value: count(health.waiting.limits.resting) },
              { label: h.partial, value: count(health.waiting.limits.partial) },
              { label: h.oldestCheck, value: health.waiting.limits.oldestCheckAt ? when(health.waiting.limits.oldestCheckAt) : words.none },
            ]}
          />
        </StaffSection>
      </div>

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <StaffSection title={h.issues} hint={h.issuesNote}>
          {health.issues.state === "off" ? (
            <p className="text-[13.5px] text-muted-foreground">{h.issuesOff}</p>
          ) : health.issues.state === "failed" ? (
            <p className="text-[13.5px] text-muted-foreground">{h.issuesFailed}</p>
          ) : (
            <Table
              rows={health.issues.issues}
              rowKey={(row) => String(row.number)}
              empty={h.noIssues}
              columns={[
                {
                  key: "title",
                  label: "",
                  className: "whitespace-normal",
                  render: (row) => (
                    <a href={row.url} target="_blank" rel="noreferrer noopener" className="underline-offset-4 hover:underline">
                      <span className="font-money text-muted-foreground">#{row.number}</span> {row.title}
                    </a>
                  ),
                },
                { key: "comments", label: "", render: (row) => h.comments(row.comments) },
                { key: "at", label: "", render: (row) => when(row.updatedAt) },
              ]}
            />
          )}
        </StaffSection>
        <div className="flex flex-col gap-5">
          <StaffSection title={h.spend}>
            <p className="text-[13.5px] text-muted-foreground">{h.spendNote}</p>
          </StaffSection>
          <StaffSection title={h.listings}>
            <p className="text-[13.5px] text-muted-foreground">
              <Tag>{words.notTracked}</Tag> {h.listingsNote}
            </p>
          </StaffSection>
        </div>
      </div>
    </StaffShell>
  );
}
