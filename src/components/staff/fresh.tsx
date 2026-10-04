"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DOOR_ATTR,
  DOOR_MARK_KEY,
  DOOR_PRIVY_TIMEOUT_MS,
  DOOR_WAIT,
  doorDecide,
  doorStart,
} from "@/lib/staff/door";
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

function openNotFound(): void {
  document.documentElement.removeAttribute(DOOR_ATTR);
}

function readMark(): string | null {
  try {
    return window.sessionStorage.getItem(DOOR_MARK_KEY);
  } catch {
    return null;
  }
}

function writeMark(value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(DOOR_MARK_KEY);
    else window.sessionStorage.setItem(DOOR_MARK_KEY, value);
  } catch {
    // Storage refused: the door then cannot guard a reload, so it does not reload.
  }
}

/**
 * The 404 page's door at a /staff address (lib/staff/door). The page's
 * words are hidden behind "Loading" (DOOR_SCRIPT, before first paint)
 * while a signed in browser asks for the staff cookie with a fresh Privy
 * token; on a yes the page loads again and the server's gate draws the
 * area. Anyone else, and anything that goes wrong, gets the 404's words,
 * the same page as any address Berth has no page for.
 */
export function StaffDoor() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  // new: not judged yet; asking: waiting for Privy; knocking: asking the
  // server; done: the 404's words show, or the page is loading again.
  const phase = useRef<"new" | "asking" | "knocking" | "done">("new");

  // Mount: decide whether to ask at all. Also covers a client side
  // navigation, where the inline script never ran: a layout effect, so the
  // 404's words are hidden before that paint, not after it.
  useLayoutEffect(() => {
    if (phase.current === "new") {
      const start = doorStart(window.location.pathname, readMark(), Date.now());
      if (start === "guard") writeMark(null);
      phase.current = start === "ask" ? "asking" : "done";
    }
    if (phase.current === "done") {
      openNotFound();
      return;
    }
    document.documentElement.setAttribute(DOOR_ATTR, DOOR_WAIT);
    // Privy that never gets ready opens nothing, and hides nothing for long.
    const timer = window.setTimeout(openNotFound, DOOR_PRIVY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (phase.current !== "asking" || !ready) return;
    phase.current = "knocking";
    void doorDecide({
      authenticated,
      path: window.location.pathname,
      now: Date.now,
      store: { read: readMark, write: writeMark },
      getToken: () => getAccessToken(),
      post: async (token) => {
        const response = await fetch("/api/staff/session", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        }).catch(() => null);
        return response ? response.status : null;
      },
      sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
    }).then((next) => {
      phase.current = "done";
      if (next === "open") {
        openNotFound();
        return;
      }
      // A navigation this page starts itself carries the SameSite=Strict
      // cookie even when the visit began with a link from another site.
      window.location.replace(window.location.href);
    });
  }, [ready, authenticated, getAccessToken]);

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
