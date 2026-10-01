"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLogin, usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/settings-provider";

/**
 * The staff session's client side (docs/adr/0008-staff-area.md). Privy's
 * token lives in the browser; the staff cookie is minted from it by POST
 * /api/staff/session. A non-staff account gets a 404 there and nothing
 * here changes.
 */

async function exchange(getAccessToken: () => Promise<string | null>): Promise<boolean> {
  const token = await getAccessToken().catch(() => null);
  if (!token) return false;
  const response = await fetch("/api/staff/session", { method: "POST", headers: { authorization: `Bearer ${token}` } }).catch(() => null);
  return Boolean(response?.ok);
}

/**
 * On a 404 at a /staff address: a signed in browser asks, once and quietly,
 * whether it may come in. For everyone else the page stays the plain
 * "No page here" it looks like.
 */
export function StaffSessionProbe() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const router = useRouter();
  const asked = useRef(false);
  useEffect(() => {
    if (!ready || !authenticated || asked.current) return;
    if (!/^\/staff(\/|$)/.test(window.location.pathname)) return;
    asked.current = true;
    // Once per page per tab: a staff member at an address that really is
    // missing gets the 404 again after the refresh, and must not loop.
    const key = `berth-staff-probe:${window.location.pathname}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      // Storage refused: the ref above still holds it to once per mount.
    }
    void exchange(getAccessToken).then((ok) => {
      if (!ok) return;
      router.refresh();
      // Let a later visit (a session that ran out) ask again.
      window.setTimeout(() => {
        try {
          window.sessionStorage.removeItem(key);
        } catch {
          // nothing to undo
        }
      }, 5_000);
    });
  }, [ready, authenticated, getAccessToken, router]);
  return null;
}

/**
 * "Confirm it is you": a reveal or a write needs an email code from the
 * last 15 minutes. Signing out of Privy and in again with a new code makes
 * one; the staff cookie is then minted afresh and `onFresh` runs.
 */
export function FreshPrompt({ onFresh, onCancel }: { onFresh: () => void; onCancel?: () => void }) {
  const words = useCopy().staff;
  const { logout, getAccessToken } = usePrivy();
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const { login } = useLogin({
    onComplete: () => {
      void exchange(getAccessToken).then((ok) => {
        if (ok) {
          setState("idle");
          onFresh();
        } else setState("failed");
      });
    },
    onError: () => setState("failed"),
  });
  const start = useCallback(async () => {
    setState("working");
    await logout().catch(() => undefined);
    login();
  }, [logout, login]);
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-lg border border-border bg-secondary px-4 py-3">
      <p className="text-[14px] font-medium text-foreground">{words.fresh.title}</p>
      <p className="text-[13px] leading-relaxed text-muted-foreground">{words.fresh.body}</p>
      {state === "failed" && <p className="text-[13px] text-foreground">{words.fresh.failed}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void start()} disabled={state === "working"}>
          {state === "working" ? words.fresh.working : words.fresh.action}
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {words.confirm.cancel}
          </Button>
        )}
      </div>
    </div>
  );
}

export function SignOutButton() {
  const words = useCopy().staff;
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        void fetch("/api/session/sign-out", { method: "POST" }).finally(() => {
          router.push("/");
          router.refresh();
        });
      }}
    >
      {words.signOut}
    </Button>
  );
}

/** Ends this browser's staff session, if it has one (app/api/session/sign-out, which any browser may call). */
function endStaffSession(): void {
  void fetch("/api/session/sign-out", { method: "POST", keepalive: true }).catch(() => undefined);
}

const RENEW_MS = 10 * 60_000;

/**
 * On every staff page: the staff session lasts only as long as the Privy
 * token it came from, so a fresh token renews it every ten minutes. A
 * Privy session that cannot refresh (signed out, expired) renews nothing,
 * and the staff session ends with its token within the hour; a browser
 * that is no longer signed in to Privy ends it at once.
 */
export function StaffKeepAlive() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      endStaffSession();
      return;
    }
    const renew = () => void exchange(getAccessToken);
    renew();
    const timer = window.setInterval(renew, RENEW_MS);
    return () => window.clearInterval(timer);
  }, [ready, authenticated, getAccessToken]);
  return null;
}

/** "Sign out everywhere": every staff session of this staff member, on every device. */
export function SignOutEverywhereButton() {
  const words = useCopy().staff;
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        void fetch("/api/staff/session/everywhere", { method: "POST" }).finally(() => {
          router.push("/");
          router.refresh();
        });
      }}
    >
      {words.signOutEverywhere}
    </Button>
  );
}
