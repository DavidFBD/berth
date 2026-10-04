import type { Metadata } from "next";
import Link from "next/link";
import { BerthMark } from "@/components/berth-mark";
import { buttonVariants } from "@/components/ui/button";
import { COPY } from "@/lib/copy";
import { readUnsubscribeToken } from "@/lib/server/email/token";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `${COPY.email.unsubscribePage.title} · Berth`,
  robots: { index: false, follow: false },
  // The token is in this page's address: never hand it on to a link's host.
  referrer: "no-referrer",
};

/**
 * The one screen an email's "Turn these off" link opens. Opening it
 * changes nothing (mail scanners open links); its button posts to
 * /api/email/unsubscribe, which flips the switch and comes back here with
 * `s` saying what happened. Reads the token only to name the kind.
 */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string; s?: string }> }) {
  const { t = "", s } = await searchParams;
  const words = COPY.email.unsubscribePage;
  const claims = await readUnsubscribeToken(t);
  const action = `/api/email/unsubscribe?t=${encodeURIComponent(t)}`;
  const retired = claims !== null && "retired" in claims;
  const kind = claims && !("retired" in claims) ? words.kindName[claims.kind] : null;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col px-5 pt-10 pb-[max(env(safe-area-inset-bottom),3rem)] sm:pt-14">
      <Link href="/" className="inline-flex items-center gap-2.5 text-foreground" aria-label={words.backHome}>
        <BerthMark className="size-7" title="Berth" />
        <span className="font-wordmark text-lg">{COPY.brand}</span>
      </Link>

      <section className="mt-10 flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:p-6">
        <h1 className="font-display text-2xl tracking-[-0.02em] text-foreground">{words.title}</h1>
        {retired ? (
          <p className="text-[15px] leading-relaxed text-foreground">{words.retired}</p>
        ) : !kind ? (
          <p className="text-[15px] leading-relaxed text-foreground">{words.invalid}</p>
        ) : s === "off" ? (
          <>
            <p className="text-[15px] leading-relaxed text-foreground">{words.done(kind)}</p>
            <p className="text-sm text-muted-foreground">{words.doneSub}</p>
            <form method="post" action={action}>
              <input type="hidden" name="action" value="on" />
              <button type="submit" className={cn(buttonVariants({ variant: "outline" }), "rounded-full")}>
                {words.turnBackOn}
              </button>
            </form>
          </>
        ) : s === "on" ? (
          <p className="text-[15px] leading-relaxed text-foreground">{words.backOn(kind)}</p>
        ) : (
          <>
            <p className="text-[15px] leading-relaxed text-foreground">{words.confirm(kind)}</p>
            <p className="text-sm text-muted-foreground">{words.confirmSub}</p>
            {s === "failed" ? <p className="text-sm text-destructive">{COPY.email.settings.saveFailed}</p> : null}
            <form method="post" action={action}>
              <input type="hidden" name="action" value="off" />
              <button type="submit" className={cn(buttonVariants(), "rounded-full")}>
                {words.confirmButton}
              </button>
            </form>
          </>
        )}
      </section>

      <Link href="/" className="mt-6 self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
        {words.backHome}
      </Link>
    </main>
  );
}
