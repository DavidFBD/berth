"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Analytics as VercelAnalytics, type BeforeSend } from "@vercel/analytics/next";
import type { BeforeSendFn, PostHog } from "posthog-js";
import { useAccountHeaders } from "@/hooks/use-profile";
import {
  analyticsConfigured,
  environmentFor,
  posthogConfig,
  recordingAllowedOn,
  promptAllowedOn,
  scrubEvent,
  scrubVercelEvent,
  setAnalyticsSink,
  startAnonymous,
  trackingAllowedOn,
  type OutgoingEvent,
} from "@/lib/analytics";
import { asks, readConsent, sends, subscribeConsent, type ConsentState } from "@/lib/analytics-consent";
import { ConsentCard } from "@/components/analytics/consent-card";

/**
 * Product analytics, wired (lib/analytics is the rulebook). Without
 * NEXT_PUBLIC_POSTHOG_KEY nothing here does anything. Without consent
 * posthog-js is not even downloaded, so nothing can be sent: no event, no
 * cookie, no request. With consent it loads once, counts App Router page
 * views by hand, names the account by its keyed hash only, and records a
 * masked replay wherever recording is allowed.
 */
const ENV = {
  key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
};
export const ANALYTICS_CONFIGURED = analyticsConfigured(ENV);

function environment(): string {
  return environmentFor({
    hostname: typeof window === "undefined" ? "" : window.location.hostname,
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV,
  });
}

/** The consent state in this browser, live; "ask" on the server and the first frame. */
export function useAnalyticsConsent(): ConsentState {
  return useSyncExternalStore(subscribeConsent, readConsent, () => "ask" as const);
}

const vercelBeforeSend: BeforeSend = (event) =>
  scrubVercelEvent(event, { consented: readConsent() === "granted", pathname: currentPath() });

let client: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;

function currentPath(): string {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

// The last gate: consent as the browser holds it this instant, then lib/analytics' scrub.
const beforeSend: BeforeSendFn = (data) =>
  data && readConsent() === "granted" ? (scrubEvent(data as unknown as OutgoingEvent, { environment: environment(), pathname: currentPath() }) as unknown as typeof data | null) : null;

async function load(): Promise<PostHog | null> {
  if (client) return client;
  if (!ANALYTICS_CONFIGURED || !ENV.key) return null;
  loading ??= (async () => {
    const [{ default: posthog }] = await Promise.all([
      import("posthog-js"),
      // The replay recorder (rrweb and PostHog's recorder class), bundled:
      // nothing is fetched from PostHog's CDN. dist/recorder alone is rrweb
      // without the class, and replay could never start.
      import("posthog-js/dist/posthog-recorder"),
    ]);
    // Remote config as plain JSON, never as a script: answer the script
    // request with nothing, so PostHog falls back to JSON without warning
    // that external scripts are disabled.
    const extensions = (window as unknown as { __PosthogExtensions__?: { loadExternalDependency?: (ph: unknown, kind: string, done: (error?: string) => void) => void } })
      .__PosthogExtensions__;
    const loadDependency = extensions?.loadExternalDependency;
    if (extensions && loadDependency) {
      extensions.loadExternalDependency = (ph, kind, done) => (kind === "remote-config" ? done() : loadDependency(ph, kind, done));
    }
    // Consent taken back while the library downloaded: never start it.
    if (readConsent() !== "granted") throw new Error("consent withdrawn");
    posthog.init(
      ENV.key!,
      // Recording waits: it starts (page view effect, below) only once the
      // identity is settled, so no snapshot is taken under a stale name.
      posthogConfig({ host: ENV.host, granted: true, pathname: currentPath(), beforeSend, deferRecording: true }),
    );
    // Every load starts anonymous: a name kept from an earlier visit (a
    // sign out this page never saw) must never label this one. The account
    // identifies itself again once the server answers (AnalyticsIdentity).
    startAnonymous(posthog);
    client = posthog;
    // Taken back during init: stop and forget at once.
    if (readConsent() !== "granted") withdraw(posthog);
    return posthog;
  })().catch(() => {
    loading = null;
    return null;
  });
  return loading;
}

/** Remove what PostHog kept in this browser: its local and session storage and its cookie (its opt-out marker stays). */
function forgetPosthogStorage(): void {
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (/^ph_.*_posthog$/.test(key)) window.localStorage.removeItem(key);
    }
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith("ph_")) window.sessionStorage.removeItem(key);
    }
    for (const part of document.cookie.split(";")) {
      const name = part.split("=")[0]?.trim();
      if (name && /^ph_.*_posthog$/.test(name)) document.cookie = `${name}=; Max-Age=0; path=/`;
    }
  } catch {
    // Nothing to remove, or storage blocked.
  }
}

