import Link from "next/link";
import { StaffShell } from "@/components/staff/shell";
import { Bars, Facts, PageTitle, StaffSection, Stat, StatGrid, Table } from "@/components/staff/ui";
import { COPY } from "@/lib/copy";
import { staffGate } from "@/lib/server/staff-gate";
import { readOverview } from "@/lib/server/staff/overview";
import { readBudgets } from "@/lib/server/staff/budgets";
import { unreadFeedbackCount } from "@/lib/server/feedback";
import { count, day, listingName, percent, shortDay, usd } from "@/lib/staff/format";

/** The PostHog project, for product analytics (lib/analytics); the EU app when no project is named. */
const POSTHOG_PROJECT_URL = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_URL || "https://eu.posthog.com";

/** The staff Overview: the userbase and the business, from the ledger (lib/server/staff/overview). */
export default async function StaffOverviewPage() {
  const staff = await staffGate("page");
  const words = COPY.staff;
  const o = words.overview;
  const [overview, budgets, unread] = await Promise.all([readOverview(), readBudgets(), unreadFeedbackCount().catch(() => 0)]);
  const low = budgets.filter((service) => service.low);
  const accounts = overview.stages.none + overview.stages.funded + overview.stages.owns;
  const daily = overview.signupsDaily;
  const weekly = overview.signupsWeekly;
  const orders = overview.ordersDaily;
  const recentOrders = [...orders].reverse().slice(0, 7);

  return (
    <StaffShell staff={staff} active="overview">
      <PageTitle
        title={o.title}
        sub={
          <span className="flex flex-col gap-1">
            <a href={POSTHOG_PROJECT_URL} target="_blank" rel="noopener noreferrer" className="self-start underline underline-offset-4 hover:text-foreground">
              {o.posthog}
            </a>
            <span>{o.posthogChecklist}</span>
          </span>
        }
      />
      {low.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-[14px] text-foreground">
          <span>{words.lowStrip(low.map((service) => words.budgets.service[service.id]).join(", "))}</span>
          <Link href="/staff/budgets" className="underline underline-offset-4">
            {words.lowStripLink}
          </Link>
        </div>
      )}
      {unread > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-card px-4 py-3 text-[14px] text-foreground">
          <span>{words.feedback.strip(unread)}</span>
          <Link href="/staff/feedback?status=new" className="underline underline-offset-4">
            {words.feedback.stripLink}
          </Link>
        </div>
      )}
      <StatGrid>
        <Stat label={o.accounts} value={count(accounts)} />
        <Stat label={o.active7} value={count(overview.active.d7)} sub={percent(overview.active.d7, accounts)} />
        <Stat label={o.active30} value={count(overview.active.d30)} sub={percent(overview.active.d30, accounts)} />
        <Stat label={o.holdings} value={usd(overview.holdings.totalUsd, 0)} sub={overview.holdings.asOf ? day(overview.holdings.asOf) : words.none} />
        <Stat label={o.volume30} value={usd(overview.volume.d30.volumeUsd, 0)} sub={words.units.orders(overview.volume.d30.orders)} />
        <Stat label={o.fee30} value={usd(overview.volume.d30.feeEstimateUsd)} sub={o.allTime(usd(overview.volume.all.feeEstimateUsd))} />
      </StatGrid>

      <div className="grid gap-5 lg:grid-cols-2">
        <StaffSection title={o.signups} hint={o.accountsNote}>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <p className="text-[12.5px] text-muted-foreground">
                {o.signupsDaily}, <span className="font-money text-foreground">{count(daily.reduce((sum, row) => sum + row.n, 0))}</span>
              </p>
              <Bars accent values={daily.map((row) => row.n)} labels={[shortDay(daily[0].day), shortDay(daily[daily.length - 1].day)]} />
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-[12.5px] text-muted-foreground">
                {o.signupsWeekly}, <span className="font-money text-foreground">{count(weekly.reduce((sum, row) => sum + row.n, 0))}</span>
              </p>
              <Bars values={weekly.map((row) => row.n)} labels={[shortDay(weekly[0].day), shortDay(weekly[weekly.length - 1].day)]} />
            </div>
          </div>
        </StaffSection>

        <StaffSection title={o.stages} hint={o.stagesNote}>
          <div className="flex flex-col gap-4">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-secondary" aria-hidden="true">
              {(["owns", "funded", "none"] as const).map((stage, index) => (
                <span
                  key={stage}
                  style={{ width: `${accounts ? (100 * overview.stages[stage]) / accounts : 0}%`, opacity: [0.9, 0.5, 0.18][index] }}
                  className="h-full bg-foreground"
                />
              ))}
            </div>
            <Facts
              rows={(["owns", "funded", "none"] as const).map((stage) => ({
                label: o.stage[stage],
                value: `${count(overview.stages[stage])}  ${percent(overview.stages[stage], accounts)}`,
              }))}
            />
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">{o.activeNote}</p>
          </div>
        </StaffSection>
      </div>

      <StaffSection title={o.firstBuys} hint={o.firstBuysNote}>
        <div className="flex flex-col gap-4">
          <StatGrid>
            <Stat label={o.firstBuyRate} value={overview.firstBuys.rate === null ? "…" : `${Math.round(overview.firstBuys.rate * 100)}%`} sub={`${count(overview.firstBuys.firstBuys)} of ${count(overview.firstBuys.accounts)}`} />
            <Stat label={o.medianToFirst} value={overview.firstBuys.medianHours === null ? "…" : words.units.hours(overview.firstBuys.medianHours)} />
            <Stat label={o.withinDay} value={count(overview.firstBuys.withinADay)} sub={percent(overview.firstBuys.withinADay, overview.firstBuys.accounts)} />
            <Stat label={o.withinWeek} value={count(overview.firstBuys.withinAWeek)} sub={percent(overview.firstBuys.withinAWeek, overview.firstBuys.accounts)} />
          </StatGrid>
          <Table
            rows={overview.firstBuyWeeks}
            rowKey={(row) => row.week}
            empty={words.none}
            columns={[
              { key: "week", label: o.week, render: (row) => day(row.week) },
              { key: "signups", label: o.signupsCol, align: "right", mono: true, render: (row) => count(row.signups) },
              { key: "buys", label: o.firstBuysCol, align: "right", mono: true, render: (row) => `${count(row.firstBuys)}  ${percent(row.firstBuys, row.signups)}` },
              { key: "day", label: o.withinDay, align: "right", mono: true, render: (row) => count(row.withinADay) },
              { key: "weekin", label: o.withinWeek, align: "right", mono: true, render: (row) => count(row.withinAWeek) },
              { key: "median", label: o.medianToFirst, align: "right", mono: true, render: (row) => (row.medianHours === null ? "…" : o.hoursShort(row.medianHours)) },
              { key: "got", label: o.gotIt, align: "right", mono: true, render: (row) => count(row.gotIt) },
            ]}
          />
        </div>
      </StaffSection>

      <div className="grid gap-5 lg:grid-cols-2">
        <StaffSection title={o.orders} hint={`${o.ordersNote} ${o.feeNote}`}>
          <div className="flex flex-col gap-4">
            <Bars values={orders.map((row) => row.volumeUsd)} labels={[shortDay(orders[0].day), shortDay(orders[orders.length - 1].day)]} />
            <Table
              rows={recentOrders}
              rowKey={(row) => row.day}
              columns={[
                { key: "day", label: o.day, render: (row) => day(row.day) },
                { key: "orders", label: o.ordersCol, align: "right", mono: true, render: (row) => count(row.orders) },
                { key: "buys", label: o.buys, align: "right", mono: true, render: (row) => count(row.buys) },
                { key: "sells", label: o.sells, align: "right", mono: true, render: (row) => count(row.sells) },
                { key: "volume", label: o.volumeCol, align: "right", mono: true, render: (row) => usd(row.volumeUsd) },
                { key: "unpriced", label: o.unpricedCol, align: "right", mono: true, render: (row) => count(row.unpriced) },
              ]}
            />
          </div>
        </StaffSection>

        <StaffSection title={o.topListings}>
          <Table
            rows={overview.topListings}
            rowKey={(row) => row.symbol}
            empty={words.none}
            columns={[
              { key: "name", label: o.listing, render: (row) => (<span>{listingName(row.symbol)} <span className="font-money text-[12px] text-muted-foreground">{row.symbol}</span></span>) },
              { key: "buyers", label: o.buyers, align: "right", mono: true, render: (row) => count(row.buyers) },
              { key: "orders", label: o.ordersCol, align: "right", mono: true, render: (row) => count(row.orders) },
              { key: "volume", label: o.volumeCol, align: "right", mono: true, render: (row) => usd(row.volumeUsd, 0) },
            ]}
          />
        </StaffSection>
      </div>

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <StaffSection title={o.retention} hint={o.retentionNote}>
          <Table
            rows={overview.retention}
            rowKey={(row) => row.week}
            empty={words.none}
            columns={[
              { key: "week", label: o.week, render: (row) => day(row.week) },
              { key: "signups", label: o.signupsCol, align: "right", mono: true, render: (row) => count(row.signups) },
              { key: "w1", label: o.orderedWeek1, align: "right", mono: true, render: (row) => `${count(row.orderedWeek1)}  ${percent(row.orderedWeek1, row.signups)}` },
              { key: "w25", label: o.orderedLater, align: "right", mono: true, render: (row) => `${count(row.orderedWeeks2to5)}  ${percent(row.orderedWeeks2to5, row.signups)}` },
              { key: "a30", label: o.active30Col, align: "right", mono: true, render: (row) => `${count(row.active30)}  ${percent(row.active30, row.signups)}` },
            ]}
          />
        </StaffSection>
        <StaffSection title={o.referrals}>
          <Facts
            rows={[
              { label: o.clicks, value: count(overview.referrals.clicks) },
              { label: o.clicks30, value: count(overview.referrals.clicks30) },
              { label: o.referred, value: count(overview.referrals.referredSignups) },
              { label: o.referredBuys, value: count(overview.referrals.referredFirstBuys) },
              { label: o.linkRequests, value: count(overview.referrals.linkRequests) },
              { label: o.linkAccepted, value: count(overview.referrals.linkAccepted) },
            ]}
          />
        </StaffSection>
      </div>
    </StaffShell>
  );
}
