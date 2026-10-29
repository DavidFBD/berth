import Link from "next/link";
import type { ReactNode } from "react";
import { BerthMark } from "@/components/berth-mark";
import { SignOutButton, SignOutEverywhereButton, StaffKeepAlive } from "@/components/staff/fresh";
import { COPY } from "@/lib/copy";
import type { StaffContext } from "@/lib/server/staff-gate";
import { cn } from "@/lib/utils";

/**
 * The staff area's frame: the mark, the role, the sections as a segmented
 * row (the active one in ink), and the note that everything here is
 * logged. A page renders it only after staffGate let it in, so nothing
 * of it reaches anyone else. The campaigns branch renders its page inside
 * it too: <StaffShell staff={staff} active="campaigns">.
 */

export const STAFF_SECTIONS = [
  { id: "overview", href: "/staff" },
  { id: "users", href: "/staff/users" },
  { id: "health", href: "/staff/health" },
  { id: "budgets", href: "/staff/budgets" },
  { id: "campaigns", href: "/staff/campaigns" },
  { id: "posts", href: "/staff/posts" },
  { id: "feedback", href: "/staff/feedback" },
  { id: "emails", href: "/staff/emails" },
  { id: "audit", href: "/staff/audit" },
] as const;

export type StaffSectionId = (typeof STAFF_SECTIONS)[number]["id"];

export function StaffShell({ staff, active, children }: { staff: StaffContext; active: StaffSectionId; children: ReactNode }) {
  const words = COPY.staff;
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 w-full max-w-[1240px] items-center gap-3 px-4 lg:px-8">
          <Link href="/staff" className="inline-flex items-center gap-2 text-foreground">
            <BerthMark className="size-6" title="Berth" />
            <span className="font-wordmark text-[17px]">{COPY.brand}</span>
          </Link>
          <span className="text-[13.5px] text-muted-foreground">{words.title}</span>
          <span className="inline-flex h-5 items-center rounded-full border border-border px-2 text-[11.5px] text-secondary-foreground">
            {words.role[staff.role]}
          </span>
          <div className="flex-1" />
          <SignOutButton />
          <SignOutEverywhereButton />
          <StaffKeepAlive />
        </div>
        <nav aria-label={words.title} className="mx-auto w-full max-w-[1240px] overflow-x-auto px-4 pb-2.5 lg:px-8">
          <ul className="flex w-max gap-1">
            {STAFF_SECTIONS.map((section) => (
              <li key={section.id}>
                <Link
                  href={section.href}
                  aria-current={section.id === active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-8 items-center rounded-full px-3.5 text-[13.5px] transition-colors duration-150 ease-lift",
                    section.id === active ? "bg-foreground text-background" : "text-secondary-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  {words.nav[section.id]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-5 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      <footer className="mx-auto w-full max-w-[1240px] px-4 pb-8 text-[12px] text-muted-foreground lg:px-8">{words.loggedNote}</footer>
    </div>
  );
}
