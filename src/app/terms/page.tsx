import type { Metadata } from "next";
import { socialCard } from "@/lib/og/metadata";
import { LegalPage } from "@/components/legal-page";
import { COPY } from "@/lib/copy";

export const metadata: Metadata = {
  title: `${COPY.termsOfUse.title} · Berth`,
  description: COPY.termsOfUse.intro[0],
  alternates: { canonical: "/terms" },
  ...socialCard({
    title: `${COPY.termsOfUse.title} · Berth`,
    description: COPY.og.terms.line,
    path: "/terms",
  }),
};

/**
 * The public terms of use, beside the privacy policy. The words live in
 * lib/copy (`termsOfUse`, with TERMS_AVAILABILITY for where Berth is offered).
 */
export default function TermsPage() {
  return (
    <LegalPage
      doc={COPY.termsOfUse}
      related={[
        { href: "/privacy", label: COPY.privacyPolicy.title },
        { href: "/assistants", label: COPY.assistantsHelp.title },
      ]}
    />
  );
}
