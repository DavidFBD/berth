"use client";

import { Toggle } from "@/components/social/social-section";
import { useCopy } from "@/components/settings-provider";
import { useAnalyticsConsent } from "@/components/analytics/analytics-root";
import { chooseConsent } from "@/lib/analytics-consent";

/**
 * Product analytics, on or off for this browser (lib/analytics-consent):
 * the same choice the consent card asks for, changeable here at any time.
 * A browser that sends Do Not Track or Global Privacy Control keeps it off.
 */
export function AnalyticsSwitch({ link = true }: { link?: boolean } = {}) {
  const words = useCopy().analytics;
  const consent = useAnalyticsConsent();
  const signal = consent === "signal";
  return (
    <section className="flex items-start gap-3" data-analytics-switch>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm text-foreground">{words.title}</span>
        <span className="text-xs leading-relaxed text-muted-foreground">
          {signal ? words.signalNote : words.switchSub}
          {link && (
            <>
              {" "}
              <a href="/privacy#analytics" className="underline underline-offset-4 hover:text-foreground">
                {words.more}
              </a>
            </>
          )}
        </span>
      </span>
      <Toggle
        label={words.title}
        on={consent === "granted"}
        disabled={signal}
        onChange={(on) => chooseConsent(on ? "switchOn" : "switchOff")}
      />
    </section>
  );
}
