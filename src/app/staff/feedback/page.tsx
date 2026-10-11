import Link from "next/link";
import { StaffShell } from "@/components/staff/shell";
import { PageTitle, StaffSection } from "@/components/staff/ui";
import { FeedbackList } from "@/components/staff/feedback-list";
import { COPY } from "@/lib/copy";
import { staffGate } from "@/lib/server/staff-gate";
import { listFeedback, type FeedbackRow } from "@/lib/server/feedback";
import { cn } from "@/lib/utils";

type Params = Record<string, string | string[] | undefined>;
const STATUSES = ["new", "read", "fixed"] as const;

/** The staff Feedback page: what people wrote from the feedback sheet, newest first (lib/server/feedback). */
export default async function StaffFeedbackPage({ searchParams }: { searchParams: Promise<Params> }) {
  const staff = await staffGate("page");
  const words = COPY.staff.feedback;
  const params = await searchParams;
  const status = STATUSES.find((value) => value === params.status) as FeedbackRow["status"] | undefined;
  const rows = await listFeedback({ limit: 200, status });
  const filters = [{ id: "all", href: "/staff/feedback", on: !status }, ...STATUSES.map((value) => ({ id: value, href: `/staff/feedback?status=${value}`, on: status === value }))];

  return (
    <StaffShell staff={staff} active="feedback">
      <PageTitle title={words.title} sub={words.sub} />
      <StaffSection
        title={words.title}
        action={
          <div className="flex gap-1">
            {filters.map((filter) => (
              <Link
                key={filter.id}
                href={filter.href}
                aria-current={filter.on ? "page" : undefined}
                className={cn(
                  "inline-flex h-7 items-center rounded-full px-3 text-[12.5px] transition-colors duration-150 ease-lift",
                  filter.on ? "bg-foreground text-background" : "text-secondary-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {words.filters[filter.id as keyof typeof words.filters]}
              </Link>
            ))}
          </div>
        }
      >
        <FeedbackList rows={rows} canAct={staff.role === "admin"} />
      </StaffSection>
    </StaffShell>
  );
}
