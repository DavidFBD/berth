import type { Metadata } from "next";
import { socialCard } from "@/lib/og/metadata";
import { LegalPage } from "@/components/legal-page";
import { COPY } from "@/lib/copy";
import { AnalyticsSwitch } from "@/components/analytics/analytics-switch";

export const metadata: Metadata = {
  title: `${COPY.privacyPolicy.title} · Berth`,
  description: COPY.privacyPolicy.intro[0],
  alternates: { canonical: "/privacy" },
  ...socialCard({
    title: `${COPY.privacyPolicy.title} · Berth`,
    description: COPY.og.privacy.line,
    path: "/privacy",
  }),
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
      // Your answer, changeable right here as well as in Settings.
      inSection={process.env.NEXT_PUBLIC_POSTHOG_KEY ? { id: "analytics", node: <AnalyticsSwitch link={false} /> } : undefined}
    />
  );
}
