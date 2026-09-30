import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthorizeConsent } from "@/components/assistant/authorize-consent";
import { BerthMark } from "@/components/berth-mark";
import { COPY } from "@/lib/copy";
import { judgeAuthorizeRequest, signConsent, type AuthorizeOutcome } from "@/lib/server/oauth/authorize";
import { publicOrigin } from "@/lib/server/oauth/config";
import { callerKeyFrom } from "@/lib/server/oauth/http";
import { scopeList } from "@/lib/server/oauth/validation";
import { requestAvailability } from "@/lib/server/availability";
import { AuthorizeUnavailable } from "@/components/availability/authorize-unavailable";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Connect to Berth",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * The OAuth authorization endpoint (lib/server/oauth). The request is
 * judged here, on the server, before anything renders: an untrustworthy
 * client or redirect gets this page's own error and no redirect at all,
 * any other problem goes straight back to the client, and a sound request
 * renders the consent screen with its fields signed. Framing is refused
 * (next.config headers), so the screen cannot be dressed up inside
 * someone else's page.
 */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // A parameter given twice is ambiguous, and RFC 6749 says to refuse it: read as absent.
  const one = (key: string) => {
    const value = params[key];
    return typeof value === "string" ? value : null;
  };
  const requestHeaders = await headers();
  const origin = publicOrigin(requestHeaders);
  let outcome: AuthorizeOutcome;
  let request: string | null = null;
  try {
    outcome = await judgeAuthorizeRequest(
      {
        response_type: one("response_type"),
        client_id: one("client_id"),
        redirect_uri: one("redirect_uri"),
        scope: one("scope"),
        state: one("state"),
        code_challenge: one("code_challenge"),
        code_challenge_method: one("code_challenge_method"),
        resource: one("resource"),
      },
      origin,
      { fetchKey: callerKeyFrom(requestHeaders) },
    );
    if (outcome.kind === "consent") request = await signConsent(outcome.request, origin);
  } catch (error) {
    // A database or network hiccup, or a caller past its hourly limit of
    // metadata document fetches (RateLimitedError), must never surface as a
    // 500 to a person midway through connecting: say so calmly and offer the
    // same link again.
    console.error("[oauth] authorize failed", error);
    const again = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (typeof value === "string") again.set(key, value);
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-6 py-10 text-center">
        <BerthMark className="size-12" title="Berth" />
        <h1 className="font-display text-2xl text-foreground">{COPY.authorizeTroubleTitle}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{COPY.authorizeTroubleBody}</p>
        <a href={`/oauth/authorize?${again.toString()}`} className="text-sm font-medium text-foreground underline underline-offset-4">
          {COPY.authorizeTryAgain}
        </a>
      </main>
    );
  }

  if (outcome.kind === "redirect") redirect(outcome.url);

  if (outcome.kind === "error") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-6 py-10 text-center">
        <BerthMark className="size-12" title="Berth" />
        <h1 className="font-display text-2xl text-foreground">{COPY.authorizeErrorTitle}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {outcome.reason === "unknown_client" ? COPY.authorizeErrorUnknownClient : COPY.authorizeErrorRedirect}
        </p>
      </main>
    );
  }

  // Where Berth is not available (lib/availability) no assistant is
  // connected: the soft landing instead of the consent screen, and the
  // decision route refuses an approval on its own too. In `next dev` only,
  // `?country=US` stands in for the header.
  const availability = requestAvailability(requestHeaders, {
    override: { country: one("country"), region: one("region") },
  });
  if (!availability.available) return <AuthorizeUnavailable availability={availability} />;

  return (
    <AuthorizeConsent
      request={request ?? ""}
      party={outcome.request.party}
      redirectHost={outcome.request.redirectHost}
      scopes={scopeList(outcome.request.scope)}
    />
  );
}
