import { StaffShell } from "@/components/staff/shell";
import { PageTitle, StaffSection, Table, Tag } from "@/components/staff/ui";
import { COPY } from "@/lib/copy";
import { autopostEnabled } from "@/lib/x-autopost";
import { staffGate } from "@/lib/server/staff-gate";
import { readAutopostLog } from "@/lib/server/x-autopost";
import { tokenStatus } from "@/lib/server/x-oauth";
import { when } from "@/lib/staff/format";

const iso = (ms: number | undefined) => (ms === undefined ? null : new Date(ms).toISOString());

/** The staff Posts page: every automatic post on X and how it ended (lib/server/x-autopost). Read only. */
export default async function StaffPostsPage() {
  const staff = await staffGate("page");
  const p = COPY.staff.posts;
  const [rows, token] = await Promise.all([readAutopostLog(), tokenStatus()]);
  const tone = (status: string) => (status === "posted" ? "good" : status === "failed" || status === "unknown" ? "low" : "plain");

  return (
    <StaffShell staff={staff} active="posts">
      <PageTitle title={p.title} sub={p.note} />
      <div className="grid gap-5">
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4 text-[13px] text-secondary-foreground">
          <span>{autopostEnabled() ? p.on : p.off}</span>
          <span>{!token.stored ? p.tokenNone : token.unreadable ? p.tokenUnreadable : token.dead ? p.tokenDead : p.tokenRefreshed(when(iso(token.refreshedAt)))}</span>
          {token.lastError && <span>{p.tokenError(token.lastError)}</span>}
        </div>
        <StaffSection title={p.title}>
          <Table
            rows={rows}
            rowKey={(row) => String(row.id)}
            empty={p.empty}
            columns={[
              { key: "at", label: p.at, render: (row) => when(iso(row.at)) },
              { key: "source", label: p.source, render: (row) => (row.source ? (p.sources[row.source] ?? row.source) : "…") },
              {
                key: "status",
                label: p.status,
                render: (row) => <Tag tone={tone(row.status)}>{p.statuses[row.status] ?? row.status}</Tag>,
              },
              {
                key: "text",
                label: p.text,
                className: "whitespace-normal max-w-[520px]",
                render: (row) => (
                  <span className="flex flex-col gap-1">
                    <span className="break-words">{row.text ?? ""}</span>
                    {row.detail && <span className="font-money text-[12px] break-words text-muted-foreground">{row.detail}</span>}
                  </span>
                ),
              },
              {
                key: "link",
                label: p.link,
                render: (row) =>
                  row.tweetId ? (
                    <a
                      href={`https://x.com/berthmarkets/status/${encodeURIComponent(row.tweetId)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline-offset-4 hover:underline"
                    >
                      {p.open}
                    </a>
                  ) : null,
              },
            ]}
          />
        </StaffSection>
      </div>
    </StaffShell>
  );
}
