"use client";

import { useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";

/**
 * Whenever an email session ends, wherever it was ended from (the account
 * drawer, a merge, a link flow, "Sign in again"), the server is asked to
 * clear what it set for that session: today the staff pages' pass
 * (app/api/session/sign-out).
 */
export function SignOutSweep() {
  const { ready, authenticated } = usePrivy();
  const was = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (was.current && !authenticated) {
      void fetch("/api/session/sign-out", { method: "POST", keepalive: true }).catch(() => undefined);
    }
    was.current = authenticated;
  }, [ready, authenticated]);
  return null;
}
