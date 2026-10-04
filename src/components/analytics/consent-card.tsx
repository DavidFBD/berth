"use client";

import { useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";
import { chooseConsent } from "@/lib/analytics-consent";

/**
 * "Help improve Berth": the one quiet question about product analytics
 * (lib/analytics-consent). A flat card at the foot of the screen, above the
 * phone's Ask dock, left on a wide screen so it never sits on a toast. It
 * publishes its height as --consent-clearance so the toast stack rises
 * above it while it shows. Allow is in ink, so the page keeps its one
 * accent; No thanks is as easy to reach. Nothing is sent while it waits.
 */
export function ConsentCard() {
  const words = useCopy().analytics;
  const card = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--consent-clearance", `${element.offsetHeight + 12}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--consent-clearance");
    };
  }, []);

  return (
    <div
      ref={card}
      role="region"
      aria-label={words.title}
      data-consent-card
      className="fixed inset-x-4 z-50 flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-foreground sm:right-auto sm:left-6 sm:w-[22rem]"
      style={{ bottom: "calc(max(var(--ask-dock-clearance, 0px), env(safe-area-inset-bottom)) + 16px)" }}
    >
      <div className="flex flex-col gap-1.5">
        <h2 className="font-heading text-[15px] leading-snug tracking-[-0.01em]">{words.title}</h2>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {words.body}{" "}
          <a href="/privacy#analytics" className="underline underline-offset-4 hover:text-foreground">
            {words.more}
          </a>
        </p>
      </div>
      <div className="flex gap-2">
        {/* In ink, not the accent: the page's own accent (Sign in, Buy) stays the one. */}
        <Button className="h-9 flex-1 bg-foreground px-4 text-background hover:bg-foreground/85" onClick={() => chooseConsent("allow")}>
          {words.allow}
        </Button>
        <Button variant="outline" className="h-9 flex-1 px-4" onClick={() => chooseConsent("decline")}>
          {words.decline}
        </Button>
      </div>
    </div>
  );
}
