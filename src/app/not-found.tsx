import type { Metadata } from "next";
import Link from "next/link";
import { BerthMark } from "@/components/berth-mark";
import { buttonVariants } from "@/components/ui/button";
import { COPY } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { StaffSessionProbe } from "@/components/staff/fresh";

export const metadata: Metadata = {
  title: `${COPY.notFound.title} · Berth`,
  robots: { index: false, follow: false },
};

/** Any address Berth has no page for: say so plainly, and the way home. */
export default function NotFound() {
  const words = COPY.notFound;
  return (
    <main className="mx-auto flex w-full max-w-md flex-col px-5 pt-10 pb-[max(env(safe-area-inset-bottom),3rem)] sm:pt-14">
      <Link href="/" className="inline-flex items-center gap-2.5 text-foreground" aria-label={words.backHome}>
        <BerthMark className="size-7" title="Berth" />
        <span className="font-wordmark text-lg">{COPY.brand}</span>
      </Link>

      <section className="mt-10 flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:p-6">
        <h1 className="font-display text-2xl tracking-[-0.02em] text-foreground">{words.title}</h1>
        <p className="text-[15px] leading-relaxed text-foreground">{words.body}</p>
        <Link href="/" className={cn(buttonVariants(), "self-start rounded-full")}>
          {words.backHome}
        </Link>
      </section>
      {/* On a /staff address only, a signed in browser asks once whether
          it may come in (components/staff/fresh); for anyone else nothing
          changes. Every 404 is this same page, the staff area's included. */}
      <StaffSessionProbe />
    </main>
  );
}
