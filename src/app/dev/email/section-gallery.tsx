"use client";

import { EmailSection } from "@/components/email-section";
import type { EmailSettingsResponse } from "@/lib/email-kinds";

const STATES: { label: string; demo: EmailSettingsResponse }[] = [
  { label: "email account", demo: { address: "you@example.com", deliverable: true, prefs: { orders: true, friends: false, weekly: false } } },
  { label: "wallet only account", demo: { address: null, deliverable: false, prefs: { orders: true, friends: true, weekly: false } } },
  { label: "bounced address", demo: { address: "gone@example.com", deliverable: false, prefs: { orders: true, friends: true, weekly: false } } },
];

/** The Email section as the settings drawer shows it, one card per state. */
export function EmailSectionGallery() {
  return (
    <div className="flex flex-col gap-6">
      {STATES.map((state) => (
        <div key={state.label} className="flex flex-col gap-2">
          <p className="font-mono text-xs text-muted-foreground">{state.label}</p>
          <div className="rounded-2xl border border-border bg-card p-4">
            <EmailSection demo={state.demo} />
          </div>
        </div>
      ))}
    </div>
  );
}
