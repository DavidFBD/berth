import { notFound } from "next/navigation";
import { renderSample, SAMPLE_NOTICES } from "@/lib/server/email/send";
import { EmailSectionGallery } from "./section-gallery";

export const dynamic = "force-dynamic";

/**
 * Dev-only gallery (404 in production): the settings drawer's Email
 * section in each state, then every notice as it renders, sample data
 * only. `?only=section` shows just the section, `?only=<notice name>`
 * one email at full width (the shots use both).
 */
export default async function EmailGalleryPage({ searchParams }: { searchParams: Promise<{ only?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { only } = await searchParams;
  const samples = await Promise.all(
    SAMPLE_NOTICES.filter(({ name }) => !only || only === name).map(async ({ name, notice }) => ({ name, ...(await renderSample(notice)) })),
  );
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8">
      {!only || only === "section" ? <EmailSectionGallery /> : null}
      {only === "section"
        ? null
        : samples.map((sample) => (
            <section key={sample.name} className="flex flex-col gap-2">
              <h2 className="font-mono text-xs text-muted-foreground">
                {sample.name}: {sample.subject}
              </h2>
              <iframe title={sample.name} srcDoc={sample.html} className="h-[640px] w-full rounded-xl border border-border bg-white" />
            </section>
          ))}
    </main>
  );
}
