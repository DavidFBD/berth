import type { ReactNode } from "react";
import Link from "next/link";
import { BerthMark } from "@/components/berth-mark";
import { COPY, type LegalDocument } from "@/lib/copy";

/**
 * A public legal page (app/privacy, app/terms): the mark home, the title and
 * effective date, a contents list, and the sections. Server rendered and
 * outside AuthGate, so it reads the same signed in, signed out and to a
 * crawler. The words live in lib/copy; this only lays them out.
 */
export function LegalPage({
  doc,
  related = [],
  inSection,
}: {
  doc: LegalDocument;
  related?: readonly { href: string; label: string }[];
  /** A control shown at the end of one section, by its id (the analytics switch in the privacy policy). */
  inSection?: { id: string; node: ReactNode };
}) {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 pt-10 pb-[max(env(safe-area-inset-bottom),3rem)] sm:px-8 sm:pt-14">
      <Link href="/" className="inline-flex items-center gap-2.5 text-foreground" aria-label={doc.backHome}>
        <BerthMark className="size-7" title="Berth" />
        <span className="font-wordmark text-lg">{COPY.brand}</span>
      </Link>

      <header className="mt-10 flex flex-col gap-3 border-b border-border pb-8">
        <h1 className="font-display text-3xl tracking-[-0.02em] text-foreground sm:text-4xl">
          {doc.title}
        </h1>
        <p className="text-sm text-muted-foreground">{doc.status}</p>
        {doc.intro.map((line) => (
          <p key={line} className="text-base leading-relaxed text-foreground">
            {line}
          </p>
        ))}
      </header>

      <nav aria-label={doc.title} className="border-b border-border py-6">
        <ol className="flex flex-col gap-1.5 text-sm">
          {doc.sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                {section.heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="flex flex-col">
        {doc.sections.map((section) => (
          <section key={section.id} id={section.id} className="scroll-mt-6 border-b border-border py-8">
            <h2 className="font-display text-xl tracking-[-0.02em] text-foreground">{section.heading}</h2>
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
              {inSection?.id === section.id && <div className="mt-2 rounded-lg border border-border bg-card p-4">{inSection.node}</div>}
            </div>
          </section>
        ))}
      </div>

      <p className="flex flex-wrap gap-x-6 gap-y-2 pt-8 text-sm">
        <Link href="/" className="font-medium text-primary underline underline-offset-4">
          {doc.backHome}
        </Link>
        {related.map((link) => (
          <Link key={link.href} href={link.href} className="text-muted-foreground underline underline-offset-4 hover:text-foreground">
            {link.label}
          </Link>
        ))}
      </p>
    </main>
  );
}
