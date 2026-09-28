import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { COPY } from "@/lib/copy";

export const metadata: Metadata = {
  title: `${COPY.privacyPolicy.title} · Berth`,
  description: COPY.privacyPolicy.intro[0],
  alternates: { canonical: "/privacy" },
};

/**
 * The public privacy policy, required by the assistant directories that
 * list Berth's connector. The words live in lib/copy (`privacyPolicy`).
 */
export default function PrivacyPage() {
  return (
    <LegalPage
      doc={COPY.privacyPolicy}
      related={[
        { href: "/terms", label: COPY.termsOfUse.title },
        { href: "/assistants", label: COPY.assistantsHelp.title },
      ]}
    />
  );
}
