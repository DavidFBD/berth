import Link from "next/link";
import { StaffShell } from "@/components/staff/shell";
import { PageTitle, StaffSection, Table, Tag } from "@/components/staff/ui";
import { buttonVariants } from "@/components/ui/button";
import { COPY } from "@/lib/copy";
import { staffGate, recordStaff } from "@/lib/server/staff-gate";
import { clampInt, classifySearch, listUsers, type UserFilters } from "@/lib/server/staff/users";
import { openSearch, staffSessionKey } from "@/lib/server/staff-session";
import type { StageName } from "@/lib/server/staff/overview";
import { count, day } from "@/lib/staff/format";
import { cn } from "@/lib/utils";

type Params = Record<string, string | string[] | undefined>;
const one = (params: Params, key: string) => (typeof params[key] === "string" ? (params[key] as string) : null);
const STAGES: StageName[] = ["none", "funded", "owns"];

/** The staff Users list: search, filters, one page of fifty, every identifier masked. */
export default async function StaffUsersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const staff = await staffGate("page");
  const words = COPY.staff;
  const u = words.users;
  const params = await searchParams;
  const stage = one(params, "stage");
  // A personal search arrives sealed (app/api/staff/search); a username prefix arrives as is.
  const sealed = one(params, "find");
  const opened = sealed ? await openSearch(sealed, staffSessionKey(), staff.userId) : null;
  const plain = one(params, "q");
  const filters: UserFilters = {
    q: opened ?? (plain && classifySearch(plain).kind === "username" ? plain : sealed ? "@" : null),
    stage: STAGES.includes(stage as StageName) ? (stage as StageName) : null,
    from: one(params, "from"),
    to: one(params, "to"),
    hasEmail: one(params, "email") === "1" ? true : null,
    referred: one(params, "referred") === "1" ? true : null,
    hidden: one(params, "hidden") === "1" ? true : null,
    ineligible: one(params, "ineligible") === "1" ? true : null,
    campaign: one(params, "campaign") === "1" ? true : null,
    page: clampInt(one(params, "page"), 1, 1, 10_000),
  };
  const search = classifySearch(filters.q);
  const page = await listUsers(filters);
  // A lookup by something personal is itself recorded: the kind and the
  // account(s) it found, never the value typed.
  if (search.kind === "email" || search.kind === "wallet" || search.kind === "id") {
    const matched = page.rows.map((row) => row.id).slice(0, 5);
    await recordStaff(staff, "search_exact", matched.length === 1 ? `user:${matched[0]}` : null, { kind: search.kind, matched });
  }
  const link = (pageNumber: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (typeof value === "string" && key !== "page") next.set(key, value);
    next.set("page", String(pageNumber));
    return `/staff/users?${next.toString()}`;
  };
  const field = "h-8 rounded-lg border border-input bg-card px-2.5 text-[13.5px] text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

  return (
    <StaffShell staff={staff} active="users">
      <PageTitle title={u.title} sub={u.searchHint} />
      <form method="post" action="/api/staff/search" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="staff-q">
            {u.searchLabel}
          </label>
          <input id="staff-q" name="q" defaultValue={filters.q ?? ""} placeholder={u.searchPlaceholder} autoComplete="off" spellCheck={false} className={cn(field, "w-full sm:max-w-md")} />
          <button type="submit" className={cn(buttonVariants(), "rounded-full")}>
            {u.search}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-secondary-foreground">
          <label className="flex items-center gap-2">
            {u.stage}
            <select name="stage" defaultValue={filters.stage ?? ""} className={field}>
              <option value="">{u.anyStage}</option>
              {STAGES.map((value) => (
                <option key={value} value={value}>
                  {words.overview.stage[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            {u.from}
            <input type="date" name="from" defaultValue={filters.from ?? ""} className={field} />
          </label>
          <label className="flex items-center gap-2">
            {u.to}
            <input type="date" name="to" defaultValue={filters.to ?? ""} className={field} />
          </label>
          {(
            [
              ["email", u.hasEmail, filters.hasEmail],
              ["referred", u.referred, filters.referred],
              ["hidden", u.hidden, filters.hidden],
              ["ineligible", u.ineligible, filters.ineligible],
              ["campaign", u.campaignAttributed, filters.campaign],
            ] as const
          ).map(([name, label, on]) => (
            <label key={name} className="flex items-center gap-1.5">
              <input type="checkbox" name={name} value="1" defaultChecked={Boolean(on)} className="size-4 accent-foreground" />
              {label}
            </label>
          ))}
          <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            {u.apply}
          </button>
          <Link href="/staff/users" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            {u.clear}
          </Link>
        </div>
      </form>

      <StaffSection title={u.page(page.page, page.pages, page.total)}>
        {page.search === "invalid" ? (
          <p className="py-2 text-[13.5px] text-muted-foreground">{u.invalid}</p>
        ) : (
          <Table
            rows={page.rows}
            rowKey={(row) => row.id}
            empty={u.empty}
            columns={[
              {
                key: "handle",
                label: u.username,
                render: (row) => (
                  <Link href={`/staff/users/${row.id}`} className="underline-offset-4 hover:underline">
                    {row.handle ?? <span className="text-muted-foreground">{u.noUsername}</span>}
                  </Link>
                ),
              },
              { key: "joined", label: u.joined, render: (row) => day(row.createdAt) },
              { key: "stage", label: u.stage, render: (row) => words.overview.stage[row.stage] },
              { key: "rank", label: u.rank, render: (row) => row.rank },
              { key: "xp", label: u.xp, align: "right", mono: true, render: (row) => count(row.xp) },
              { key: "orders", label: u.orders, align: "right", mono: true, render: (row) => count(row.orders) },
              { key: "email", label: u.email, mono: true, render: (row) => row.email ?? <span className="text-muted-foreground">{words.none}</span> },
              { key: "wallet", label: u.wallet, mono: true, render: (row) => row.wallet ?? <span className="text-muted-foreground">{words.none}</span> },
              {
                key: "flags",
                label: u.flags,
                render: (row) => (
                  <span className="flex gap-1">
                    {row.referred && <Tag>{u.flag.referred}</Tag>}
                    {row.hidden && <Tag>{u.flag.hidden}</Tag>}
                    {row.ineligible && <Tag>{u.flag.ineligible}</Tag>}
                  </span>
                ),
              },
            ]}
          />
        )}
        {page.pages > 1 && (
          <div className="mt-4 flex gap-2">
            {page.page > 1 && (
              <Link href={link(page.page - 1)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                {u.previous}
              </Link>
            )}
            {page.page < page.pages && (
              <Link href={link(page.page + 1)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                {u.next}
              </Link>
            )}
          </div>
        )}
      </StaffSection>
    </StaffShell>
  );
}
