"use client";

import { EnvelopeSimple } from "@phosphor-icons/react";
import { useCopy } from "@/components/settings-provider";
import { ADD_EMAIL_ANCHOR, Toggle } from "@/components/social/social-section";
import { useEmailSettings, useSetEmailPref } from "@/hooks/use-profile";
import type { EmailSettingsResponse, SwitchableKind } from "@/lib/email-kinds";
import { cn } from "@/lib/utils";
import { focusAddEmail, useDrawerNav } from "@/components/account-drawer-nav";

/**
 * Email notices (lib/server/email): the address they go to, the verified
 * primary email, and one switch per kind a person may turn off. Security
 * notices have no switch, only the line saying they always arrive. An
 * account without an email is offered the add-email flow instead, which
 * lives in the same drawer (RewardsPanel, ADD_EMAIL_ANCHOR).
 *
 * The weekly summary (lib/server/weekly) is the one switch that starts
 * off: it is the only email the person did not cause.
 */
const SHOWN_KINDS: readonly SwitchableKind[] = ["orders", "friends", "weekly"];

export function EmailSection({
  heading = "caps",
  offerAdd = true,
  demo,
}: {
  /** Whether the add-email flow is in this drawer to be offered; where it is not, an account without an email sees nothing. */
  offerAdd?: boolean;
  /** `caps`: the settings drawer's small caps label. `row`: a panel's title row, as the account drawer's sections read. */
  heading?: "caps" | "row";
  /** The dev gallery's fixed answer, so the section is seen without an account. */
  demo?: EmailSettingsResponse;
}) {
  const copy = useCopy().email.settings;
  const query = useEmailSettings(!demo);
  const setPref = useSetEmailPref();
  const nav = useDrawerNav();
  const settings = demo ?? query.data;
  if (!settings) return null;

  const title =
    heading === "caps" ? (
      <h3 className="text-[11.5px] font-bold tracking-(--tracking-caps) uppercase text-muted-foreground">
        {copy.sectionLabel}
      </h3>
    ) : (
      <span className="px-3 pt-3 pb-1 text-sm font-medium text-foreground">{copy.sectionLabel}</span>
    );

  if (!settings.address) {
    if (!offerAdd) return null;
    return (
      <section data-ph-mask className={cn("flex flex-col", heading === "caps" && "gap-2")}>
        {title}
        <button
          type="button"
          className="flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-[background-color] duration-150 ease-lift hover:bg-muted/60 active:bg-muted"
          onClick={() => focusAddEmail(nav, ADD_EMAIL_ANCHOR)}
        >
          <EnvelopeSimple weight="duotone" className="size-5 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm text-foreground">{copy.addEmail}</span>
            <span className="text-xs text-muted-foreground">{copy.addEmailSub}</span>
          </span>
        </button>
      </section>
    );
  }

  const prefs = settings.prefs;
  return (
    <section data-ph-mask className={cn("flex flex-col", heading === "caps" && "gap-2")} aria-label={copy.sectionLabel}>
      {title}
      <div className={cn("flex flex-col", heading === "caps" ? "rounded-xl border border-border" : "px-0")}>
        <p className="px-3 pt-3 text-sm text-foreground break-all">{copy.goesTo(settings.address)}</p>
        {!settings.deliverable ? <p className="px-3 pt-1 text-xs text-destructive">{copy.undeliverable}</p> : null}
        <ul className="flex flex-col">
          {SHOWN_KINDS.map((kind) => (
            <li key={kind} className="flex min-h-14 items-center gap-3 px-3 py-2.5">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm text-foreground">{copy.kinds[kind].label}</span>
                <span className="text-xs text-muted-foreground">{copy.kinds[kind].sub}</span>
              </span>
              <Toggle
                label={copy.kinds[kind].label}
                on={prefs[kind]}
                disabled={setPref.isPending || !settings.deliverable}
                onChange={(on) => {
                  if (!demo) setPref.mutate({ kind, enabled: on });
                }}
              />
            </li>
          ))}
        </ul>
        <p className="px-3 pb-3 text-xs text-muted-foreground">{copy.securityAlways}</p>
        {setPref.isError ? <p className="px-3 pb-3 text-xs text-destructive">{copy.saveFailed}</p> : null}
      </div>
    </section>
  );
}
