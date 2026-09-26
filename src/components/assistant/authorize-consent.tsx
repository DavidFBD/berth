"use client";

import { useState } from "react";
import { Eye, NotePencil, ShieldCheck } from "@phosphor-icons/react";
import { BerthMark } from "@/components/berth-mark";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useCopy } from "@/components/settings-provider";
import { AuthGate } from "@/components/welcome-screen";
import { useAuthorizeDecision, useIdentityLabel } from "@/hooks/use-profile";
import { shortenAddress } from "@/lib/format";
import type { ConsentParty } from "@/lib/assistant-party";
import { CONSENT_TTL_SECONDS } from "@/lib/server/oauth/config";

/**
 * The consent screen an assistant sends a person to (app/oauth/authorize).
 * Signed out, it is the usual welcome screen with one line saying why they
 * are here; signed in, it names the app, the account, what the app can and
 * cannot do, and where the browser goes afterwards. The answer goes to the
 * server with the signed request; the server builds the redirect.
 *
 * Works in a new tab or a popup alike: nothing here reads window.opener.
 */
export function AuthorizeConsent({
  request,
  party,
  redirectHost,
  scopes,
}: {
  /** The signed consent request (lib/server/oauth/authorize). */
  request: string;
  party: ConsentParty;
  redirectHost: string;
  scopes: string[];
}) {
  const copy = useCopy();
  return (
    <AuthGate lead={copy.authorizeSignInLead(party)}>
      <ConsentCard request={request} party={party} redirectHost={redirectHost} scopes={scopes} />
    </AuthGate>
  );
}

/** The signed in half on its own; exported for the dev gallery (/dev/account?consent). */
export function ConsentCard({
  request,
  party,
  redirectHost,
  scopes,
}: {
  request: string;
  party: ConsentParty;
  redirectHost: string;
  scopes: string[];
}) {
  const copy = useCopy();
  const identity = useIdentityLabel();
  const decide = useAuthorizeDecision();
  const [pressed, setPressed] = useState<"approve" | "decline" | null>(null);
  const [leaving, setLeaving] = useState(false);
  // "expired" when the answer failed after the signed request's life, so
  // it says to start again rather than to try again.
  const [failed, setFailed] = useState<false | "failed" | "expired">(false);
  const [renderedAt] = useState(() => Date.now());
  const who = identity.email ?? (identity.wallet ? shortenAddress(identity.wallet, 4) : null);
  const unverified = copy.authorizeUnverified(party);

  const answer = async (decision: "approve" | "decline") => {
    setFailed(false);
    setPressed(decision);
    const redirect = await decide.mutateAsync({ request, decision }).catch(() => null);
    if (!redirect) {
      setFailed(Date.now() - renderedAt > CONSENT_TTL_SECONDS * 1000 ? "expired" : "failed");
      setPressed(null);
      return;
    }
    setLeaving(true);
    window.location.assign(redirect);
  };

  const busy = decide.isPending || leaving;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
      <div className="flex flex-col items-center gap-4 text-center">
        <BerthMark className="size-12" title="Berth" />
        <h1 className="font-display text-2xl font-semibold tracking-[-0.01em] text-foreground">
          {copy.authorizeTitle(party)}
        </h1>
        {unverified && <p className="text-sm font-medium text-foreground">{unverified}</p>}
        {who && <p className="text-sm text-muted-foreground">{copy.authorizeAccount(who)}</p>}
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sheet">
        <p className="text-sm font-medium text-foreground">{copy.authorizeCanLead}</p>
        <ul className="flex flex-col gap-3">
          {scopes.includes("berth.read") && (
            <li className="flex gap-3 text-sm text-foreground">
              <Eye className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
              <span>{copy.authorizeScopeRead}</span>
            </li>
          )}
          {scopes.includes("berth.draft") && (
            <li className="flex gap-3 text-sm text-foreground">
              <NotePencil className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
              <span>{copy.authorizeScopeDraft}</span>
            </li>
          )}
        </ul>
        <div className="flex gap-3 border-t border-border pt-3 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span>{copy.authorizeCannot}</span>
        </div>
      </section>

      <div className="flex flex-col gap-2">
        <p className="text-center text-sm text-muted-foreground">{copy.authorizeReturnTo(redirectHost)}</p>
        <Button className="h-12 w-full rounded-full text-base font-semibold" disabled={busy} onClick={() => void answer("approve")}>
          {busy && pressed === "approve" ? <Spinner className="size-5" /> : copy.authorizeApprove}
        </Button>
        <Button
          variant="outline"
          className="h-12 w-full rounded-full text-base font-semibold"
          disabled={busy}
          onClick={() => void answer("decline")}
        >
          {busy && pressed === "decline" ? <Spinner className="size-5" /> : copy.authorizeDecline}
        </Button>
        <p className="min-h-4 text-center text-xs text-muted-foreground" aria-live="polite" role="status">
          {leaving
            ? copy.authorizeReturning(party)
            : failed === "expired"
              ? copy.authorizeExpired
              : failed
                ? copy.authorizeFailed
                : ""}
        </p>
      </div>
    </main>
  );
}
