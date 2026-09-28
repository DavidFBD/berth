import type { Metadata } from "next";
import Link from "next/link";
import { BerthMark } from "@/components/berth-mark";
import { COPY } from "@/lib/copy";

export const metadata: Metadata = {
  title: `${COPY.privacyPolicy.title} · Berth`,
  description: COPY.privacyPolicy.intro[0],
  alternates: { canonical: "/privacy" },
};

/**
 * The public privacy policy, required by the assistant directories that
 * list Berth's connector. Server rendered and outside AuthGate, so it reads
 * the same signed in, signed out and to a crawler. The words live in
 * lib/copy (`privacyPolicy`); this file only lays them out.
 */
export default function PrivacyPage() {
  const policy = COPY.privacyPolicy;
  return (
    <main className="mx-auto w-full max-w-2xl px-5 pt-10 pb-[max(env(safe-area-inset-bottom),3rem)] sm:px-8 sm:pt-14">
      <Link href="/" className="inline-flex items-center gap-2.5 text-foreground" aria-label={policy.backHome}>
        <BerthMark className="size-7" title="Berth" />
        <span className="font-display text-lg font-semibold tracking-[-0.012em]">{COPY.brand}</span>
      </Link>

      <header className="mt-10 flex flex-col gap-3 border-b border-border pb-8">
        <h1 className="font-display text-3xl font-semibold tracking-[-0.01em] text-foreground sm:text-4xl">
          {policy.title}
        </h1>
        <p className="text-sm text-muted-foreground">{policy.status}</p>
        {policy.intro.map((line) => (
          <p key={line} className="text-base leading-relaxed text-foreground">
            {line}
          </p>
        ))}
      </header>

      <nav aria-label={policy.title} className="border-b border-border py-6">
        <ol className="flex flex-col gap-1.5 text-sm">
          {policy.sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                {section.heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="flex flex-col">
        {policy.sections.map((section) => (
          <section key={section.id} id={section.id} className="scroll-mt-6 border-b border-border py-8">
            <h2 className="font-display text-xl font-semibold tracking-[-0.005em] text-foreground">{section.heading}</h2>
            <div className="mt-3 flex flex-col gap-3 text-[15px] leading-relaxed text-foreground">
              {section.body.map((line) => (
                <p key={line}>{line}</p>
              ))}
              {section.list && (
                <ul className="flex list-disc flex-col gap-2.5 pl-5 marker:text-muted-foreground">
                  {section.list.map((line) => (
                    <li key={line} className="pl-1">
                      {line}
                    </li>
                  ))}
                </ul>
              )}
              {section.after?.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="pt-8 text-sm">
        <Link href="/" className="font-medium text-primary underline underline-offset-4">
          {policy.backHome}
        </Link>
      </p>
    </main>
  );
}