/** Consent taken back: stop recording, forget the person, opt out, and clear storage. */
function withdraw(posthog: PostHog): void {
  setAnalyticsSink(null);
  posthog.stopSessionRecording();
  posthog.reset(true);
  posthog.opt_out_capturing();
  posthog.set_config({ persistence: "memory", disable_session_recording: true });
  forgetPosthogStorage();
}

export function AnalyticsRoot() {
  const consent = useAnalyticsConsent();
  const pathname = usePathname() ?? "/";
  const granted = ANALYTICS_CONFIGURED && sends(consent);
  const [loaded, setReady] = useState(false);
  // Loaded once stays loaded; it counts only while consent holds.
  const ready = loaded && granted;

  // Never loaded from a staff page; a later page outside it may load it.
  const staffPage = !trackingAllowedOn(pathname);

  // Consent given: load, attach the sink. Taken back: stop at once and forget.
  useEffect(() => {
    if (!ANALYTICS_CONFIGURED) return;
    let cancelled = false;
    if (granted && !staffPage) {
      void load().then((posthog) => {
        if (cancelled || !posthog || readConsent() !== "granted") return;
        if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing({ captureEventName: null });
        posthog.set_config({ persistence: "localStorage+cookie" });
        setAnalyticsSink({
          capture: (name, props, options) =>
            posthog.capture(name, props, options?.beacon ? { transport: "sendBeacon" } : undefined),
        });
        setReady(true);
      });
    } else if (!granted) {
      setAnalyticsSink(null);
      if (client) withdraw(client);
    }
    return () => {
      cancelled = true;
    };
  }, [granted, staffPage]);

  // Page views by hand (App Router), and replay paused where it is not allowed.
  useEffect(() => {
    if (!ready || !client) return;
    if (recordingAllowedOn(pathname)) {
      if (!client.sessionRecordingStarted()) client.startSessionRecording();
    } else if (client.sessionRecordingStarted()) {
      client.stopSessionRecording();
    }
    if (trackingAllowedOn(pathname)) client.capture("$pageview");
  }, [ready, pathname]);

  return (
    <>
      {/* Vercel's page counts too, under the same consent (lib/analytics scrubVercelEvent). */}
      {sends(consent) && trackingAllowedOn(pathname) && <VercelAnalytics beforeSend={vercelBeforeSend} />}
      {ready && <AnalyticsIdentity />}
      {ANALYTICS_CONFIGURED && asks(consent) && promptAllowedOn(pathname) && <ConsentCard />}
    </>
  );
}

/**
 * The account's name in PostHog: the server's keyed hash of the account id
 * (app/api/analytics-id), never the id, email, wallet or username. Never
 * asks a wallet for a signature. Reset when the account signs out or
 * changes.
 */
function AnalyticsIdentity() {
  const { key, headers } = useAccountHeaders({ prompt: false });
  const last = useRef<string | null>(null);
  useEffect(() => {
    const posthog = client;
    if (!posthog) return;
    if (last.current && last.current !== key) posthog.reset();
    last.current = key;
    if (!key) return;
    let cancelled = false;
    void (async () => {
      const auth = await headers();
      if (!auth || cancelled) return;
      const response = await fetch("/api/analytics-id", {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: "{}",
      }).catch(() => null);
      if (!response?.ok || cancelled) return;
      const { id } = (await response.json().catch(() => ({}))) as { id?: unknown };
      if (typeof id !== "string" || !/^[0-9a-f]{64}$/.test(id) || posthog.get_distinct_id() === id) return;
      // Named as someone else (another account used this browser before): start fresh first.
      if (posthog.get_property("$user_state") === "identified") posthog.reset();
      posthog.identify(id);
    })();
    return () => {
      cancelled = true;
    };
    // headers changes identity with the key; the key alone decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}
