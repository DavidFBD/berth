import Link from "next/link";
import { notFound } from "next/navigation";
import { StaffShell } from "@/components/staff/shell";
import { Facts, PageTitle, StaffSection, Table, Tag } from "@/components/staff/ui";
import { RevealField, StaffAction } from "@/components/staff/actions";
import { ValueChart } from "@/components/staff/value-chart";
import { COPY } from "@/lib/copy";
import { staffGate, recordStaff } from "@/lib/server/staff-gate";
import { userDetail } from "@/lib/server/staff/users";
import { count, day, listingName, shortId, usd, when } from "@/lib/staff/format";
import { SWITCHABLE_KINDS } from "@/lib/email-kinds";

/**
 * One account, as staff may see it: everything the ledger holds about it,
 * identifiers masked, each view recorded in staff_audit before anything is
 * read. Writes and reveals are the audited actions beside each part.
 */
export default async function StaffUserPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await staffGate("page");
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  await recordStaff(staff, "view_user", `user:${id.toLowerCase()}`);
  const user = await userDetail(id);
  if (!user) notFound();
  const words = COPY.staff;
  const w = words.user;
  const admin = staff.role === "admin";
  const canAct = admin;

  return (
    <StaffShell staff={staff} active="users">
      <div className="flex flex-col gap-2">
        <Link href="/staff/users" className="text-[13px] text-secondary-foreground underline-offset-4 hover:underline">
          {w.back}
        </Link>
        <PageTitle
          title={user.handle ?? words.users.noUsername}
          sub={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                {w.accountId} <span className="font-money text-foreground">{user.id}</span>
              </span>
              <span>
                {w.joined} {day(user.createdAt)}
              </span>
              <span>
                {w.stage} {words.overview.stage[user.stage]}
              </span>
              <span>
                {w.rank} {user.rank.name}, {count(user.xp)} XP
              </span>
              <span>{w.viewLogged}</span>
            </span>
          }
        />
        {user.retiredInto && (
          <p className="text-[13.5px] text-foreground">
            {w.retired}{" "}
            <Link href={`/staff/users/${user.retiredInto}`} className="underline underline-offset-4">
              {w.openSurvivor}
            </Link>
          </p>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <StaffSection title={w.identities} hint={w.identitiesNote}>
          <Table
            rows={user.identities}
            rowKey={(row) => row.id ?? `${row.kind}:${row.masked}`}
            empty={words.none}
            columns={[
              { key: "kind", label: "", render: (row) => (row.kind === "email" ? w.kind.email : `${w.kind.wallet}, ${row.family ?? ""}`) },
              {
                key: "value",
                label: "",
                render: (row) => (
                  <RevealField
                    masked={row.masked}
                    what={row.kind}
                    canReveal={canAct}
                    payload={row.id ? { userId: user.id, identityId: row.id } : { userId: user.id, column: row.kind }}
                  />
                ),
              },
              {
                key: "flags",
                label: "",
                render: (row) => (
                  <span className="flex gap-1">
                    {row.primary && <Tag>{w.primary}</Tag>}
                    {row.home && <Tag>{w.home}</Tag>}
                    {row.unlinkedAt && <Tag>{w.unlinked}</Tag>}
                  </span>
                ),
              },
              { key: "proof", label: w.proof, render: (row) => (row.proof === "column" ? w.fromColumn : row.proof) },
              { key: "at", label: w.since, render: (row) => day(row.verifiedAt ?? row.createdAt) },
            ]}
          />
        </StaffSection>

        <StaffSection title={w.email}>
          <div className="flex flex-col gap-4">
            <Facts
              rows={[
                { label: w.primaryEmail, value: user.email.primary ?? w.noEmail },
                { label: words.health.suppressions, value: user.email.suppressed ? w.suppressed(user.email.suppressed.reason) : w.deliverable },
                ...SWITCHABLE_KINDS.map((kind) => ({ label: w.pref[kind], value: user.email.prefs[kind] ? w.on : w.off })),
              ]}
            />
            {user.email.suppressed && !user.email.suppressed.removable ? (
              <p className="text-[12.5px] text-muted-foreground">{w.suppressionHolds}</p>
            ) : (
              canAct &&
              user.email.primary && (
                <div>
                  <StaffAction action={user.email.suppressed ? "unsuppress" : "suppress"} payload={{ userId: user.id }} />
                </div>
              )
            )}
            <Table
              rows={user.email.sends}
              rowKey={(row) => row.id}
              empty={words.none}
              columns={[
                { key: "type", label: words.health.type, render: (row) => row.type },
                { key: "status", label: w.status, render: (row) => (row.stuck ? <Tag tone="low">{w.stuck}</Tag> : row.status) },
                { key: "error", label: "", render: (row) => <span title={row.error ?? undefined} className="inline-block max-w-[110px] truncate align-bottom font-money text-[12px] text-muted-foreground">{row.error ?? ""}</span> },
                { key: "tries", label: "", render: (row) => w.attempts(row.attempts) },
                { key: "at", label: words.audit.at, render: (row) => day(row.at) },
                { key: "retry", label: "", render: (row) => (row.stuck && canAct ? <StaffAction action="retry" payload={{ sendId: row.id }} /> : null) },
              ]}
            />
          </div>
        </StaffSection>
      </div>

      <StaffSection title={w.portfolio} hint={w.portfolioNote}>
        {user.portfolio.history.length >= 2 ? (
          <div className="flex flex-col gap-4">
            <ValueChart days={user.portfolio.history} />
            {user.portfolio.latest && (
              <Table
                rows={user.portfolio.latest.holdings}
                rowKey={(row) => row.symbol}
                columns={[
                  { key: "name", label: w.latestClose(day(user.portfolio.latest.day)), render: (row) => (<span>{listingName(row.symbol)} <span className="font-money text-[12px] text-muted-foreground">{row.symbol}</span></span>) },
                  { key: "q", label: "", align: "right", mono: true, render: (row) => row.quantity.toLocaleString("en-US", { maximumFractionDigits: 6 }) },
                  { key: "v", label: "", align: "right", mono: true, render: (row) => (row.price === null ? "…" : usd(row.price * row.quantity)) },
                ]}
              />
            )}
          </div>
        ) : user.portfolio.latest ? (
          <p className="text-[13.5px] text-foreground">
            {usd(user.portfolio.latest.valueUsd)} <span className="text-muted-foreground">{w.latestClose(day(user.portfolio.latest.day))}</span>
          </p>
        ) : (
          <p className="text-[13.5px] text-muted-foreground">{w.noPortfolio}</p>
        )}
      </StaffSection>

      <StaffSection title={`${w.orders}, ${w.ordersCount(user.orders.length, user.ordersTotal)}`}>
        <Table
          rows={user.orders}
          rowKey={(row) => row.id}
          empty={words.none}
          columns={[
            { key: "at", label: words.audit.at, render: (row) => when(row.at) },
            { key: "side", label: "", render: (row) => w.side[row.direction as "buy" | "sell"] ?? row.direction },
            { key: "name", label: words.overview.listing, render: (row) => (<span>{listingName(row.symbol)} <span className="font-money text-[12px] text-muted-foreground">{row.symbol}</span></span>) },
            { key: "q", label: "", align: "right", mono: true, render: (row) => (row.quantity === null ? "…" : row.quantity.toLocaleString("en-US", { maximumFractionDigits: 6 })) },
            { key: "usd", label: words.overview.volumeCol, align: "right", mono: true, render: (row) => usd(row.usd) },
            { key: "pay", label: w.paidWith, render: (row) => [row.paySymbol, row.payChain].filter(Boolean).join(", ") },
            { key: "type", label: "", render: (row) => (row.type === "limit" ? <Tag>{w.limitOrders}</Tag> : null) },
            { key: "tx", label: "", mono: true, render: (row) => <span className="text-muted-foreground">{row.tx}</span> },
          ]}
        />
      </StaffSection>

      <div className="grid gap-5 lg:grid-cols-2">
        <StaffSection title={w.limitOrders}>
          <Table
            rows={user.limitOrders}
            rowKey={(row) => row.id}
            empty={words.none}
            columns={[
              { key: "at", label: words.audit.at, render: (row) => day(row.placedAt) },
              { key: "side", label: "", render: (row) => w.side[row.direction as "buy" | "sell"] ?? row.direction },
              { key: "name", label: words.overview.listing, render: (row) => listingName(row.symbol) },
              { key: "price", label: w.limitPrice, align: "right", mono: true, render: (row) => usd(row.limitPrice) },
              { key: "status", label: w.status, render: (row) => row.status },
              { key: "exp", label: w.expires, render: (row) => (row.expiresAt ? day(row.expiresAt) : words.none) },
            ]}
          />
        </StaffSection>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <StaffSection title={w.assistants}>
          <div className="flex flex-col gap-3">
            <Table
              rows={user.assistants.grants}
              rowKey={(row) => row.id}
              empty={w.noGrants}
              columns={[
                { key: "client", label: w.client, render: (row) => row.client ?? "…" },
                { key: "scope", label: w.scope, mono: true, render: (row) => row.scope },
                { key: "since", label: w.since, render: (row) => day(row.createdAt) },
                { key: "used", label: w.lastUsed, render: (row) => (row.lastUsedAt ? when(row.lastUsedAt) : words.none) },
                {
                  key: "state",
                  label: "",
                  render: (row) =>
                    row.revokedAt ? <Tag>{w.revoked}</Tag> : canAct ? <StaffAction action="revoke" payload={{ userId: user.id, grantId: row.id }} /> : <Tag>{w.live}</Tag>,
                },
              ]}
            />
            <p className="text-[12.5px] text-muted-foreground">
              {w.usage30(user.assistants.mcpCalls30, user.assistants.chat30.messages, usd(user.assistants.chat30.costMicros / 1_000_000, 4))}
            </p>
          </div>
        </StaffSection>

        <StaffSection title={w.social}>
          <div className="flex flex-col gap-3">
            <Facts
              rows={[
                { label: w.friends, value: count(user.friends) },
                { label: w.salutes, value: count(user.salutes) },
                {
                  label: w.referredBy,
                  value: user.referredBy ? (
                    <Link href={`/staff/users/${user.referredBy.id}`} className="underline underline-offset-4">
                      {user.referredBy.handle ?? shortId(user.referredBy.id)}
                    </Link>
                  ) : (
                    words.none
                  ),
                },
                { label: w.referralsOut, value: `${count(user.referralsOut.total)}, ${w.referralsOutBuys(user.referralsOut.firstBuys)}` },
              ]}
            />
            {user.referralsOut.rows.length > 0 && (
              <ul className="flex flex-wrap gap-2 text-[13px]">
                {user.referralsOut.rows.map((row) => (
                  <li key={row.id}>
                    <Link href={`/staff/users/${row.id}`} className="underline underline-offset-4">
                      {row.handle ?? shortId(row.id)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </StaffSection>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <StaffSection title={w.profile}>
          <div className="flex flex-col gap-3">
            <p className="text-[13.5px] text-foreground">
              {user.profile
                ? user.profile.visible
                  ? w.profileVisible
                  : (user.profile.byStaff ? w.profileHiddenByStaff : w.profileHidden)(user.profile.hiddenAt ? day(user.profile.hiddenAt) : null)
                : w.noProfile}
            </p>
            {canAct && user.profile?.visible && <StaffAction action="hide" payload={{ userId: user.id }} />}
            {canAct && user.profile && !user.profile.visible && user.profile.byStaff && <StaffAction action="unhide" payload={{ userId: user.id }} />}
            {user.profile && !user.profile.visible && !user.profile.byStaff && <p className="text-[12.5px] text-muted-foreground">{w.profileOwnHide}</p>}
          </div>
        </StaffSection>
        <StaffSection title={w.campaign}>
          <div className="flex flex-col gap-3">
            <p className="text-[13.5px] text-foreground">{user.campaign.ineligibleAt ? w.ineligibleSince(day(user.campaign.ineligibleAt)) : w.eligible}</p>
            {canAct && <StaffAction action={user.campaign.ineligibleAt ? "eligible" : "ineligible"} payload={{ userId: user.id }} />}
            <Link href="/staff/campaigns" className="text-[13px] text-secondary-foreground underline underline-offset-4">
              {w.campaignLink}
            </Link>
          </div>
        </StaffSection>
        <StaffSection title={w.firstLook}>
          <p className="text-[13.5px] text-foreground">{user.firstStockClosedAt ? w.firstLookClosed(day(user.firstStockClosedAt)) : w.firstLookOpen}</p>
        </StaffSection>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <StaffSection title={w.xp}>
          <Table
            rows={user.xpEvents}
            rowKey={(row) => `${row.kind}:${row.at}`}
            empty={words.none}
            columns={[
              { key: "at", label: words.audit.at, render: (row) => when(row.at) },
              { key: "kind", label: words.audit.action, mono: true, render: (row) => row.kind },
              { key: "amount", label: "", align: "right", mono: true, render: (row) => `+${count(row.amount)}` },
            ]}
          />
        </StaffSection>
        <StaffSection title={w.history}>
          <div className="flex flex-col gap-4">
            {user.merges.length > 0 && (
              <Table
                rows={user.merges}
                rowKey={(row) => row.id}
                columns={[
                  { key: "at", label: w.merges, render: (row) => day(row.createdAt) },
                  { key: "role", label: "", render: (row) => w.mergeRole[row.role] },
                  {
                    key: "other",
                    label: "",
                    render: (row) => (
                      <Link href={`/staff/users/${row.otherId}`} className="font-money underline underline-offset-4">
                        {shortId(row.otherId)}
                      </Link>
                    ),
                  },
                  { key: "status", label: w.status, render: (row) => `${row.reason}, ${row.status}` },
                ]}
              />
            )}
            <Table
              rows={user.accountAudit}
              rowKey={(row) => `${row.action}:${row.createdAt}`}
              empty={w.auditEmpty}
              columns={[
                { key: "at", label: words.audit.at, render: (row) => when(row.createdAt) },
                { key: "action", label: words.audit.action, mono: true, render: (row) => row.action },
                { key: "detail", label: words.audit.detail, render: (row) => <span className="font-money text-[12px] text-muted-foreground">{JSON.stringify(row.detail).slice(0, 120)}</span> },
              ]}
            />
          </div>
        </StaffSection>
      </div>
    </StaffShell>
  );
}
